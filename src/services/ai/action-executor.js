import { db } from "../../database/db.js";

export async function executeApprovedAction(action,ctx){
  if(action.action_type!=="CREATE_MAINTENANCE_DRAFT")throw new Error("Executor não implementado para esta ação.");
  const p=action.payload;
  const orderNumber=`IA-OM-${Date.now().toString().slice(-10)}`;
  const row=(await db.query(`INSERT INTO maintenance_orders(company_id,branch_id,order_number,maintenance_asset_id,maintenance_type,title,problem_description,priority,status,requested_by,assigned_to,cost_center_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,'OPEN',$9,NULL,$10) RETURNING id,order_number`,[ctx.companyId,ctx.branchId,orderNumber,p.maintenanceAssetId,p.maintenanceType,p.title,p.problemDescription,p.priority||"NORMAL",ctx.userId,p.costCenterId||null])).rows[0];
  return {created:true,entityType:"MAINTENANCE_ORDER",entityId:row.id,number:row.order_number,url:`/maintenance/orders/${row.id}`};
}
