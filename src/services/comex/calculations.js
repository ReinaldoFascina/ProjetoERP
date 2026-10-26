export function calculateLandedCost({ goodsValue = 0, freight = 0, insurance = 0, costs = [] }) {
  const additional = costs.reduce((sum, item) => sum + Number(item.amount_brl || 0), 0);
  return Number((Number(goodsValue) + Number(freight) + Number(insurance) + additional).toFixed(2));
}

export function calculateContainerDemurrage({ returnDeadline, returnDate, dailyRate = 0 }) {
  if (!returnDeadline || !returnDate) return { days: 0, amount: 0 };
  const deadline = new Date(`${returnDeadline}T00:00:00Z`);
  const returned = new Date(`${returnDate}T00:00:00Z`);
  const days = Math.max(Math.ceil((returned - deadline) / 86400000), 0);
  return { days, amount: Number((days * Number(dailyRate || 0)).toFixed(2)) };
}
