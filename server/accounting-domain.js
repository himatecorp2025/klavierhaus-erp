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

function monthKey(value) {
  const text = String(value || "");
  return /^\d{4}-\d{2}/.test(text) ? text.slice(0, 7) : null;
}

function nextMonthKey(value) {
  const key = monthKey(value);
  if (!key) return null;
  const date = new Date(`${key}-01T00:00:00Z`);
  date.setUTCMonth(date.getUTCMonth() + 1);
  return date.toISOString().slice(0, 7);
}

function expandFinancialItemsAsOf(items, cutoffExclusive) {
  const cutoff = String(cutoffExclusive || "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(cutoff)) return [];
  const expanded = [];
  for (const item of items || []) {
    const itemDate = String(item?.item_date || "");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(itemDate) || itemDate >= cutoff) continue;
    const recurrence = String(item?.recurrence || "ONE_TIME").toUpperCase();
    if (recurrence !== "MONTHLY") { expanded.push(item); continue; }
    const startMonth = monthKey(itemDate);
    const voidDate = String(item?.void_effective_date || "");
    const voidMonth = /^\d{4}-\d{2}-\d{2}$/.test(voidDate) ? monthKey(voidDate) : null;
    let cursor = startMonth;
    let guard = 0;
    while (cursor && guard < 2400) {
      const occurrenceDate = cursor === startMonth ? itemDate : `${cursor}-01`;
      if (occurrenceDate >= cutoff) break;
      if (voidMonth && cursor > voidMonth) break;
      expanded.push({
        ...item,
        item_date: occurrenceDate,
        recurrence_source_id: item.id,
        recurrence_occurrence_month: cursor,
        is_recurring_occurrence: 1
      });
      cursor = nextMonthKey(cursor);
      guard += 1;
    }
  }
  return expanded;
}

function workflowBillablePhaseSubtotal(lines) {
  let total = 0;
  for (const line of lines || []) {
    if (line?.line_type && String(line.line_type).toUpperCase() !== "COST") continue;
    const status = String(line?.billing_status || "CHARGEABLE").toUpperCase();
    const amount = roundMoney(line?.amount || 0);
    if (status === "CHARGEABLE") total = roundMoney(total + amount);
    else if (status === "CREDIT") total = roundMoney(total - amount);
  }
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

function normalizeOpeningBalance(openingBalance) {
  const source = openingBalance && typeof openingBalance === "object" ? openingBalance : null;
  const result = {
    effectiveDate: source?.effective_date || source?.effectiveDate || null,
    cashBank: roundMoney(source?.opening_cash_bank ?? source?.cashBank ?? 0),
    accountsReceivable: roundMoney(source?.opening_accounts_receivable ?? source?.accountsReceivable ?? 0),
    accountsPayable: roundMoney(source?.opening_accounts_payable ?? source?.accountsPayable ?? 0),
    retainedEarningsEquity: roundMoney(source?.opening_retained_earnings_equity ?? source?.retainedEarningsEquity ?? 0),
    customAssets: 0,
    customLiabilities: 0,
    customEquity: 0,
    items: []
  };
  for (const item of source?.items || []) {
    const itemType = String(item?.item_type || item?.itemType || "").toUpperCase();
    if (!["ASSET", "LIABILITY", "EQUITY"].includes(itemType)) continue;
    const amount = roundMoney(item?.amount || 0);
    const normalized = { id: item?.id || null, item_name: String(item?.item_name || item?.itemName || "").trim(), item_type: itemType, amount };
    result.items.push(normalized);
    if (itemType === "ASSET") result.customAssets = roundMoney(result.customAssets + amount);
    else if (itemType === "LIABILITY") result.customLiabilities = roundMoney(result.customLiabilities + amount);
    else result.customEquity = roundMoney(result.customEquity + amount);
  }
  result.totalAssets = roundMoney(result.cashBank + result.accountsReceivable + result.customAssets);
  result.totalLiabilitiesEquity = roundMoney(result.accountsPayable + result.retainedEarningsEquity + result.customLiabilities + result.customEquity);
  result.difference = roundMoney(result.totalAssets - result.totalLiabilitiesEquity);
  result.balanced = Math.abs(result.difference) < 0.01;
  return result;
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
  asOfDateExclusive = null,
  openingBalance = null
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
  const opening = normalizeOpeningBalance(openingBalance);

  const salesTaxPayable = roundMoney(salesTaxGross - refundedSalesTax - manual.salesTaxRemitted);
  const deferredRevenue = roundMoney(deferredRevenueGross - deferredRevenueCredits);
  const currentPeriodNetIncome = roundMoney(recognizedCumulativeRevenue - cumulativeContraRevenue - cumulativeInvoiceExpenses + directCumulativeNet);
  const cashBankAccounts = roundMoney(opening.cashBank + paidReceivables - paidPayables - refundForPaidReceivables + directCumulativeNet + manual.cashDelta);
  const accountsReceivableWithOpening = roundMoney(opening.accountsReceivable + accountsReceivable);
  const accountsPayableWithOpening = roundMoney(opening.accountsPayable + accountsPayable);
  const manualAssets = roundMoney(opening.customAssets + manual.manualAssets);
  const manualLiabilities = roundMoney(opening.customLiabilities + manual.manualLiabilities);
  const ownersOpeningEquity = roundMoney(opening.retainedEarningsEquity + manual.ownersOpeningEquity);
  const manualEquity = roundMoney(opening.customEquity + manual.manualEquity);
  const totalAssets = roundMoney(cashBankAccounts + accountsReceivableWithOpening + manualAssets);
  const totalLiabilities = roundMoney(accountsPayableWithOpening + salesTaxPayable + deferredRevenue + manualLiabilities);
  const totalEquity = roundMoney(ownersOpeningEquity + currentPeriodNetIncome + manualEquity);
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
      accountsReceivable: accountsReceivableWithOpening,
      manualAssets,
      totalAssets,
      accountsPayable: accountsPayableWithOpening,
      salesTaxPayable,
      deferredRevenue,
      manualLiabilities,
      totalLiabilities,
      ownersOpeningEquity,
      currentPeriodNetIncome,
      manualEquity,
      totalEquity,
      totalLiabilitiesEquity,
      difference,
      balanced: Math.abs(difference) < 0.01,
      openingBalance: opening
    }
  };
}

module.exports = Object.freeze({
  INVOICE_DERIVED_SOURCE_TYPES,
  roundMoney,
  sumMoney,
  expandFinancialItemsAsOf,
  workflowBillablePhaseSubtotal,
  isInvoiceDerivedFinancialItem,
  buildAccountingSnapshot,
  normalizeOpeningBalance
});
