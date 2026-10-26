const ROUNDING = 2;

function round(value) {
  return Number(Number(value || 0).toFixed(ROUNDING));
}

export function calculateResidualValue(cost, residualPercent) {
  return round(Number(cost) * Number(residualPercent || 0) / 100);
}

export function calculateDepreciableAmount(cost, residualValue) {
  return round(Math.max(Number(cost) - Number(residualValue || 0), 0));
}

export function calculatePeriodDepreciation(asset, unitsInPeriod = 0) {
  const depreciableAmount = Number(asset.depreciable_amount || 0);
  const accumulated = Number(asset.accumulated_depreciation || 0);
  const remaining = round(Math.max(depreciableAmount - accumulated, 0));

  if (remaining <= 0 || asset.depreciation_method === "NO_DEPRECIATION") {
    return 0;
  }

  if (asset.depreciation_method === "UNITS_OF_PRODUCTION") {
    const capacity = Number(asset.production_capacity_units || 0);
    if (capacity <= 0) {
      throw new Error(`O patrimônio ${asset.asset_number} não possui capacidade de produção definida.`);
    }
    return Math.min(round(depreciableAmount * Number(unitsInPeriod || 0) / capacity), remaining);
  }

  const usefulLife = Number(asset.useful_life_months || 0);
  if (usefulLife <= 0) {
    throw new Error(`O patrimônio ${asset.asset_number} não possui vida útil válida.`);
  }

  return Math.min(round(depreciableAmount / usefulLife), remaining);
}

export function nextMonthStart(dateValue) {
  const date = new Date(`${dateValue}T00:00:00Z`);
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1))
    .toISOString()
    .slice(0, 10);
}
