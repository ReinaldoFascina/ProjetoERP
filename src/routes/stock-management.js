import { Router } from 'express';
import { db } from '../database/db.js';
import { requireAuth, allow } from '../middleware/auth.js';
import {
  loadTypeContext,
  applyTypeTaxes,
  confirmMovement
} from '../services/stock-management/movement-flow.js';

export const stockManagementRouter = Router();

const guard = [requireAuth, allow('ADMIN', 'COORDENADOR')];

const run = f => (req, res, next) =>
  Promise.resolve(f(req, res, next)).catch(next);

const context = req => ({
  companyId: Number(req.session.companyId),
  branchId: Number(req.session.branchId),
  userId: Number(req.session.user.id)
});

// ─────────────────────────────────────────────────────────────
// Redirecionamento raiz
// ─────────────────────────────────────────────────────────────
stockManagementRouter.get(
  '/stock-management',
  ...guard,
  (req, res) => res.redirect('/stock-management/dashboard')
);

// ─────────────────────────────────────────────────────────────
// Dashboard
// ─────────────────────────────────────────────────────────────
stockManagementRouter.get(
  '/stock-management/dashboard',
  ...guard,
  run(async (req, res) => {
    const { companyId, branchId } = context(req);

    const [summary, recent, queue] = await Promise.all([
      db.query(
        `SELECT
           COUNT(*) FILTER (WHERE status = 'RASCUNHO')   AS drafts,
           COUNT(*) FILTER (WHERE status = 'CONFIRMADO') AS confirmed,
           COALESCE(SUM(total), 0)                       AS total
         FROM billing_movements
         WHERE company_id = $1 AND branch_id = $2`,
        [companyId, branchId]
      ),
      db.query(
        `SELECT
           bm.id,
           bm.number,
           bm.status,
           bm.total,
           bm.date_issued,
           mt.code             AS type_code,
           mt.name             AS type_name,
           c.corporate_name
         FROM billing_movements bm
         JOIN movement_types mt ON mt.id = bm.movement_type_id
         JOIN clients c         ON c.id  = bm.client_id
         WHERE bm.company_id = $1
           AND bm.branch_id  = $2
           AND mt.module_context = 'ES'
         ORDER BY bm.id DESC
         LIMIT 10`,
        [companyId, branchId]
      ),
      db.query(
        `SELECT
           process_code,
           status,
           COUNT(*) AS total
         FROM movement_process_queue
         WHERE company_id = $1 AND branch_id = $2
         GROUP BY process_code, status
         ORDER BY process_code`,
        [companyId, branchId]
      )
    ]);

    res.render('stock-management/dashboard', {
      pageTitle: 'Gestão de Estoque',
      summary: summary.rows[0],
      recent: recent.rows,
      queue: queue.rows
    });
  })
);

// ─────────────────────────────────────────────────────────────
// Listagem de movimentos
// ─────────────────────────────────────────────────────────────
stockManagementRouter.get(
  '/stock-management/movements',
  ...guard,
  run(async (req, res) => {
    const { companyId, branchId } = context(req);

    const rows = await db.query(
      `SELECT
         bm.id,
         bm.number,
         bm.date_issued,
         bm.status,
         bm.stock_status,
         bm.financial_status,
         bm.posting_status,
         bm.total,
         mt.code             AS type_code,
         mt.name             AS type_name,
         c.corporate_name
       FROM billing_movements bm
       JOIN movement_types mt ON mt.id = bm.movement_type_id
       JOIN clients c         ON c.id  = bm.client_id
       WHERE bm.company_id = $1
         AND bm.branch_id  = $2
         AND mt.module_context = 'ES'
       ORDER BY bm.id DESC`,
      [companyId, branchId]
    );

    res.render('stock-management/movements/list', {
      pageTitle: 'Movimentos',
      movements: rows.rows
    });
  })
);

// ─────────────────────────────────────────────────────────────
// Formulário de novo movimento
// ─────────────────────────────────────────────────────────────
stockManagementRouter.get(
  '/stock-management/movements/new',
  ...guard,
  run(async (req, res) => {
    const { companyId, branchId } = context(req);

    const [types, clients] = await Promise.all([
      db.query(
        `SELECT id, code, name
         FROM movement_types
         WHERE company_id = $1
           AND (branch_id = $2 OR branch_id IS NULL)
           AND module_context = 'ES'
           AND active = TRUE
         ORDER BY code`,
        [companyId, branchId]
      ),
      db.query(
        `SELECT id, corporate_name, document
         FROM clients
         WHERE company_id = $1 AND branch_id = $2
         ORDER BY corporate_name`,
        [companyId, branchId]
      )
    ]);

    res.render('stock-management/movements/new', {
      pageTitle: 'Novo movimento',
      types: types.rows,
      clients: clients.rows
    });
  })
);

// ─────────────────────────────────────────────────────────────
// Contexto do tipo de movimento (JSON)
// ─────────────────────────────────────────────────────────────
stockManagementRouter.get(
  '/stock-management/movement-types/:id/context',
  ...guard,
  run(async (req, res) => {
    const { companyId, branchId } = context(req);

    const data = await loadTypeContext(req.params.id, companyId, branchId);

    if (!data) {
      return res.status(404).json({ error: 'Tipo não encontrado' });
    }

    res.json(data);
  })
);

// ─────────────────────────────────────────────────────────────
// Criação de movimento
// ─────────────────────────────────────────────────────────────
stockManagementRouter.post(
  '/stock-management/movements',
  ...guard,
  run(async (req, res) => {
    const { companyId, branchId, userId } = context(req);
    const b = req.body;

    const type = await loadTypeContext(b.movement_type_id, companyId, branchId);

    if (!type) {
      return res
        .status(400)
        .render('error', { message: 'Tipo de movimento inválido.' });
    }

    const c = await db.connect();

    try {
      await c.query('BEGIN');

      const next = (
        await c.query(
          `SELECT COALESCE(MAX(id), 0) + 1 AS next
           FROM billing_movements
           WHERE company_id = $1 AND branch_id = $2`,
          [companyId, branchId]
        )
      ).rows[0].next;

      const movement = (
        await c.query(
          `INSERT INTO billing_movements (
             company_id,
             branch_id,
             movement_type_id,
             number,
             series,
             client_id,
             date_issued,
             competence,
             status,
             fiscal_nature_id,
             warehouse_id,
             total,
             service_total,
             product_total,
             created_by,
             updated_at
           ) VALUES (
             $1, $2, $3, $4, $5, $6, $7, $7, $8, $9, $10, 0, 0, 0, $11, NOW()
           )
           RETURNING *`,
          [
            companyId,
            branchId,
            type.type.id,
            String(next).padStart(8, '0'),
            type.type.series,
            b.client_id,
            b.date_issued || new Date(),
            type.type.status_initial || 'RASCUNHO',
            type.type.fiscal_nature_id,
            type.type.default_warehouse_id,
            userId
          ]
        )
      ).rows[0];

      await applyTypeTaxes(c, {
        movementId: movement.id,
        typeId: type.type.id,
        companyId,
        branchId
      });

      await c.query(
        `INSERT INTO movement_status_history (
           company_id,
           branch_id,
           movement_id,
           new_status,
           operation,
           message,
           user_id
         ) VALUES ($1, $2, $3, $4, 'CRIACAO', 'Movimento criado a partir do tipo parametrizado.', $5)`,
        [companyId, branchId, movement.id, movement.status, userId]
      );

      await c.query('COMMIT');

      res.redirect(`/stock-management/movements/${movement.id}`);
    } catch (e) {
      await c.query('ROLLBACK');
      throw e;
    } finally {
      c.release();
    }
  })
);

// ─────────────────────────────────────────────────────────────
// Detalhe de movimento
// ─────────────────────────────────────────────────────────────
stockManagementRouter.get(
  '/stock-management/movements/:id',
  ...guard,
  run(async (req, res) => {
    const { companyId, branchId } = context(req);

    const movement = (
      await db.query(
        `SELECT
           bm.*,
           mt.code             AS type_code,
           mt.name             AS type_name,
           c.corporate_name,
           fn.code             AS nature_code,
           fn.name             AS nature_name,
           sw.code             AS warehouse_code,
           sw.name             AS warehouse_name
         FROM billing_movements bm
         JOIN movement_types mt   ON mt.id = bm.movement_type_id
         JOIN clients c           ON c.id  = bm.client_id
         LEFT JOIN fiscal_natures fn ON fn.id = bm.fiscal_nature_id
         LEFT JOIN stock_warehouses sw ON sw.id = bm.warehouse_id
         WHERE bm.id         = $1
           AND bm.company_id = $2
           AND bm.branch_id  = $3`,
        [req.params.id, companyId, branchId]
      )
    ).rows[0];

    if (!movement) {
      return res
        .status(404)
        .render('error', { message: 'Movimento não encontrado.' });
    }

    const [items, headerTaxes, itemTaxes, queue, history, catalog] =
      await Promise.all([
        db.query(
          `SELECT *
           FROM billing_movement_items
           WHERE movement_id = $1 AND company_id = $2 AND branch_id = $3
           ORDER BY sequence, id`,
          [req.params.id, companyId, branchId]
        ),
        db.query(
          `SELECT
             h.*,
             t.code AS tax_code,
             t.name AS tax_name
           FROM movement_header_taxes h
           JOIN fiscal_taxes t ON t.id = h.tax_id
           WHERE h.movement_id = $1
             AND h.company_id = $2
             AND h.branch_id  = $3
           ORDER BY h.id`,
          [req.params.id, companyId, branchId]
        ),
        db.query(
          `SELECT
             it.*,
             t.code    AS tax_code,
             t.name    AS tax_name,
             i.sequence
           FROM movement_item_taxes it
           JOIN fiscal_taxes t ON t.id = it.tax_id
           JOIN billing_movement_items i ON i.id = it.movement_item_id
           WHERE it.movement_id = $1
             AND it.company_id = $2
             AND it.branch_id  = $3
           ORDER BY i.sequence, it.id`,
          [req.params.id, companyId, branchId]
        ),
        db.query(
          `SELECT *
           FROM movement_process_queue
           WHERE movement_id = $1 AND company_id = $2 AND branch_id = $3
           ORDER BY id`,
          [req.params.id, companyId, branchId]
        ),
        db.query(
          `SELECT *
           FROM movement_status_history
           WHERE movement_id = $1 AND company_id = $2 AND branch_id = $3
           ORDER BY created_at DESC`,
          [req.params.id, companyId, branchId]
        ),
        db.query(
          `SELECT id, code, description, item_type, unit, unit_price, ncm
           FROM catalog_items
           WHERE company_id = $1 AND branch_id = $2 AND active = TRUE
           ORDER BY description`,
          [companyId, branchId]
        )
      ]);

    res.render('stock-management/movements/detail', {
      pageTitle: `${movement.type_code} | ${movement.number}`,
      movement,
      items: items.rows,
      headerTaxes: headerTaxes.rows,
      itemTaxes: itemTaxes.rows,
      queue: queue.rows,
      history: history.rows,
      catalog: catalog.rows
    });
  })
);

// ─────────────────────────────────────────────────────────────
// Inclusão de item no movimento
// ─────────────────────────────────────────────────────────────
stockManagementRouter.post(
  '/stock-management/movements/:id/items',
  ...guard,
  run(async (req, res) => {
    const { companyId, branchId } = context(req);
    const b = req.body;

    const c = await db.connect();

    try {
      await c.query('BEGIN');

      const movement = (
        await c.query(
          `SELECT *
           FROM billing_movements
           WHERE id         = $1
             AND company_id = $2
             AND branch_id  = $3
           FOR UPDATE`,
          [req.params.id, companyId, branchId]
        )
      ).rows[0];

      if (!movement || !['RASCUNHO', 'ABERTO'].includes(movement.status)) {
        throw new Error('Movimento não permite inclusão de itens.');
      }

      const product = (
        await c.query(
          `SELECT *
           FROM catalog_items
           WHERE id = $1 AND company_id = $2 AND branch_id = $3`,
          [b.catalog_item_id, companyId, branchId]
        )
      ).rows[0];

      const seq = (
        await c.query(
          `SELECT COALESCE(MAX(sequence), 0) + 1 AS seq
           FROM billing_movement_items
           WHERE movement_id = $1`,
          [movement.id]
        )
      ).rows[0].seq;

      const qty = Number(b.quantity);
      const price = Number(b.unit_price ?? product.unit_price);
      const total = qty * price;

      const item = (
        await c.query(
          `INSERT INTO billing_movement_items (
             company_id,
             branch_id,
             movement_id,
             sequence,
             catalog_item_id,
             item_type,
             description,
             unit,
             quantity,
             unit_price,
             discount,
             total,
             ncm,
             cfop
           ) VALUES (
             $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 0, $11, $12, $13
           )
           RETURNING *`,
          [
            companyId,
            branchId,
            movement.id,
            seq,
            product.id,
            product.item_type,
            product.description,
            product.unit,
            qty,
            price,
            total,
            product.ncm,
            b.cfop || null
          ]
        )
      ).rows[0];

      await applyTypeTaxes(c, {
        movementId: movement.id,
        itemId: item.id,
        typeId: movement.movement_type_id,
        companyId,
        branchId
      });

      await c.query(
        `UPDATE billing_movements
         SET
           product_total = (
             SELECT COALESCE(SUM(total), 0)
             FROM billing_movement_items
             WHERE movement_id = $1 AND item_type = 'PRODUTO'
           ),
           service_total = (
             SELECT COALESCE(SUM(total), 0)
             FROM billing_movement_items
             WHERE movement_id = $1 AND item_type = 'SERVICO'
           ),
           total = (
             SELECT COALESCE(SUM(total), 0)
             FROM billing_movement_items
             WHERE movement_id = $1
           ),
           updated_at = NOW()
         WHERE id = $1`,
        [movement.id]
      );

      await c.query('COMMIT');

      res.redirect(`/stock-management/movements/${movement.id}?tab=items`);
    } catch (e) {
      await c.query('ROLLBACK');
      throw e;
    } finally {
      c.release();
    }
  })
);

// ─────────────────────────────────────────────────────────────
// Confirmação de movimento
// ─────────────────────────────────────────────────────────────
stockManagementRouter.post(
  '/stock-management/movements/:id/confirm',
  ...guard,
  run(async (req, res) => {
    const { companyId, branchId, userId } = context(req);

    await confirmMovement({
      movementId: req.params.id,
      companyId,
      branchId,
      userId
    });

    res.redirect(
      `/stock-management/movements/${req.params.id}?message=${encodeURIComponent(
        'Movimento confirmado.'
      )}`
    );
  })
);

// ─────────────────────────────────────────────────────────────
// Listagem de tipos de movimento
// ─────────────────────────────────────────────────────────────
stockManagementRouter.get(
  '/stock-management/movement-types',
  ...guard,
  run(async (req, res) => {
    const { companyId, branchId } = context(req);

    const rows = await db.query(
      `SELECT
         mt.*,
         COUNT(mtt.id) AS tax_count
       FROM movement_types mt
       LEFT JOIN movement_type_taxes mtt
         ON mtt.movement_type_id = mt.id
        AND mtt.company_id = $1
        AND mtt.branch_id  = $2
       WHERE mt.company_id = $1
         AND (mt.branch_id = $2 OR mt.branch_id IS NULL)
         AND mt.module_context = 'ES'
       GROUP BY mt.id
       ORDER BY mt.code`,
      [companyId, branchId]
    );

    res.render('stock-management/movement-types/list', {
      pageTitle: 'Tipos de movimento',
      types: rows.rows
    });
  })
);

// ─────────────────────────────────────────────────────────────
// Posição de estoque
// ─────────────────────────────────────────────────────────────
stockManagementRouter.get(
  '/stock-management/stock',
  ...guard,
  run(async (req, res) => {
    const { companyId, branchId } = context(req);

    const rows = await db.query(
      `SELECT
         sb.*,
         sw.code        AS warehouse_code,
         ci.code        AS item_code,
         ci.description
       FROM stock_balances sb
       JOIN stock_warehouses sw ON sw.id = sb.warehouse_id
       JOIN catalog_items ci    ON ci.id = sb.catalog_item_id
       WHERE sb.company_id = $1
         AND sb.branch_id  = $2
       ORDER BY ci.description`,
      [companyId, branchId]
    );

    res.render('stock-management/stock/index', {
      pageTitle: 'Posição de estoque',
      balances: rows.rows
    });
  })
);