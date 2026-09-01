"use strict";

const fs = require("node:fs");
const path = require("node:path");
const zlib = require("node:zlib");
const { createFontMetrics, jpegDimensions } = require("./guest-list-pdf");

const COLORS = Object.freeze({
  black: "0.02 0.02 0.02",
  gold: "0.788 0.663 0.369",
  cream: "0.969 0.953 0.894",
  muted: "0.62 0.58 0.50",
  vipBlack: "0.08 0.075 0.06",
  vipGold: "0.788 0.663 0.369"
});
const BOARDING_PASS = Object.freeze({ width: 612, height: 252 });
const LETTER = Object.freeze({ width: 612, height: 792 });
const ASSET_DIR = path.join(__dirname, "assets");

function number(value) {
  return Number(value).toFixed(2).replace(/\.00$/, "");
}

function safeText(value) {
  return String(value ?? "").replace(/[\r\n\t]+/g, " ").replace(/\s+/g, " ").trim();
}

function escapePdfLiteral(value) {
  return safeText(value).replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
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

function readPng(buffer) {
  if (buffer.length < 33 || buffer.toString("hex", 0, 8) !== "89504e470d0a1a0a") throw new Error("INVALID_LOGO_PNG");
  const width = buffer.readUInt32BE(16);
  const height = buffer.readUInt32BE(20);
  const bitDepth = buffer[24];
  const colorType = buffer[25];
  const interlace = buffer[28];
  const channelsByColorType = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };
  const channels = channelsByColorType[colorType];
  if (!width || !height || bitDepth !== 8 || !channels || interlace !== 0) throw new Error("UNSUPPORTED_LOGO_PNG");

  const idat = [];
  let palette = null;
  let paletteAlpha = null;
  let offset = 8;
  while (offset + 12 <= buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString("ascii", offset + 4, offset + 8);
    const start = offset + 8;
    const end = start + length;
    if (end + 4 > buffer.length) throw new Error("INVALID_LOGO_PNG");
    if (type === "IDAT") idat.push(buffer.subarray(start, end));
    if (type === "PLTE") palette = Buffer.from(buffer.subarray(start, end));
    if (type === "tRNS") paletteAlpha = Buffer.from(buffer.subarray(start, end));
    if (type === "IEND") break;
    offset = end + 4;
  }
  if (colorType === 3 && (!palette || palette.length < 3)) throw new Error("INVALID_LOGO_PNG_PALETTE");

  const rowBytes = width * channels;
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const expected = height * (rowBytes + 1);
  if (raw.length < expected) throw new Error("INVALID_LOGO_PNG_DATA");
  const rgb = Buffer.alloc(width * height * 3);
  const alpha = Buffer.alloc(width * height, 255);
  let sourceOffset = 0;
  let targetOffset = 0;
  let alphaOffset = 0;
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
    for (let x = 0; x < width; x += 1) {
      const source = x * channels;
      let red = row[source];
      let green = red;
      let blue = red;
      let pixelAlpha = 255;
      if (colorType === 2) {
        green = row[source + 1];
        blue = row[source + 2];
      } else if (colorType === 3) {
        const paletteOffset = row[source] * 3;
        red = palette[paletteOffset];
        green = palette[paletteOffset + 1];
        blue = palette[paletteOffset + 2];
        pixelAlpha = paletteAlpha && paletteAlpha[row[source]] !== undefined ? paletteAlpha[row[source]] : 255;
      } else if (colorType === 4) {
        pixelAlpha = row[source + 1];
      } else if (colorType === 6) {
        green = row[source + 1];
        blue = row[source + 2];
        pixelAlpha = row[source + 3];
      }
      rgb[targetOffset++] = red;
      rgb[targetOffset++] = green;
      rgb[targetOffset++] = blue;
      alpha[alphaOffset++] = pixelAlpha;
    }
    previous = row;
  }

  if (alpha.some((value) => value < 255)) {
    const maskRowBytes = Math.ceil(width / 8);
    const mask = Buffer.alloc(height * maskRowBytes);
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        if (alpha[y * width + x] >= 128) mask[y * maskRowBytes + Math.floor(x / 8)] |= 1 << (7 - (x % 8));
      }
    }
    return { kind: "mask", width, height, data: zlib.deflateSync(mask) };
  }
  return { kind: "regular", width, height, colorSpace: "/DeviceRGB", filter: "/FlateDecode", data: zlib.deflateSync(rgb) };
}

function readLogoImage(logoPath) {
  if (!logoPath) return null;
  try {
    const buffer = fs.readFileSync(logoPath);
    if (buffer.toString("hex", 0, 8) === "89504e470d0a1a0a") return readPng(buffer);
    if (buffer.length > 4 && buffer[0] === 0xff && buffer[1] === 0xd8) {
      const dimensions = jpegDimensions(buffer);
      return { kind: "regular", width: dimensions.width, height: dimensions.height, colorSpace: dimensions.components === 1 ? "/DeviceGray" : "/DeviceRGB", filter: "/DCTDecode", data: buffer };
    }
  } catch (_error) {
    return null;
  }
  return null;
}

function logoCommand(logoState, x, y, width, height, color) {
  if (!logoState?.hasLogo) return "";
  const paintColor = logoState.isMask ? color + " rg " : "";
  return "q " + paintColor + number(width) + " 0 0 " + number(height) + " " + number(x) + " " + number(y) + " cm /Logo Do Q\n";
}

function unicodeHex(value) {
  return [...safeText(value)].map((character) => Math.min(character.codePointAt(0), 0xffff).toString(16).padStart(4, "0")).join("").toUpperCase();
}

function textCommand(text, x, y, size, color = COLORS.cream, font = "F1", charSpace = 0) {
  const value = safeText(text);
  if (!value) return "";
  const spacing = charSpace ? number(charSpace) + " Tc " : "";
  return color + " rg BT /" + font + " " + number(size) + " Tf " + spacing + "1 0 0 1 " + number(x) + " " + number(y) + " Tm <" + unicodeHex(value) + "> Tj ET\n";
}

function textWidth(text, size, metrics) {
  return [...safeText(text)].reduce((total, character) => {
    const code = Math.min(character.codePointAt(0), 0xffff);
    return total + metrics.widthForGlyph(metrics.glyphForCode(code)) * size / 1000;
  }, 0);
}

function truncate(text, maxWidth, size, metrics) {
  const source = safeText(text);
  let result = "";
  let width = 0;
  for (const character of source) {
    const code = Math.min(character.codePointAt(0), 0xffff);
    const glyphWidth = metrics.widthForGlyph(metrics.glyphForCode(code)) * size / 1000;
    if (width + glyphWidth > maxWidth) return result.trimEnd() + "...";
    result += character;
    width += glyphWidth;
  }
  return result;
}

function wrapText(text, maxWidth, size, metrics, maxLines = 2) {
  const words = safeText(text).split(" ").filter(Boolean);
  if (!words.length) return [];
  const lines = [];
  let current = "";
  for (let index = 0; index < words.length; index += 1) {
    const word = words[index];
    const candidate = current ? current + " " + word : word;
    if (textWidth(candidate, size, metrics) <= maxWidth) {
      current = candidate;
      continue;
    }
    if (current) lines.push(current);
    current = word;
    if (lines.length === maxLines - 1) {
      lines.push(truncate([current].concat(words.slice(index + 1)).join(" "), maxWidth, size, metrics));
      return lines;
    }
  }
  if (current) lines.push(current);
  return lines.slice(0, maxLines);
}

function centeredText(text, y, size, color, metrics, font = "F2", charSpace = 0) {
  const width = textWidth(text, size, metrics) + Math.max(0, safeText(text).length - 1) * charSpace;
  return textCommand(text, Math.max(0, (BOARDING_PASS.width - width) / 2), y, size, color, font, charSpace);
}

function simpleToken(value) {
  let hash = 2166136261;
  for (const character of safeText(value)) {
    hash ^= character.codePointAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36).toUpperCase().padStart(7, "0").slice(-7);
}

function displayTicketId(ticket) {
  const explicit = safeText(ticket.ticket_identifier || ticket.ticket_id);
  if (explicit && explicit.length <= 18) return explicit;
  return "KH-" + simpleToken(ticket.id || ticket.public_code);
}

function displayTicketCode(ticket) {
  const code = safeText(ticket.public_code);
  if (code.length <= 24) return code;
  return "KH-" + simpleToken(code);
}

function isVipTicket(event = {}, ticket = {}) {
  const explicit = safeText(ticket.ticket_variant || ticket.ticket_type || ticket.access_level).toUpperCase();
  if (["VIP", "INTERNAL", "INVITATION", "INVITE_ONLY"].includes(explicit)) return true;
  if (["STANDARD", "PUBLIC", "PUBLIC_EVENT"].includes(explicit)) return false;
  return event.access_type === "INTERNAL" || event.access_type === "INVITE_ONLY" || ticket.source_type === "INVITATION";
}

function ticketTypeLabel(event, ticket, language) {
  const hu = language === "hu";
  const explicit = safeText(ticket.ticket_variant || ticket.ticket_type || ticket.access_level).toUpperCase();
  if (event.access_type === "INTERNAL" || ["VIP", "INTERNAL"].includes(explicit)) return hu ? "VIP JEGY" : "VIP TICKET";
  if (event.access_type === "INVITE_ONLY" || ["INVITATION", "INVITE_ONLY"].includes(explicit) || ticket.source_type === "INVITATION") return hu ? "SZEMÉLYES MEGHÍVÁS" : "PERSONAL INVITATION";
  return hu ? "NYILVÁNOS ESEMÉNY" : "PUBLIC EVENT";
}

function ticketPriceText(ticket, event, language = "en") {
  const currency = String(ticket.currency || event.currency || "USD").toUpperCase();
  const cents = Number(ticket.price_cents);
  if (!Number.isFinite(cents)) return "";
  if (cents <= 0) return language === "hu" ? "INGYENES" : "COMPLIMENTARY";
  return currency + " " + (cents / 100).toFixed(2);
}

function eventCategoryText(event, language) {
  const hu = language === "hu";
  return safeText(event["category_name_" + (hu ? "hu" : "en")] || event.category || event.category_code || (hu ? "ZONGORAHANGVERSENY" : "PIANO CONCERT"));
}

function invoiceIssueDate(payment, language) {
  const issuedAt = payment.paid_at || payment.updated_at || payment.created_at || new Date().toISOString();
  return new Intl.DateTimeFormat(language === "hu" ? "hu-HU" : "en-US", { timeZone: "America/New_York", dateStyle: "long" }).format(new Date(issuedAt));
}

class PdfBuilder {
  constructor() { this.objects = []; }
  reserve() { this.objects.push(null); return this.objects.length; }
  add(value) { const id = this.reserve(); this.set(id, value); return id; }
  set(id, value) { this.objects[id - 1] = Buffer.isBuffer(value) ? value : Buffer.from(String(value), "binary"); }
  stream(dictionary, bytes) {
    const data = Buffer.isBuffer(bytes) ? bytes : Buffer.from(String(bytes), "binary");
    return Buffer.concat([Buffer.from("<< " + dictionary + " /Length " + data.length + " >>\nstream\n", "binary"), data, Buffer.from("\nendstream", "binary")]);
  }
  serialize(rootId, infoId) {
    const pieces = [Buffer.from("%PDF-1.7\n%\xFF\xFF\xFF\xFF\n", "binary")];
    const offsets = [0];
    let position = pieces[0].length;
    this.objects.forEach((object, index) => {
      offsets.push(position);
      const header = Buffer.from(index + 1 + " 0 obj\n", "binary");
      const footer = Buffer.from("\nendobj\n", "binary");
      pieces.push(header, object, footer);
      position += header.length + object.length + footer.length;
    });
    const xref = position;
    const rows = offsets.slice(1).map((offset) => String(offset).padStart(10, "0") + " 00000 n \n").join("");
    pieces.push(Buffer.from("xref\n0 " + (this.objects.length + 1) + "\n0000000000 65535 f \n" + rows + "trailer\n<< /Size " + (this.objects.length + 1) + " /Root " + rootId + " 0 R /Info " + infoId + " 0 R >>\nstartxref\n" + xref + "\n%%EOF\n", "binary"));
    return Buffer.concat(pieces);
  }
}

function usedCodes(values) {
  const codes = new Set([32, 45, 47, 58, 46, 36, 40, 41, 44, 35]);
  values.forEach((value) => [...safeText(value)].forEach((character) => codes.add(Math.min(character.codePointAt(0), 0xffff))));
  return [...codes].sort((left, right) => left - right);
}

function createToUnicode(codes) {
  const mappings = codes.map((code) => "<" + code.toString(16).padStart(4, "0") + "> <" + code.toString(16).padStart(4, "0") + ">").join("\n");
  return "/CIDInit /ProcSet findresource begin\n12 dict begin\nbegincmap\n/CIDSystemInfo << /Registry (Adobe) /Ordering (Identity) /Supplement 0 >> def\n/CMapName /KlavierhausUnicode def\n/CMapType 2 def\n1 begincodespacerange\n<0000> <FFFF>\nendcodespacerange\n" + codes.length + " beginbfchar\n" + mappings + "\nendbfchar\nendcmap\nCMapName currentdict /CMap defineresource pop\nend\nend";
}

function addFont(pdf, labels, fontPath, baseName) {
  const font = fs.readFileSync(fontPath);
  const metrics = createFontMetrics(font);
  const codes = usedCodes(labels);
  const cidMap = Buffer.alloc((Math.max(...codes) + 1) * 2);
  codes.forEach((code) => cidMap.writeUInt16BE(metrics.glyphForCode(code), code * 2));
  const widths = codes.map((code) => code + " [" + metrics.widthForGlyph(metrics.glyphForCode(code)) + "]").join(" ");
  const fontFileId = pdf.add(pdf.stream("/Length1 " + font.length, font));
  const descriptorId = pdf.add("<< /Type /FontDescriptor /FontName /" + baseName + " /Flags 32 /FontBBox [" + metrics.bbox.join(" ") + "] /ItalicAngle 0 /Ascent 928 /Descent -236 /CapHeight 729 /StemV 80 /FontFile2 " + fontFileId + " 0 R >>");
  const cidMapId = pdf.add(pdf.stream("", cidMap));
  const unicodeId = pdf.add(pdf.stream("", createToUnicode(codes)));
  const cidFontId = pdf.add("<< /Type /Font /Subtype /CIDFontType2 /BaseFont /" + baseName + " /CIDSystemInfo << /Registry (Adobe) /Ordering (Identity) /Supplement 0 >> /FontDescriptor " + descriptorId + " 0 R /CIDToGIDMap " + cidMapId + " 0 R /DW 1000 /W [" + widths + "] >>");
  const fontId = pdf.add("<< /Type /Font /Subtype /Type0 /BaseFont /" + baseName + " /Encoding /Identity-H /DescendantFonts [" + cidFontId + " 0 R] /ToUnicode " + unicodeId + " 0 R >>");
  return { fontId, metrics };
}

function createPdf({ pages, size, labels, title, fontPath, fontPaths, logoPath }) {
  const pdf = new PdfBuilder();
  const pagesId = pdf.reserve();
  const sansPath = (fontPaths && fontPaths.sans) || fontPath || path.join(ASSET_DIR, "DejaVuSans.ttf");
  const requestedDisplayPath = (fontPaths && fontPaths.display) || path.join(ASSET_DIR, "DejaVuSerif.ttf");
  const displayPath = fs.existsSync(requestedDisplayPath) ? requestedDisplayPath : sansPath;
  const sans = addFont(pdf, labels, sansPath, "KlavierhausSans");
  const display = addFont(pdf, labels, displayPath, "KlavierhausDisplay");
  const logo = readLogoImage(logoPath);
  let logoId = null;
  if (logo?.kind === "mask") {
    logoId = pdf.add(pdf.stream("/Type /XObject /Subtype /Image /Width " + logo.width + " /Height " + logo.height + " /ImageMask true /BitsPerComponent 1 /Decode [1 0] /Filter /FlateDecode", logo.data));
  } else if (logo) {
    logoId = pdf.add(pdf.stream("/Type /XObject /Subtype /Image /Width " + logo.width + " /Height " + logo.height + " /ColorSpace " + logo.colorSpace + " /BitsPerComponent 8 /Filter " + logo.filter, logo.data));
  }
  const logoState = { hasLogo: Boolean(logoId), isMask: logo?.kind === "mask" };
  const resourceFonts = " /Font << /F1 " + sans.fontId + " 0 R /F2 " + display.fontId + " 0 R >>";
  const resourceImages = logoId ? " /XObject << /Logo " + logoId + " 0 R >>" : "";
  const context = { metrics: display.metrics, sansMetrics: sans.metrics, fonts: { sans: "F1", display: "F2" } };
  const pageIds = pages.map((content) => {
    const contentId = pdf.add(pdf.stream("", content(context, logoState)));
    return pdf.add("<< /Type /Page /Parent " + pagesId + " 0 R /MediaBox [0 0 " + number(size.width) + " " + number(size.height) + "] /Resources <<" + resourceFonts + resourceImages + " >> /Contents " + contentId + " 0 R >>");
  });
  pdf.set(pagesId, "<< /Type /Pages /Count " + pageIds.length + " /Kids [" + pageIds.map((id) => id + " 0 R").join(" ") + "] >>");
  const catalogId = pdf.add("<< /Type /Catalog /Pages " + pagesId + " 0 R /PageLayout /SinglePage >>");
  const infoId = pdf.add("<< /Title (" + escapePdfLiteral(title) + ") /Author (Klavierhaus) /Creator (Klavierhaus ERP) >>");
  return pdf.serialize(catalogId, infoId);
}

function ticketPalette(vip) {
  return vip
    ? { background: COLORS.vipGold, foreground: COLORS.vipBlack, accent: COLORS.vipBlack, muted: "0.28 0.23 0.14" }
    : { background: COLORS.black, foreground: COLORS.cream, accent: COLORS.gold, muted: COLORS.muted };
}

function ticketPage({ event, ticket, language, context, logoState }) {
  const hu = language === "hu";
  const vip = isVipTicket(event, ticket);
  const palette = ticketPalette(vip);
  const title = hu ? (event.title_hu || event.title_en) : event.title_en;
  const date = event.dateLabel || event.start_at || "";
  const venue = event.venueLabel || event.venue_name || "Klavierhaus";
  const attendee = safeText(ticket.attendee_name || ticket.buyer_name || (hu ? "Vendég" : "Guest"));
  const code = displayTicketCode(ticket);
  const identifier = displayTicketId(ticket);
  const price = ticketPriceText(ticket, event, language);
  const typeLabel = ticketTypeLabel(event, ticket, language);
  const category = eventCategoryText(event, language);
  const titleLines = wrapText(title, 370, 24, context.metrics, 2);
  const commands = [
    palette.background + " rg 0 0 " + number(BOARDING_PASS.width) + " " + number(BOARDING_PASS.height) + " re f\n",
    palette.accent + " RG 2.5 w 14 14 " + number(BOARDING_PASS.width - 28) + " " + number(BOARDING_PASS.height - 28) + " re S\n",
    palette.accent + " RG .65 w 430 30 0 175 re S\n",
    logoCommand(logoState, 31, 184, 30, 31, palette.foreground),
    textCommand("KLAVIERHAUS", 70, 202, 12, palette.accent, context.fonts.sans, 1.4),
    textCommand(hu ? "BELÉPŐJEGY" : "ADMISSION TICKET", 31, 171, 8.5, palette.accent, context.fonts.sans, 1.1),
    textCommand(category, 31, 153, 8.2, palette.muted, context.fonts.sans, 0.6),
    titleLines.map((line, lineIndex) => textCommand(line, 31, 132 - lineIndex * 27, 24, palette.foreground, context.fonts.display)).join(""),
    textCommand(date, 31, 73, 9.2, palette.foreground, context.fonts.sans),
    textCommand(truncate(venue, 370, 8.8, context.sansMetrics), 31, 57, 8.8, palette.muted, context.fonts.sans),
    textCommand(hu ? "VENDÉG" : "ATTENDEE", 458, 171, 8, palette.accent, context.fonts.sans, 0.8),
    textCommand(truncate(attendee, 123, 15, context.metrics), 458, 145, 15, palette.foreground, context.fonts.display),
    textCommand(hu ? "JEGYKÓD" : "TICKET CODE", 458, 108, 7.5, palette.accent, context.fonts.sans, 0.6),
    textCommand(truncate(code, 123, 8.5, context.sansMetrics), 458, 92, 8.5, palette.foreground, context.fonts.sans),
    textCommand(hu ? "JEGYAZONOSÍTÓ" : "TICKET ID", 458, 73, 7.5, palette.accent, context.fonts.sans, 0.6),
    textCommand(identifier, 458, 57, 8.5, palette.foreground, context.fonts.sans),
    textCommand(hu ? "JEGYTÍPUS" : "TICKET TYPE", 458, 39, 7.5, palette.accent, context.fonts.sans, 0.6),
    textCommand(truncate(typeLabel, 123, 8, context.sansMetrics), 458, 23, 8, palette.foreground, context.fonts.sans),
    vip ? "" : textCommand(hu ? "ÁR" : "PRICE", 31, 29, 7.5, palette.accent, context.fonts.sans, 0.6),
    vip ? "" : textCommand(truncate(price, 120, 9, context.sansMetrics), 31, 15, 9, palette.foreground, context.fonts.sans)
  ];
  return commands.join("");
}

function ticketBackPage({ event, ticket, context, logoState }) {
  const palette = ticketPalette(isVipTicket(event, ticket));
  return [
    palette.background + " rg 0 0 " + number(BOARDING_PASS.width) + " " + number(BOARDING_PASS.height) + " re f\n",
    palette.accent + " RG 2.5 w 14 14 " + number(BOARDING_PASS.width - 28) + " " + number(BOARDING_PASS.height - 28) + " re S\n",
    logoCommand(logoState, 257, 104, 98, 102, palette.foreground),
    centeredText("KLAVIERHAUS", 80, 17, palette.foreground, context.metrics, context.fonts.display, 1.4)
  ].join("");
}

function normalizeTicketSide(value, fallback = "both") {
  const side = String(value || "").toLowerCase();
  return ["front", "back", "both"].includes(side) ? side : fallback;
}

function ticketLabels(event, tickets, language) {
  const labels = [];
  tickets.forEach((ticket) => labels.push(
    ticket.attendee_name, ticket.public_code, ticket.currency, ticket.price_cents,
    ticket.ticket_identifier, ticket.ticket_id, ticket.ticket_variant, ticket.ticket_type,
    ticketPriceText(ticket, event, language), displayTicketId(ticket), displayTicketCode(ticket),
    ticketTypeLabel(event, ticket, language)
  ));
  return labels.concat([
    event.title_en, event.title_hu, event.dateLabel, event.venueLabel, event.start_at, event.venue_name,
    event.category_name_en, event.category_name_hu, event.category_code, "KLAVIERHAUS",
    "ADMISSION TICKET", "BELÉPŐJEGY", "ATTENDEE", "VENDÉG", "TICKET CODE", "JEGYKÓD",
    "TICKET ID", "JEGYAZONOSÍTÓ", "TICKET TYPE", "JEGYTÍPUS", "PRICE", "ÁR",
    "PUBLIC EVENT", "NYILVÁNOS ESEMÉNY", "PERSONAL INVITATION", "SZEMÉLYES MEGHÍVÁS",
    "VIP TICKET", "VIP JEGY", "COMPLIMENTARY", "INGYENES"
  ]);
}

function generateTicketPdf({ event = {}, tickets, language = "en", fontPath, fontPaths, logoPath, side = "front" }) {
  const rows = Array.isArray(tickets) ? tickets : [];
  const safeRows = rows.length ? rows : [{ attendee_name: language === "hu" ? "Nincs jegy" : "No ticket", public_code: "" }];
  const normalizedSide = normalizeTicketSide(side, "front");
  const pages = [];
  safeRows.forEach((ticket, index) => {
    if (normalizedSide === "front" || normalizedSide === "both") {
      pages.push((context, logoState) => ticketPage({ event, ticket, index, pageCount: safeRows.length, language, context, logoState }));
    }
    if (normalizedSide === "back" || normalizedSide === "both") {
      pages.push((context, logoState) => ticketBackPage({ event, ticket, language, context, logoState }));
    }
  });
  return createPdf({ pages, size: BOARDING_PASS, labels: ticketLabels(event, safeRows, language), title: "Klavierhaus Admission Tickets", fontPath, fontPaths, logoPath });
}

function invoicePage({ company, event, payment, tickets, invoiceNumber, language, context, logoState }) {
  const hu = language === "hu";
  const currency = String(payment.currency || company.invoice_currency || "USD").toUpperCase();
  const total = (Number(payment.amount_total || 0) / 100).toFixed(2);
  const issueDate = invoiceIssueDate(payment, language);
  const eventDate = event.dateLabel || event.start_at || "";
  const venue = event.venueLabel || event.venue_name || "Klavierhaus";
  const f = context.fonts.sans;
  const lines = [
    COLORS.black + " rg 0 0 " + number(LETTER.width) + " " + number(LETTER.height) + " re f\n",
    COLORS.gold + " RG 2 w 28 28 " + number(LETTER.width - 56) + " " + number(LETTER.height - 56) + " re S\n",
    logoCommand(logoState, 54, 724, 42, 43, COLORS.cream),
    textCommand(company.legal_name || company.trade_name || "Klavierhaus", 112, 716, 19, COLORS.cream, f),
    textCommand(hu ? "SZÁMLA" : "INVOICE", 400, 716, 18, COLORS.gold, f),
    textCommand(invoiceNumber, 400, 692, 9, COLORS.muted, f),
    textCommand(hu ? "KIÁLLÍTVA" : "ISSUED", 400, 674, 8, COLORS.gold, f),
    textCommand(issueDate, 400, 658, 9, COLORS.cream, f),
    textCommand(hu ? "FIZETETT" : "PAID", 400, 640, 8, COLORS.gold, f),
    textCommand(company.address_line1, 54, 686, 9, COLORS.muted, f),
    textCommand(company.address_line2, 54, 670, 9, COLORS.muted, f),
    textCommand([company.city, company.state, company.postal_code].filter(Boolean).join(", "), 54, 654, 9, COLORS.muted, f),
    textCommand(company.country, 54, 638, 9, COLORS.muted, f),
    textCommand(company.tax_id ? (hu ? "Adóazonosító" : "Tax ID") + ": " + company.tax_id : "", 54, 622, 9, COLORS.muted, f),
    textCommand([company.email, company.phone].filter(Boolean).join(" - "), 54, 606, 9, COLORS.muted, f),
    COLORS.gold + " RG .8 w 54 584 504 0 re\n",
    textCommand(hu ? "VÁSÁRLÓ" : "BILLED TO", 54, 560, 8, COLORS.gold, f),
    textCommand(payment.purchaser_name, 54, 540, 11, COLORS.cream, f),
    textCommand(payment.purchaser_email, 54, 522, 9, COLORS.muted, f),
    textCommand(hu ? "ESEMÉNY" : "EVENT", 54, 480, 8, COLORS.gold, f),
    textCommand(truncate(eventDate, 300, 8, context.sansMetrics), 54, 464, 8, COLORS.muted, f),
    textCommand(truncate(venue, 300, 8, context.sansMetrics), 54, 450, 8, COLORS.muted, f),
    textCommand(hu ? "TÉTEL" : "DESCRIPTION", 54, 424, 8, COLORS.gold, f),
    textCommand(hu ? "MENNYISÉG" : "QTY", 398, 424, 8, COLORS.gold, f),
    textCommand(hu ? "ÖSSZEG" : "AMOUNT", 476, 424, 8, COLORS.gold, f),
    COLORS.muted + " RG .6 w 54 411 504 0 re\n",
    textCommand(truncate(hu ? (event.title_hu || event.title_en) : event.title_en, 320, 11, context.metrics), 54, 388, 11, COLORS.cream, context.fonts.display),
    textCommand(String(tickets.length), 410, 388, 11, COLORS.cream, f),
    textCommand(currency + " " + total, 470, 388, 11, COLORS.cream, f),
    COLORS.gold + " RG .8 w 54 348 504 0 re\n",
    textCommand(hu ? "FIZETENDŐ / RENDEZVE" : "TOTAL / PAID", 350, 322, 9, COLORS.gold, f),
    textCommand(currency + " " + total, 430, 296, 17, COLORS.cream, f),
    textCommand(company.invoice_payment_terms || "Paid at checkout", 54, 126, 8, COLORS.muted, f),
    textCommand(hu ? "Eseménybelépő vásárlásának bizonylata. A dokumentum adatai a kiállításkor elmentett tranzakcióból származnak." : "Receipt for an event-ticket purchase. The document reflects the transaction data saved at issuance.", 54, 100, 8, COLORS.muted, f),
    textCommand(company.invoice_footer || "Klavierhaus - New York", 54, 76, 8, COLORS.muted, f)
  ];
  return lines.join("");
}

function generateInvoicePdf({ company = {}, event = {}, payment = {}, tickets = [], invoiceNumber, language = "en", fontPath, fontPaths, logoPath }) {
  const currency = String(payment.currency || company.invoice_currency || "USD").toUpperCase();
  const total = (Number(payment.amount_total || 0) / 100).toFixed(2);
  const labels = [
    company.legal_name, company.trade_name, company.address_line1, company.address_line2, company.city, company.state, company.postal_code, company.country, company.tax_id, company.email, company.phone, company.invoice_payment_terms,
    payment.purchaser_name, payment.purchaser_email, payment.currency, payment.amount_total, currency + " " + total, String(tickets.length), event.title_en, event.title_hu, event.dateLabel, event.venueLabel, event.start_at, event.venue_name, event.currency,
    invoiceIssueDate(payment, language), invoiceNumber, company.invoice_footer, "Klavierhaus", "Klavierhaus - New York", "Paid at checkout", "INVOICE", "SZÁMLA", "ISSUED", "KIÁLLÍTVA", "PAID", "FIZETETT", "BILLED TO", "VÁSÁRLÓ", "EVENT", "ESEMÉNY", "DESCRIPTION", "TÉTEL", "QTY", "AMOUNT", "MENNYISÉG", "ÖSSZEG", "TOTAL / PAID", "FIZETENDŐ / RENDEZVE"
  ];
  return createPdf({
    pages: [(context, logoState) => invoicePage({ company, event, payment, tickets, invoiceNumber, language, context, logoState })],
    size: LETTER,
    labels,
    title: "Klavierhaus Invoice " + invoiceNumber,
    fontPath,
    fontPaths,
    logoPath
  });
}

module.exports = { BOARDING_PASS, LETTER, normalizeTicketSide, isVipTicket, generateTicketPdf, generateInvoicePdf };
