import { db } from './db.js';
const sql=`
ALTER TABLE financial_settlements ADD COLUMN IF NOT EXISTS status VARCHAR(20) NOT NULL DEFAULT 'ATIVA';
ALTER TABLE financial_settlements ADD COLUMN IF NOT EXISTS reversed_at TIMESTAMPTZ;
ALTER TABLE financial_settlements ADD COLUMN IF NOT EXISTS reversed_by INT REFERENCES users(id);
ALTER TABLE financial_settlements ADD COLUMN IF NOT EXISTS reversal_reason TEXT;
ALTER TABLE cash_entries ADD COLUMN IF NOT EXISTS reversed_at TIMESTAMPTZ;
ALTER TABLE cash_entries ADD COLUMN IF NOT EXISTS reversal_entry_id INT REFERENCES cash_entries(id);
CREATE INDEX IF NOT EXISTS idx_financial_settlements_title_status ON financial_settlements(title_id,status);
CREATE UNIQUE INDEX IF NOT EXISTS uq_cash_entries_active_settlement ON cash_entries(settlement_id) WHERE settlement_id IS NOT NULL AND reversed_at IS NULL;
`;
try{await db.query('BEGIN');await db.query(sql);await db.query('COMMIT');console.log('Migração de cancelamento de baixa concluída.');}catch(error){await db.query('ROLLBACK');console.error(error);process.exitCode=1;}finally{await db.end();}
