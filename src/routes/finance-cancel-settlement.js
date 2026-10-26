import { Router } from 'express';
import { db } from '../database/db.js';
import { requireAuth, allow } from '../middleware/auth.js';

export const financeCancelSettlementRouter = Router();
const permission = [requireAuth, allow('ADMIN', 'COORDENADOR')];

financeCancelSettlementRouter.post(
  '/finance/settlements/:id/cancel',
  ...permission,
  async (req, res, next) => {
    const connection = await db.connect();

    try {
      await connection.query('BEGIN');

      const settlement = (
        await connection.query(
          `SELECT s.*, f.title_type, f.number AS title_number,
                  f.original_amount, f.open_amount, f.status AS title_status
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

      const cashEntry = (
        await connection.query(
          `SELECT *
             FROM cash_entries
            WHERE settlement_id = $1
              AND reversed_at IS NULL
            FOR UPDATE`,
          [settlement.id]
        )
      ).rows[0];

      if (!cashEntry) {
        throw new Error('Lançamento de caixa ativo da baixa não encontrado.');
      }

      if (cashEntry.reconciled) {
        throw new Error(
          'A baixa possui lançamento conciliado. Desfaça a conciliação bancária antes de cancelar.'
        );
      }

      const reason = String(req.body.reason || '').trim();
      if (reason.length < 5) {
        throw new Error('Informe o motivo do cancelamento com pelo menos 5 caracteres.');
      }

      const reversalType = cashEntry.entry_type === 'C' ? 'D' : 'C';
      const reversal = (
        await connection.query(
          `INSERT INTO cash_entries (
             cash_account_id, entry_date, entry_type, amount,
             description, document_number, reconciled, created_at
           ) VALUES ($1, CURRENT_DATE, $2, $3, $4, $5, FALSE, NOW())
           RETURNING id`,
          [
            cashEntry.cash_account_id,
            reversalType,
            cashEntry.amount,
            `Estorno da baixa ${settlement.id} - ${settlement.title_number}`,
            cashEntry.document_number || settlement.title_number,
          ]
        )
      ).rows[0];

      await connection.query(
        `UPDATE cash_entries
            SET reversed_at = NOW(), reversal_entry_id = $1
          WHERE id = $2`,
        [reversal.id, cashEntry.id]
      );

      await connection.query(
        `UPDATE financial_settlements
            SET status = 'CANCELADA',
                reversed_at = NOW(),
                reversed_by = $1,
                reversal_reason = $2
          WHERE id = $3`,
        [req.session.user.id, reason, settlement.id]
      );

      const restoredOpenAmount = Math.min(
        Number(settlement.original_amount),
        Number(settlement.open_amount) + Number(settlement.amount)
      );

      const restoredStatus =
        restoredOpenAmount >= Number(settlement.original_amount)
          ? 'ABERTO'
          : 'PARCIAL';

      await connection.query(
        `UPDATE financial_titles
            SET open_amount = $1,
                status = $2,
                updated_at = NOW()
          WHERE id = $3`,
        [restoredOpenAmount, restoredStatus, settlement.title_id]
      );

      await connection.query('COMMIT');
      res.redirect(`/finance/${settlement.title_id}?message=${encodeURIComponent('Baixa cancelada e saldo revertido com sucesso.')}`);
    } catch (error) {
      await connection.query('ROLLBACK');
      next(error);
    } finally {
      connection.release();
    }
  }
);
