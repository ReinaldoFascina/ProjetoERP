import { Router } from 'express';
import { db } from '../database/db.js';
import { requireAuth, allow } from '../middleware/auth.js';

export const stockManagementWizardRouter = Router();
const middlewares = [requireAuth, allow('ADMIN', 'COORDENADOR')];

// Função auxiliar para capturar erros async
const asyncHandler = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

// Função para obter companyId e branchId da sessão
const getContext = req => [Number(req.session.companyId), Number(req.session.branchId)];

// Etapas do wizard
const steps = [
    'identification',
    'items',
    'stock',
    'financial',
    'fiscal',
    'accounting',
    'retentions',
    'nfe',
    'review'
];

/**
 * Wizard de configuração de tipo de movimento
 */
stockManagementWizardRouter.get(
    '/stock-management/movement-types/:id/wizard/:step?',
    ...middlewares,
    asyncHandler(async (req, res) => {
        const [companyId, branchId] = getContext(req);
        const step = req.params.step || 'identification';

        // Buscar tipo de movimento
        const type = (await db.query(
            `SELECT * 
       FROM movement_types 
       WHERE id=$1 AND company_id=$2 AND (branch_id=$3 OR branch_id IS NULL)`,
            [req.params.id, companyId, branchId]
        )).rows[0];

        if (!type) {
            return res.status(404).render('error', { message: 'Tipo não encontrado' });
        }

        // Buscar dados já salvos e tabelas auxiliares
        const [saved, natures, taxes] = await Promise.all([
            db.query(
                `SELECT * 
         FROM movement_type_wizard_steps 
         WHERE movement_type_id=$1 AND company_id=$2 AND branch_id=$3 
         ORDER BY step_order`,
                [req.params.id, companyId, branchId]
            ),
            db.query(
                `SELECT * 
         FROM fiscal_natures 
         WHERE company_id=$1 AND (branch_id=$2 OR branch_id IS NULL) AND active=TRUE 
         ORDER BY name`,
                [companyId, branchId]
            ),
            db.query(
                `SELECT * 
         FROM fiscal_taxes 
         WHERE company_id=$1 AND branch_id=$2 AND active=TRUE 
         ORDER BY name`,
                [companyId, branchId]
            )
        ]);

        res.render('stock-management/movement-types/wizard/index', {
            pageTitle: 'Assistente do tipo de movimento',
            type,
            step,
            steps,
            saved: saved.rows,
            natures: natures.rows,
            taxes: taxes.rows,
            config: saved.rows.find(x => x.step_code === step)?.configuration || {}
        });
    })
);

stockManagementWizardRouter.post(
    '/stock-management/movement-types/:id/wizard/:step',
    ...middlewares,
    asyncHandler(async (req, res) => {
        const [companyId, branchId] = getContext(req);
        const step = req.params.step;
        const order = steps.indexOf(step) + 1;

        if (!order) {
            return res.status(400).send('Etapa inválida');
        }

        await db.query(
            `INSERT INTO movement_type_wizard_steps(
         company_id, branch_id, movement_type_id, step_code, step_order, completed, configuration, updated_by
       )
       VALUES($1,$2,$3,$4,$5,TRUE,$6,$7)
       ON CONFLICT(company_id,branch_id,movement_type_id,step_code)
       DO UPDATE SET completed=TRUE, configuration=EXCLUDED.configuration, updated_by=EXCLUDED.updated_by, updated_at=NOW()`,
            [companyId, branchId, req.params.id, step, order, req.body, req.session.user.id]
        );

        const nextStep = steps[order] || 'review';
        res.redirect(`/stock-management/movement-types/${req.params.id}/wizard/${nextStep}`);
    })
);

/**
 * Central de NF-e
 */
stockManagementWizardRouter.get(
    '/stock-management/nfe',
    ...middlewares,
    asyncHandler(async (req, res) => {
        const companyId = getContext(req)[0];
        const branchId = getContext(req)[1];
        const statusFilter = req.query.status || null;

        if(statusFilter) {
            const rows = await db.query(
                `SELECT bm.id, bm.number, bm.total, bm.nfe_status, bm.nfe_key, bm.nfe_protocol,
                  c.corporate_name, mt.code type_code
           FROM billing_movements bm
           JOIN movement_types mt ON mt.id=bm.movement_type_id
           JOIN clients c ON c.id=bm.client_id
           WHERE bm.company_id=$1 AND bm.branch_id=$2 AND mt.creates_nfe=TRUE AND bm.nfe_status=$3
           ORDER BY bm.id DESC`,
                [companyId, branchId, statusFilter]
            );

            res.render('stock-management/nfe/list', {
                pageTitle: 'Central de NF-e',
                movements: rows.rows,
                statusFilter
            });
        } else {
            const rows = await db.query(
                `SELECT bm.id, bm.number, bm.total, bm.nfe_status, bm.nfe_key, bm.nfe_protocol,
              c.corporate_name, mt.code type_code
       FROM billing_movements bm
       JOIN movement_types mt ON mt.id=bm.movement_type_id
       JOIN clients c ON c.id=bm.client_id
       WHERE bm.company_id=$1 
       AND bm.branch_id=$2 
       AND mt.creates_nfe=TRUE
       ORDER BY bm.id DESC`,
                [companyId, branchId]
            );

            res.render('stock-management/nfe/list', {
                pageTitle: 'Central de NF-e',
                movements: rows.rows
            });
        }
    })
);

stockManagementWizardRouter.get(
    '/stock-management/nfe/:id',
    ...middlewares,
    asyncHandler(async (req, res) => {
        const [companyId, branchId] = getContext(req);

        const movement = (await db.query(
            `SELECT bm.*, c.corporate_name, mt.code type_code, mt.name type_name
       FROM billing_movements bm
       JOIN clients c ON c.id=bm.client_id
       JOIN movement_types mt ON mt.id=bm.movement_type_id
       WHERE bm.id=$1 AND bm.company_id=$2 AND bm.branch_id=$3`,
            [req.params.id, companyId, branchId]
        )).rows[0];

        const transmissions = await db.query(
            `SELECT * 
       FROM nfe_transmissions 
       WHERE movement_id=$1 AND company_id=$2 AND branch_id=$3 
       ORDER BY created_at DESC`,
            [req.params.id, companyId, branchId]
        );

        res.render('stock-management/nfe/detail', {
            pageTitle: 'Envio de NF-e',
            movement,
            transmissions: transmissions.rows
        });
    })
);

stockManagementWizardRouter.post(
    '/stock-management/nfe/:id/send',
    ...middlewares,
    asyncHandler(async (req, res) => {
        const [companyId, branchId] = getContext(req);

        await db.query(
            `INSERT INTO movement_process_queue(company_id, branch_id, movement_id, process_code, status, payload)
       VALUES($1,$2,$3,'PREPARAR_NFE','PENDENTE',$4)`,
            [companyId, branchId, req.params.id, { requestedBy: req.session.user.id }]
        );

        await db.query(
            `UPDATE billing_movements 
       SET nfe_status='EM_FILA' 
       WHERE id=$1 AND company_id=$2 AND branch_id=$3`,
            [req.params.id, companyId, branchId]
        );

        res.redirect(`/stock-management/nfe/${req.params.id}?message=${encodeURIComponent('NF-e colocada na fila de transmissão.')}`);
    })
);
