"use strict";

const INVOICE_DERIVED_SOURCE_TYPES = new Set([
  "JOB_REVENUE",
  "DAILY_RATE",
  "TECHNICIAN_EXTRA_COMPENSATION",
  "MANUAL_INVOICE",
  "WORKFLOW_INVOICE_REVENUE",
  "WORKFLOW_INVOICE_MATERIAL",
  "event_payment_refund",
  "event_manual_ticket_refund"
]);

const CASH_ASSET_CATEGORIES = new Set(["CASH", "BANK", "CHECKS"]);
const ASSET_BALANCE_CATEGORIES = new Set(["CASH", "BANK", "CHECKS", "AR", "INVENTORY", "PREPAID_EXPENSE", "COMPANY_PIANOS", "TOOLS", "OTHER_ASSET"]);
const LIABILITY_BALANCE_CATEGORIES = new Set(["LOAN", "BANK_LOAN", "INSURANCE_LIABILITY", "OTHER_LONG_TERM_SOURCE", "AP", "CHECK_PAYABLE", "RENT_PAYABLE", "UTILITIES_PAYABLE", "SHORT_TERM_OPERATING", "OTHER_SHORT_TERM_SOURCE", "SALES_TAX_PAYABLE", "DEFERRED_REVENUE"]);
const EQUITY_BALANCE_CATEGORIES = new Set(["OWNER_EQUITY", "OWNER_OPENING_EQUITY", "OTHER_SOURCE", "OTHER_EQUITY"]);
const SALES_TAX_REMITTANCE_CATEGORIES = new Set(["SALES_TAX_REMITTANCE", "SALES_TAX_PAYMENT"]);
const OWNER_OPENING_EQUITY_CATEGORIES = new Set(["OWNER_EQUITY", "OWNER_OPENING_EQUITY"]);

function roundMoney(value) {
  const number = Number(value || 0);
  if (!Number.isFinite(number)) return 0;
  return Math.round((number + Number.EPSILON) * 100) / 100;
}

function sumMoney(values) {
  let total = 0;
  for (const value of values || []) total = roundMoney(total + roundMoney(value));
  return total;
}

function isInvoiceDerivedFinancialItem(item) {
  return INVOICE_DERIVED_SOURCE_TYPES.has(String(item?.source_type || ""));
}

function activeInvoices(rows) {
  return (rows || []).filter((row) => String(row?.status || "").toLowerCase() !== "void");
}

function pendingInvoice(row) {
  return ["issued", "carried_over", "draft"].includes(String(row?.status || "").toLowerCase());
}

function invoiceSubtotal(row) {
  const subtotal = Number(row?.subtotal ?? row?.subtotal_amount);
  if (Number.isFinite(subtotal)) return roundMoney(subtotal);
  return roundMoney(Number(row?.total_amount || 0) - Number(row?.tax_amount || 0));
}

function invoiceTax(row) {
  return roundMoney(row?.tax_amount || 0);
}

function invoiceTotal(row) {
  const total = Number(row?.total_amount);
  return Number.isFinite(total) ? roundMoney(total) : roundMoney(invoiceSubtotal(row) + invoiceTax(row));
}

function eventRevenueRecognizedAt(row, cutoffExclusive = null) {
  if (String(row?.source_type || "").toLowerCase() !== "event") return true;
  if (String(row?.revenue_recognition_status || "").toUpperCase() !== "RECOGNIZED") return false;
  if (!cutoffExclusive) return true;
  const date = String(row?.revenue_recognition_date || "");
  return !date || date < String(cutoffExclusive);
}

function accountingCreditMemos(rows) {
  return (rows || []).filter((row) => Number(row?.accounting_effect ?? 1) === 1 && String(row?.memo_type || "").toUpperCase() !== "VOID_REVERSAL" && String(row?.invoice_status || "").toLowerCase() !== "void");
}

function creditMemoSubtotal(row) {
  return roundMoney(row?.subtotal_amount ?? row?.subtotal ?? 0);
}

function creditMemoTax(row) {
  return roundMoney(row?.tax_amount || 0);
}

function creditMemoTotal(row) {
  const total = Number(row?.total_amount);
  return Number.isFinite(total) ? roundMoney(total) : roundMoney(creditMemoSubtotal(row) + creditMemoTax(row));
}

function memoRevenueEffectiveAt(row, cutoffExclusive = null) {
  const date = String(row?.revenue_effect_date || "");
  if (!date) return false;
  return !cutoffExclusive || date < String(cutoffExclusive);
}

function addEquity(result, category, amount) {
  if (OWNER_OPENING_EQUITY_CATEGORIES.has(category)) result.ownersOpeningEquity = roundMoney(result.ownersOpeningEquity + amount);
  else result.manualEquity = roundMoney(result.manualEquity + amount);
}

function summarizeManualBalanceItems(items) {
  const result = {
    cashDelta: 0,
    manualAssets: 0,
    manualLiabilities: 0,
    ownersOpeningEquity: 0,
    manualEquity: 0,
    salesTaxRemitted: 0
  };

  for (const item of items || []) {
    const type = String(item?.main_type || "").toUpperCase();
    if (!["ASSET", "LIABILITY", "EQUITY"].includes(type)) continue;
    const amount = roundMoney(item?.amount || 0);
    if (amount === 0) continue;
    const category = String(item?.category || "").toUpperCase();
    const offset = String(item?.balance_account || "").toUpperCase();

    if (type === "ASSET") {
      if (CASH_ASSET_CATEGORIES.has(category)) {
        result.cashDelta = roundMoney(result.cashDelta + amount);
        if (LIABILITY_BALANCE_CATEGORIES.has(offset)) result.manualLiabilities = roundMoney(result.manualLiabilities + amount);
        else addEquity(result, EQUITY_BALANCE_CATEGORIES.has(offset) ? offset : "OWNER_OPENING_EQUITY", amount);
      } else {
        result.manualAssets = roundMoney(result.manualAssets + amount);
        if (LIABILITY_BALANCE_CATEGORIES.has(offset)) result.manualLiabilities = roundMoney(result.manualLiabilities + amount);
        else if (EQUITY_BALANCE_CATEGORIES.has(offset)) addEquity(result, offset, amount);
        else result.cashDelta = roundMoney(result.cashDelta - amount);
      }
      continue;
    }

    if (type === "LIABILITY") {
      if (SALES_TAX_REMITTANCE_CATEGORIES.has(category)) {
        result.salesTaxRemitted = roundMoney(result.salesTaxRemitted + amount);
        result.cashDelta = roundMoney(result.cashDelta - amount);
      } else {
        result.manualLiabilities = roundMoney(result.manualLiabilities + amount);
        if (ASSET_BALANCE_CATEGORIES.has(offset) && !CASH_ASSET_CATEGORIES.has(offset)) result.manualAssets = roundMoney(result.manualAssets + amount);
        else result.cashDelta = roundMoney(result.cashDelta + amount);
      }
      continue;
    }

    addEquity(result, category, amount);
    if (ASSET_BALANCE_CATEGORIES.has(offset) && !CASH_ASSET_CATEGORIES.has(offset)) result.manualAssets = roundMoney(result.manualAssets + amount);
    else result.cashDelta = roundMoney(result.cashDelta + amount);
  }

  return result;
}

function buildAccountingSnapshot({
  monthInvoices = [],
  monthDirectItems = [],
  asOfInvoices = [],
  asOfDirectItems = [],
  monthCreditMemos = [],
  asOfCreditMemos = [],
  asOfDateExclusive = null
} = {}) {
  const monthActiveInvoices = activeInvoices(monthInvoices);
  const asOfActiveInvoices = activeInvoices(asOfInvoices);
  const cleanMonthDirect = (monthDirectItems || []).filter((item) => !isInvoiceDerivedFinancialItem(item));
  const cleanAsOfDirect = (asOfDirectItems || []).filter((item) => !isInvoiceDerivedFinancialItem(item));
  const monthMemos = accountingCreditMemos(monthCreditMemos);
  const asOfMemos = accountingCreditMemos(asOfCreditMemos);

  const grossInvoiceRevenue = sumMoney(monthActiveInvoices
    .filter((row) => row.direction === "receivable" && eventRevenueRecognizedAt(row))
    .map(invoiceSubtotal));
  const contraRevenue = sumMoney(monthMemos.filter((row) => memoRevenueEffectiveAt(row)).map(creditMemoSubtotal));
  const invoiceRevenue = roundMoney(grossInvoiceRevenue - contraRevenue);
  const invoiceExpenses = sumMoney(monthActiveInvoices.filter((row) => row.direction === "payable").map(invoiceTotal));
  const directRevenue = sumMoney(cleanMonthDirect.filter((row) => row.main_type === "INCOME").map((row) => row.amount));
  const directExpenses = sumMoney(cleanMonthDirect.filter((row) => row.main_type === "EXPENSE").map((row) => row.amount));
  const revenue = roundMoney(invoiceRevenue + directRevenue);
  const expenses = roundMoney(invoiceExpenses + directExpenses);
  const profit = roundMoney(revenue - expenses);

  const invoiceById = new Map(asOfActiveInvoices.map((row) => [String(row.id || ""), row]));
  const refundForPendingReceivables = sumMoney(asOfMemos
    .filter((memo) => pendingInvoice(invoiceById.get(String(memo.invoice_id || ""))))
    .map(creditMemoTotal));
  const refundForPaidReceivables = sumMoney(asOfMemos
    .filter((memo) => Number(memo.cash_effect ?? 1) === 1 && String(invoiceById.get(String(memo.invoice_id || ""))?.status || "").toLowerCase() === "paid")
    .map(creditMemoTotal));

  const paidReceivables = sumMoney(asOfActiveInvoices.filter((row) => row.direction === "receivable" && String(row.status).toLowerCase() === "paid").map(invoiceTotal));
  const paidPayables = sumMoney(asOfActiveInvoices.filter((row) => row.direction === "payable" && String(row.status).toLowerCase() === "paid").map(invoiceTotal));
  const accountsReceivableGross = sumMoney(asOfActiveInvoices.filter((row) => row.direction === "receivable" && pendingInvoice(row)).map(invoiceTotal));
  const accountsReceivable = roundMoney(accountsReceivableGross - refundForPendingReceivables);
  const accountsPayable = sumMoney(asOfActiveInvoices.filter((row) => row.direction === "payable" && pendingInvoice(row)).map(invoiceTotal));

  const salesTaxGross = sumMoney(asOfActiveInvoices.filter((row) => row.direction === "receivable").map(invoiceTax));
  const refundedSalesTax = sumMoney(asOfMemos.map(creditMemoTax));
  const deferredRevenueGross = sumMoney(asOfActiveInvoices
    .filter((row) => row.direction === "receivable" && String(row.source_type || "").toLowerCase() === "event" && !eventRevenueRecognizedAt(row, asOfDateExclusive))
    .map(invoiceSubtotal));
  const deferredRevenueCredits = sumMoney(asOfMemos
    .filter((memo) => {
      const invoice = invoiceById.get(String(memo.invoice_id || ""));
      return invoice && String(invoice.source_type || "").toLowerCase() === "event" && !eventRevenueRecognizedAt(invoice, asOfDateExclusive);
    })
    .map(creditMemoSubtotal));

  const recognizedCumulativeRevenue = sumMoney(asOfActiveInvoices
    .filter((row) => row.direction === "receivable" && eventRevenueRecognizedAt(row, asOfDateExclusive))
    .map(invoiceSubtotal));
  const cumulativeContraRevenue = sumMoney(asOfMemos.filter((row) => memoRevenueEffectiveAt(row, asOfDateExclusive)).map(creditMemoSubtotal));
  const cumulativeInvoiceExpenses = sumMoney(asOfActiveInvoices.filter((row) => row.direction === "payable").map(invoiceTotal));
  const directCumulativeRevenue = sumMoney(cleanAsOfDirect.filter((row) => row.main_type === "INCOME").map((row) => row.amount));
  const directCumulativeExpenses = sumMoney(cleanAsOfDirect.filter((row) => row.main_type === "EXPENSE").map((row) => row.amount));
  const directCumulativeNet = roundMoney(directCumulativeRevenue - directCumulativeExpenses);
  const manual = summarizeManualBalanceItems(cleanAsOfDirect);

  const salesTaxPayable = roundMoney(salesTaxGross - refundedSalesTax - manual.salesTaxRemitted);
  const deferredRevenue = roundMoney(deferredRevenueGross - deferredRevenueCredits);
  const currentPeriodNetIncome = roundMoney(recognizedCumulativeRevenue - cumulativeContraRevenue - cumulativeInvoiceExpenses + directCumulativeNet);
  const cashBankAccounts = roundMoney(paidReceivables - paidPayables - refundForPaidReceivables + directCumulativeNet + manual.cashDelta);
  const totalAssets = roundMoney(cashBankAccounts + accountsReceivable + manual.manualAssets);
  const totalLiabilities = roundMoney(accountsPayable + salesTaxPayable + deferredRevenue + manual.manualLiabilities);
  const totalEquity = roundMoney(manual.ownersOpeningEquity + currentPeriodNetIncome + manual.manualEquity);
  const totalLiabilitiesEquity = roundMoney(totalLiabilities + totalEquity);
  const difference = roundMoney(totalAssets - totalLiabilitiesEquity);

  return {
    pnl: {
      grossInvoiceRevenue,
      contraRevenue,
      invoiceRevenue,
      invoiceExpenses,
      directRevenue,
      directExpenses,
      revenue,
      expenses,
      profit
    },
    balance: {
      cashBankAccounts,
      accountsReceivable,
      manualAssets: manual.manualAssets,
      totalAssets,
      accountsPayable,
      salesTaxPayable,
      deferredRevenue,
      manualLiabilities: manual.manualLiabilities,
      totalLiabilities,
      ownersOpeningEquity: manual.ownersOpeningEquity,
      currentPeriodNetIncome,
      manualEquity: manual.manualEquity,
      totalEquity,
      totalLiabilitiesEquity,
      difference,
      balanced: Math.abs(difference) < 0.01
    }
  };
}

module.exports = Object.freeze({
  INVOICE_DERIVED_SOURCE_TYPES,
  roundMoney,
  sumMoney,
  isInvoiceDerivedFinancialItem,
  buildAccountingSnapshot
});
