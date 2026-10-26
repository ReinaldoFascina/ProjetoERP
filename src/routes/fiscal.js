import { Router } from 'express';
import { db } from '../database/db.js';
import { requireAuth,allow } from '../middleware/auth.js';
import { calculateDueDate } from '../services/fiscal/due-date.js';

export const fiscalRouter=Router();
const guard=[requireAuth,allow('ADMIN','COORDENADOR')];
const asyncRoute=(fn)=>(req,res,next)=>Promise.resolve(fn(req,res,next)).catch(next);
const ctx=(req)=>({companyId:Number(req.session.companyId),branchId:Number(req.session.branchId)});

fiscalRouter.get('/fiscal',...guard,asyncRoute(async(req,res)=>{
 const {companyId,branchId}=ctx(req);
 const [taxes,periods]=await Promise.all([
  db.query(`SELECT t.*,(SELECT r.rate FROM fiscal_tax_rates r WHERE r.tax_id=t.id AND r.company_id=t.company_id AND r.branch_id=t.branch_id AND r.active=TRUE AND r.valid_from<=CURRENT_DATE AND (r.valid_to IS NULL OR r.valid_to>=CURRENT_DATE) ORDER BY r.valid_from DESC LIMIT 1) current_rate,(SELECT d.due_day FROM fiscal_due_date_rules d WHERE d.tax_id=t.id AND d.company_id=t.company_id AND d.branch_id=t.branch_id AND d.active=TRUE AND d.valid_from<=CURRENT_DATE AND (d.valid_to IS NULL OR d.valid_to>=CURRENT_DATE) ORDER BY d.valid_from DESC LIMIT 1) due_day FROM fiscal_taxes t WHERE t.company_id=$1 AND t.branch_id=$2 ORDER BY t.tax_type,t.code`,[companyId,branchId]),
  db.query(`SELECT p.*,t.code tax_code,t.name tax_name FROM fiscal_assessment_periods p JOIN fiscal_taxes t ON t.id=p.tax_id WHERE p.company_id=$1 AND p.branch_id=$2 ORDER BY p.period_end DESC,p.id DESC LIMIT 12`,[companyId,branchId])
 ]);
 return res.render('fiscal/dashboard',{pageTitle:'Módulo Fiscal',taxes:taxes.rows,periods:periods.rows,message:req.query.message||'',error:req.query.error||''});
}));

fiscalRouter.get('/fiscal/taxes/new',...guard,(req,res)=>res.render('fiscal/tax-form',{pageTitle:'Novo tributo',tax:null,error:null}));
fiscalRouter.post('/fiscal/taxes',...guard,asyncRoute(async(req,res)=>{
 const {companyId,branchId}=ctx(req),b=req.body;
 await db.query(`INSERT INTO fiscal_taxes(company_id,branch_id,code,name,tax_type,calculation_basis,periodicity,retained,recoverable,active,notes,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,[companyId,branchId,String(b.code).trim().toUpperCase(),b.name,b.tax_type,b.calculation_basis,b.periodicity,b.retained==='on',b.recoverable==='on',b.active==='on',b.notes||null,req.session.user.id]);
 return res.redirect('/fiscal?message='+encodeURIComponent('Tributo cadastrado.'));
}));
fiscalRouter.get('/fiscal/taxes/:id',...guard,asyncRoute(async(req,res)=>{
 const {companyId,branchId}=ctx(req);
 const [tax,rates,rules]=await Promise.all([
  db.query('SELECT * FROM fiscal_taxes WHERE id=$1 AND company_id=$2 AND branch_id=$3',[req.params.id,companyId,branchId]),
  db.query('SELECT * FROM fiscal_tax_rates WHERE tax_id=$1 AND company_id=$2 AND branch_id=$3 ORDER BY valid_from DESC',[req.params.id,companyId,branchId]),
  db.query('SELECT * FROM fiscal_due_date_rules WHERE tax_id=$1 AND company_id=$2 AND branch_id=$3 ORDER BY valid_from DESC',[req.params.id,companyId,branchId])
 ]);
 if(!tax.rows[0])return res.status(404).render('error',{message:'Tributo não encontrado.'});
 return res.render('fiscal/tax-detail',{pageTitle:tax.rows[0].name,tax:tax.rows[0],rates:rates.rows,rules:rules.rows,error:req.query.error||'',message:req.query.message||''});
}));
fiscalRouter.post('/fiscal/taxes/:id/rates',...guard,asyncRoute(async(req,res)=>{
 const {companyId,branchId}=ctx(req),b=req.body;
 await db.query(`INSERT INTO fiscal_tax_rates(company_id,branch_id,tax_id,valid_from,valid_to,rate,reduction_rate,deferral_rate,additional_rate,minimum_base,maximum_base,fixed_amount,tax_classification,nbs_code,national_service_code,municipality_code,state,tax_regime,active,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)`,[companyId,branchId,req.params.id,b.valid_from,b.valid_to||null,Number(b.rate||0),Number(b.reduction_rate||0),Number(b.deferral_rate||0),Number(b.additional_rate||0),Number(b.minimum_base||0),b.maximum_base?Number(b.maximum_base):null,Number(b.fixed_amount||0),b.tax_classification||null,b.nbs_code||null,b.national_service_code||null,b.municipality_code||null,b.state||null,b.tax_regime||null,b.active==='on',req.session.user.id]);
 return res.redirect(`/fiscal/taxes/${req.params.id}?message=${encodeURIComponent('Alíquota e vigência cadastradas.')}`);
}));
fiscalRouter.post('/fiscal/taxes/:id/due-rules',...guard,asyncRoute(async(req,res)=>{
 const {companyId,branchId}=ctx(req),b=req.body;
 await db.query(`INSERT INTO fiscal_due_date_rules(company_id,branch_id,tax_id,valid_from,valid_to,due_day,due_month_offset,adjustment,holiday_calendar,active,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,[companyId,branchId,req.params.id,b.valid_from,b.valid_to||null,Number(b.due_day),Number(b.due_month_offset||1),b.adjustment,b.holiday_calendar||'NACIONAL',b.active==='on',req.session.user.id]);
 return res.redirect(`/fiscal/taxes/${req.params.id}?message=${encodeURIComponent('Vencimento padrão cadastrado.')}`);
}));

fiscalRouter.get('/fiscal/periods',...guard,asyncRoute(async(req,res)=>{
 const {companyId,branchId}=ctx(req),status=String(req.query.status||''),params=[companyId,branchId],where=['p.company_id=$1','p.branch_id=$2'];if(status){params.push(status);where.push(`p.status=$${params.length}`)}
 const [periods,taxes]=await Promise.all([db.query(`SELECT p.*,t.code tax_code,t.name tax_name,t.tax_type FROM fiscal_assessment_periods p JOIN fiscal_taxes t ON t.id=p.tax_id WHERE ${where.join(' AND ')} ORDER BY p.period_end DESC,p.id DESC`,params),db.query('SELECT id,code,name FROM fiscal_taxes WHERE company_id=$1 AND branch_id=$2 AND active=TRUE ORDER BY name',[companyId,branchId])]);
 return res.render('fiscal/periods',{pageTitle:'Períodos de apuração',periods:periods.rows,taxes:taxes.rows,status,error:req.query.error||'',message:req.query.message||''});
}));
fiscalRouter.post('/fiscal/periods',...guard,asyncRoute(async(req,res)=>{
 const {companyId,branchId}=ctx(req),b=req.body,dueDate=await calculateDueDate(db,{companyId,branchId,taxId:Number(b.tax_id),periodEnd:b.period_end});
 await db.query(`INSERT INTO fiscal_assessment_periods(company_id,branch_id,tax_id,period_start,period_end,due_date,status,notes,created_by) VALUES($1,$2,$3,$4,$5,$6,'ABERTO',$7,$8)`,[companyId,branchId,b.tax_id,b.period_start,b.period_end,dueDate,b.notes||null,req.session.user.id]);
 return res.redirect('/fiscal/periods?message='+encodeURIComponent('Período aberto com vencimento calculado.'));
}));
fiscalRouter.get('/fiscal/periods/:id',...guard,asyncRoute(async(req,res)=>{
 const {companyId,branchId}=ctx(req);
 const [period,entries]=await Promise.all([db.query(`SELECT p.*,t.code tax_code,t.name tax_name,t.tax_type FROM fiscal_assessment_periods p JOIN fiscal_taxes t ON t.id=p.tax_id WHERE p.id=$1 AND p.company_id=$2 AND p.branch_id=$3`,[req.params.id,companyId,branchId]),db.query('SELECT * FROM fiscal_assessment_entries WHERE period_id=$1 AND company_id=$2 AND branch_id=$3 ORDER BY entry_date,id',[req.params.id,companyId,branchId])]);
 if(!period.rows[0])return res.status(404).render('error',{message:'Período não encontrado.'});
 return res.render('fiscal/period-detail',{pageTitle:`Apuração ${period.rows[0].tax_code}`,period:period.rows[0],entries:entries.rows,error:req.query.error||'',message:req.query.message||''});
}));
fiscalRouter.post('/fiscal/periods/:id/entries',...guard,asyncRoute(async(req,res)=>{
 const {companyId,branchId}=ctx(req),b=req.body;const period=(await db.query('SELECT * FROM fiscal_assessment_periods WHERE id=$1 AND company_id=$2 AND branch_id=$3',[req.params.id,companyId,branchId])).rows[0];if(!period||period.status==='FECHADO')return res.redirect(`/fiscal/periods/${req.params.id}?error=${encodeURIComponent('Período fechado ou inexistente.')}`);
 await db.query(`INSERT INTO fiscal_assessment_entries(company_id,branch_id,period_id,entry_type,entry_date,description,tax_base,rate,amount,source) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,'MANUAL')`,[companyId,branchId,req.params.id,b.entry_type,b.entry_date,b.description,Number(b.tax_base||0),Number(b.rate||0),Number(b.amount||0)]);
 return res.redirect(`/fiscal/periods/${req.params.id}?message=${encodeURIComponent('Lançamento incluído.')}`);
}));
fiscalRouter.post('/fiscal/periods/:id/calculate',...guard,asyncRoute(async(req,res)=>{
 const {companyId,branchId}=ctx(req);const sum=(await db.query(`SELECT COALESCE(SUM(amount) FILTER(WHERE entry_type='DEBITO'),0) debit,COALESCE(SUM(amount) FILTER(WHERE entry_type='CREDITO'),0) credit,COALESCE(SUM(amount) FILTER(WHERE entry_type='RETENCAO'),0) retained,COALESCE(SUM(amount) FILTER(WHERE entry_type='AJUSTE'),0) adjustments,COALESCE(SUM(tax_base),0) tax_base FROM fiscal_assessment_entries WHERE period_id=$1 AND company_id=$2 AND branch_id=$3`,[req.params.id,companyId,branchId])).rows[0];const payable=Math.max(0,Number(sum.debit)-Number(sum.credit)-Number(sum.retained)+Number(sum.adjustments));
 await db.query(`UPDATE fiscal_assessment_periods SET status='CALCULADO',tax_base=$1,debit_amount=$2,credit_amount=$3,retained_amount=$4,adjustments_amount=$5,tax_amount=$2,payable_amount=$6,calculated_at=NOW(),updated_at=NOW() WHERE id=$7 AND company_id=$8 AND branch_id=$9 AND status<>'FECHADO'`,[sum.tax_base,sum.debit,sum.credit,sum.retained,sum.adjustments,payable,req.params.id,companyId,branchId]);
 return res.redirect(`/fiscal/periods/${req.params.id}?message=${encodeURIComponent('Apuração calculada.')}`);
}));
fiscalRouter.post('/fiscal/periods/:id/close',...guard,asyncRoute(async(req,res)=>{
 const {companyId,branchId}=ctx(req);await db.query(`UPDATE fiscal_assessment_periods SET status='FECHADO',closed_at=NOW(),closed_by=$1,updated_at=NOW() WHERE id=$2 AND company_id=$3 AND branch_id=$4 AND status='CALCULADO'`,[req.session.user.id,req.params.id,companyId,branchId]);return res.redirect(`/fiscal/periods/${req.params.id}?message=${encodeURIComponent('Período fechado.')}`);
}));

fiscalRouter.get('/fiscal/books',...guard,asyncRoute(async(req,res)=>{const{companyId,branchId}=ctx(req),book=String(req.query.book||'SERVICOS_PRESTADOS'),dateFrom=String(req.query.date_from||''),dateTo=String(req.query.date_to||''),taxId=String(req.query.tax_id||''),params=[companyId,branchId,book],where=['r.company_id=$1','r.branch_id=$2','r.book_type=$3'];if(dateFrom){params.push(dateFrom);where.push(`r.document_date >= $${params.length}::date`)}if(dateTo){params.push(dateTo);where.push(`r.document_date <= $${params.length}::date`)}if(taxId){params.push(taxId);where.push(`r.tax_id=$${params.length}`)}const[records,taxes,totals]=await Promise.all([db.query(`SELECT r.*,t.code tax_code,t.name tax_name,bm.number movement_number,c.corporate_name participant_name FROM fiscal_movement_tax_records r JOIN fiscal_taxes t ON t.id=r.tax_id JOIN billing_movements bm ON bm.id=r.movement_id LEFT JOIN clients c ON c.id=r.participant_id WHERE ${where.join(' AND ')} ORDER BY r.document_date,r.id`,params),db.query('SELECT id,code,name FROM fiscal_taxes WHERE company_id=$1 AND branch_id=$2 ORDER BY name',[companyId,branchId]),db.query(`SELECT COALESCE(SUM(tax_base),0) tax_base,COALESCE(SUM(tax_amount),0) tax_amount,COALESCE(SUM(withheld_amount),0) withheld_amount,COALESCE(SUM(credit_amount),0) credit_amount FROM fiscal_movement_tax_records r WHERE ${where.join(' AND ')}`,params)]);return res.render('fiscal/books',{pageTitle:'Livros fiscais',records:records.rows,taxes:taxes.rows,totals:totals.rows[0],filters:{book,date_from:dateFrom,date_to:dateTo,tax_id:taxId},message:req.query.message||'',error:req.query.error||''})}));

fiscalRouter.post('/fiscal/movements/:id/taxes/register',...guard,asyncRoute(async(req,res)=>{const{companyId,branchId}=ctx(req),movement=(await db.query('SELECT * FROM billing_movements WHERE id=$1 AND company_id=$2 AND branch_id=$3',[req.params.id,companyId,branchId])).rows[0];if(!movement)return res.status(404).render('error',{message:'Movimento não encontrado.'});if(movement.status!=='CONFIRMADO')return res.redirect(`/billing?error=${encodeURIComponent('Confirme o movimento antes de escriturar.')}`);const items=(await db.query('SELECT * FROM billing_movement_items WHERE movement_id=$1 AND company_id=$2 AND branch_id=$3 ORDER BY sequence,id',[movement.id,companyId,branchId])).rows,taxes=(await db.query('SELECT * FROM fiscal_taxes WHERE company_id=$1 AND branch_id=$2 AND active=TRUE',[companyId,branchId])).rows,c=await db.connect();let count=0;try{await c.query('BEGIN');for(const item of items)for(const tax of taxes){let base=0,rate=0,amount=0,withheld=0,credit=0;if(tax.tax_type==='ISS'){base=Number(item.iss_base||item.total||0);rate=Number(item.iss_rate||0);amount=Number(item.iss_value||0);withheld=item.iss_withheld?amount:0}else if(tax.tax_type==='PIS'){base=Number(item.pis_base||0);rate=Number(item.pis_rate||0);amount=Number(item.pis_value||0)}else if(tax.tax_type==='COFINS'){base=Number(item.cofins_base||0);rate=Number(item.cofins_rate||0);amount=Number(item.cofins_value||0)}else if(tax.tax_type==='IBS_ESTADUAL'){base=Number(item.ibscbs_base||0);rate=Number(item.ibs_state_rate||0);amount=Number(item.ibs_state_value||0)}else if(tax.tax_type==='IBS_MUNICIPAL'){base=Number(item.ibscbs_base||0);rate=Number(item.ibs_municipal_rate||0);amount=Number(item.ibs_municipal_value||0)}else if(tax.tax_type==='CBS'){base=Number(item.ibscbs_base||0);rate=Number(item.cbs_rate||0);amount=Number(item.cbs_value||0)}else continue;if(base===0&&amount===0)continue;const active=(await c.query(`SELECT * FROM fiscal_tax_rates WHERE company_id=$1 AND branch_id=$2 AND tax_id=$3 AND active=TRUE AND valid_from<=$4::date AND(valid_to IS NULL OR valid_to>=$4::date) AND(nbs_code IS NULL OR nbs_code=$5) AND(national_service_code IS NULL OR national_service_code=$6) ORDER BY(nbs_code IS NOT NULL)::int DESC,(national_service_code IS NOT NULL)::int DESC,valid_from DESC LIMIT 1`,[companyId,branchId,tax.id,movement.date_issued,item.nbs_code,item.national_service_code])).rows[0];if(rate===0&&active){rate=Number(active.rate||0);amount=Number((base*rate/100+Number(active.fixed_amount||0)).toFixed(2))}await c.query(`INSERT INTO fiscal_movement_tax_records(company_id,branch_id,movement_id,movement_item_id,tax_id,book_type,document_model,document_number,document_date,competence_date,participant_id,operation_code,fiscal_classification,nbs_code,national_service_code,municipality_code,tax_base,rate,tax_amount,withheld_amount,credit_amount,status)VALUES($1,$2,$3,$4,$5,'SERVICOS_PRESTADOS','NFSE',$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,'ESCRITURADO')ON CONFLICT(company_id,branch_id,movement_id,movement_item_id,tax_id)DO UPDATE SET tax_base=EXCLUDED.tax_base,rate=EXCLUDED.rate,tax_amount=EXCLUDED.tax_amount,withheld_amount=EXCLUDED.withheld_amount,credit_amount=EXCLUDED.credit_amount,status='ESCRITURADO',updated_at=NOW()`,[companyId,branchId,movement.id,item.id,tax.id,movement.number,movement.date_issued,movement.competence,movement.client_id,movement.operation_indicator,item.ibscbs_tax_class,item.nbs_code,item.national_service_code,item.municipality_code,base,rate,amount,withheld,credit]);count++}await c.query('COMMIT');return res.redirect(`/fiscal/books?book=SERVICOS_PRESTADOS&message=${encodeURIComponent(`${count} registro(s) escriturado(s).`)}`)}catch(e){await c.query('ROLLBACK');throw e}finally{c.release()}}));

fiscalRouter.post('/fiscal/movements/:id/taxes/cancel',...guard,asyncRoute(async(req,res)=>{const{companyId,branchId}=ctx(req);await db.query(`UPDATE fiscal_movement_tax_records SET status='CANCELADO',updated_at=NOW() WHERE movement_id=$1 AND company_id=$2 AND branch_id=$3`,[req.params.id,companyId,branchId]);return res.redirect('/fiscal/books?book=SERVICOS_PRESTADOS')}));
