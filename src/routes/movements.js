import { Router } from 'express';
import { db } from '../database/db.js';
import { requireAuth, allow } from '../middleware/auth.js';
import { loadIntegratedMovement } from '../services/movements/load-integrated.js';

export const movementsRouter = Router();

const guard = [
  requireAuth,
  allow('ADMIN', 'COORDENADOR')
];

const a = (f) => (req, res, next) =>
  Promise.resolve(f(req, res, next)).catch(next);

const ctx = (req) => ({
  companyId: Number(req.session.companyId),
  branchId: Number(req.session.branchId)
});

movementsRouter.get(
  '/movements',
  ...guard,
  a(async (req, res) => {
    const { companyId, branchId } = ctx(req);

    const status = String(req.query.status || '');
    const q = String(req.query.q || '');

    const p = [companyId, branchId];

    const w = [
      'bm.company_id=$1',
      'bm.branch_id=$2'
    ];

    if (status) {
      p.push(status);
      w.push(`bm.status=$${p.length}`);
    }

    if (q) {
      p.push(`%${q}%`);

      w.push(
        `(bm.number ILIKE $${p.length}
          OR c.corporate_name ILIKE $${p.length}
          OR COALESCE(bm.nfse_national_number,'') ILIKE $${p.length})`
      );
    }

    const rows = await db.query(
      `
      SELECT
        bm.*,
        c.corporate_name,
        mt.code AS movement_type_code,
        mt.name AS movement_type_name
      FROM billing_movements bm
      JOIN clients c
        ON c.id = bm.client_id
      LEFT JOIN movement_types mt
        ON mt.id = bm.movement_type_id
      WHERE ${w.join(' AND ')}
      ORDER BY
        bm.date_issued DESC,
        bm.id DESC
      `,
      p
    );

    return res.render('movements/list', {
      pageTitle: 'Movimentos',
      movements: rows.rows,
      filters: {
        status,
        q
      },
      message: req.query.message || '',
      error: req.query.error || ''
    });
  })
);

movementsRouter.get(
  '/movements/:id',
  ...guard,
  a(async (req, res) => {
    const { companyId, branchId } = ctx(req);

    const data = await loadIntegratedMovement(
      req.params.id,
      companyId,
      branchId
    );

    if (!data) {
      return res
        .status(404)
        .render('error', {
          message: 'Movimento não encontrado.'
        });
    }

    return res.render('movements/detail', {
      pageTitle: `${data.movement.movement_type_code || 'MOV'} | ${data.movement.number}`,
      data,
      tab: req.query.tab || 'identification',
      message: req.query.message || '',
      error: req.query.error || ''
    });
  })
);