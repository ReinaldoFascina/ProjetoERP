import { Router } from 'express';
import { db } from '../database/db.js';
import { requireAuth, allow } from '../middleware/auth.js';

export const financeRouter = Router();
const permission = [requireAuth, allow('ADMIN', 'COORDENADOR')];

// ---------------------------------------------------------------------------
// Listagem de títulos financeiros
// ---------------------------------------------------------------------------
financeRouter.get('/finance', ...permission, async (req, res) => {
  const [titles, summary, settlements] = await Promise.all([
    db.query(`SELECT * FROM financial_titles ORDER BY due_date, id`),
    db.query(`SELECT
        COALESCE(SUM(open_amount) FILTER (WHERE title_type='R' AND status IN ('ABERTO','PARCIAL')),0) AS receivable,
        COALESCE(SUM(open_amount) FILTER (WHERE title_type='P' AND status IN ('ABERTO','PARCIAL')),0) AS payable
      FROM financial_titles`),
    db.query(`SELECT
        COALESCE(SUM(net_amount) FILTER (WHERE f.title_type='R'),0) AS received,
        COALESCE(SUM(net_amount) FILTER (WHERE f.title_type='P'),0) AS paid
      FROM financial_settlements s
      JOIN financial_titles f ON f.id = s.title_id
      WHERE s.status = 'ATIVA'`),
  ]);
  res.render('finance/list', {
    titles: titles.rows,
    summary: summary.rows[0],
    settlements: settlements.rows[0],
    filters: {},
  });
});

// ---------------------------------------------------------------------------
// Criação de título
// ---------------------------------------------------------------------------
financeRouter.get('/finance/new', ...permission, async (req, res) => {
  const { rows: partners } = await db.query(
    `SELECT * FROM clients WHERE active = TRUE ORDER BY corporate_name`
  );
  res.render('finance/title-form', { partners });
});

financeRouter.post('/finance', ...permission, async (req, res) => {
  const b = req.body;

  if (!['R', 'P'].includes(b.title_type)) {
    return res.status(400).render('error', { message: 'Tipo de título inválido.' });
  }

  const partner = (
    await db.query('SELECT * FROM clients WHERE id = $1 AND active = TRUE', [b.partner_id])
  ).rows[0];

  if (!partner) {
    return res.status(400).render('error', { message: 'Selecione uma pessoa válida.' });
  }

  // Para títulos a pagar, exigir que o parceiro seja fornecedor (ou ambos).
  if (
    b.title_type === 'P' &&
    !['FORNECEDOR', 'AMBOS'].includes(partner.partner_type)
  ) {
    return res.status(400).render('error', {
      message: 'Para títulos a pagar, selecione um fornecedor.',
    });
  }

  const amount = Number(b.amount);
  if (!Number.isFinite(amount) || amount <= 0) {
    return res.status(400).render('error', { message: 'Valor inválido.' });
  }

  const number = `FIN-${Date.now()}`;
  await db.query(
    `INSERT INTO financial_titles(
        title_type, number, description, party_name, party_document, partner_id,
        issue_date, due_date, original_amount, open_amount, created_by
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$9,$10)`,
    [
      b.title_type,
      number,
      b.description,
      partner.corporate_name,
      partner.document,
      partner.id,
      b.issue_date,
      b.due_date,
      amount,
      req.session.user.id,
    ]
  );
  res.redirect('/finance');
});

// ---------------------------------------------------------------------------
// Detalhe do título + baixas
// ---------------------------------------------------------------------------
financeRouter.get('/finance/:id', ...permission, async (req, res) => {
  const [title, settlements, accounts] = await Promise.all([
    db.query('SELECT * FROM financial_titles WHERE id = $1', [req.params.id]),
    db.query(
      `SELECT s.*, a.name AS cash_account_name,
              COALESCE(e.reconciled, FALSE) AS reconciled,
              e.id AS cash_entry_id
         FROM financial_settlements s
         JOIN cash_accounts a ON a.id = s.cash_account_id
         LEFT JOIN cash_entries e ON e.settlement_id = s.id AND e.reversed_at IS NULL
        WHERE s.title_id = $1
        ORDER BY s.created_at DESC`,
      [req.params.id]
    ),
    db.query('SELECT * FROM cash_accounts WHERE active = TRUE ORDER BY name'),
  ]);

  if (!title.rows[0]) {
    return res.status(404).render('error', { message: 'Título não encontrado.' });
  }

  res.render('finance/detail', {
    title: title.rows[0],
    settlements: settlements.rows,
    accounts: accounts.rows,
    message: req.query.message || '',
    error: req.query.error || '',
  });
});

// ---------------------------------------------------------------------------
// Baixa (settle)
// ---------------------------------------------------------------------------
financeRouter.post('/finance/:id/settle', ...permission, async (req, res, next) => {
  const connection = await db.connect();
  try {
    await connection.query('BEGIN');

    const title = (
      await connection.query(
        'SELECT * FROM financial_titles WHERE id = $1 FOR UPDATE',
        [req.params.id]
      )
    ).rows[0];

    if (!title || !['ABERTO', 'PARCIAL'].includes(title.status)) {
      throw new Error('Título não está disponível para baixa.');
    }

    const amount = Number(req.body.amount);
    const discount = Number(req.body.discount || 0);
    const interest = Number(req.body.interest || 0);
    const penalty = Number(req.body.penalty || 0);

    if (!Number.isFinite(amount) || amount <= 0 || amount > Number(title.open_amount)) {
      throw new Error('Valor de baixa inválido.');
    }

    const net = amount - discount + interest + penalty;
    if (net <= 0) {
      throw new Error('Valor líquido da baixa deve ser maior que zero.');
    }

    // Valida que a conta de caixa existe e está ativa.
    const account = (
      await connection.query(
        'SELECT id FROM cash_accounts WHERE id = $1 AND active = TRUE',
        [req.body.cash_account_id]
      )
    ).rows[0];
    if (!account) {
      throw new Error('Conta de caixa inválida ou inativa.');
    }

    const settlement = (
      await connection.query(
        `INSERT INTO financial_settlements(
            title_id, cash_account_id, settlement_date, amount, discount,
            interest, penalty, net_amount, document_number, notes, status, created_by
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'ATIVA',$11)
         RETURNING id`,
        [
          title.id,
          req.body.cash_account_id,
          req.body.settlement_date,
          amount,
          discount,
          interest,
          penalty,
          net,
          req.body.document_number || null,
          req.body.notes || null,
          req.session.user.id,
        ]
      )
    ).rows[0];

    await connection.query(
      `INSERT INTO cash_entries(
          cash_account_id, entry_date, entry_type, amount, description,
          document_number, settlement_id, reconciled
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,FALSE)`,
      [
        req.body.cash_account_id,
        req.body.settlement_date,
        title.title_type === 'R' ? 'C' : 'D',
        net,
        `Baixa ${title.number} - ${title.description}`,
        req.body.document_number || title.number,
        settlement.id,
      ]
    );

    const openAmount = Number(title.open_amount) - amount;
    await connection.query(
      `UPDATE financial_titles
          SET open_amount = $1, status = $2, updated_at = NOW()
        WHERE id = $3`,
      [openAmount, openAmount === 0 ? 'BAIXADO' : 'PARCIAL', title.id]
    );

    await connection.query('COMMIT');
    res.redirect(
      `/finance/${title.id}?message=${encodeURIComponent('Baixa realizada com sucesso.')}`
    );
  } catch (error) {
    await connection.query('ROLLBACK');
    next(error);
  } finally {
    connection.release();
  }
});

// ---------------------------------------------------------------------------
// Cancelamento de baixa
// ---------------------------------------------------------------------------
financeRouter.post(
  '/finance/settlements/:id/cancel',
  ...permission,
  async (req, res, next) => {
    const connection = await db.connect();
    try {
      await connection.query('BEGIN');

      const settlement = (
        await connection.query(
          `SELECT s.*, f.number AS title_number, f.original_amount, f.open_amount
             FROM financial_settlements s
             JOIN financial_titles f ON f.id = s.title_id
            WHERE s.id = $1
            FOR UPDATE OF s, f`,
          [req.params.id]
        )
      ).rows[0];

      if (!settlement) throw new Error('Baixa não encontrada.');
      if (settlement.status === 'CANCELADA' || settlement.reversed_at) {
        throw new Error('Esta baixa já foi cancelada.');
      }

      const entry = (
        await connection.query(
          `SELECT * FROM cash_entries
            WHERE settlement_id = $1 AND reversed_at IS NULL
            FOR UPDATE`,
          [settlement.id]
        )
      ).rows[0];
      if (!entry) throw new Error('Lançamento de caixa da baixa não encontrado.');
      if (entry.reconciled) {
        throw new Error('Desfaça a conciliação bancária antes de cancelar a baixa.');
      }

      const reason = String(req.body.reason || '').trim();
      if (reason.length < 5) {
        throw new Error('Informe o motivo do cancelamento com pelo menos 5 caracteres.');
      }

      const reversal = (
        await connection.query(
          `INSERT INTO cash_entries(
              cash_account_id, entry_date, entry_type, amount, description,
              document_number, reconciled
           ) VALUES ($1, CURRENT_DATE, $2, $3, $4, $5, FALSE)
           RETURNING id`,
          [
            entry.cash_account_id,
            entry.entry_type === 'C' ? 'D' : 'C',
            entry.amount,
            `Estorno da baixa ${settlement.id} - ${settlement.title_number}`,
            entry.document_number || settlement.title_number,
          ]
        )
      ).rows[0];

      await connection.query(
        'UPDATE cash_entries SET reversed_at = NOW(), reversal_entry_id = $1 WHERE id = $2',
        [reversal.id, entry.id]
      );

      await connection.query(
        `UPDATE financial_settlements
            SET status = 'CANCELADA', reversed_at = NOW(), reversed_by = $1, reversal_reason = $2
          WHERE id = $3`,
        [req.session.user.id, reason, settlement.id]
      );

      // Recalcula o saldo em aberto a partir das baixas ATIVAS remanescentes.
      const activeSum = (
        await connection.query(
          `SELECT COALESCE(SUM(amount), 0) AS total
             FROM financial_settlements
            WHERE title_id = $1 AND status = 'ATIVA'`,
          [settlement.title_id]
        )
      ).rows[0].total;

      const original = Number(settlement.original_amount);
      const restored = Math.max(0, original - Number(activeSum));

      await connection.query(
        `UPDATE financial_titles
            SET open_amount = $1, status = $2, updated_at = NOW()
          WHERE id = $3`,
        [restored, restored >= original ? 'ABERTO' : 'PARCIAL', settlement.title_id]
      );

      await connection.query('COMMIT');
      res.redirect(
        `/finance/${settlement.title_id}?message=${encodeURIComponent(
          'Baixa cancelada e processo revertido com sucesso.'
        )}`
      );
    } catch (error) {
      await connection.query('ROLLBACK');
      next(error);
    } finally {
      connection.release();
    }
  }
);

// ---------------------------------------------------------------------------
// Contas de caixa
// ---------------------------------------------------------------------------
financeRouter.get('/cash-accounts', ...permission, async (req, res) => {
  const { rows } = await db.query(
    `SELECT a.*,
            a.opening_balance + COALESCE(
              SUM(CASE WHEN e.entry_type = 'C' THEN e.amount ELSE -e.amount END), 0
            ) AS balance
       FROM cash_accounts a
       LEFT JOIN cash_entries e ON e.cash_account_id = a.id
      GROUP BY a.id
      ORDER BY a.name`
  );
  res.render('finance/accounts', { accounts: rows });
});

financeRouter.post('/cash-accounts', ...permission, async (req, res) => {
  const b = req.body;
  await db.query(
    `INSERT INTO cash_accounts(code, name, account_type, bank_code, agency, account_number, opening_balance)
     VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [
      b.code,
      b.name,
      b.account_type,
      b.bank_code || null,
      b.agency || null,
      b.account_number || null,
      Number(b.opening_balance || 0),
    ]
  );
  res.redirect('/cash-accounts');
});

// ---------------------------------------------------------------------------
// Extrato de caixa
// ---------------------------------------------------------------------------
financeRouter.get('/cash-extract', ...permission, async (req, res) => {
  const [entries, accounts] = await Promise.all([
    db.query(
      `SELECT e.*, a.name AS account_name
         FROM cash_entries e
         JOIN cash_accounts a ON a.id = e.cash_account_id
        ORDER BY entry_date DESC, e.id DESC`
    ),
    db.query('SELECT * FROM cash_accounts ORDER BY name'),
  ]);
  res.render('finance/extract', {
    entries: entries.rows,
    accounts: accounts.rows,
    filters: {},
  });
});

// ---------------------------------------------------------------------------
// Compras (fornecedores)
// ---------------------------------------------------------------------------
financeRouter.get('/purchases/new', ...permission, async (req, res) => {
  const [ c, i ] = await Promise.all([
    db.query(
      `SELECT * FROM clients
        WHERE active = TRUE AND partner_type IN ('FORNECEDOR', 'AMBOS')
        ORDER BY corporate_name`
    ),
    db.query('SELECT * FROM catalog_items WHERE active=TRUE ORDER BY description'),
  ]);
  res.render('finance/purchase-form', { suppliers: c.rows, catalogItems: i.rows });
});

financeRouter.post('/purchases', ...permission, async (req, res, next) => {
  const b = req.body;
  const connection = await db.connect();
  try {
    await connection.query('BEGIN');

    const supplier = (
      await connection.query(
        `SELECT * FROM clients
          WHERE id = $1 AND active = TRUE
            AND partner_type IN ('FORNECEDOR', 'AMBOS')`,
        [b.supplier_id]
      )
    ).rows[0];

    if (!supplier) {
      throw new Error('Fornecedor inválido.');
    }

    const total = Number(b.total);
    if (!Number.isFinite(total) || total <= 0) {
      throw new Error('Valor total inválido.');
    }

    const number = `ENT-${Date.now()}`;

    const movement = (
      await connection.query(
        `INSERT INTO purchase_movements(
            number, supplier_id, supplier_name, supplier_document,
            document_type, document_number, issue_date, entry_date,
            due_date, total, notes, created_by
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
         RETURNING id`,
        [
          number,
          supplier.id,
          supplier.corporate_name,
          supplier.document,
          b.document_type,
          b.document_number,
          b.issue_date,
          b.entry_date,
          b.due_date,
          total,
          b.notes || null,
          req.session.user.id,
        ]
      )
    ).rows[0];

    await connection.query(
      `INSERT INTO financial_titles(
          title_type, number, description, party_name, party_document, partner_id,
          issue_date, due_date, original_amount, open_amount,
          purchase_movement_id, created_by
       ) VALUES ('P',$1,$2,$3,$4,$5,$6,$7,$8,$8,$9,$10)`,
      [
        `PAG-${Date.now()}`,
        `${b.document_type} ${b.document_number}`,
        supplier.corporate_name,
        supplier.document,
        supplier.id,
        b.issue_date,
        b.due_date,
        total,
        movement.id,
        req.session.user.id,
      ]
    );

    await connection.query('COMMIT');
    res.redirect('/finance');
  } catch (error) {
    await connection.query('ROLLBACK');
    next(error);
  } finally {
    connection.release();
  }
});

// ---------------------------------------------------------------------------
// Conciliação bancária (stub — implementar consultas reais)
// ---------------------------------------------------------------------------
financeRouter.get('/reconciliation', ...permission, async (req, res) => {
  res.render('finance/reconciliation', { bank: [], cash: [], accounts: [] });
});