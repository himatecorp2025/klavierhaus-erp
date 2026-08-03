const test = require("node:test");
const assert = require("node:assert/strict");
const AdmZip = require("adm-zip");

test("adm-zip 0.6 remains compatible with the XLSX reader API used by imports", () => {
  const archive = new AdmZip();
  archive.addFile("xl/workbook.xml", Buffer.from("<workbook>ok</workbook>", "utf8"));
  const reopened = new AdmZip(archive.toBuffer());
  assert.equal(reopened.getEntry("xl/workbook.xml").getData().toString("utf8"), "<workbook>ok</workbook>");
});
