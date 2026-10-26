import { Router } from 'express';
import { db } from '../database/db.js';
import { requireAuth, allow } from '../middleware/auth.js';

export const billingRouter = Router();

const asyncRoute = (handler) => (req, res, next) =>
  Promise.resolve(handler(req, res, next)).catch(next);

const p = [requireAuth, allow('ADMIN', 'COORDENADOR')];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Recalcula totais do movimento a partir dos itens. */
async function rec(c, id) {
  const t = (
    await c.query(
      `SELECT
         COALESCE(SUM(total), 0) AS subtotal,
         COALESCE(SUM(total) FILTER (WHERE item_type='SERVICO'), 0) AS service_total,
         COALESCE(SUM(total) FILTER (WHERE item_type='PRODUTO'), 0) AS product_total
       FROM billing_movement_items
       WHERE movement_id = $1`,
      [id]
    )
  ).rows[0];

  await c.query(
    `UPDATE billing_movements
        SET subtotal = $1,
            service_total = $2,
            product_total = $3,
            total = GREATEST($1 - discount, 0),
            updated_at = NOW()
      WHERE id = $4`,
    [t.subtotal, t.service_total, t.product_total, id]
  );
}

/** Adiciona um item do catálogo ao movimento. */
async function add(c, id, item, qty, price, seq, ratId = null) {
  const total = Number(qty) * Number(price);
  if (!Number.isFinite(total) || total <= 0) {
    throw new Error('Item sem valor.');
  }

  const result = (
    await c.query(
      `INSERT INTO billing_movement_items(
         movement_id, catalog_item_id, sequence, item_type, code, description,
         unit, quantity, unit_price, total, rat_id, service_date,
         national_service_code, nbs_code, ncm, cfop, iss_rate
       )
       SELECT
         $1, id, $2, item_type, code, description, unit,
         $3, $4, $5, $6, $7,
         national_service_code, nbs_code, ncm, cfop, iss_rate
       FROM catalog_items
       WHERE id = $8
       RETURNING id`,
      [id, seq, qty, price, total, ratId, item.service_date || null, item.id]
    )
  ).rows[0];

  if (!result) {
    throw new Error('Item de catálogo inválido.');
  }
  return result;
}

// ---------------------------------------------------------------------------
// GET /billing — listagem
// ---------------------------------------------------------------------------
billingRouter.get(
  '/billing',
  ...p,
  asyncRoute(async (req, res) => {
    const { rows } = await db.query(
      `SELECT m.*, c.corporate_name,
              (SELECT COUNT(*) FROM billing_movement_items i WHERE i.movement_id = m.id) AS item_count
         FROM billing_movements m
         JOIN clients c ON c.id = m.client_id
        ORDER BY m.id DESC`
    );

    res.render('billing/list', { movements: rows, clients: [], filters: {} });
  })
);

// ---------------------------------------------------------------------------
// GET /billing/new — formulário
// ---------------------------------------------------------------------------
billingRouter.get(
  '/billing/new',
  ...p,
  asyncRoute(async (req, res) => {
    const [clients, items] = await Promise.all([
      db.query(
        `SELECT * FROM clients
          WHERE active = TRUE AND partner_type IN ('CLIENTE','AMBOS')
          ORDER BY corporate_name`
      ),
      db.query(
        'SELECT * FROM catalog_items WHERE active = TRUE ORDER BY description'
      ),
    ]);

    res.render('billing/master-form', {
      movement: null,
      clients: clients.rows,
      catalogItems: items.rows,
      action: '/billing',
      pageTitle: 'Novo movimento',
      error: null,
    });
  })
);

// ---------------------------------------------------------------------------
// POST /billing — criação
// ---------------------------------------------------------------------------
billingRouter.post(
  '/billing',
  ...p,
  asyncRoute(async (req, res) => {
    const b = req.body;

    if (!b.client_id) {
      return res.status(400).render('error', { message: 'Selecione o cliente.' });
    }
    if (!b.catalog_item_id) {
      return res
        .status(400)
        .render('error', { message: 'Selecione um item de catálogo.' });
    }

    const connection = await db.connect();
    try {
      await connection.query('BEGIN');

      const movement = (
        await connection.query(
          `INSERT INTO billing_movements(
             number, client_id, competence, date_issued, due_date, discount, notes, created_by
           ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
           RETURNING id`,
          [
            `MOV-${Date.now()}`,
            b.client_id,
            b.competence,
            b.date_issued,
            b.due_date || null,
            Number(b.discount || 0),
            b.notes || null,
            req.session.user.id,
          ]
        )
      ).rows[0];

      await add(
        connection,
        movement.id,
        { id: b.catalog_item_id, service_date: b.service_date },
        b.quantity,
        b.unit_price,
        1
      );
      await rec(connection, movement.id);

      await connection.query('COMMIT');
      res.redirect(`/billing/${movement.id}`);
    } catch (error) {
      await connection.query('ROLLBACK');
      throw error;
    } finally {
      connection.release();
    }
  })
);

// ---------------------------------------------------------------------------
// GET /billing/:id — detalhe
// ---------------------------------------------------------------------------
billingRouter.get(
  '/billing/:id',
  ...p,
  asyncRoute(async (req, res) => {
    const [movement, items, rats, fiscalDocs, catalogItems] = await Promise.all([
      db.query(
        `SELECT m.*, c.corporate_name
           FROM billing_movements m
           JOIN clients c ON c.id = m.client_id
          WHERE m.id = $1`,
        [req.params.id]
      ),
      db.query(
        'SELECT * FROM billing_movement_items WHERE movement_id = $1 ORDER BY sequence',
        [req.params.id]
      ),
      db.query(
        `SELECT r.*, u.name AS technician,
                ci.code AS fiscal_code, ci.description AS fiscal_item
           FROM rats r
           JOIN users u ON u.id = r.technician_id
           JOIN catalog_items ci ON ci.id = r.catalog_item_id
          WHERE r.client_id = (SELECT client_id FROM billing_movements WHERE id = $1)
            AND r.customer_approved = TRUE
            AND r.billed_at IS NULL`,
        [req.params.id]
      ),
      db.query(
        'SELECT * FROM fiscal_documents WHERE movement_id = $1 ORDER BY id DESC',
        [req.params.id]
      ),
      db.query(
        'SELECT * FROM catalog_items WHERE active = TRUE ORDER BY description'
      ),
    ]);

    if (!movement.rows[0]) {
      return res
        .status(404)
        .render('error', { message: 'Movimento não encontrado' });
    }

    res.render('billing/detail', {
      movement: movement.rows[0],
      items: items.rows,
      rats: rats.rows,
      fiscalDocuments: fiscalDocs.rows,
      catalogItems: catalogItems.rows,
      error: req.query.error || '',
      message: req.query.message || '',
    });
  })
);

// ---------------------------------------------------------------------------
// GET /billing/:id/edit — edição
// ---------------------------------------------------------------------------
billingRouter.get(
  '/billing/:id/edit',
  ...p,
  asyncRoute(async (req, res) => {
    const [movement, clients] = await Promise.all([
      db.query('SELECT * FROM billing_movements WHERE id = $1', [req.params.id]),
      db.query(
        'SELECT id, corporate_name FROM clients WHERE active = TRUE ORDER BY corporate_name'
      ),
    ]);

    if (!movement.rows[0]) {
      return res
        .status(404)
        .render('error', { message: 'Movimento não encontrado.' });
    }

    res.render('billing/master-form', {
      movement: movement.rows[0],
      clients: clients.rows,
      catalogItems: [],
      action: `/billing/${req.params.id}`,
      pageTitle: `Editar ${movement.rows[0].number}`,
      error: null,
    });
  })
);

// ---------------------------------------------------------------------------
// POST /billing/:id/cancel — cancelamento
// ---------------------------------------------------------------------------
billingRouter.post(
  '/billing/:id/cancel',
  ...p,
  asyncRoute(async (req, res) => {
    const connection = await db.connect();

    try {
      await connection.query('BEGIN');

      const movement = (
        await connection.query(
          'SELECT * FROM billing_movements WHERE id = $1 FOR UPDATE',
          [req.params.id]
        )
      ).rows[0];

      if (!movement) throw new Error('Movimento não encontrado.');
      if (movement.status === 'CANCELADO') {
        throw new Error('Movimento já cancelado.');
      }

      const financialTitles = await connection.query(
        'SELECT * FROM financial_titles WHERE billing_movement_id = $1 FOR UPDATE',
        [movement.id]
      );

      for (const title of financialTitles.rows) {
        const settlement = await connection.query(
          `SELECT id FROM financial_settlements
            WHERE title_id = $1 AND status = 'ATIVA'
            LIMIT 1`,
          [title.id]
        );

        if (settlement.rowCount) {
          throw new Error(
            `Existe baixa financeira ativa para o título ${title.number}.`
          );
        }

        await connection.query(
          `UPDATE financial_titles
              SET status = 'CANCELADO',
                  open_amount = 0,
                  updated_at = NOW()
            WHERE id = $1`,
          [title.id]
        );
      }

      if (movement.hours_debited_at && !movement.hours_reversed_at) {
        await connection.query(
          `UPDATE clients
              SET used_hours = GREATEST(used_hours - $1, 0),
                  updated_at = NOW()
            WHERE id = $2`,
          [movement.hours_debited, movement.client_id]
        );
      }

      await connection.query(
        `UPDATE rats
            SET billed_at = NULL
          WHERE id IN (
            SELECT rat_id
              FROM billing_movement_items
             WHERE movement_id = $1
               AND rat_id IS NOT NULL
          )`,
        [movement.id]
      );

      await connection.query(
        `UPDATE billing_movements
            SET status = 'CANCELADO',
                hours_reversed_at = CASE
                  WHEN hours_debited_at IS NOT NULL THEN NOW()
                  ELSE hours_reversed_at
                END,
                updated_at = NOW()
          WHERE id = $1`,
        [movement.id]
      );

      await connection.query('COMMIT');

      return res.redirect(
        `/billing/${movement.id}?message=${encodeURIComponent(
          'Movimento cancelado e financeiro estornado com sucesso.'
        )}`
      );
    } catch (error) {
      await connection.query('ROLLBACK');
      return res.redirect(
        `/billing/${req.params.id}?error=${encodeURIComponent(error.message)}`
      );
    } finally {
      connection.release();
    }
  })
);

// ---------------------------------------------------------------------------
// POST /billing/:id/from-rats — importação de RATs
// ---------------------------------------------------------------------------
billingRouter.post(
  '/billing/:id/from-rats',
  ...p,
  asyncRoute(async (req, res) => {
    const ctx = req.session.companyContext || {};
    const companyId = Number(ctx.companyId);
    const branchId = Number(ctx.branchId);
    const movementId = Number(req.params.id);

    if (!Number.isInteger(companyId) || !Number.isInteger(branchId)) {
      return res.redirect(
        `/billing?error=${encodeURIComponent(
          'Contexto de empresa/filial não definido.'
        )}`
      );
    }

    const rawRatIds = req.body.rat_ids;
    const receivedRatIds = Array.isArray(rawRatIds)
      ? rawRatIds
      : rawRatIds
        ? [rawRatIds]
        : [];

    const ratIds = [
      ...new Set(
        receivedRatIds
          .map(Number)
          .filter((v) => Number.isInteger(v) && v > 0)
      ),
    ];

    if (!Number.isInteger(movementId)) {
      return res.redirect(
        `/billing?error=${encodeURIComponent('Movimento inválido.')}`
      );
    }
    if (!ratIds.length) {
      return res.redirect(
        `/billing/${movementId}?error=${encodeURIComponent(
          'Selecione pelo menos um RAT para importar.'
        )}`
      );
    }

    const client = await db.connect();
    try {
      await client.query('BEGIN');

      // Bloqueia o movimento
      const movement = (
        await client.query(
          `SELECT id, number, client_id, status
             FROM billing_movements
            WHERE id = $1 AND company_id = $2 AND branch_id = $3
            FOR UPDATE`,
          [movementId, companyId, branchId]
        )
      ).rows[0];

      if (!movement) {
        throw new Error(
          'Movimento não encontrado para a empresa e filial selecionadas.'
        );
      }
      if (movement.status !== 'RASCUNHO') {
        throw new Error(
          `O movimento ${movement.number} está com status ${movement.status} e não permite importar RATs.`
        );
      }

      // Libera vínculos antigos de movimentos cancelados
      await client.query(
        `DELETE FROM billing_movement_rats bmr
               USING billing_movements bm
               WHERE bm.id = bmr.movement_id
                 AND bmr.rat_id = ANY($1::integer[])
                 AND bm.status = 'CANCELADO'
                 AND bm.company_id = $2
                 AND bm.branch_id = $3`,
        [ratIds, companyId, branchId]
      );

      // Verifica RATs já vinculados a movimentos ativos
      const alreadyLinked = await client.query(
        `SELECT bmr.rat_id,
                r.number AS rat_number,
                bm.id AS movement_id,
                bm.number AS movement_number,
                bm.status AS movement_status
           FROM billing_movement_rats bmr
           JOIN billing_movements bm ON bm.id = bmr.movement_id
           LEFT JOIN rats r ON r.id = bmr.rat_id
          WHERE bmr.rat_id = ANY($1::integer[])
            AND bm.status <> 'CANCELADO'
            AND bm.company_id = $2
            AND bm.branch_id = $3
          ORDER BY r.number`,
        [ratIds, companyId, branchId]
      );

      if (alreadyLinked.rowCount > 0) {
        const details = alreadyLinked.rows
          .map(
            (row) =>
              `${row.rat_number || `ID ${row.rat_id}`} → movimento ${row.movement_number}`
          )
          .join(', ');
        throw new Error(`Os seguintes RATs já estão faturados: ${details}.`);
      }

      // Carrega RATs aprovados
      const ratsResult = await client.query(
        `SELECT r.id, r.number, r.client_id, r.service_date,
                r.billable_minutes, r.activities, r.catalog_item_id,
                ci.id AS item_id,
                ci.code AS item_code,
                ci.description AS item_description,
                ci.item_type,
                ci.unit,
                ci.sale_price AS unit_price,
                ci.ncm,
                ci.cfop,
                ci.nbs_code,
                ci.national_service_code,
                ci.municipality_code
           FROM rats r
           LEFT JOIN catalog_items ci
             ON ci.id = r.catalog_item_id
            AND ci.company_id = r.company_id
            AND ci.branch_id = r.branch_id
          WHERE r.id = ANY($1::integer[])
            AND r.company_id = $2
            AND r.branch_id = $3
            AND r.customer_approved = TRUE
          ORDER BY r.service_date, r.id
          FOR UPDATE OF r`,
        [ratIds, companyId, branchId]
      );

      if (ratsResult.rowCount !== ratIds.length) {
        const foundIds = ratsResult.rows.map((r) => Number(r.id));
        const missing = ratIds.filter((id) => !foundIds.includes(id));
        throw new Error(
          `Os RATs ${missing.join(', ')} não foram encontrados, não estão aprovados ou pertencem a outro contexto.`
        );
      }

      const seqResult = await client.query(
        `SELECT COALESCE(MAX(sequence), 0) AS last_sequence
           FROM billing_movement_items
          WHERE movement_id = $1 AND company_id = $2 AND branch_id = $3`,
        [movementId, companyId, branchId]
      );
      let nextSequence = Number(seqResult.rows[0].last_sequence) + 1;
      let importedCount = 0;

      for (const rat of ratsResult.rows) {
        if (Number(rat.client_id) !== Number(movement.client_id)) {
          throw new Error(`O RAT ${rat.number} pertence a outro cliente.`);
        }
        if (!rat.item_id) {
          throw new Error(`O RAT ${rat.number} não possui item fiscal vinculado.`);
        }

        const billableMinutes = Number(rat.billable_minutes || 0);
        if (billableMinutes <= 0) {
          throw new Error(`O RAT ${rat.number} não possui horas faturáveis.`);
        }

        const quantity = Number((billableMinutes / 60).toFixed(4));
        const unitPrice = Number(rat.unit_price || 0);
        if (unitPrice <= 0) {
          throw new Error(
            `O item fiscal do RAT ${rat.number} não possui preço de venda válido.`
          );
        }

        const itemTotal = Number((quantity * unitPrice).toFixed(2));
        const itemNotes = [
          `Importado do RAT ${rat.number}.`,
          rat.activities ? `Atividades: ${rat.activities}` : null,
        ]
          .filter(Boolean)
          .join(' ');

        await client.query(
          `INSERT INTO billing_movement_items(
             company_id, branch_id, movement_id, sequence, catalog_item_id,
             item_type, code, description, unit, quantity, unit_price, discount,
             total, service_date, notes, ncm, cfop, nbs_code,
             national_service_code, municipality_code
           ) VALUES (
             $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,0,$12,$13,$14,$15,$16,$17,$18,$19
           )`,
          [
            companyId,
            branchId,
            movementId,
            nextSequence,
            rat.item_id,
            rat.item_type || 'SERVICO',
            rat.item_code,
            rat.item_description,
            rat.unit || 'H',
            quantity,
            unitPrice,
            itemTotal,
            rat.service_date,
            itemNotes,
            rat.ncm || null,
            rat.cfop || null,
            rat.nbs_code || null,
            rat.national_service_code || null,
            rat.municipality_code || null,
          ]
        );

        const link = await client.query(
          `INSERT INTO billing_movement_rats(movement_id, rat_id)
           VALUES ($1, $2)
           ON CONFLICT (rat_id) DO NOTHING
           RETURNING rat_id`,
          [movementId, rat.id]
        );
        if (link.rowCount === 0) {
          throw new Error(
            `O RAT ${rat.number} foi associado a outro movimento durante a importação.`
          );
        }

        nextSequence += 1;
        importedCount += 1;
      }

      // Recalcula totais
      await client.query(
        `UPDATE billing_movements bm
            SET service_total = t.service_total,
                product_total = t.product_total,
                discount      = t.discount_total,
                total         = t.net_total,
                updated_at    = NOW()
           FROM (
             SELECT
               COALESCE(SUM(total) FILTER (WHERE item_type='SERVICO'), 0) AS service_total,
               COALESCE(SUM(total) FILTER (WHERE item_type='PRODUTO'), 0) AS product_total,
               COALESCE(SUM(discount), 0) AS discount_total,
               COALESCE(SUM(total), 0) AS net_total
             FROM billing_movement_items
             WHERE movement_id = $1 AND company_id = $2 AND branch_id = $3
             GROUP BY movement_id
           ) t
          WHERE bm.id = $1 AND bm.company_id = $2 AND bm.branch_id = $3`,
        [movementId, companyId, branchId]
      );

      // Histórico
      await client.query(
        `INSERT INTO movement_status_history(
           company_id, branch_id, movement_id, previous_status, new_status,
           operation, message, user_id
         ) VALUES ($1,$2,$3,$4,$4,'IMPORTACAO_RATS',$5,$6)`,
        [
          companyId,
          branchId,
          movementId,
          movement.status,
          `${importedCount} RAT(s) importado(s) para o movimento.`,
          Number(req.session.user.id),
        ]
      );

      await client.query('COMMIT');

      return res.redirect(
        `/billing/${movementId}?message=${encodeURIComponent(
          `${importedCount} RAT(s) importado(s) com sucesso.`
        )}`
      );
    } catch (error) {
      await client.query('ROLLBACK');

      if (
        error.code === '23505' &&
        error.constraint === 'billing_movement_rats_rat_id_key'
      ) {
        return res.redirect(
          `/billing/${movementId}?error=${encodeURIComponent(
            'Um dos RATs selecionados já está vinculado a outro movimento.'
          )}`
        );
      }

      return res.redirect(
        `/billing/${movementId}?error=${encodeURIComponent(
          error.message || 'Não foi possível importar os RATs.'
        )}`
      );
    } finally {
      client.release();
    }
  })
);

// ---------------------------------------------------------------------------
// POST /billing/:id/confirm — confirmação
// ---------------------------------------------------------------------------
billingRouter.post(
  '/billing/:id/confirm',
  ...p,
  asyncRoute(async (req, res) => {
    const connection = await db.connect();
    try {
      await connection.query('BEGIN');

      const movement = (
        await connection.query(
          'SELECT * FROM billing_movements WHERE id = $1 FOR UPDATE',
          [req.params.id]
        )
      ).rows[0];

      if (!movement || Number(movement.total) <= 0) {
        throw new Error('Movimento sem valor.');
      }
      if (movement.status === 'CONFIRMADO') {
        throw new Error('Movimento já confirmado.');
      }
      if (movement.status === 'CANCELADO') {
        throw new Error('Movimento cancelado não pode ser confirmado.');
      }

      await connection.query(
        `UPDATE billing_movements SET status = 'CONFIRMADO', updated_at = NOW() WHERE id = $1`,
        [movement.id]
      );

      await connection.query(
        `INSERT INTO financial_titles(
           title_type, number, description, party_name, party_document,
           partner_id, issue_date, due_date, original_amount, open_amount,
           billing_movement_id, created_by
         )
         SELECT 'R',
                'REC-' || bm.number,
                'Faturamento ' || bm.number,
                cl.corporate_name,
                cl.document,
                cl.id,
                bm.date_issued,
                COALESCE(bm.due_date, bm.date_issued),
                bm.total,
                bm.total,
                bm.id,
                $2
           FROM billing_movements bm
           JOIN clients cl ON cl.id = bm.client_id
          WHERE bm.id = $1
            AND NOT EXISTS (
              SELECT 1 FROM financial_titles f WHERE f.billing_movement_id = bm.id
            )`,
        [movement.id, req.session.user.id]
      );

      await connection.query('COMMIT');
      res.redirect(`/billing/${movement.id}`);
    } catch (error) {
      await connection.query('ROLLBACK');
      throw error;
    } finally {
      connection.release();
    }
  })
);

