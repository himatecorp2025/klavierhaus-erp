"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { generateGuestListPdf } = require("../../server/guest-list-pdf");

const outputDirectory = path.join(__dirname, "..", "..", "tmp", "pdfs");
fs.mkdirSync(outputDirectory, { recursive: true });
const guests = Array.from({ length: 41 }, (_value, index) => ({
  attendee_name: `${String(index + 1).padStart(2, "0")}. Árvíztűrő Tükörfúrógép Vendég`
}));
const pdf = generateGuestListPdf({
  event: { title: "Klavierhaus – Ravel estje", dateLabel: "2031. április 10. 19:00" },
  guests,
  language: "hu"
});
const outputPath = path.join(outputDirectory, "guest-list-sample.pdf");
fs.writeFileSync(outputPath, pdf);
console.log(outputPath);
