export async function chooseRouletteAssignee(client,{companyId,branchId,groupId}){
 const result=await client.query(`SELECT m.id,m.user_id,m.roulette_weight,m.last_assigned_at,m.current_open_tickets FROM technical_crm_group_members m WHERE m.company_id=$1 AND m.branch_id=$2 AND m.group_id=$3 AND m.active=TRUE ORDER BY (m.current_open_tickets::numeric/GREATEST(m.roulette_weight,1)) ASC,m.last_assigned_at NULLS FIRST,m.roulette_order,m.id FOR UPDATE SKIP LOCKED LIMIT 1`,[companyId,branchId,groupId]);
 const selected=result.rows[0];
 if(!selected)throw new Error('O grupo não possui técnicos ativos para a roleta.');
 await client.query(`UPDATE technical_crm_group_members SET last_assigned_at=NOW(),current_open_tickets=current_open_tickets+1 WHERE id=$1`,[selected.id]);
 return selected.user_id;
}
