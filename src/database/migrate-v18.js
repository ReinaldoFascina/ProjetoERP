import { db } from './db.js';
const sql=`
ALTER TABLE clients ADD COLUMN IF NOT EXISTS partner_type VARCHAR(20) NOT NULL DEFAULT 'CLIENTE';
ALTER TABLE financial_titles ADD COLUMN IF NOT EXISTS partner_id INT REFERENCES clients(id);
ALTER TABLE purchase_movements ADD COLUMN IF NOT EXISTS supplier_id INT REFERENCES clients(id);
CREATE INDEX IF NOT EXISTS idx_clients_partner_type ON clients(partner_type,active);
CREATE INDEX IF NOT EXISTS idx_financial_titles_partner ON financial_titles(partner_id);
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='clients_partner_type_check') THEN
    ALTER TABLE clients ADD CONSTRAINT clients_partner_type_check CHECK(partner_type IN('CLIENTE','FORNECEDOR','AMBOS'));
  END IF;
END $$;
`;
try{await db.query('BEGIN');await db.query(sql);await db.query('COMMIT');console.log('Migração v18 concluída.');}catch(e){await db.query('ROLLBACK');console.error(e);process.exitCode=1;}finally{await db.end();}
