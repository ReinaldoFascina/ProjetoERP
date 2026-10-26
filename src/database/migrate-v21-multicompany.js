import { db } from './db.js';

const scopedTables = [
  'clients','tickets','appointments','rats','catalog_items',
  'billing_movements','billing_movement_items','billing_movement_rats',
  'cash_accounts','purchase_movements','financial_titles',
  'financial_settlements','cash_entries','bank_statement_entries',
  'bank_reconciliations','fiscal_documents','fiscal_document_transmissions'
];

const client = await db.connect();

async function executeStatements(statements) {
  for (const statement of statements) await client.query(statement);
}

try {
  await client.query('BEGIN');

  await executeStatements([
    `CREATE TABLE IF NOT EXISTS companies(id SERIAL PRIMARY KEY,code VARCHAR(20) UNIQUE NOT NULL,corporate_name VARCHAR(180) NOT NULL,trade_name VARCHAR(180),document VARCHAR(20) UNIQUE,state_registration VARCHAR(40),municipal_registration VARCHAR(40),tax_regime VARCHAR(30) DEFAULT 'SIMPLES_NACIONAL',email VARCHAR(180),phone VARCHAR(30),city VARCHAR(120),state CHAR(2),active BOOLEAN DEFAULT TRUE,created_at TIMESTAMPTZ DEFAULT NOW(),updated_at TIMESTAMPTZ DEFAULT NOW())`,
    `CREATE TABLE IF NOT EXISTS branches(id SERIAL PRIMARY KEY,company_id INT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,code VARCHAR(20) NOT NULL,name VARCHAR(180) NOT NULL,document VARCHAR(20),state_registration VARCHAR(40),municipal_registration VARCHAR(40),city VARCHAR(120),state CHAR(2),active BOOLEAN DEFAULT TRUE,created_at TIMESTAMPTZ DEFAULT NOW(),UNIQUE(company_id,code))`,
    `CREATE TABLE IF NOT EXISTS user_company_access(id SERIAL PRIMARY KEY,user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,company_id INT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,is_default BOOLEAN DEFAULT FALSE,active BOOLEAN DEFAULT TRUE,created_at TIMESTAMPTZ DEFAULT NOW(),UNIQUE(user_id,company_id))`,
    `INSERT INTO companies(code,corporate_name,trade_name,document) VALUES('001','Empresa Principal','Empresa Principal','00000000000000') ON CONFLICT(code) DO NOTHING`,
    `INSERT INTO branches(company_id,code,name,document) SELECT id,'01','Matriz',document FROM companies WHERE code='001' ON CONFLICT(company_id,code) DO NOTHING`,
    `INSERT INTO user_company_access(user_id,company_id,is_default,active) SELECT u.id,c.id,TRUE,TRUE FROM users u CROSS JOIN companies c WHERE c.code='001' ON CONFLICT(user_id,company_id) DO NOTHING`,
    `CREATE OR REPLACE FUNCTION apply_company_context() RETURNS trigger LANGUAGE plpgsql AS $$
     BEGIN
       IF NEW.company_id IS NULL THEN NEW.company_id:=NULLIF(current_setting('app.company_id',true),'')::int; END IF;
       IF NEW.branch_id IS NULL THEN NEW.branch_id:=NULLIF(current_setting('app.branch_id',true),'')::int; END IF;
       IF NEW.company_id IS NULL THEN SELECT id INTO NEW.company_id FROM companies WHERE code='001'; END IF;
       IF NEW.branch_id IS NULL THEN SELECT id INTO NEW.branch_id FROM branches WHERE company_id=NEW.company_id ORDER BY id LIMIT 1; END IF;
       RETURN NEW;
     END $$`
  ]);

  const defaultCompany = (await client.query(`SELECT id FROM companies WHERE code='001'`)).rows[0].id;
  const defaultBranch = (await client.query(`SELECT id FROM branches WHERE company_id=$1 AND code='01'`, [defaultCompany])).rows[0].id;

  for (const table of scopedTables) {
    const exists = (await client.query(`SELECT to_regclass($1) AS name`, [`public.${table}`])).rows[0].name;
    if (!exists) { console.log(`Tabela ${table} não existe; ignorada.`); continue; }

    await client.query(`ALTER TABLE ${table} ADD COLUMN IF NOT EXISTS company_id INT REFERENCES companies(id)`);
    await client.query(`ALTER TABLE ${table} ADD COLUMN IF NOT EXISTS branch_id INT REFERENCES branches(id)`);
    await client.query(`UPDATE ${table} SET company_id=$1 WHERE company_id IS NULL`, [defaultCompany]);
    await client.query(`UPDATE ${table} SET branch_id=$1 WHERE branch_id IS NULL`, [defaultBranch]);
    await client.query(`ALTER TABLE ${table} ALTER COLUMN company_id SET NOT NULL`);
    await client.query(`ALTER TABLE ${table} ALTER COLUMN branch_id SET NOT NULL`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_${table}_company_branch ON ${table}(company_id,branch_id)`);
    await client.query(`DROP TRIGGER IF EXISTS trg_${table}_company_context ON ${table}`);
    await client.query(`CREATE TRIGGER trg_${table}_company_context BEFORE INSERT ON ${table} FOR EACH ROW EXECUTE FUNCTION apply_company_context()`);
    await client.query(`ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY`);
    await client.query(`ALTER TABLE ${table} FORCE ROW LEVEL SECURITY`);
    await client.query(`DROP POLICY IF EXISTS p_${table}_context ON ${table}`);
    await client.query(`CREATE POLICY p_${table}_context ON ${table} USING (NULLIF(current_setting('app.company_id',true),'') IS NULL OR (company_id=NULLIF(current_setting('app.company_id',true),'')::int AND branch_id=NULLIF(current_setting('app.branch_id',true),'')::int)) WITH CHECK (NULLIF(current_setting('app.company_id',true),'') IS NULL OR (company_id=NULLIF(current_setting('app.company_id',true),'')::int AND branch_id=NULLIF(current_setting('app.branch_id',true),'')::int))`);
    console.log(`Tabela ${table} preparada para multiempresa.`);
  }

  await client.query('COMMIT');
  console.log('Migração multiempresa concluída.');
} catch (error) {
  await client.query('ROLLBACK');
  console.error('Falha na migração multiempresa:', error);
  process.exitCode = 1;
} finally {
  client.release();
  await db.end();
}
