import { db } from './db.js';

const client = await db.connect();
try {
  await client.query('BEGIN');

  await client.query(`ALTER TABLE fiscal_documents ADD COLUMN IF NOT EXISTS branch_id INT`);
  await client.query(`ALTER TABLE fiscal_documents ADD COLUMN IF NOT EXISTS provider VARCHAR(40)`);
  await client.query(`ALTER TABLE fiscal_documents ADD COLUMN IF NOT EXISTS provider_document_id VARCHAR(120)`);
  await client.query(`ALTER TABLE fiscal_documents ADD COLUMN IF NOT EXISTS request_payload JSONB`);
  await client.query(`ALTER TABLE fiscal_documents ADD COLUMN IF NOT EXISTS response_payload JSONB`);
  await client.query(`ALTER TABLE fiscal_documents ADD COLUMN IF NOT EXISTS created_by INT REFERENCES users(id)`);
  await client.query(`ALTER TABLE fiscal_documents ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMPTZ`);
  await client.query(`ALTER TABLE fiscal_documents ADD COLUMN IF NOT EXISTS cancelled_by INT REFERENCES users(id)`);
  await client.query(`ALTER TABLE fiscal_documents ADD COLUMN IF NOT EXISTS cancellation_reason TEXT`);

  await client.query(`ALTER TABLE fiscal_document_transmissions ADD COLUMN IF NOT EXISTS branch_id INT`);
  await client.query(`ALTER TABLE fiscal_document_transmissions ADD COLUMN IF NOT EXISTS provider VARCHAR(40)`);

  const defaultBranch = (await client.query(`SELECT id FROM branches ORDER BY id LIMIT 1`)).rows[0];
  if (!defaultBranch) throw new Error('Cadastre ao menos uma filial antes de instalar o módulo NFS-e.');

  await client.query(`
    UPDATE fiscal_documents fd
       SET branch_id = COALESCE(
         (SELECT bm.branch_id FROM billing_movements bm WHERE bm.id=fd.movement_id),
         $1
       )
     WHERE fd.branch_id IS NULL
  `, [defaultBranch.id]);

  await client.query(`
    UPDATE fiscal_document_transmissions t
       SET branch_id = COALESCE(
         (SELECT fd.branch_id FROM fiscal_documents fd WHERE fd.id=t.fiscal_document_id),
         $1
       )
     WHERE t.branch_id IS NULL
  `, [defaultBranch.id]);

  await client.query(`ALTER TABLE fiscal_documents ALTER COLUMN company_id SET NOT NULL`);
  await client.query(`ALTER TABLE fiscal_documents ALTER COLUMN branch_id SET NOT NULL`);
  await client.query(`ALTER TABLE fiscal_document_transmissions ALTER COLUMN company_id SET NOT NULL`);
  await client.query(`ALTER TABLE fiscal_document_transmissions ALTER COLUMN branch_id SET NOT NULL`);

  await client.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS uq_nfse_movement_context
      ON fiscal_documents(company_id,branch_id,movement_id)
      WHERE document_type='NFSE'
  `);
  await client.query(`
    CREATE INDEX IF NOT EXISTS idx_nfse_context_status
      ON fiscal_documents(company_id,branch_id,status,created_at DESC)
      WHERE document_type='NFSE'
  `);
  await client.query(`
    CREATE INDEX IF NOT EXISTS idx_nfse_transmission_context
      ON fiscal_document_transmissions(company_id,branch_id,fiscal_document_id,created_at DESC)
  `);

  await client.query(`ALTER TABLE fiscal_documents ENABLE ROW LEVEL SECURITY`);
  await client.query(`ALTER TABLE fiscal_documents FORCE ROW LEVEL SECURITY`);
  await client.query(`DROP POLICY IF EXISTS p_fiscal_documents_context ON fiscal_documents`);
  await client.query(`
    CREATE POLICY p_fiscal_documents_context ON fiscal_documents
    USING (
      NULLIF(current_setting('app.company_id',TRUE),'') IS NULL OR
      (company_id=NULLIF(current_setting('app.company_id',TRUE),'')::INT AND
       branch_id=NULLIF(current_setting('app.branch_id',TRUE),'')::INT)
    )
    WITH CHECK (
      NULLIF(current_setting('app.company_id',TRUE),'') IS NULL OR
      (company_id=NULLIF(current_setting('app.company_id',TRUE),'')::INT AND
       branch_id=NULLIF(current_setting('app.branch_id',TRUE),'')::INT)
    )
  `);

  await client.query(`ALTER TABLE fiscal_document_transmissions ENABLE ROW LEVEL SECURITY`);
  await client.query(`ALTER TABLE fiscal_document_transmissions FORCE ROW LEVEL SECURITY`);
  await client.query(`DROP POLICY IF EXISTS p_fiscal_document_transmissions_context ON fiscal_document_transmissions`);
  await client.query(`
    CREATE POLICY p_fiscal_document_transmissions_context ON fiscal_document_transmissions
    USING (
      NULLIF(current_setting('app.company_id',TRUE),'') IS NULL OR
      (company_id=NULLIF(current_setting('app.company_id',TRUE),'')::INT AND
       branch_id=NULLIF(current_setting('app.branch_id',TRUE),'')::INT)
    )
    WITH CHECK (
      NULLIF(current_setting('app.company_id',TRUE),'') IS NULL OR
      (company_id=NULLIF(current_setting('app.company_id',TRUE),'')::INT AND
       branch_id=NULLIF(current_setting('app.branch_id',TRUE),'')::INT)
    )
  `);

  await client.query('COMMIT');
  console.log('Módulo de emissão NFS-e multiempresa instalado.');
} catch (error) {
  await client.query('ROLLBACK');
  console.error('Falha na instalação do módulo NFS-e:', error);
  process.exitCode = 1;
} finally {
  client.release();
  await db.end();
}
