"use strict";

// The same zero-balance account definitions are used at installation and after
// an explicitly confirmed factory reset. These are configuration, not entries.
const DEFAULT_ACCOUNTS = Object.freeze([
    ["1000","Cash","Készpénz","ASSET","DEBIT"],["1010","Bank","Bank","ASSET","DEBIT"],
    ["1020","Undeposited Checks","Befizetés előtti csekkek","ASSET","DEBIT"],
    ["1200","Accounts Receivable","Vevőkövetelés","ASSET","DEBIT"],["1300","Inventory","Készlet","ASSET","DEBIT"],["1310","Work in Progress Inventory","Befejezetlen termelés (WIP)","ASSET","DEBIT"],
    ["1500","Fixed Assets","Befektetett eszközök","ASSET","DEBIT"],["2000","Accounts Payable","Szállítói tartozás","LIABILITY","CREDIT"],["2010","Sales Tax Payable","Fizetendő forgalmi adó","LIABILITY","CREDIT"],["2020","Deferred Revenue","Halasztott bevétel","LIABILITY","CREDIT"],
    ["2100","SBA Loan","SBA hitel","LIABILITY","CREDIT"],["3000","Owner Equity","Saját tőke","EQUITY","CREDIT"],
    ["4000","Sales Revenue","Árbevétel","REVENUE","CREDIT"],["4100","Restoration Revenue","Felújítási bevétel","REVENUE","CREDIT"],
    ["4200","Tuning Revenue","Hangolási bevétel","REVENUE","CREDIT"],["4300","Concert Service Revenue","Koncertszerviz bevétel","REVENUE","CREDIT"],["4390","Ticket Refund Contra Revenue","Jegy-visszatérítés bevételcsökkentés","REVENUE","DEBIT"],
    ["5000","Cost of Goods Sold","Eladott áruk költsége","EXPENSE","DEBIT"],["6100","Rent Expense","Bérleti díj","EXPENSE","DEBIT"],
    ["6200","Transport Expense","Szállítási költség","EXPENSE","DEBIT"],["6300","Payroll Expense","Bérköltség","EXPENSE","DEBIT"],
    ["6400","Interest Expense","Kamatköltség","EXPENSE","DEBIT"],["6990","Loss on Abandoned Work","Megszakított munka vesztesége","EXPENSE","DEBIT"]
  ].map(row => Object.freeze(row)));
function seedAccountingDefaults(db) {
  const insert = db.prepare("INSERT OR IGNORE INTO accounts(code,name_en,name_hu,category,normal_side) VALUES(?,?,?,?,?)");
  db.transaction(() => DEFAULT_ACCOUNTS.forEach(row => insert.run(...row)))();
}
module.exports = { DEFAULT_ACCOUNTS, seedAccountingDefaults };
