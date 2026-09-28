"use strict";

const { parentPort, workerData } = require("node:worker_threads");

const allowed = Object.freeze({
  "document-pdf": new Set([
    "generateInvoicePdf","generateBusinessInvoicePdf","generateMonthlyInvoiceReportPdf","generateFinancialStatementPdf",
    "generateTicketBackPdf","generateTicketDocumentPdf","generateTicketFrontPdf","generateTicketFullPdf","generateTicketPdf"
  ]),
  "guest-list-pdf": new Set(["generateGuestDataPdf", "generateGuestListPdf"])
});

try {
  const moduleName = String(workerData?.moduleName || "document-pdf");
  const generatorName = String(workerData?.generatorName || "");
  if (!allowed[moduleName]?.has(generatorName)) throw Object.assign(new Error("PDF_GENERATOR_NOT_ALLOWED"), { code: "PDF_GENERATOR_NOT_ALLOWED" });
  const generators = require(`./${moduleName}`);
  const generator = generators[generatorName];
  if (typeof generator !== "function") throw Object.assign(new Error("PDF_GENERATOR_NOT_FOUND"), { code: "PDF_GENERATOR_NOT_FOUND" });
  const pdf = generator(workerData?.args || {});
  if (!Buffer.isBuffer(pdf)) throw Object.assign(new Error("PDF_GENERATOR_INVALID_OUTPUT"), { code: "PDF_GENERATOR_INVALID_OUTPUT" });
  parentPort.postMessage({ ok: true, pdf });
} catch (error) {
  parentPort.postMessage({ ok: false, error: { message: error?.message || "PDF_WORKER_FAILED", code: error?.code || null } });
}
