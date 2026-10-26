import {
  calculateDepreciableAmount,
  calculateResidualValue,
  nextMonthStart,
} from "./depreciation.js";

function depreciationStart(rule, movementDate, inServiceDate) {
  if (rule === "PURCHASE_DATE") return movementDate;
  if (rule === "ACQUISITION_DATE") return movementDate;
  if (rule === "NEXT_MONTH") return nextMonthStart(inServiceDate || movementDate);
  return inServiceDate || null;
}

export async function createAssetsFromPurchase(client, {
  companyId,
  branchId,
  userId,
  movement,
  items,
}) {
  const rule = (await client.query(
    `SELECT r.*,c.useful_life_months,c.residual_percent,c.depreciation_method
       FROM asset_purchase_rules r
       LEFT JOIN asset_categories c ON c.id=r.category_id
      WHERE r.company_id=$1 AND r.branch_id=$2
        AND r.movement_type_code=$3 AND r.active=TRUE AND r.auto_create=TRUE`,
    [companyId, branchId, movement.movement_type_code]
  )).rows[0];

  if (!rule) return [];

  const created = [];
  for (const item of items) {
    const unitValue = Number(item.total_value || 0) / Math.max(Number(item.quantity || 1), 1);
    if (unitValue < Number(rule.minimum_value || 0)) continue;

    const units = Math.max(Math.trunc(Number(item.quantity || 1)), 1);
    for (let unit = 1; unit <= units; unit += 1) {
      const residualValue = calculateResidualValue(unitValue, rule.residual_percent);
      const depreciableAmount = calculateDepreciableAmount(unitValue, residualValue);
      const number = `PAT-${Date.now().toString().slice(-8)}-${item.id}-${unit}`;
      const startDate = depreciationStart(rule.start_depreciation_rule, movement.movement_date, movement.in_service_date);

      const asset = (await client.query(
        `INSERT INTO assets(company_id,branch_id,asset_number,description,category_id,catalog_item_id,purchase_movement_id,purchase_movement_type_code,supplier_id,invoice_number,invoice_key,purchase_date,acquisition_date,in_service_date,depreciation_start_date,acquisition_cost,residual_value,depreciable_amount,useful_life_months,depreciation_method,book_value,cost_center_id,status,created_by)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$12,$13,$14,$15,$16,$17,$18,$19,$15,$20,'ACTIVE',$21) RETURNING id,asset_number`,
        [companyId, branchId, number, item.description, rule.category_id, item.product_id, movement.id, movement.movement_type_code, movement.supplier_id || null, movement.invoice_number || null, movement.invoice_key || null, movement.movement_date, movement.in_service_date || null, startDate, unitValue, residualValue, depreciableAmount, rule.useful_life_months, rule.depreciation_method, movement.cost_center_id || null, userId]
      )).rows[0];
      created.push(asset);
    }
  }
  return created;
}
