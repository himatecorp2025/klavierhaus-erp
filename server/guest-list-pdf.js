const fs = require("node:fs");
const path = require("node:path");

const A4 = { width: 595.28, height: 841.89 };
const GOLD = "0.788 0.663 0.369";
const CREAM = "0.969 0.953 0.894";
const MUTED_GOLD = "0.510 0.431 0.250";

function pdfNumber(value) {
  return Number(value).toFixed(2).replace(/\.00$/, "");
}

function escapePdfText(value) {
  return String(value || "").replace(/[\r\n\t]+/g, " ").replace(/\s+/g, " ").trim();
}

function unicodeHex(value) {
  const output = [];
  for (const character of escapePdfText(value)) {
    const code = character.codePointAt(0);
    output.push((code > 0xffff ? 0x003f : code).toString(16).padStart(4, "0"));
  }
  return output.join("").toUpperCase();
}

function readTables(font) {
  const count = font.readUInt16BE(4);
  const tables = new Map();
  for (let index = 0; index < count; index += 1) {
    const offset = 12 + index * 16;
    tables.set(font.toString("ascii", offset, offset + 4), {
      offset: font.readUInt32BE(offset + 8),
      length: font.readUInt32BE(offset + 12)
    });
  }
  return tables;
}

function createFontMetrics(font) {
  const tables = readTables(font);
  const head = tables.get("head");
  const hhea = tables.get("hhea");
  const hmtx = tables.get("hmtx");
  const cmap = tables.get("cmap");
  if (!head || !hhea || !hmtx || !cmap) throw new Error("INVALID_GUEST_LIST_FONT");
  const unitsPerEm = font.readUInt16BE(head.offset + 18);
  const bbox = [36, 38, 40, 42].map((position) => Math.round(font.readInt16BE(head.offset + position) * 1000 / unitsPerEm));
  const metricCount = font.readUInt16BE(hhea.offset + 34);
  const widthForGlyph = (glyph) => {
    const metricIndex = Math.min(Math.max(0, glyph), metricCount - 1);
    return Math.round(font.readUInt16BE(hmtx.offset + metricIndex * 4) * 1000 / unitsPerEm);
  };
  const subtableCount = font.readUInt16BE(cmap.offset + 2);
  const candidates = [];
  for (let index = 0; index < subtableCount; index += 1) {
    const record = cmap.offset + 4 + index * 8;
    const platform = font.readUInt16BE(record);
    const encoding = font.readUInt16BE(record + 2);
    const offset = cmap.offset + font.readUInt32BE(record + 4);
    const format = font.readUInt16BE(offset);
    if (format === 12 || format === 4) candidates.push({ platform, encoding, offset, format });
  }
  const selected = candidates.sort((left, right) => (right.format - left.format) || (right.platform - left.platform))[0];
  if (!selected) throw new Error("UNSUPPORTED_GUEST_LIST_FONT_CMAP");
  function glyphForCode(code) {
    if (selected.format === 12) {
      const groups = font.readUInt32BE(selected.offset + 12);
      for (let index = 0; index < groups; index += 1) {
        const group = selected.offset + 16 + index * 12;
        const start = font.readUInt32BE(group);
        const end = font.readUInt32BE(group + 4);
        if (code >= start && code <= end) return font.readUInt32BE(group + 8) + code - start;
      }
      return 0;
    }
    const segCount = font.readUInt16BE(selected.offset + 6) / 2;
    const endCodes = selected.offset + 14;
    const startCodes = endCodes + segCount * 2 + 2;
    const deltas = startCodes + segCount * 2;
    const rangeOffsets = deltas + segCount * 2;
    for (let index = 0; index < segCount; index += 1) {
      const start = font.readUInt16BE(startCodes + index * 2);
      const end = font.readUInt16BE(endCodes + index * 2);
      if (code < start || code > end) continue;
      const delta = font.readInt16BE(deltas + index * 2);
      const rangeOffsetPosition = rangeOffsets + index * 2;
      const rangeOffset = font.readUInt16BE(rangeOffsetPosition);
      if (!rangeOffset) return (code + delta) & 0xffff;
      const glyphPosition = rangeOffsetPosition + rangeOffset + (code - start) * 2;
      const glyph = font.readUInt16BE(glyphPosition);
      return glyph ? (glyph + delta) & 0xffff : 0;
    }
    return 0;
  }
  return { unitsPerEm, bbox, glyphForCode, widthForGlyph };
}

function jpegDimensions(buffer) {
  let offset = 2;
  while (offset < buffer.length - 9) {
    if (buffer[offset] !== 0xff) { offset += 1; continue; }
    const marker = buffer[offset + 1];
    const length = buffer.readUInt16BE(offset + 2);
    if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) {
      return { height: buffer.readUInt16BE(offset + 5), width: buffer.readUInt16BE(offset + 7), components: buffer[offset + 9] };
    }
    offset += 2 + length;
  }
  throw new Error("INVALID_GUEST_LIST_LOGO");
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

function usedCodePoints(values) {
  const codes = new Set([32, 45, 47, 58]);
  values.forEach((value) => {
    for (const character of escapePdfText(value)) codes.add(Math.min(character.codePointAt(0), 0xffff));
  });
  return [...codes].sort((left, right) => left - right);
}

function createToUnicode(codes) {
  const mappings = codes.map((code) => `<${code.toString(16).padStart(4, "0")}> <${code.toString(16).padStart(4, "0")}>`).join("\n");
  return `/CIDInit /ProcSet findresource begin\n12 dict begin\nbegincmap\n/CIDSystemInfo << /Registry (Adobe) /Ordering (Identity) /Supplement 0 >> def\n/CMapName /KlavierhausUnicode def\n/CMapType 2 def\n1 begincodespacerange\n<0000> <FFFF>\nendcodespacerange\n${codes.length} beginbfchar\n${mappings}\nendbfchar\nendcmap\nCMapName currentdict /CMap defineresource pop\nend\nend`;
}

function truncateToWidth(text, maxWidth, fontSize, metrics) {
  const source = escapePdfText(text);
  let width = 0;
  let result = "";
  for (const character of source) {
    const code = Math.min(character.codePointAt(0), 0xffff);
    const characterWidth = metrics.widthForGlyph(metrics.glyphForCode(code)) * fontSize / 1000;
    if (width + characterWidth > maxWidth) return `${result.trimEnd()}…`;
    result += character;
    width += characterWidth;
  }
  return result;
}

function textCommand(text, x, y, size, color = CREAM) {
  return `${color} rg BT /F1 ${pdfNumber(size)} Tf 1 0 0 1 ${pdfNumber(x)} ${pdfNumber(y)} Tm <${unicodeHex(text)}> Tj ET\n`;
}

function pageContent({ event, names, language, pageNumber, pageCount, metrics }) {
  const hu = language === "hu";
  const width = A4.width;
  const height = A4.height;
  const commands = [
    `0.02 0.02 0.02 rg 0 0 ${pdfNumber(width)} ${pdfNumber(height)} re f\n`,
    `${GOLD} RG 3 w 20 20 ${pdfNumber(width - 40)} ${pdfNumber(height - 40)} re S\n`,
    `${MUTED_GOLD} RG .7 w 28 28 ${pdfNumber(width - 56)} ${pdfNumber(height - 56)} re S\n`,
    "q 70 0 0 73 262.5 729 cm /Logo Do Q\n",
    textCommand(hu ? "VENDÉGLISTA" : "GUEST LIST", 54, 698, 17, GOLD),
    textCommand(truncateToWidth(event.title, 487, 20, metrics), 54, 668, 20, CREAM),
    textCommand(event.dateLabel || "", 54, 645, 10, CREAM),
    `${MUTED_GOLD} RG .8 w 54 624 487 0 re S\n`,
    textCommand(hu ? "VENDÉG NEVE" : "GUEST NAME", 66, 605, 9, GOLD),
    textCommand(hu ? "MEGÉRKEZETT" : "ARRIVED", 456, 605, 9, GOLD)
  ];
  let y = 579;
  names.forEach((name) => {
    commands.push(`${MUTED_GOLD} RG .45 w 54 ${pdfNumber(y - 8)} 487 28 re S\n`);
    commands.push(textCommand(truncateToWidth(name, 365, 11, metrics), 66, y, 11, CREAM));
    // The checklist box is centered against the full guest row, not the text baseline.
    commands.push(`${GOLD} RG 1 w 500 ${pdfNumber(y - 0.5)} 13 13 re S\n`);
    y -= 28;
  });
  // Keep pagination as plain ASCII so every PDF viewer renders the same `1 / 1` form.
  commands.push(textCommand(`${pageNumber} / ${pageCount}`, 288, 43, 8.5, GOLD));
  commands.push(textCommand("KLAVIERHAUS · NEW YORK | FRANCE", 54, 43, 8.5, CREAM));
  return commands.join("");
}

function generateGuestListPdf({ event, guests, language = "en", logoPath, fontPath }) {
  const names = guests.map((guest) => escapePdfText(guest.attendee_name || guest.guest_name || guest.name)).filter(Boolean);
  const safeNames = names.length ? names : [language === "hu" ? "Nincs rögzített vendég" : "No registered guests"];
  const rowsPerPage = 18;
  const pageCount = Math.max(1, Math.ceil(safeNames.length / rowsPerPage));
  const labels = [event.title, event.dateLabel, ...safeNames, "0123456789", "GUEST LIST", "VENDÉGLISTA", "ARRIVED", "MEGÉRKEZETT", "KLAVIERHAUS · NEW YORK | FRANCE"];
  const font = fs.readFileSync(fontPath || path.join(__dirname, "assets", "DejaVuSans.ttf"));
  const metrics = createFontMetrics(font);
  const codes = usedCodePoints(labels);
  const cidMap = Buffer.alloc((Math.max(...codes) + 1) * 2);
  codes.forEach((code) => cidMap.writeUInt16BE(metrics.glyphForCode(code), code * 2));
  const widths = codes.map((code) => `${code} [${metrics.widthForGlyph(metrics.glyphForCode(code))}]`).join(" ");
  const logo = fs.readFileSync(logoPath || path.join(__dirname, "assets", "klavierhaus-logo-black.jpg"));
  const logoSize = jpegDimensions(logo);
  const pdf = new PdfBuilder();
  const pagesId = pdf.reserve();
  const fontFileId = pdf.add(pdf.stream(`/Length1 ${font.length}`, font));
  const descriptorId = pdf.add(`<< /Type /FontDescriptor /FontName /DejaVuSans /Flags 32 /FontBBox [${metrics.bbox.join(" ")}] /ItalicAngle 0 /Ascent 928 /Descent -236 /CapHeight 729 /StemV 80 /FontFile2 ${fontFileId} 0 R >>`);
  const cidMapId = pdf.add(pdf.stream("", cidMap));
  const unicodeId = pdf.add(pdf.stream("", createToUnicode(codes)));
  const cidFontId = pdf.add(`<< /Type /Font /Subtype /CIDFontType2 /BaseFont /DejaVuSans /CIDSystemInfo << /Registry (Adobe) /Ordering (Identity) /Supplement 0 >> /FontDescriptor ${descriptorId} 0 R /CIDToGIDMap ${cidMapId} 0 R /DW 1000 /W [${widths}] >>`);
  const fontId = pdf.add(`<< /Type /Font /Subtype /Type0 /BaseFont /DejaVuSans /Encoding /Identity-H /DescendantFonts [${cidFontId} 0 R] /ToUnicode ${unicodeId} 0 R >>`);
  const logoId = pdf.add(pdf.stream(`/Type /XObject /Subtype /Image /Width ${logoSize.width} /Height ${logoSize.height} /ColorSpace ${logoSize.components === 1 ? "/DeviceGray" : "/DeviceRGB"} /BitsPerComponent 8 /Filter /DCTDecode`, logo));
  const pageIds = [];
  for (let index = 0; index < pageCount; index += 1) {
    const content = pageContent({ event, names: safeNames.slice(index * rowsPerPage, (index + 1) * rowsPerPage), language, pageNumber: index + 1, pageCount, metrics });
    const contentId = pdf.add(pdf.stream("", content));
    pageIds.push(pdf.add(`<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 ${pdfNumber(A4.width)} ${pdfNumber(A4.height)}] /Resources << /Font << /F1 ${fontId} 0 R >> /XObject << /Logo ${logoId} 0 R >> >> /Contents ${contentId} 0 R >>`));
  }
  pdf.set(pagesId, `<< /Type /Pages /Count ${pageIds.length} /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] >>`);
  const catalogId = pdf.add(`<< /Type /Catalog /Pages ${pagesId} 0 R /PageLayout /SinglePage >>`);
  const infoId = pdf.add("<< /Title (Klavierhaus Guest List) /Author (Klavierhaus) /Creator (Klavierhaus ERP) >>");
  return pdf.serialize(catalogId, infoId);
}

module.exports = { generateGuestListPdf, createFontMetrics, jpegDimensions };
