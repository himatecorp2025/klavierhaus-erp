"use strict";

const fs = require("node:fs");
const path = require("node:path");
const zlib = require("node:zlib");
const { createFontMetrics, jpegDimensions } = require("./guest-list-pdf");

const GOLD = "0.95 0.73 0.18";
const GOLD_DEEP = "0.62 0.39 0.05";
const CREAM = "0.98 0.97 0.91";
const MUTED = "0.72 0.69 0.61";
const SILVER = "0.70 0.71 0.71";
const DARK = "0.055 0.055 0.055";
const GOLD_RGB = Object.freeze([0.62, 0.39, 0.05]);
const SILVER_RGB = Object.freeze([0.70, 0.71, 0.71]);
const DARK_RGB = Object.freeze([0.055, 0.055, 0.055]);
const WHITE_RGB = Object.freeze([1, 1, 1]);
const LOGO_SPECS = Object.freeze({
  LogoWhite: Object.freeze({ tint: WHITE_RGB }),
  LogoBlack: Object.freeze({ tint: DARK_RGB }),
  LogoGold: Object.freeze({ tint: GOLD_RGB })
});
const BOARDING_PASS = { width: 612, height: 252 };
const LETTER = { width: 612, height: 792 };

function number(value) {
  return Number(value).toFixed(2).replace(/\.00$/, "");
}

function safeText(value) {
  return String(value ?? "").replace(/[\r\n\t]+/g, " ").replace(/\s+/g, " ").trim();
}

function paethPredictor(left, above, upperLeft) {
  const estimate = left + above - upperLeft;
  const leftDistance = Math.abs(estimate - left);
  const aboveDistance = Math.abs(estimate - above);
  const upperLeftDistance = Math.abs(estimate - upperLeft);
  if (leftDistance <= aboveDistance && leftDistance <= upperLeftDistance) return left;
  if (aboveDistance <= upperLeftDistance) return above;
  return upperLeft;
}

function readPngAsRgba(buffer) {
  if (buffer.length < 33 || buffer.toString("hex", 0, 8) !== "89504e470d0a1a0a") throw new Error("INVALID_LOGO_PNG");
  const width = buffer.readUInt32BE(16);
  const height = buffer.readUInt32BE(20);
  const bitDepth = buffer[24];
  const colorType = buffer[25];
  const interlace = buffer[28];
  const channelsByColorType = { 0: 1, 2: 3, 4: 2, 6: 4 };
  const channels = colorType === 3 ? 1 : channelsByColorType[colorType];
  if (!width || !height || bitDepth !== 8 || !channels || interlace !== 0) throw new Error("UNSUPPORTED_LOGO_PNG");
  const idat = [];
  let palette = null;
  let transparency = null;
  let offset = 8;
  while (offset + 12 <= buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString("ascii", offset + 4, offset + 8);
    const start = offset + 8;
    const end = start + length;
    if (end + 4 > buffer.length) throw new Error("INVALID_LOGO_PNG");
    if (type === "IDAT") idat.push(buffer.subarray(start, end));
    if (type === "PLTE") palette = Buffer.from(buffer.subarray(start, end));
    if (type === "tRNS") transparency = Buffer.from(buffer.subarray(start, end));
    if (type === "IEND") break;
    offset = end + 4;
  }
  if (colorType === 3 && (!palette || palette.length < 3 || palette.length % 3 !== 0)) throw new Error("INVALID_LOGO_PNG_PALETTE");
  const rowBytes = width * channels;
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const expected = height * (rowBytes + 1);
  if (raw.length < expected) throw new Error("INVALID_LOGO_PNG_DATA");
  const rows = [];
  let sourceOffset = 0;
  let previous = Buffer.alloc(rowBytes);
  for (let y = 0; y < height; y += 1) {
    const filter = raw[sourceOffset++];
    const encoded = raw.subarray(sourceOffset, sourceOffset + rowBytes);
    sourceOffset += rowBytes;
    const row = Buffer.alloc(rowBytes);
    for (let x = 0; x < rowBytes; x += 1) {
      const left = x >= channels ? row[x - channels] : 0;
      const above = previous[x] || 0;
      const upperLeft = x >= channels ? previous[x - channels] || 0 : 0;
      if (filter === 0) row[x] = encoded[x];
      else if (filter === 1) row[x] = (encoded[x] + left) & 0xff;
      else if (filter === 2) row[x] = (encoded[x] + above) & 0xff;
      else if (filter === 3) row[x] = (encoded[x] + Math.floor((left + above) / 2)) & 0xff;
      else if (filter === 4) row[x] = (encoded[x] + paethPredictor(left, above, upperLeft)) & 0xff;
      else throw new Error("UNSUPPORTED_LOGO_PNG_FILTER");
    }
    rows.push(row);
    previous = row;
  }
  const rgba = Buffer.alloc(width * height * 4);
  let targetOffset = 0;
  rows.forEach((row) => {
    for (let x = 0; x < width; x += 1) {
      const source = x * channels;
      let red;
      let green;
      let blue;
      let alpha = 255;
      if (colorType === 3) {
        const paletteIndex = row[source];
        const paletteOffset = paletteIndex * 3;
        if (paletteOffset + 2 >= palette.length) throw new Error("INVALID_LOGO_PNG_PALETTE_INDEX");
        red = palette[paletteOffset];
        green = palette[paletteOffset + 1];
        blue = palette[paletteOffset + 2];
        alpha = transparency && paletteIndex < transparency.length ? transparency[paletteIndex] : 255;
      } else {
        red = row[source];
        green = colorType === 0 || colorType === 4 ? red : row[source + 1];
        blue = colorType === 0 || colorType === 4 ? red : row[source + 2];
        alpha = colorType === 6 ? row[source + 3] : colorType === 4 ? row[source + 1] : 255;
      }
      rgba[targetOffset++] = red;
      rgba[targetOffset++] = green;
      rgba[targetOffset++] = blue;
      rgba[targetOffset++] = alpha;
    }
  });
  return { width, height, rgba };
}

function colorizeLogo(source, tint) {
  const rgb = Buffer.alloc(source.width * source.height * 3);
  const alpha = Buffer.alloc(source.width * source.height);
  let targetOffset = 0;
  let alphaOffset = 0;
  for (let sourceOffset = 0; sourceOffset < source.rgba.length; sourceOffset += 4) {
    const opacity = source.rgba[sourceOffset + 3];
    for (let channel = 0; channel < 3; channel += 1) {
      rgb[targetOffset++] = Math.round(tint[channel] * 255);
    }
    alpha[alphaOffset++] = opacity;
  }
  return { width: source.width, height: source.height, colorSpace: "/DeviceRGB", filter: "/FlateDecode", data: zlib.deflateSync(rgb), softMask: { width: source.width, height: source.height, colorSpace: "/DeviceGray", filter: "/FlateDecode", data: zlib.deflateSync(alpha) } };
}

function readLogoSource(logoPath) {
  if (!logoPath) return null;
  try {
    const buffer = fs.readFileSync(logoPath);
    if (buffer.toString("hex", 0, 8) === "89504e470d0a1a0a") return { type: "png", ...readPngAsRgba(buffer) };
    if (buffer.length > 4 && buffer[0] === 0xff && buffer[1] === 0xd8) {
      const dimensions = jpegDimensions(buffer);
      return { type: "jpeg", width: dimensions.width, height: dimensions.height, colorSpace: dimensions.components === 1 ? "/DeviceGray" : "/DeviceRGB", filter: "/DCTDecode", data: buffer };
    }
  } catch (_error) {
    return null;
  }
  return null;
}

function readLogoVariants(logoPath) {
  const fallbackPath = path.join(__dirname, "assets", "klavierhaus-logo-white.png");
  const source = readLogoSource(logoPath) || readLogoSource(fallbackPath);
  if (!source) return {};
  if (source.type === "jpeg") {
    const canonical = readLogoSource(fallbackPath);
    if (canonical?.type === "png") return { LogoOriginal: source, ...Object.fromEntries(Object.entries(LOGO_SPECS).map(([name, spec]) => [name, colorizeLogo(canonical, spec.tint)])) };
    return { LogoOriginal: source };
  }
  return Object.fromEntries(Object.entries(LOGO_SPECS).map(([name, spec]) => [name, colorizeLogo(source, spec.tint)]));
}

function logoCommand(hasLogo, x, y, width, height, resourceName = "LogoWhite") {
  return hasLogo ? `q ${number(width)} 0 0 ${number(height)} ${number(x)} ${number(y)} cm /${resourceName} Do Q\n` : "";
}

function rgbColor(values) {
  return values.map((value) => Number(value).toFixed(4).replace(/0+$/, "").replace(/\.$/, "") || "0").join(" ");
}

function interpolateColor(left, right, amount) {
  return left.map((value, index) => value + (right[index] - value) * amount);
}

function metallicColor(stops, amount) {
  for (let index = 1; index < stops.length; index += 1) {
    if (amount <= stops[index][0]) {
      const [leftStop, leftColor] = stops[index - 1];
      const [rightStop, rightColor] = stops[index];
      return interpolateColor(leftColor, rightColor, (amount - leftStop) / (rightStop - leftStop));
    }
  }
  return stops[stops.length - 1][1];
}

function ticketBackground(palette) {
  if (palette.designType === "NORMAL") return `${palette.background} rg 0 0 ${number(BOARDING_PASS.width)} ${number(BOARDING_PASS.height)} re f\n`;
  const stops = palette.designType === "VIP"
    ? [[0, [0.76, 0.57, 0.27]], [0.25, [0.84, 0.66, 0.36]], [0.50, [0.88, 0.71, 0.42]], [0.75, [0.84, 0.66, 0.36]], [1, [0.76, 0.57, 0.27]]]
    : [[0, [0.62, 0.63, 0.63]], [0.25, [0.68, 0.69, 0.69]], [0.50, [0.72, 0.73, 0.73]], [0.75, [0.68, 0.69, 0.69]], [1, [0.62, 0.63, 0.63]]];
  const bands = 256;
  const commands = [];
  for (let index = 0; index < bands; index += 1) {
    const y = BOARDING_PASS.height * index / bands;
    const bandHeight = BOARDING_PASS.height / bands + 0.15;
    commands.push(`${rgbColor(metallicColor(stops, index / (bands - 1)))} rg 0 ${number(y)} ${number(BOARDING_PASS.width)} ${number(bandHeight)} re f\n`);
  }
  return commands.join("");
}

function ticketTexture(palette) {
  const colors = palette.designType === "NORMAL"
    ? ["0.09 0.09 0.09", "0.035 0.035 0.035"]
    : palette.designType === "VIP"
      ? ["0.92 0.72 0.34", "0.52 0.34 0.10"]
      : ["0.86 0.87 0.87", "0.53 0.55 0.55"];
  let seed = palette.designType === "VIP" ? 0x9e3779b9 : palette.designType === "HONORARY" ? 0x243f6a88 : 0x1f123bb5;
  const commands = [];
  for (let index = 0; index < 900; index += 1) {
    seed = (Math.imul(seed ^ (seed >>> 16), 2246822519) + 3266489917) >>> 0;
    const x = (seed % 612) + 2;
    seed = (Math.imul(seed ^ (seed >>> 13), 3266489917) + 668265263) >>> 0;
    const y = seed % 252;
    seed = (Math.imul(seed ^ (seed >>> 16), 2246822519) + 3266489917) >>> 0;
    const length = 0.12 + (seed % 12) / 40;
    const slope = ((seed >>> 8) % 7 - 3) / 180;
    commands.push(`${colors[index % 2]} RG 0.1 w ${number(x)} ${number(y)} m ${number(x + length)} ${number(y + slope)} l S\n`);
  }
  return commands.join("");
}

function unicodeHex(value) {
  return [...safeText(value)].map((character) => Math.min(character.codePointAt(0), 0xffff).toString(16).padStart(4, "0")).join("").toUpperCase();
}

function textCommand(text, x, y, size, color = CREAM, options = {}) {
  const tracking = Number(options.tracking || 0);
  const shear = Number(options.shear || 0);
  const renderMode = options.bold ? `0.24 w 2 Tr` : "0 Tr";
  const characterSpacing = tracking ? `${number(tracking)} Tc ` : "";
  return `${color} rg BT /F1 ${number(size)} Tf ${characterSpacing}${renderMode} 1 ${number(shear)} 0 1 ${number(x)} ${number(y)} Tm <${unicodeHex(text)}> Tj ET\n`;
}

function textWidth(text, size, metrics, tracking = 0) {
  const source = safeText(text);
  const glyphWidth = [...source].reduce((total, character) => total + metrics.widthForGlyph(metrics.glyphForCode(Math.min(character.codePointAt(0), 0xffff))) * size / 1000, 0);
  return glyphWidth + Math.max(0, source.length - 1) * Number(tracking || 0);
}

function centeredTextCommand(text, y, size, color, metrics, options = {}) {
  const width = textWidth(text, size, metrics, options.tracking || 0);
  return textCommand(text, (BOARDING_PASS.width - width) / 2, y, size, color, options);
}

function truncate(text, maxWidth, size, metrics) {
  const source = safeText(text);
  let result = "";
  let width = 0;
  for (const character of source) {
    const code = Math.min(character.codePointAt(0), 0xffff);
    const glyphWidth = metrics.widthForGlyph(metrics.glyphForCode(code)) * size / 1000;
    if (width + glyphWidth > maxWidth) return `${result.trimEnd()}…`;
    result += character;
    width += glyphWidth;
  }
  return result;
}

class PdfBuilder {
  constructor() { this.objects = []; }
  reserve() { this.objects.push(null); return this.objects.length; }
  add(value) { const id = this.reserve(); this.set(id, value); return id; }
  set(id, value) { this.objects[id - 1] = Buffer.isBuffer(value) ? value : Buffer.from(String(value), "binary"); }
  stream(dictionary, bytes) {
    const data = Buffer.isBuffer(bytes) ? bytes : Buffer.from(String(bytes), "binary");
    return Buffer.concat([Buffer.from(`<< ${dictionary} /Length ${data.length} >>\nstream\n`, "binary"), data, Buffer.from("\nendstream", "binary")]);
  }
  serialize(rootId, infoId) {
    const pieces = [Buffer.from("%PDF-1.7\n%\xFF\xFF\xFF\xFF\n", "binary")];
    const offsets = [0];
    let position = pieces[0].length;
    this.objects.forEach((object, index) => {
      offsets.push(position);
      const header = Buffer.from(`${index + 1} 0 obj\n`, "binary");
      const footer = Buffer.from("\nendobj\n", "binary");
      pieces.push(header, object, footer);
      position += header.length + object.length + footer.length;
    });
    const xref = position;
    const rows = offsets.slice(1).map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`).join("");
    pieces.push(Buffer.from(`xref\n0 ${this.objects.length + 1}\n0000000000 65535 f \n${rows}trailer\n<< /Size ${this.objects.length + 1} /Root ${rootId} 0 R /Info ${infoId} 0 R >>\nstartxref\n${xref}\n%%EOF\n`, "binary"));
    return Buffer.concat(pieces);
  }
}

function usedCodes(values) {
  const codes = new Set([32, 45, 47, 58, 46, 36, 40, 41, 44, 35]);
  values.forEach((value) => [...safeText(value)].forEach((character) => codes.add(Math.min(character.codePointAt(0), 0xffff))));
  return [...codes].sort((left, right) => left - right);
}

function createToUnicode(codes) {
  const mappings = codes.map((code) => `<${code.toString(16).padStart(4, "0")}> <${code.toString(16).padStart(4, "0")}>`).join("\n");
  return `/CIDInit /ProcSet findresource begin\n12 dict begin\nbegincmap\n/CIDSystemInfo << /Registry (Adobe) /Ordering (Identity) /Supplement 0 >> def\n/CMapName /KlavierhausUnicode def\n/CMapType 2 def\n1 begincodespacerange\n<0000> <FFFF>\nendcodespacerange\n${codes.length} beginbfchar\n${mappings}\nendbfchar\nendcmap\nCMapName currentdict /CMap defineresource pop\nend\nend`;
}

function addFont(pdf, labels, fontPath) {
  const font = fs.readFileSync(fontPath || path.join(__dirname, "assets", "DejaVuSans.ttf"));
  const fontName = /DejaVuSerif/i.test(path.basename(fontPath || "")) ? "DejaVuSerif" : "DejaVuSans";
  const metrics = createFontMetrics(font);
  const codes = usedCodes(labels);
  const cidMap = Buffer.alloc((Math.max(...codes) + 1) * 2);
  codes.forEach((code) => cidMap.writeUInt16BE(metrics.glyphForCode(code), code * 2));
  const widths = codes.map((code) => `${code} [${metrics.widthForGlyph(metrics.glyphForCode(code))}]`).join(" ");
  const fontFileId = pdf.add(pdf.stream(`/Length1 ${font.length}`, font));
  const descriptorId = pdf.add(`<< /Type /FontDescriptor /FontName /${fontName} /Flags 32 /FontBBox [${metrics.bbox.join(" ")}] /ItalicAngle 0 /Ascent 928 /Descent -236 /CapHeight 729 /StemV 80 /FontFile2 ${fontFileId} 0 R >>`);
  const cidMapId = pdf.add(pdf.stream("", cidMap));
  const unicodeId = pdf.add(pdf.stream("", createToUnicode(codes)));
  const cidFontId = pdf.add(`<< /Type /Font /Subtype /CIDFontType2 /BaseFont /${fontName} /CIDSystemInfo << /Registry (Adobe) /Ordering (Identity) /Supplement 0 >> /FontDescriptor ${descriptorId} 0 R /CIDToGIDMap ${cidMapId} 0 R /DW 1000 /W [${widths}] >>`);
  const fontId = pdf.add(`<< /Type /Font /Subtype /Type0 /BaseFont /${fontName} /Encoding /Identity-H /DescendantFonts [${cidFontId} 0 R] /ToUnicode ${unicodeId} 0 R >>`);
  return { fontId, metrics };
}

function createPdf({ pages, size, labels, title, fontPath, logoPath }) {
  const pdf = new PdfBuilder();
  const pagesId = pdf.reserve();
  const { fontId, metrics } = addFont(pdf, labels, fontPath);
  const logoVariants = readLogoVariants(logoPath);
  const logoIds = Object.fromEntries(Object.entries(logoVariants).map(([name, logo]) => {
    const maskId = logo.softMask
      ? pdf.add(pdf.stream(`/Type /XObject /Subtype /Image /Width ${logo.softMask.width} /Height ${logo.softMask.height} /ColorSpace ${logo.softMask.colorSpace} /BitsPerComponent 8 /Filter ${logo.softMask.filter}`, logo.softMask.data))
      : null;
    const softMask = maskId ? ` /SMask ${maskId} 0 R` : "";
    const imageId = pdf.add(pdf.stream(`/Type /XObject /Subtype /Image /Width ${logo.width} /Height ${logo.height} /ColorSpace ${logo.colorSpace} /BitsPerComponent 8 /Filter ${logo.filter}${softMask}`, logo.data));
    return [name, imageId];
  }));
  const logoResources = Object.fromEntries(Object.entries(logoIds).map(([name, id]) => [name, `${id} 0 R`]));
  const imageResources = Object.keys(logoResources).length
    ? ` /XObject << ${Object.entries(logoResources).map(([name, reference]) => `/${name} ${reference}`).join(" ")} >>`
    : "";
  const pageIds = pages.map((content) => {
    const contentId = pdf.add(pdf.stream("", content(metrics, logoResources)));
    return pdf.add(`<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 ${number(size.width)} ${number(size.height)}] /Resources << /Font << /F1 ${fontId} 0 R >>${imageResources} >> /Contents ${contentId} 0 R >>`);
  });
  pdf.set(pagesId, `<< /Type /Pages /Count ${pageIds.length} /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] >>`);
  const catalogId = pdf.add(`<< /Type /Catalog /Pages ${pagesId} 0 R /PageLayout /SinglePage >>`);
  const infoId = pdf.add(`<< /Title (${safeText(title)}) /Author (Klavierhaus) /Creator (Klavierhaus ERP) >>`);
  return pdf.serialize(catalogId, infoId);
}

function ticketVariant(ticket, event) {
  const value = safeText(ticket?.ticket_variant).toUpperCase();
  if (value) return value;
  if (ticket?.source_type === "INVITATION") return "INVITATION";
  if (ticket?.source_type === "PURCHASE") return "PUBLIC_PAID";
  return event?.access_type === "PUBLIC_FREE" ? "PUBLIC_FREE" : "COMPLIMENTARY";
}

function ticketDesignType(variant) {
  if (variant === "VIP" || variant === "INVITATION") return "VIP";
  if (variant === "COMPLIMENTARY") return "HONORARY";
  return "NORMAL";
}

function ticketPalette(variant) {
  const designType = ticketDesignType(variant);
  if (designType === "VIP") {
    return { designType, background: GOLD, logoResource: "LogoBlack", border: DARK, divider: DARK, wordmark: DARK, label: DARK, title: DARK, foreground: DARK, muted: DARK, texture: true };
  }
  if (designType === "HONORARY") {
    return { designType, background: SILVER, logoResource: "LogoGold", border: GOLD, divider: GOLD, wordmark: GOLD_DEEP, label: DARK, title: GOLD_DEEP, foreground: DARK, muted: DARK, texture: true };
  }
  return { designType, background: DARK, logoResource: "LogoWhite", border: GOLD, divider: GOLD, wordmark: CREAM, label: GOLD, title: CREAM, foreground: CREAM, muted: CREAM, texture: true };
}

function ticketTypeLabel(designType) {
  if (designType === "VIP") return "VIP INVITATION";
  if (designType === "HONORARY") return "HONORARY TICKET";
  return "PUBLIC EVENT";
}

function ticketEventType(event, designType) {
  const raw = safeText(event?.custom_type || event?.event_type || "").replace(/_/g, " ");
  if (!raw || /^(PUBLIC PAID|PUBLIC FREE|VIP|INVITATION|COMPLIMENTARY|MANUAL|ON SITE)$/i.test(raw)) return ticketTypeLabel(designType);
  return raw;
}

function ticketDate(event) {
  if (event?.dateLabel) return safeText(event.dateLabel);
  if (!event?.start_at) return "";
  try {
    return new Intl.DateTimeFormat("en-US", { timeZone: event.timezone || "America/New_York", dateStyle: "long", timeStyle: "short" }).format(new Date(event.start_at));
  } catch (_error) { return safeText(event.start_at); }
}

function ticketDateParts(event) {
  const value = ticketDate(event);
  const match = value.match(/^(.*?)(?:\s+at\s+)(.*)$/i);
  return match ? [match[1], `at ${match[2]}`] : [value, ""];
}

function ticketSubtitle(event) {
  const raw = safeText(event?.custom_type || event?.event_type || "").replace(/_/g, " ");
  return /^(PUBLIC PAID|PUBLIC FREE|VIP|INVITATION|COMPLIMENTARY|MANUAL|ON SITE)$/i.test(raw) ? "" : raw;
}

function ticketVenueParts(event) {
  const primary = safeText(event?.venue_name || "Klavierhaus");
  const secondary = safeText([event?.venue_city, event?.venue_region].filter(Boolean).join(", ") || event?.venueLabel || "New York");
  return [primary, secondary];
}

function calendarIcon(x, y, color) {
  return `${color} RG 1 w ${number(x)} ${number(y)} 12 11 re S ${number(x + 2)} ${number(y + 13)} m ${number(x + 2)} ${number(y + 9)} l S ${number(x + 10)} ${number(y + 13)} m ${number(x + 10)} ${number(y + 9)} l S ${number(x)} ${number(y + 8)} m ${number(x + 12)} ${number(y + 8)} l S\n`;
}

function locationIcon(x, y, color) {
  return `${color} RG 1 w ${number(x + 6)} ${number(y + 1)} m ${number(x + 1)} ${number(y + 7)} ${number(x + 2)} ${number(y + 13)} ${number(x + 6)} ${number(y + 16)} c ${number(x + 10)} ${number(y + 13)} ${number(x + 11)} ${number(y + 7)} ${number(x + 6)} ${number(y + 1)} c S ${color} rg ${number(x + 4.5)} ${number(y + 7)} 3 3 re f\n`;
}

function ticketPage({ event, ticket, index, pageCount, metrics, logoResources }) {
  const variant = ticketVariant(ticket, event);
  const palette = ticketPalette(variant);
  const title = safeText(event.title_en || event.title_hu || "Klavierhaus Event").toUpperCase();
  const subtitle = ticketSubtitle(event);
  const [dateLine, timeLine] = ticketDateParts(event);
  const [venueLine, venueCityLine] = ticketVenueParts(event);
  const guest = safeText(ticket.display_name || ticket.attendee_name || ticket.original_guest_name || "Guest");
  const code = safeText(ticket.public_code);
  const id = safeText(ticket.id);
  const priceCents = Number(ticket.price_cents || 0) > 0 ? Number(ticket.price_cents) : Number(event.price_cents || 0);
  const priceVisible = priceCents > 0;
  const price = priceVisible ? `${String(ticket.currency || event.currency || "USD").toUpperCase()} ${(priceCents / 100).toFixed(2)}` : "";
  const hasLogo = Boolean(logoResources?.[palette.logoResource]);
  const commands = [
    ticketBackground(palette),
    palette.texture ? ticketTexture(palette) : "",
    `${palette.border} RG 2.5 w 14 14 ${number(BOARDING_PASS.width - 28)} ${number(BOARDING_PASS.height - 28)} re S\n`,
    `${palette.border} rg 14 205 4 4 re f\n`,
    logoCommand(hasLogo, 44, 173, 58, 60, palette.logoResource),
    textCommand("KLAVIERHAUS", hasLogo ? 136 : 44, 194, 16, palette.wordmark, { tracking: 1.2 }),
    textCommand("ADMISSION TICKET", 44, 158, 8.5, palette.label, { tracking: 1.1 }),
    textCommand(truncate(title, 330, 21, metrics), 44, 132, 21, palette.title, { bold: true, tracking: 0.4 }),
    subtitle ? textCommand(truncate(subtitle, 330, 12, metrics), 44, 109, 12, palette.designType === "HONORARY" ? palette.foreground : palette.label, { shear: 0.16 }) : "",
    textCommand(truncate(guest, 330, 13, metrics), 44, 82, 13, palette.foreground),
    textCommand(ticketTypeLabel(palette.designType), 44, 36, 8.5, palette.designType === "NORMAL" ? palette.label : palette.foreground, { tracking: 1.1 }),
    `${palette.divider} RG .7 w 390 28 0 190 re S\n`,
    textCommand("TICKET CODE", 414, 195, 7, palette.label, { tracking: 0.7 }),
    textCommand(truncate(code, 155, 9, metrics), 414, 180, 9, palette.foreground),
    textCommand("TICKET ID", 414, 160, 7, palette.label, { tracking: 0.7 }),
    textCommand(truncate(id, 155, 8, metrics), 414, 145, 8, palette.foreground),
    priceVisible ? textCommand("PRICE", 414, 125, 7, palette.label, { tracking: 0.7 }) : "",
    priceVisible ? textCommand(price, 414, 111, 9, palette.foreground) : "",
    calendarIcon(414, 74, palette.label),
    textCommand(truncate(dateLine, 135, 8.5, metrics), 432, 83, 8.5, palette.foreground),
    textCommand(truncate(timeLine, 135, 8.5, metrics), 432, 70, 8.5, palette.foreground),
    locationIcon(414, 34, palette.label),
    textCommand(truncate(venueLine, 135, 8.5, metrics), 432, 48, 8.5, palette.foreground),
    textCommand(truncate(venueCityLine, 135, 8.5, metrics), 432, 36, 8.5, palette.foreground),
  ];
  return commands.join("");
}

function ticketBackPage({ palette, logoResources, metrics }) {
  const hasLogo = Boolean(logoResources?.[palette.logoResource]);
  return [
    ticketBackground(palette),
    palette.texture ? ticketTexture(palette) : "",
    `${palette.border} RG 2.5 w 14 14 ${number(BOARDING_PASS.width - 28)} ${number(BOARDING_PASS.height - 28)} re S\n`,
    logoCommand(hasLogo, 244, 99, 124, 129, palette.logoResource),
    centeredTextCommand("KLAVIERHAUS", 72, 22, palette.wordmark, metrics, { tracking: 1.4 })
  ].join("");
}

function generateTicketDocumentPdf({ event, tickets, mode = "full", fontPath, logoPath }) {
  const rows = Array.isArray(tickets) ? tickets : [];
  const safeRows = rows.length ? rows : [{ id: "", attendee_name: "No ticket", public_code: "", ticket_variant: "PUBLIC_PAID" }];
  const normalizedMode = ["front", "back", "full"].includes(String(mode).toLowerCase()) ? String(mode).toLowerCase() : "full";
  const labels = safeRows.flatMap((ticket) => {
    const palette = ticketPalette(ticketVariant(ticket, event));
    return [
      ticket.id, ticket.attendee_name, ticket.display_name, ticket.original_guest_name, ticket.public_code, ticket.ticket_variant,
      ticket.price_cents, event.price_cents, ticket.currency, ticketDate(event), ticketSubtitle(event), ticketEventType(event, palette.designType), ticketTypeLabel(palette.designType), "PRICE",
      event.venueLabel || event.venue_name, event.venue_street, event.venue_city, event.venue_region, event.venue_postal_code
    ];
  }).concat([
    event.title_en, event.title_hu, event.dateLabel, event.venueLabel, event.venue_name, event.custom_type, "KLAVIERHAUS", "ADMISSION TICKET", "DATE / TIME", "LOCATION", "GUEST", "TICKET ID", "TICKET CODE", "PRICE", "PUBLIC PAID", "PUBLIC FREE", "VIP", "INVITATION", "COMPLIMENTARY", "MANUAL", "ON SITE"
  ]);
  const pages = [];
  safeRows.forEach((ticket, index) => {
    const palette = ticketPalette(ticketVariant(ticket, event));
    if (normalizedMode !== "back") pages.push((metrics, logoResources) => ticketPage({ event, ticket, index, pageCount: normalizedMode === "full" ? safeRows.length * 2 : safeRows.length, metrics, logoResources }));
    if (normalizedMode !== "front") pages.push((metrics, logoResources) => ticketBackPage({ palette, logoResources, metrics }));
  });
  return createPdf({ pages, size: BOARDING_PASS, labels, title: `Klavierhaus ${normalizedMode} ticket document`, fontPath: fontPath || path.join(__dirname, "assets", "DejaVuSerif.ttf"), logoPath });
}

function generateTicketPdf(options = {}) { return generateTicketDocumentPdf({ ...options, mode: options.mode || "full" }); }
function generateTicketFrontPdf(options = {}) { return generateTicketDocumentPdf({ ...options, mode: "front" }); }
function generateTicketBackPdf(options = {}) { return generateTicketDocumentPdf({ ...options, mode: "back" }); }
function generateTicketFullPdf(options = {}) { return generateTicketDocumentPdf({ ...options, mode: "full" }); }

function invoicePage({ company, event, payment, tickets, invoiceNumber, language, metrics, logoResources }) {
  const hu = language === "hu";
  const logoResource = logoResources?.LogoOriginal ? "LogoOriginal" : "LogoWhite";
  const hasLogo = Boolean(logoResources?.[logoResource]);
  const lines = [
    `0.02 0.02 0.02 rg 0 0 ${number(LETTER.width)} ${number(LETTER.height)} re f\n`,
    `${GOLD} RG 2 w 28 28 ${number(LETTER.width - 56)} ${number(LETTER.height - 56)} re S\n`,
    logoCommand(hasLogo, 54, 724, 42, 42, logoResource),
    textCommand(company.legal_name || company.trade_name || "Klavierhaus", hasLogo ? 112 : 54, 716, 19, CREAM),
    textCommand(hu ? "SZÁMLA" : "INVOICE", 400, 716, 18, GOLD),
    textCommand(invoiceNumber, 400, 692, 9, MUTED),
    textCommand(company.address_line1, 54, 686, 9, MUTED),
    textCommand(company.address_line2, 54, 670, 9, MUTED),
    textCommand([company.city, company.state, company.postal_code].filter(Boolean).join(", "), 54, 654, 9, MUTED),
    textCommand(company.country, 54, 638, 9, MUTED),
    textCommand(company.tax_id ? `${hu ? "Adóazonosító" : "Tax ID"}: ${company.tax_id}` : "", 54, 622, 9, MUTED),
    textCommand([company.email, company.phone].filter(Boolean).join(" · "), 54, 606, 9, MUTED),
    `${GOLD} RG .8 w 54 584 504 0 re\n`,
    textCommand(hu ? "VÁSÁRLÓ" : "BILLED TO", 54, 560, 8, GOLD),
    textCommand(payment.purchaser_name, 54, 540, 11, CREAM),
    textCommand(payment.purchaser_email, 54, 522, 9, MUTED),
    textCommand(hu ? "TÉTEL" : "DESCRIPTION", 54, 480, 8, GOLD),
    textCommand(hu ? "MENNYISÉG" : "QTY", 398, 480, 8, GOLD),
    textCommand(hu ? "ÖSSZEG" : "AMOUNT", 476, 480, 8, GOLD),
    `${MUTED} RG .6 w 54 467 504 0 re\n`,
    textCommand(truncate(hu ? (event.title_hu || event.title_en) : event.title_en, 320, 11, metrics), 54, 444, 11, CREAM),
    textCommand(`${tickets.length}`, 410, 444, 11, CREAM),
    textCommand(`${String(payment.currency || "USD").toUpperCase()} ${(Number(payment.amount_total || 0) / 100).toFixed(2)}`, 470, 444, 11, CREAM),
    `${GOLD} RG .8 w 54 396 504 0 re\n`,
    textCommand(hu ? "FIZETENDŐ / RENDEZVE" : "TOTAL / PAID", 350, 370, 9, GOLD),
    textCommand(`${String(payment.currency || "USD").toUpperCase()} ${(Number(payment.amount_total || 0) / 100).toFixed(2)}`, 430, 344, 17, CREAM),
    textCommand(company.invoice_payment_terms || "Paid at checkout", 54, 126, 8, MUTED),
    textCommand(hu ? "Ez a dokumentum a Klavierhaus belső rendszerében kiállított tranzakciós bizonylat." : "This document records the transaction issued by the Klavierhaus internal system.", 54, 100, 8, MUTED),
    textCommand(company.invoice_footer || "Klavierhaus · New York", 54, 76, 8, MUTED)
  ];
  return lines.join("");
}

function generateInvoicePdf({ company = {}, event, payment, tickets = [], invoiceNumber, language = "en", fontPath, logoPath }) {
  const labels = [
    company.legal_name, company.trade_name, company.address_line1, company.address_line2, company.city, company.state, company.postal_code, company.country, company.tax_id, company.email, company.phone, company.invoice_payment_terms,
    payment.purchaser_name, payment.purchaser_email, event.title_en, event.title_hu, invoiceNumber, company.invoice_payment_terms, company.invoice_footer, "INVOICE", "SZÁMLA", "BILLED TO", "VÁSÁRLÓ", "DESCRIPTION", "TÉTEL", "QTY", "AMOUNT", "MENNYISÉG", "ÖSSZEG", "TOTAL / PAID", "FIZETENDŐ / RENDEZVE", "This document records the transaction issued by the Klavierhaus internal system."
  ];
  return createPdf({
    pages: [(metrics, logoResources) => invoicePage({ company, event, payment, tickets, invoiceNumber, language, metrics, logoResources })],
    size: LETTER,
    labels,
    title: `Klavierhaus Invoice ${invoiceNumber}`,
    fontPath,
    logoPath
  });
}

module.exports = { BOARDING_PASS, LETTER, generateInvoicePdf, generateTicketBackPdf, generateTicketDocumentPdf, generateTicketFrontPdf, generateTicketFullPdf, generateTicketPdf, ticketDesignType, ticketPalette };
