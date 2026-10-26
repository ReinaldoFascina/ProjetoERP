import { Router } from 'express';
import { db } from '../database/db.js';
import { requireAuth, allow } from '../middleware/auth.js';
import { buildNfsePayload } from '../services/nfse/payload.js';
import { issueNfse, cancelNfse } from '../services/nfse/provider.js';

export const nfseRouter = Router();
const permission = [requireAuth, allow('ADMIN','COORDENADOR')];
const asyncRoute = (handler) => (req,res,next) => Promise.resolve(handler(req,res,next)).catch(next);
const statuses = ['AUTORIZADA','CANCELADA','PENDENTE','REJEITADA'];

function context(req) {
  return { companyId: Number(req.session.companyId), branchId: Number(req.session.branchId) };
}

nfseRouter.get('/nfse', ...permission, asyncRoute(async (req,res) => {
  const { companyId, branchId } = context(req);
  const status = statuses.includes(String(req.query.status || '').toUpperCase()) ? String(req.query.status).toUpperCase() : '';
  const dateFrom = String(req.query.date_from || '');
  const dateTo = String(req.query.date_to || '');
  const q = String(req.query.q || '').trim();
  const params = [companyId, branchId];
  const where = ["bm.company_id=$1", "bm.branch_id=$2", "bm.status='CONFIRMADO'", "bm.service_total>0"];

  if (status) { params.push(status); where.push(`COALESCE(fd.status,'PENDENTE')=$${params.length}`); }
  if (dateFrom) { params.push(dateFrom); where.push(`bm.date_issued >= $${params.length}::date`); }
  if (dateTo) { params.push(dateTo); where.push(`bm.date_issued <= $${params.length}::date`); }
  if (q) { params.push(`%${q}%`); where.push(`(bm.number ILIKE $${params.length} OR c.corporate_name ILIKE $${params.length} OR COALESCE(fd.document_number,'') ILIKE $${params.length})`); }

  const [documents, counters] = await Promise.all([
    db.query(`
      SELECT bm.id movement_id,bm.number movement_number,bm.date_issued,bm.competence,
             bm.service_total,c.corporate_name,c.document client_document,
             fd.id fiscal_document_id,COALESCE(fd.status,'PENDENTE') nfse_status,
             fd.document_number,fd.access_key,fd.protocol,fd.provider,
             fd.authorized_at,fd.cancelled_at,fd.error_message,fd.updated_at
        FROM billing_movements bm
        JOIN clients c ON c.id=bm.client_id
        LEFT JOIN fiscal_documents fd
          ON fd.movement_id=bm.id AND fd.document_type='NFSE'
         AND fd.company_id=bm.company_id AND fd.branch_id=bm.branch_id
       WHERE ${where.join(' AND ')}
       ORDER BY bm.date_issued DESC,bm.id DESC`, params),
    db.query(`
      SELECT COALESCE(fd.status,'PENDENTE') status,COUNT(*)::int total
        FROM billing_movements bm
        LEFT JOIN fiscal_documents fd
          ON fd.movement_id=bm.id AND fd.document_type='NFSE'
         AND fd.company_id=bm.company_id AND fd.branch_id=bm.branch_id
       WHERE bm.company_id=$1 AND bm.branch_id=$2
         AND bm.status='CONFIRMADO' AND bm.service_total>0
       GROUP BY COALESCE(fd.status,'PENDENTE')`, [companyId,branchId]),
  ]);

  const summary = Object.fromEntries(statuses.map((item) => [item,0]));
  for (const item of counters.rows) summary[item.status] = item.total;

  return res.render('nfse/list', {
    pageTitle: 'Emissão de NFS-e',
    documents: documents.rows,
    summary,
    filters: { status, date_from: dateFrom, date_to: dateTo, q },
    message: req.query.message || '',
    error: req.query.error || '',
  });
}));

nfseRouter.get('/nfse/:id', ...permission, asyncRoute(async (req,res) => {
  const { companyId, branchId } = context(req);
  const [document, transmissions] = await Promise.all([
    db.query(`
      SELECT fd.*,bm.number movement_number,bm.date_issued,bm.competence,bm.service_total,
             c.corporate_name,c.document client_document
        FROM fiscal_documents fd
        JOIN billing_movements bm ON bm.id=fd.movement_id
        JOIN clients c ON c.id=bm.client_id
       WHERE fd.id=$1 AND fd.document_type='NFSE'
         AND fd.company_id=$2 AND fd.branch_id=$3`, [req.params.id,companyId,branchId]),
    db.query(`SELECT * FROM fiscal_document_transmissions WHERE fiscal_document_id=$1 AND company_id=$2 AND branch_id=$3 ORDER BY created_at DESC`, [req.params.id,companyId,branchId]),
  ]);
  if (!document.rows[0]) return res.status(404).render('error',{message:'NFS-e não encontrada neste contexto.'});
  return res.render('nfse/detail',{pageTitle:`NFS-e ${document.rows[0].document_number || 'pendente'}`,document:document.rows[0],transmissions:transmissions.rows,error:req.query.error||'',message:req.query.message||''});
}));

nfseRouter.post('/nfse/movements/:movementId/issue', ...permission, asyncRoute(async (req,res) => {
  const { companyId, branchId } = context(req);
  const connection = await db.connect();
  let documentId;
  try {
    await connection.query('BEGIN');
    const movement = (await connection.query(`SELECT * FROM billing_movements WHERE id=$1 AND company_id=$2 AND branch_id=$3 FOR UPDATE`,[req.params.movementId,companyId,branchId])).rows[0];
    if (!movement) throw new Error('Faturamento não encontrado neste contexto.');
    if (movement.status !== 'CONFIRMADO') throw new Error('Somente faturamentos confirmados podem emitir NFS-e.');
    if (Number(movement.service_total) <= 0) throw new Error('O faturamento não possui serviços para emissão.');

    const existing = (await connection.query(`SELECT * FROM fiscal_documents WHERE movement_id=$1 AND document_type='NFSE' AND company_id=$2 AND branch_id=$3 FOR UPDATE`,[movement.id,companyId,branchId])).rows[0];
    if (existing && ['AUTORIZADA','CANCELADA'].includes(existing.status)) throw new Error(`A NFS-e já está ${existing.status.toLowerCase()}.`);

    const [client,company,branch,items] = await Promise.all([
      connection.query('SELECT c.* FROM clients c WHERE c.id=$1 AND c.company_id=$2 AND c.branch_id=$3',[movement.client_id,companyId,branchId]),
      connection.query('SELECT * FROM companies WHERE id=$1',[companyId]),
      connection.query('SELECT * FROM branches WHERE id=$1 AND company_id=$2',[branchId,companyId]),
      connection.query(`SELECT * FROM billing_movement_items WHERE movement_id=$1 AND company_id=$2 AND branch_id=$3 AND item_type='SERVICO' ORDER BY sequence`,[movement.id,companyId,branchId]),
    ]);
    if (!client.rows[0]) throw new Error('Cliente não encontrado no contexto atual.');
    if (!company.rows[0] || !branch.rows[0]) throw new Error('Empresa ou filial não encontrada.');
    if (!items.rowCount) throw new Error('Nenhum item de serviço encontrado no faturamento.');

    const payload = buildNfsePayload({movement,client:client.rows[0],company:company.rows[0],branch:branch.rows[0],items:items.rows});
    const saved = (await connection.query(`
      INSERT INTO fiscal_documents(company_id,branch_id,movement_id,document_type,environment,status,amount,provider,request_payload,created_by,updated_at)
      VALUES($1,$2,$3,'NFSE',$4,'PENDENTE',$5,$6,$7,$8,NOW())
      ON CONFLICT(company_id,branch_id,movement_id) WHERE document_type='NFSE'
      DO UPDATE SET environment=EXCLUDED.environment,status='PENDENTE',amount=EXCLUDED.amount,provider=EXCLUDED.provider,
                    request_payload=EXCLUDED.request_payload,error_message=NULL,updated_at=NOW()
      RETURNING id`,[companyId,branchId,movement.id,payload.environment,payload.totals.services,process.env.NFSE_PROVIDER||'MANUAL',payload,req.session.user.id])).rows[0];
    documentId = saved.id;
    await connection.query('COMMIT');

    const result = await issueNfse(payload);
    await connection.query('BEGIN');
    await connection.query(`
      UPDATE fiscal_documents SET status=$1,provider=$2,provider_document_id=$3,document_number=$4,access_key=$5,
        protocol=$6,verification_code=$7,document_url=$8,authorized_xml=$9,response_payload=$10,
        authorized_at=CASE WHEN $1='AUTORIZADA' THEN NOW() ELSE authorized_at END,error_message=$11,updated_at=NOW()
      WHERE id=$12 AND company_id=$13 AND branch_id=$14`,[
      result.status,result.provider,result.providerDocumentId,result.documentNumber,result.accessKey,result.protocol,
      result.verificationCode,result.documentUrl,result.authorizedXml,result.data,result.status==='REJEITADA'?(result.message||'Emissão rejeitada.'):null,
      documentId,companyId,branchId,
    ]);
    await connection.query(`INSERT INTO fiscal_document_transmissions(company_id,branch_id,fiscal_document_id,operation,provider,request_payload,response_payload,http_status,protocol,error_message,created_by) VALUES($1,$2,$3,'EMISSAO',$4,$5,$6,$7,$8,$9,$10)`,[companyId,branchId,documentId,result.provider,payload,result.data,result.httpStatus,result.protocol,result.message,req.session.user.id]);
    await connection.query('COMMIT');
    return res.redirect(`/nfse/${documentId}?message=${encodeURIComponent('Processamento da NFS-e concluído.')}`);
  } catch (error) {
    try { await connection.query('ROLLBACK'); } catch {}
    if (documentId) {
      await db.query(`UPDATE fiscal_documents SET status='REJEITADA',error_message=$1,updated_at=NOW() WHERE id=$2 AND company_id=$3 AND branch_id=$4`,[error.message,documentId,companyId,branchId]);
      return res.redirect(`/nfse/${documentId}?error=${encodeURIComponent(error.message)}`);
    }
    return res.redirect(`/nfse?error=${encodeURIComponent(error.message)}`);
  } finally {
    connection.release();
  }
}));

nfseRouter.post('/nfse/:id/cancel', ...permission, asyncRoute(async (req,res) => {
  const { companyId, branchId } = context(req);
  const reason = String(req.body.reason || '').trim();
  if (reason.length < 15) return res.redirect(`/nfse/${req.params.id}?error=${encodeURIComponent('Informe um motivo de cancelamento com pelo menos 15 caracteres.')}`);

  const document = (await db.query(`SELECT * FROM fiscal_documents WHERE id=$1 AND document_type='NFSE' AND company_id=$2 AND branch_id=$3`,[req.params.id,companyId,branchId])).rows[0];
  if (!document) return res.status(404).render('error',{message:'NFS-e não encontrada neste contexto.'});
  if (document.status !== 'AUTORIZADA') return res.redirect(`/nfse/${document.id}?error=${encodeURIComponent('Somente NFS-e autorizada pode ser cancelada.')}`);

  const result = await cancelNfse(document,reason);
  const finalStatus = result.status === 'CANCELADA' ? 'CANCELADA' : 'REJEITADA';
  await db.query(`UPDATE fiscal_documents SET status=$1,cancelled_at=CASE WHEN $1='CANCELADA' THEN NOW() ELSE cancelled_at END,cancelled_by=CASE WHEN $1='CANCELADA' THEN $2 ELSE cancelled_by END,cancellation_reason=CASE WHEN $1='CANCELADA' THEN $3 ELSE cancellation_reason END,response_payload=$4,error_message=$5,updated_at=NOW() WHERE id=$6 AND company_id=$7 AND branch_id=$8`,[finalStatus,req.session.user.id,reason,result.data,finalStatus==='REJEITADA'?(result.message||'Cancelamento rejeitado.'):null,document.id,companyId,branchId]);
  await db.query(`INSERT INTO fiscal_document_transmissions(company_id,branch_id,fiscal_document_id,operation,provider,request_payload,response_payload,http_status,protocol,error_message,created_by) VALUES($1,$2,$3,'CANCELAMENTO',$4,$5,$6,$7,$8,$9,$10)`,[companyId,branchId,document.id,result.provider,{reason},result.data,result.httpStatus,result.protocol,result.message,req.session.user.id]);
  return res.redirect(`/nfse/${document.id}?message=${encodeURIComponent(finalStatus==='CANCELADA'?'NFS-e cancelada.':'Cancelamento rejeitado.')}`);
}));

nfseRouter.get('/nfse/:id/xml', ...permission, asyncRoute(async (req,res) => {
  const { companyId, branchId } = context(req);
  const document = (await db.query(`SELECT document_number,authorized_xml,request_xml FROM fiscal_documents WHERE id=$1 AND document_type='NFSE' AND company_id=$2 AND branch_id=$3`,[req.params.id,companyId,branchId])).rows[0];
  if (!document) return res.status(404).render('error',{message:'NFS-e não encontrada.'});
  const xml = document.authorized_xml || document.request_xml;
  if (!xml) return res.status(404).render('error',{message:'XML ainda não disponível.'});
  return res.type('application/xml').attachment(`NFSE-${document.document_number || req.params.id}.xml`).send(xml);
}));
