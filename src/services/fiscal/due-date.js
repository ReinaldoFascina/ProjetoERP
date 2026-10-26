function endOfMonth(year,month){return new Date(Date.UTC(year,month+1,0)).getUTCDate()}
function iso(date){return date.toISOString().slice(0,10)}
export async function calculateDueDate(db,{companyId,branchId,taxId,periodEnd}){
 const rule=(await db.query(`SELECT * FROM fiscal_due_date_rules WHERE company_id=$1 AND branch_id=$2 AND tax_id=$3 AND active=TRUE AND valid_from<=$4::date AND (valid_to IS NULL OR valid_to>=$4::date) ORDER BY valid_from DESC,id DESC LIMIT 1`,[companyId,branchId,taxId,periodEnd])).rows[0];
 if(!rule)throw new Error('Não existe regra de vencimento vigente para o tributo.');
 const p=new Date(`${periodEnd}T00:00:00Z`),targetMonth=p.getUTCMonth()+Number(rule.due_month_offset),year=p.getUTCFullYear()+Math.floor(targetMonth/12),month=((targetMonth%12)+12)%12,day=Math.min(Number(rule.due_day),endOfMonth(year,month));let due=new Date(Date.UTC(year,month,day));
 const isBusiness=async(date)=>{const weekday=date.getUTCDay();if(weekday===0||weekday===6)return false;const holiday=await db.query(`SELECT 1 FROM fiscal_holidays WHERE company_id=$1 AND branch_id=$2 AND calendar=$3 AND holiday_date=$4::date`,[companyId,branchId,rule.holiday_calendar,iso(date)]);return !holiday.rowCount};
 if(rule.adjustment!=='SEM_AJUSTE')while(!(await isBusiness(due)))due=new Date(due.getTime()+(rule.adjustment==='PRORROGAR'?86400000:-86400000));
 return iso(due);
}
