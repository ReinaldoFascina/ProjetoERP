export function buildInstallmentSchedule({ total, downPayment = 0, count, firstDueDate, monthlyRate = 0 }) {
  const financed = Number((Number(total) - Number(downPayment)).toFixed(2));
  const installments = Number(count);
  if (!Number.isFinite(financed) || financed < 0 || !Number.isInteger(installments) || installments <= 0) {
    throw new Error("Condições financeiras inválidas.");
  }
  const rate = Number(monthlyRate || 0) / 100;
  const baseAmount = rate > 0
    ? financed * (rate * Math.pow(1 + rate, installments)) / (Math.pow(1 + rate, installments) - 1)
    : financed / installments;
  const start = new Date(`${firstDueDate}T00:00:00Z`);
  const schedule = [];
  let allocated = 0;
  for (let index = 1; index <= installments; index += 1) {
    const due = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + index - 1, start.getUTCDate()));
    const amount = index === installments
      ? Number((financed - allocated).toFixed(2))
      : Number(baseAmount.toFixed(2));
    allocated = Number((allocated + amount).toFixed(2));
    schedule.push({ number: index, dueDate: due.toISOString().slice(0, 10), amount });
  }
  return { financed, schedule };
}
