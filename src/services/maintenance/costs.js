export function calculateMaintenanceTotals({ parts = [], labor = [], externalServiceCost = 0, otherCost = 0 }) {
  const partsCost = Number(parts.reduce((sum, item) => sum + Number(item.total_cost || 0), 0).toFixed(2));
  const internalLaborCost = Number(labor.reduce((sum, item) => sum + Number(item.total_cost || 0), 0).toFixed(2));
  const external = Number(Number(externalServiceCost || 0).toFixed(2));
  const other = Number(Number(otherCost || 0).toFixed(2));
  return { partsCost, internalLaborCost, externalServiceCost: external, otherCost: other, totalCost: Number((partsCost + internalLaborCost + external + other).toFixed(2)) };
}
