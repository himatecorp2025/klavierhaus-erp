"use strict";

const INVOICE_DERIVED_SOURCE_TYPES = new Set([
  "JOB_REVENUE",
  "DAILY_RATE",
  "TECHNICIAN_EXTRA_COMPENSATION",
  "MANUAL_INVOICE",
  "WORKFLOW_INVOICE_REVENUE",
  "WORKFLOW_INVOICE_MATERIAL"
]);

function roundMoney(value) {
  const number = Number(value || 0);
  if (!Number.isFinite(number)) return 0;
  return Math.round((number + Number.EPSILON) * 100) / 100;
}

function sumMoney(values) {
  return roundMoney((values || []).reduce((sum, value) => sum + Number(value || 0), 0));
}

function isInvoiceDerivedFinancialItem(item) {
  return INVOICE_DERIVED_SOURCE_TYPES.has(String(item?.source_type || ""));
}

function activeInvoices(rows) {
  return (rows || []).filter((row) => String(row?.status || "") !== "void");
}

function pendingInvoice(row) {
  return ["issued", "carried_over", "draft"].includes(String(row?.status || ""));
}

function buildAccountingSnapshot({ monthInvoices = [], monthDirectItems = [], asOfInvoices = [], asOfDirectItems = [] } = {}) {
  const monthActiveInvoices = activeInvoices(monthInvoices);
  const asOfActiveInvoices = activeInvoices(asOfInvoices);
  const cleanMonthDirect = (monthDirectItems || []).filter((item) => !isInvoiceDerivedFinancialItem(item));
  const cleanAsOfDirect = (asOfDirectItems || []).filter((item) => !isInvoiceDerivedFinancialItem(item));

  const invoiceRevenue = sumMoney(monthActiveInvoices.filter((row) => row.direction === "receivable").map((row) => row.total_amount));
  const invoiceExpenses = sumMoney(monthActiveInvoices.filter((row) => row.direction === "payable").map((row) => row.total_amount));
  const directRevenue = sumMoney(cleanMonthDirect.filter((row) => row.main_type === "INCOME").map((row) => row.amount));
  const directExpenses = sumMoney(cleanMonthDirect.filter((row) => row.main_type === "EXPENSE").map((row) => row.amount));
  const revenue = roundMoney(invoiceRevenue + directRevenue);
  const expenses = roundMoney(invoiceExpenses + directExpenses);
  const profit = roundMoney(revenue - expenses);

  const allReceivables = sumMoney(asOfActiveInvoices.filter((row) => row.direction === "receivable").map((row) => row.total_amount));
  const allPayables = sumMoney(asOfActiveInvoices.filter((row) => row.direction === "payable").map((row) => row.total_amount));
  const paidReceivables = sumMoney(asOfActiveInvoices.filter((row) => row.direction === "receivable" && row.status === "paid").map((row) => row.total_amount));
  const paidPayables = sumMoney(asOfActiveInvoices.filter((row) => row.direction === "payable" && row.status === "paid").map((row) => row.total_amount));
  const accountsReceivable = sumMoney(asOfActiveInvoices.filter((row) => row.direction === "receivable" && pendingInvoice(row)).map((row) => row.total_amount));
  const accountsPayable = sumMoney(asOfActiveInvoices.filter((row) => row.direction === "payable" && pendingInvoice(row)).map((row) => row.total_amount));
  const directCumulativeRevenue = sumMoney(cleanAsOfDirect.filter((row) => row.main_type === "INCOME").map((row) => row.amount));
  const directCumulativeExpenses = sumMoney(cleanAsOfDirect.filter((row) => row.main_type === "EXPENSE").map((row) => row.amount));
  const directCumulativeNet = roundMoney(directCumulativeRevenue - directCumulativeExpenses);

  const cashBankAccounts = roundMoney(paidReceivables - paidPayables + directCumulativeNet);
  const currentPeriodNetIncome = roundMoney(allReceivables - allPayables + directCumulativeNet);
  const totalAssets = roundMoney(cashBankAccounts + accountsReceivable);
  const totalLiabilitiesEquity = roundMoney(accountsPayable + currentPeriodNetIncome);
  const difference = roundMoney(totalAssets - totalLiabilitiesEquity);

  return {
    pnl: {
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
      totalAssets,
      accountsPayable,
      currentPeriodNetIncome,
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
