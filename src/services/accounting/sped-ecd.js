function clean(value) {
  return String(value ?? "").replace(/[|\r\n]/g, " ").trim();
}
function record(code, ...fields) {
  return `|${code}|${fields.map(clean).join("|")}|`;
}
export function buildEcdFile({ company, book, accounts, costCenters, entries }) {
  const lines = [];
  lines.push(record("0000", "LECD", book.period_start, book.period_end, company.corporate_name, company.document));
  lines.push(record("I001", "0"));
  for (const account of accounts) {
    lines.push(record("I050", account.created_at?.toISOString?.().slice(0,10) || book.period_start, account.nature === "DEVEDORA" ? "D" : "C", account.code, account.name, account.reference_code));
  }
  for (const cc of costCenters) {
    lines.push(record("I100", cc.created_at?.toISOString?.().slice(0,10) || book.period_start, cc.code, cc.name));
  }
  for (const entry of entries) {
    lines.push(record("I200", entry.entry_number, entry.entry_date, entry.total_debit, entry.history));
    for (const item of entry.lines) {
      lines.push(record("I250", item.account_code, item.cost_center_code, item.debit || item.credit, item.debit > 0 ? "D" : "C", item.history_complement || entry.history, item.participant_code, item.document_number));
    }
  }
  lines.push(record("I990", lines.length + 1));
  lines.push(record("9999", lines.length + 1));
  return `${lines.join("\r\n")}\r\n`;
}
