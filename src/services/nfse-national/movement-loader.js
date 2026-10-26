import { db } from '../../database/db.js';
export async function loadFiscalMovement(movementId,companyId,branchId,connection=db){
 const [movement,items,company,branch]=await Promise.all([
  connection.query('SELECT * FROM billing_movements WHERE id=$1 AND company_id=$2 AND branch_id=$3',[movementId,companyId,branchId]),
  connection.query('SELECT * FROM billing_movement_items WHERE movement_id=$1 AND company_id=$2 AND branch_id=$3 ORDER BY sequence,id',[movementId,companyId,branchId]),
  connection.query('SELECT * FROM companies WHERE id=$1',[companyId]),
  connection.query('SELECT * FROM branches WHERE id=$1 AND company_id=$2',[branchId,companyId]),
 ]);
 const row=movement.rows[0];if(!row)return null;
 const customer=await connection.query('SELECT * FROM clients WHERE id=$1 AND company_id=$2 AND branch_id=$3',[row.client_id,companyId,branchId]);
 return{movement:row,items:items.rows,company:company.rows[0],branch:branch.rows[0],customer:customer.rows[0]};
}
