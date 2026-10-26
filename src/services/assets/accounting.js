export async function createAccountingEntry(client, {
  companyId,
  branchId,
  userId,
  bookId,
  entryNumber,
  entryDate,
  history,
  sourceId,
  lines,
}) {
  const totalDebit = Number(lines.reduce((sum, line) => sum + Number(line.debit || 0), 0).toFixed(2));
  const totalCredit = Number(lines.reduce((sum, line) => sum + Number(line.credit || 0), 0).toFixed(2));

  if (Math.abs(totalDebit - totalCredit) > 0.005) {
    throw new Error("O lançamento patrimonial está desbalanceado.");
  }

  const entry = (await client.query(
    `INSERT INTO accounting_entries(company_id,branch_id,book_id,entry_number,entry_date,source_module,source_id,history,total_debit,total_credit,status,created_by,posted_by,posted_at)
     VALUES($1,$2,$3,$4,$5,'PT',$6,$7,$8,$9,'LANCADO',$10,$10,NOW()) RETURNING id`,
    [companyId, branchId, bookId, entryNumber, entryDate, sourceId, history, totalDebit, totalCredit, userId]
  )).rows[0];

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    await client.query(
      `INSERT INTO accounting_entry_lines(company_id,branch_id,entry_id,sequence,account_id,cost_center_id,debit,credit,history_complement,participant_id,document_number)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [companyId, branchId, entry.id, index + 1, line.accountId, line.costCenterId || null, line.debit || 0, line.credit || 0, line.history || history, line.participantId || null, line.documentNumber || null]
    );
  }

  return entry.id;
}
