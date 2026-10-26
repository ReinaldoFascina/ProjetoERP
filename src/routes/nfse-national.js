import crypto from 'node:crypto';
import { Router } from 'express';
import { db } from '../database/db.js';
import { requireAuth,allow } from '../middleware/auth.js';
import { loadFiscalMovement } from '../services/nfse-national/movement-loader.js';
import { validateMovementFiscal } from '../services/nfse-national/validator.js';
import { buildDpsXml } from '../services/nfse-national/dps-builder.js';
import { signDpsXml } from '../services/nfse-national/signer.js';
import { transmitDps } from '../services/nfse-national/client.js';

export const nfseNationalRouter=Router();
const guard=[requireAuth,allow('ADMIN','COORDENADOR')];
const asyncRoute=(fn)=>(req,res,next)=>Promise.resolve(fn(req,res,next)).catch(next);
const ctx=(req)=>({companyId:Number(req.session.companyId),branchId:Number(req.session.branchId)});

nfseNationalRouter.get('/nfse-national',...guard,asyncRoute(async(req,res)=>{
 const {companyId,branchId}=ctx(req),status=String(req.query.status||''),params=[companyId,branchId],where=['bm.company_id=$1','bm.branch_id=$2'];
 if(status){params.push(status);where.push(`bm.nfse_national_status=$${params.length}`)}
 const rows=await db.query(`SELECT bm.id,bm.number,bm.date_issued,bm.competence,bm.service_total,bm.nfse_national_status,bm.nfse_national_key,bm.nfse_national_number,bm.nfse_national_error,c.corporate_name FROM billing_movements bm JOIN clients c ON c.id=bm.client_id WHERE ${where.join(' AND ')} ORDER BY bm.date_issued DESC,bm.id DESC`,params);
 return res.render('nfse-national/list',{pageTitle:'Transmissão NFS-e Nacional',movements:rows.rows,status,error:req.query.error||'',message:req.query.message||''});
}));

nfseNationalRouter.get('/nfse-national/:id',...guard,asyncRoute(async(req,res)=>{
 const {companyId,branchId}=ctx(req),data=await loadFiscalMovement(req.params.id,companyId,branchId);if(!data)return res.status(404).render('error',{message:'Movimento não encontrado no contexto atual.'});
 const validation=validateMovementFiscal(data),history=await db.query('SELECT * FROM nfse_national_transmissions WHERE movement_id=$1 AND company_id=$2 AND branch_id=$3 ORDER BY created_at DESC',[req.params.id,companyId,branchId]);
 return res.render('nfse-national/detail',{pageTitle:`NFS-e Nacional ${data.movement.number}`,data,validation,history:history.rows,error:req.query.error||'',message:req.query.message||''});
}));

nfseNationalRouter.post('/nfse-national/:id/fiscal',...guard,asyncRoute(async(req,res)=>{
 const {companyId,branchId}=ctx(req),b=req.body;
 await db.query(`UPDATE billing_movements SET fiscal_purpose=$1,operation_indicator=$2,final_consumer=$3,service_location_code=$4,incidence_location_code=$5,taxation_regime=$6,simple_national_option=$7,ibscbs_simple_regime=$8,simple_activity_code=$9,simple_gross_revenue=$10,iss_withheld=$11,iss_responsibility=$12,pis_total=$13,cofins_total=$14,inss_total=$15,ir_total=$16,csll_total=$17,other_withholdings_total=$18,ibs_total=$19,cbs_total=$20,ibscbs_required=$21,updated_at=NOW() WHERE id=$22 AND company_id=$23 AND branch_id=$24`,[b.fiscal_purpose||'NORMAL',b.operation_indicator||'1',b.final_consumer==='on',b.service_location_code,b.incidence_location_code,b.taxation_regime||null,b.simple_national_option||null,b.ibscbs_simple_regime||null,b.simple_activity_code||null,Number(b.simple_gross_revenue||0),b.iss_withheld==='on',b.iss_responsibility||null,Number(b.pis_total||0),Number(b.cofins_total||0),Number(b.inss_total||0),Number(b.ir_total||0),Number(b.csll_total||0),Number(b.other_withholdings_total||0),Number(b.ibs_total||0),Number(b.cbs_total||0),b.ibscbs_required==='on',req.params.id,companyId,branchId]);
 return res.redirect(`/nfse-national/${req.params.id}?message=${encodeURIComponent('Dados fiscais do movimento salvos.')}`);
}));

nfseNationalRouter.post('/nfse-national/:id/items/:itemId',...guard,asyncRoute(async(req,res)=>{
 const {companyId,branchId}=ctx(req),b=req.body;
 await db.query(`UPDATE billing_movement_items SET fiscal_nature=$1,nbs_code=$2,national_service_code=$3,lc116_code=$4,cnae=$5,municipality_code=$6,operation_indicator=$7,ibscbs_tax_class=$8,ibscbs_operation_indicator=$9,ibscbs_base=$10,ibs_state_rate=$11,ibs_state_value=$12,ibs_municipal_rate=$13,ibs_municipal_value=$14,cbs_rate=$15,cbs_value=$16,tax_reduction_rate=$17,tax_deferral_rate=$18,tax_regular=$19,pis_base=$20,pis_rate=$21,pis_value=$22,cofins_base=$23,cofins_rate=$24,cofins_value=$25,iss_base=$26,iss_rate=$27,iss_value=$28,iss_withheld=$29,unconditional_discount=$30,conditional_discount=$31,tax_base_adjustment=$32,updated_at=NOW() WHERE id=$33 AND movement_id=$34 AND company_id=$35 AND branch_id=$36`,[b.fiscal_nature||'SERVICO',b.nbs_code||null,b.national_service_code||null,b.lc116_code||null,b.cnae||null,b.municipality_code||null,b.operation_indicator||null,b.ibscbs_tax_class||null,b.ibscbs_operation_indicator||null,Number(b.ibscbs_base||0),Number(b.ibs_state_rate||0),Number(b.ibs_state_value||0),Number(b.ibs_municipal_rate||0),Number(b.ibs_municipal_value||0),Number(b.cbs_rate||0),Number(b.cbs_value||0),Number(b.tax_reduction_rate||0),Number(b.tax_deferral_rate||0),b.tax_regular==='on',Number(b.pis_base||0),Number(b.pis_rate||0),Number(b.pis_value||0),Number(b.cofins_base||0),Number(b.cofins_rate||0),Number(b.cofins_value||0),Number(b.iss_base||0),Number(b.iss_rate||0),Number(b.iss_value||0),b.iss_withheld==='on',Number(b.unconditional_discount||0),Number(b.conditional_discount||0),Number(b.tax_base_adjustment||0),req.params.itemId,req.params.id,companyId,branchId]);
 return res.redirect(`/nfse-national/${req.params.id}?message=${encodeURIComponent('Tributação do item salva.')}`);
}));

nfseNationalRouter.post('/nfse-national/:id/transmit',...guard,asyncRoute(async(req,res)=>{
 const {companyId,branchId}=ctx(req),data=await loadFiscalMovement(req.params.id,companyId,branchId);if(!data)return res.status(404).render('error',{message:'Movimento não encontrado.'});
 const validation=validateMovementFiscal(data);if(!validation.valid)return res.redirect(`/nfse-national/${req.params.id}?error=${encodeURIComponent(validation.errors.join(' | '))}`);
 if(['AUTORIZADA','CANCELADA'].includes(data.movement.nfse_national_status))return res.redirect(`/nfse-national/${req.params.id}?error=${encodeURIComponent('Movimento já possui NFS-e Nacional autorizada ou cancelada.')}`);
 const environment=process.env.NFSE_NATIONAL_ENVIRONMENT||'RESTRITA',xml=buildDpsXml({...data,environment}),signed=signDpsXml(xml),hash=crypto.createHash('sha256').update(signed).digest('hex');
 await db.query(`UPDATE billing_movements SET nfse_national_status='TRANSMITINDO',nfse_national_xml=$1,nfse_national_error=NULL,updated_at=NOW() WHERE id=$2 AND company_id=$3 AND branch_id=$4`,[signed,req.params.id,companyId,branchId]);
 let result;try{result=await transmitDps(signed)}catch(e){result={approved:false,httpStatus:0,data:{exception:e.message},errorCode:'TRANSPORT',errorMessage:e.message}}
 const status=result.approved?'AUTORIZADA':'REJEITADA';
 await db.query(`UPDATE billing_movements SET nfse_national_status=$1,nfse_national_key=$2,nfse_national_number=$3,nfse_national_protocol=$4,nfse_national_response=$5,nfse_national_error=$6,nfse_national_transmitted_at=NOW(),nfse_national_xml=COALESCE($7,nfse_national_xml),updated_at=NOW() WHERE id=$8 AND company_id=$9 AND branch_id=$10`,[status,result.accessKey,result.number,result.protocol,result.data,result.errorMessage,result.authorizedXml,req.params.id,companyId,branchId]);
 await db.query(`INSERT INTO nfse_national_transmissions(company_id,branch_id,movement_id,operation,environment,status,request_xml,request_hash,response_payload,http_status,access_key,protocol,error_code,error_message,created_by) VALUES($1,$2,$3,'EMISSAO',$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,[companyId,branchId,req.params.id,environment,status,signed,hash,result.data,result.httpStatus,result.accessKey,result.protocol,result.errorCode,result.errorMessage,req.session.user.id]);
 return res.redirect(`/nfse-national/${req.params.id}?${result.approved?'message':'error'}=${encodeURIComponent(result.approved?'NFS-e Nacional autorizada.':result.errorMessage||'Transmissão rejeitada.')}`);
}));
