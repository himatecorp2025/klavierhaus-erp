"use strict";

const fs = require("node:fs");
const path = require("node:path");
const zlib = require("node:zlib");
const { createFontMetrics, jpegDimensions } = require("./guest-list-pdf");

const GOLD = "0.788 0.663 0.369";
const CREAM = "0.969 0.953 0.894";
const MUTED = "0.62 0.58 0.50";
// Long-envelope boarding-pass insert: 8.5 × 3.5 inches at 72 pt/in.
// The dimensions are deliberately explicit so the exported PDF has an exact
// MediaBox and can be printed without browser scaling.
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

function readPngAsRgb(buffer) {
  if (buffer.length < 33 || buffer.toString("hex", 0, 8) !== "89504e470d0a1a0a") throw new Error("INVALID_LOGO_PNG");
  const width = buffer.readUInt32BE(16);
  const height = buffer.readUInt32BE(20);
  const bitDepth = buffer[24];
  const colorType = buffer[25];
  const interlace = buffer[28];
  const channelsByColorType = { 0: 1, 2: 3, 4: 2, 6: 4 };
  const channels = channelsByColorType[colorType];
  if (!width || !height || bitDepth !== 8 || !channels || interlace !== 0) throw new Error("UNSUPPORTED_LOGO_PNG");
  const idat = [];
  let offset = 8;
  while (offset + 12 <= buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString("ascii", offset + 4, offset + 8);
    const start = offset + 8;
    const end = start + length;
    if (end + 4 > buffer.length) throw new Error("INVALID_LOGO_PNG");
    if (type === "IDAT") idat.push(buffer.subarray(start, end));
    if (type === "IEND") break;
    offset = end + 4;
  }
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
  const rgb = Buffer.alloc(width * height * 3);
  let targetOffset = 0;
  rows.forEach((row) => {
    for (let x = 0; x < width; x += 1) {
      const source = x * channels;
      const alpha = colorType === 6 ? row[source + 3] / 255 : colorType === 4 ? row[source + 1] / 255 : 1;
      const red = row[source];
      const green = colorType === 0 || colorType === 4 ? red : row[source + 1];
      const blue = colorType === 0 || colorType === 4 ? red : row[source + 2];
      // Flatten transparency onto the black document background so PDF viewers
      // render transparent logos consistently without an SMask dependency.
      rgb[targetOffset++] = Math.round(red * alpha);
      rgb[targetOffset++] = Math.round(green * alpha);
      rgb[targetOffset++] = Math.round(blue * alpha);
    }
  });
  return { width, height, colorSpace: "/DeviceRGB", filter: "/FlateDecode", data: zlib.deflateSync(rgb) };
}

function readLogoImage(logoPath) {
  if (!logoPath) return null;
  try {
    const buffer = fs.readFileSync(logoPath);
    if (buffer.toString("hex", 0, 8) === "89504e470d0a1a0a") return readPngAsRgb(buffer);
    if (buffer.length > 4 && buffer[0] === 0xff && buffer[1] === 0xd8) {
      const dimensions = jpegDimensions(buffer);
      return { width: dimensions.width, height: dimensions.height, colorSpace: dimensions.components === 1 ? "/DeviceGray" : "/DeviceRGB", filter: "/DCTDecode", data: buffer };
    }
  } catch (_error) {
    return null;
  }
  return null;
}

function logoCommand(hasLogo, x, y, width, height) {
  return hasLogo ? `q ${number(width)} 0 0 ${number(height)} ${number(x)} ${number(y)} cm /Logo Do Q\n` : "";
}

function unicodeHex(value) {
  return [...safeText(value)].map((character) => Math.min(character.codePointAt(0), 0xffff).toString(16).padStart(4, "0")).join("").toUpperCase();
}

function textCommand(text, x, y, size, color = CREAM) {
  return `${color} rg BT /F1 ${number(size)} Tf 1 0 0 1 ${number(x)} ${number(y)} Tm <${unicodeHex(text)}> Tj ET\n`;
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

function ticketPriceText(ticket, event, language = "en") {
  const currency = String(ticket.currency || event.currency || "USD").toUpperCase();
  const cents = Number(ticket.price_cents);
  if (!Number.isFinite(cents)) return "";
  if (cents <= 0) return language === "hu" ? "INGYENES" : "COMPLIMENTARY";
  return `${currency} ${(cents / 100).toFixed(2)}`;
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
  const metrics = createFontMetrics(font);
  const codes = usedCodes(labels);
  const cidMap = Buffer.alloc((Math.max(...codes) + 1) * 2);
  codes.forEach((code) => cidMap.writeUInt16BE(metrics.glyphForCode(code), code * 2));
  const widths = codes.map((code) => `${code} [${metrics.widthForGlyph(metrics.glyphForCode(code))}]`).join(" ");
  const fontFileId = pdf.add(pdf.stream(`/Length1 ${font.length}`, font));
  const descriptorId = pdf.add(`<< /Type /FontDescriptor /FontName /DejaVuSans /Flags 32 /FontBBox [${metrics.bbox.join(" ")}] /ItalicAngle 0 /Ascent 928 /Descent -236 /CapHeight 729 /StemV 80 /FontFile2 ${fontFileId} 0 R >>`);
  const cidMapId = pdf.add(pdf.stream("", cidMap));
  const unicodeId = pdf.add(pdf.stream("", createToUnicode(codes)));
  const cidFontId = pdf.add(`<< /Type /Font /Subtype /CIDFontType2 /BaseFont /DejaVuSans /CIDSystemInfo << /Registry (Adobe) /Ordering (Identity) /Supplement 0 >> /FontDescriptor ${descriptorId} 0 R /CIDToGIDMap ${cidMapId} 0 R /DW 1000 /W [${widths}] >>`);
  const fontId = pdf.add(`<< /Type /Font /Subtype /Type0 /BaseFont /DejaVuSans /Encoding /Identity-H /DescendantFonts [${cidFontId} 0 R] /ToUnicode ${unicodeId} 0 R >>`);
  return { fontId, metrics };
}

function createPdf({ pages, size, labels, title, fontPath, logoPath }) {
  const pdf = new PdfBuilder();
  const pagesId = pdf.reserve();
  const { fontId, metrics } = addFont(pdf, labels, fontPath);
  const logo = readLogoImage(logoPath);
  const logoId = logo ? pdf.add(pdf.stream(`/Type /XObject /Subtype /Image /Width ${logo.width} /Height ${logo.height} /ColorSpace ${logo.colorSpace} /BitsPerComponent 8 /Filter ${logo.filter}`, logo.data)) : null;
  const pageIds = pages.map((content) => {
    const contentId = pdf.add(pdf.stream("", content(metrics, Boolean(logo))));
    const imageResources = logoId ? ` /XObject << /Logo ${logoId} 0 R >>` : "";
    return pdf.add(`<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 ${number(size.width)} ${number(size.height)}] /Resources << /Font << /F1 ${fontId} 0 R >>${imageResources} >> /Contents ${contentId} 0 R >>`);
  });
  pdf.set(pagesId, `<< /Type /Pages /Count ${pageIds.length} /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] >>`);
  const catalogId = pdf.add(`<< /Type /Catalog /Pages ${pagesId} 0 R /PageLayout /SinglePage >>`);
  const infoId = pdf.add(`<< /Title (${safeText(title)}) /Author (Klavierhaus) /Creator (Klavierhaus ERP) >>`);
  return pdf.serialize(catalogId, infoId);
}

function ticketPage({ event, ticket, index, pageCount, language, metrics, hasLogo }) {
  const hu = language === "hu";
  const title = hu ? (event.title_hu || event.title_en) : event.title_en;
  const date = event.dateLabel || event.start_at || "";
  const venue = event.venueLabel || event.venue_name || "Klavierhaus";
  const label = hu ? "BELÉPŐJEGY" : "ADMISSION TICKET";
  const attendee = hu ? "VENDÉG" : "ATTENDEE";
  const code = safeText(ticket.public_code);
  const price = ticketPriceText(ticket, event, language);
  const commands = [
    `0.02 0.02 0.02 rg 0 0 ${number(BOARDING_PASS.width)} ${number(BOARDING_PASS.height)} re f\n`,
    `${GOLD} RG 2.5 w 14 14 ${number(BOARDING_PASS.width - 28)} ${number(BOARDING_PASS.height - 28)} re S\n`,
    `${GOLD} rg 14 205 4 4 re f\n`,
    logoCommand(hasLogo, 31, 182, 30, 30),
    textCommand("KLAVIERHAUS", hasLogo ? 70 : 31, 204, 12, GOLD),
    textCommand(label, 31, 174, 10, MUTED),
    textCommand(truncate(title, 370, 23, metrics), 31, 141, 23, CREAM),
    textCommand(date, 31, 112, 10, CREAM),
    textCommand(truncate(venue, 370, 10, metrics), 31, 94, 10, MUTED),
    `${MUTED} RG .7 w 430 30 0 175 re S\n`,
    textCommand(attendee, 458, 174, 8, GOLD),
    textCommand(truncate(ticket.attendee_name, 125, 16, metrics), 458, 143, 16, CREAM),
    textCommand(hu ? "JEGYKÓD" : "TICKET CODE", 458, 103, 8, GOLD),
    textCommand(truncate(code, 125, 9, metrics), 458, 84, 9, CREAM),
    textCommand(hu ? "ÁR" : "PRICE", 458, 67, 8, GOLD),
    textCommand(truncate(price, 125, 8.5, metrics), 458, 48, 8.5, CREAM),
    textCommand(`${index + 1} / ${pageCount}`, 458, 29, 8, MUTED),
    textCommand("BLACK · GOLD · PERSONAL ADMISSION", 31, 27, 7.5, MUTED)
  ];
  return commands.join("");
}

function generateTicketPdf({ event, tickets, language = "en", fontPath, logoPath }) {
  const rows = Array.isArray(tickets) ? tickets : [];
  const safeRows = rows.length ? rows : [{ attendee_name: language === "hu" ? "Nincs jegy" : "No ticket", public_code: "" }];
  const labels = safeRows.flatMap((ticket) => [ticket.attendee_name, ticket.public_code, ticket.currency, ticket.price_cents, ticketPriceText(ticket, event, language)]).concat([
    event.title_en, event.title_hu, event.dateLabel, event.venueLabel, event.start_at, event.venue_name, event.currency, "KLAVIERHAUS", "ADMISSION TICKET", "BELÉPŐJEGY", "ATTENDEE", "VENDÉG", "TICKET CODE", "JEGYKÓD", "PRICE", "ÁR", "COMPLIMENTARY", "INGYENES", "BLACK · GOLD · PERSONAL ADMISSION"
  ]);
  return createPdf({
    pages: safeRows.map((ticket, index) => (metrics, hasLogo) => ticketPage({ event, ticket, index, pageCount: safeRows.length, language, metrics, hasLogo })),
    size: BOARDING_PASS,
    labels,
    title: "Klavierhaus Admission Tickets",
    fontPath,
    logoPath
  });
}

function invoicePage({ company, event, payment, tickets, invoiceNumber, language, metrics, hasLogo }) {
  const hu = language === "hu";
  const currency = String(payment.currency || company.invoice_currency || "USD").toUpperCase();
  const total = (Number(payment.amount_total || 0) / 100).toFixed(2);
  const issueDate = invoiceIssueDate(payment, language);
  const eventDate = event.dateLabel || event.start_at || "";
  const venue = event.venueLabel || event.venue_name || "Klavierhaus";
  const lines = [
    `0.02 0.02 0.02 rg 0 0 ${number(LETTER.width)} ${number(LETTER.height)} re f\n`,
    `${GOLD} RG 2 w 28 28 ${number(LETTER.width - 56)} ${number(LETTER.height - 56)} re S\n`,
    logoCommand(hasLogo, 54, 724, 42, 42),
    textCommand(company.legal_name || company.trade_name || "Klavierhaus", hasLogo ? 112 : 54, 716, 19, CREAM),
    textCommand(hu ? "SZÁMLA" : "INVOICE", 400, 716, 18, GOLD),
    textCommand(invoiceNumber, 400, 692, 9, MUTED),
    textCommand(hu ? "KIÁLLÍTVA" : "ISSUED", 400, 674, 8, GOLD),
    textCommand(issueDate, 400, 658, 9, CREAM),
    textCommand(hu ? "FIZETETT" : "PAID", 400, 640, 8, GOLD),
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
    textCommand(hu ? "ESEMÉNY" : "EVENT", 54, 480, 8, GOLD),
    textCommand(truncate(eventDate, 300, 8, metrics), 54, 464, 8, MUTED),
    textCommand(truncate(venue, 300, 8, metrics), 54, 450, 8, MUTED),
    textCommand(hu ? "TÉTEL" : "DESCRIPTION", 54, 424, 8, GOLD),
    textCommand(hu ? "MENNYISÉG" : "QTY", 398, 424, 8, GOLD),
    textCommand(hu ? "ÖSSZEG" : "AMOUNT", 476, 424, 8, GOLD),
    `${MUTED} RG .6 w 54 411 504 0 re\n`,
    textCommand(truncate(hu ? (event.title_hu || event.title_en) : event.title_en, 320, 11, metrics), 54, 388, 11, CREAM),
    textCommand(`${tickets.length}`, 410, 388, 11, CREAM),
    textCommand(`${currency} ${total}`, 470, 388, 11, CREAM),
    `${GOLD} RG .8 w 54 348 504 0 re\n`,
    textCommand(hu ? "FIZETENDŐ / RENDEZVE" : "TOTAL / PAID", 350, 322, 9, GOLD),
    textCommand(`${currency} ${total}`, 430, 296, 17, CREAM),
    textCommand(company.invoice_payment_terms || "Paid at checkout", 54, 126, 8, MUTED),
    textCommand(hu ? "Eseménybelépő vásárlásának bizonylata. A dokumentum adatai a kiállításkor elmentett tranzakcióból származnak." : "Receipt for an event-ticket purchase. The document reflects the transaction data saved at issuance.", 54, 100, 8, MUTED),
    textCommand(company.invoice_footer || "Klavierhaus · New York", 54, 76, 8, MUTED)
  ];
  return lines.join("");
}

function generateInvoicePdf({ company = {}, event, payment, tickets = [], invoiceNumber, language = "en", fontPath, logoPath }) {
  const currency = String(payment.currency || company.invoice_currency || "USD").toUpperCase();
  const total = (Number(payment.amount_total || 0) / 100).toFixed(2);
  const issueDate = invoiceIssueDate(payment, language);
  const eventDate = event.dateLabel || event.start_at || "";
  const venue = event.venueLabel || event.venue_name || "Klavierhaus";
  const labels = [
    company.legal_name, company.trade_name, company.address_line1, company.address_line2, company.city, company.state, company.postal_code, company.country, company.tax_id, company.email, company.phone, company.invoice_payment_terms,
    payment.purchaser_name, payment.purchaser_email, payment.currency, payment.amount_total, `${currency} ${total}`, `${tickets.length}`, event.title_en, event.title_hu, event.dateLabel, event.venueLabel, event.start_at, event.venue_name, event.currency, issueDate, invoiceNumber, company.invoice_payment_terms, company.invoice_footer, "Klavierhaus", "Klavierhaus · New York", "Paid at checkout", "INVOICE", "SZÁMLA", "ISSUED", "KIÁLLÍTVA", "PAID", "FIZETETT", "BILLED TO", "VÁSÁRLÓ", "EVENT", "ESEMÉNY", "DESCRIPTION", "TÉTEL", "QTY", "AMOUNT", "MENNYISÉG", "ÖSSZEG", "TOTAL / PAID", "FIZETENDŐ / RENDEZVE", "Receipt for an event-ticket purchase.", "Eseménybelépő vásárlásának bizonylata."
  ];
  return createPdf({
    pages: [(metrics, hasLogo) => invoicePage({ company, event, payment, tickets, invoiceNumber, language, metrics, hasLogo })],
    size: LETTER,
    labels,
    title: `Klavierhaus Invoice ${invoiceNumber}`,
    fontPath,
    logoPath
  });
}

module.exports = { BOARDING_PASS, LETTER, generateTicketPdf, generateInvoicePdf };
