import { Router } from 'express';
import { db } from '../database/db.js';
import { requireAuth, allow } from '../middleware/auth.js';

export const wizardRouter = Router();
const p = [requireAuth, allow('ADMIN','COORDENADOR')];

/**
 * Redireciona para a primeira etapa
 */
wizardRouter.get('/movement-type-wizard/:movementTypeId', ...p, async (req, res) => {
  res.redirect(`/movement-type-wizard/${req.params.movementTypeId}/identificacao`);
});

/**
 * Etapa 1 - Identificação
 */
wizardRouter.get('/movement-type-wizard/:movementTypeId/identificacao', ...p, async (req, res) => {
  res.render('wizard/step', { step: 'IDENTIFICACAO', movementTypeId: req.params.movementTypeId });
});

wizardRouter.post('/movement-type-wizard/:movementTypeId/identificacao', ...p, async (req, res) => {
  await db.query(`
    INSERT INTO movement_type_wizard_steps(company_id, branch_id, movement_type_id, step_code, step_order, completed, configuration, updated_by)
    VALUES($1,$2,$3,'IDENTIFICACAO',1,true,$4,$5)
    ON CONFLICT (company_id,branch_id,movement_type_id,step_code)
    DO UPDATE SET configuration=$4, completed=true, updated_by=$5, updated_at=NOW()
  `, [req.session.company_id, req.session.branch_id, req.params.movementTypeId, req.body, req.session.user.id]);

  res.redirect(`/movement-type-wizard/${req.params.movementTypeId}/financeiro`);
});

/**
 * Etapa 2 - Financeiro
 */
wizardRouter.get('/movement-type-wizard/:movementTypeId/financeiro', ...p, async (req, res) => {
  res.render('wizard/step', { step: 'FINANCEIRO', movementTypeId: req.params.movementTypeId });
});

wizardRouter.post('/movement-type-wizard/:movementTypeId/financeiro', ...p, async (req, res) => {
  await db.query(`
    INSERT INTO movement_financial_config(company_id, branch_id, movement_type_id, generates_financial, direction, installment_count, payment_term_days, cost_center_required, allocation_required, configuration)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
    ON CONFLICT (company_id,branch_id,movement_type_id)
    DO UPDATE SET generates_financial=$4, direction=$5, installment_count=$6, payment_term_days=$7, cost_center_required=$8, allocation_required=$9, configuration=$10
  `, [
    req.session.company_id, req.session.branch_id, req.params.movementTypeId,
    req.body.generates_financial === 'on', req.body.direction, req.body.installment_count,
    req.body.payment_term_days, req.body.cost_center_required === 'on', req.body.allocation_required === 'on',
    req.body
  ]);

  res.redirect(`/movement-type-wizard/${req.params.movementTypeId}/fiscal`);
});

/**
 * Etapa 3 - Fiscal
 */
wizardRouter.get('/movement-type-wizard/:movementTypeId/fiscal', ...p, async (req, res) => {
  const fiscalNatures = (await db.query('SELECT * FROM fiscal_natures ORDER BY name')).rows;
  res.render('wizard/step', { step: 'FISCAL', movementTypeId: req.params.movementTypeId, fiscalNatures });
});

wizardRouter.post('/movement-type-wizard/:movementTypeId/fiscal', ...p, async (req, res) => {
  await db.query(`
    INSERT INTO movement_fiscal_config(company_id, branch_id, movement_type_id, fiscal_nature_id, document_model, generates_posting, generates_nfe, series, environment, send_mode, allows_item_nature, configuration)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
    ON CONFLICT (company_id,branch_id,movement_type_id)
    DO UPDATE SET fiscal_nature_id=$4, document_model=$5, generates_posting=$6, generates_nfe=$7, series=$8, environment=$9, send_mode=$10, allows_item_nature=$11, configuration=$12
  `, [
    req.session.company_id, req.session.branch_id, req.params.movementTypeId,
    req.body.fiscal_nature_id, req.body.document_model,
    req.body.generates_posting === 'on', req.body.generates_nfe === 'on',
    req.body.series, req.body.environment, req.body.send_mode,
    req.body.allows_item_nature === 'on', req.body
  ]);

  res.redirect(`/movement-type-wizard/${req.params.movementTypeId}/contabil`);
});

/**
 * Etapa 4 - Contábil
 */
wizardRouter.get('/movement-type-wizard/:movementTypeId/contabil', ...p, async (req, res) => {
  res.render('wizard/step', { step: 'CONTABIL', movementTypeId: req.params.movementTypeId });
});

wizardRouter.post('/movement-type-wizard/:movementTypeId/contabil', ...p, async (req, res) => {
  await db.query(`
    INSERT INTO movement_accounting_config(company_id, branch_id, movement_type_id, generates_accounting, posting_mode, accounting_event_code, debit_account, credit_account, history_template, cost_center_required, configuration)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
    ON CONFLICT (company_id,branch_id,movement_type_id)
    DO UPDATE SET generates_accounting=$4, posting_mode=$5, accounting_event_code=$6, debit_account=$7, credit_account=$8, history_template=$9, cost_center_required=$10, configuration=$11
  `, [
    req.session.company_id, req.session.branch_id, req.params.movementTypeId,
    req.body.generates_accounting === 'on', req.body.posting_mode,
    req.body.accounting_event_code, req.body.debit_account, req.body.credit_account,
    req.body.history_template, req.body.cost_center_required === 'on', req.body
  ]);

  res.redirect(`/movement-type-wizard/${req.params.movementTypeId}/retencoes`);
});

/**
 * Etapa 5 - Retenções
 */
wizardRouter.get('/movement-type-wizard/:movementTypeId/retencoes', ...p, async (req, res) => {
  const fiscalTaxes = (await db.query('SELECT * FROM fiscal_taxes ORDER BY name')).rows;
  res.render('wizard/step', { step: 'RETENCOES', movementTypeId: req.params.movementTypeId, fiscalTaxes });
});

wizardRouter.post('/movement-type-wizard/:movementTypeId/retencoes', ...p, async (req, res) => {
  await db.query(`
    INSERT INTO movement_retention_config(company_id, branch_id, movement_type_id, tax_id, application_level, control_mode, default_rate, default_value, deducts_financial, generates_separate_title, nature_of_income, active)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,true)
    ON CONFLICT (company_id,branch_id,movement_type_id)
    DO UPDATE SET tax_id=$4, application_level=$5, control_mode=$6, default_rate=$7, default_value=$8, deducts_financial=$9, generates_separate_title=$10, nature_of_income=$11, active=true
  `, [
    req.session.company_id, req.session.branch_id, req.params.movementTypeId,
    req.body.tax_id, req.body.application_level, req.body.control_mode,
    req.body.default_rate, req.body.default_value,
    req.body.deducts_financial === 'on', req.body.generates_separate_title === 'on',
    req.body.nature_of_income
  ]);

  res.redirect(`/movement-type-wizard/${req.params.movementTypeId}/resumo`);
});

/**
 * Etapa 6 - Resumo
 *//**
 * Etapa 6 - Resumo
 */
wizardRouter.get('/movement-type-wizard/:movementTypeId/resumo', ...p, async (req, res) => {
  const [steps, fin, fis, cont, ret] = await Promise.all([
    db.query('SELECT * FROM movement_type_wizard_steps WHERE movement_type_id=$1 ORDER BY step_order', [req.params.movementTypeId]),
    db.query('SELECT * FROM movement_financial_config WHERE movement_type_id=$1', [req.params.movementTypeId]),
    db.query('SELECT * FROM movement_fiscal_config WHERE movement_type_id=$1', [req.params.movementTypeId]),
    db.query('SELECT * FROM movement_accounting_config WHERE movement_type_id=$1', [req.params.movementTypeId]),
    db.query('SELECT * FROM movement_retention_config WHERE movement_type_id=$1', [req.params.movementTypeId])
  ]);

  res.render('wizard/step', {
    step: 'RESUMO',
    movementTypeId: req.params.movementTypeId,
    steps: steps.rows,
    financial: fin.rows[0],
    fiscal: fis.rows[0],
    accounting: cont.rows[0],
    retention: ret.rows[0]
  });
});

/**
 * Conclusão do wizard
 */
wizardRouter.post('/movement-type-wizard/:movementTypeId/concluir', ...p, async (req, res) => {
  await db.query(`
    UPDATE movement_type_wizard_steps
    SET completed=true, updated_at=NOW(), updated_by=$1
    WHERE movement_type_id=$2
  `, [req.session.user.id, req.params.movementTypeId]);

  res.redirect(`/movement-types/${req.params.movementTypeId}`);
});


/**
 * Lista tipos de movimento
 */
movementTypeRouter.get('/movement-types', ...p, async (req, res) => {
  const { rows } = await db.query(`
    SELECT mt.*, 
           (SELECT COUNT(*) FROM movement_type_wizard_steps s 
            WHERE s.movement_type_id=mt.id AND s.completed=true) completed_steps
    FROM movement_types mt
    WHERE mt.company_id=$1 AND mt.branch_id=$2
    ORDER BY mt.id DESC
  `, [req.session.company_id, req.session.branch_id]);

  res.render('movement-types/list', { movementTypes: rows });
});

/**
 * Acessa wizard de configuração
 */
movementTypeRouter.get('/movement-types/:id/configurar', ...p, async (req, res) => {
  res.redirect(`/movement-type-wizard/${req.params.id}`);
});