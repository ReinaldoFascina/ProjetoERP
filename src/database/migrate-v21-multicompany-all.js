import { db } from './db.js';

/*
 * Migração multiempresa completa baseada no inventário real do banco.
 *
 * Tabelas globais:
 *   companies, branches, users, technician_profiles,
 *   user_company_access, user_branch_access.
 *
 * Tabelas operacionais:
 *   recebem company_id + branch_id, chave composta, trigger e RLS.
 */

const operationalTables = [
  'appointments',
  'bank_reconciliations',
  'bank_statement_entries',
  'billing_movement_items',
  'billing_movement_rats',
  'billing_movements',
  'cash_accounts',
  'cash_entries',
  'catalog_items',
  'clients',
  'financial_settlements',
  'financial_titles',
  'fiscal_document_transmissions',
  'fiscal_documents',
  'nfse_transmissions',
  'purchase_movements',
  'rats',
  'tickets',
];

const scopedUniqueConstraints = [
  { table: 'billing_movements', constraint: 'billing_movements_number_key', columns: ['company_id', 'branch_id', 'number'] },
  { table: 'cash_accounts', constraint: 'cash_accounts_code_key', columns: ['company_id', 'branch_id', 'code'] },
  { table: 'catalog_items', constraint: 'catalog_items_code_key', columns: ['company_id', 'branch_id', 'code'] },
  { table: 'financial_titles', constraint: 'financial_titles_number_key', columns: ['company_id', 'branch_id', 'number'] },
  { table: 'purchase_movements', constraint: 'purchase_movements_number_key', columns: ['company_id', 'branch_id', 'number'] },
  { table: 'rats', constraint: 'rats_number_key', columns: ['company_id', 'branch_id', 'number'] },
  { table: 'tickets', constraint: 'tickets_number_key', columns: ['company_id', 'branch_id', 'number'] },
];

const client = await db.connect();

function quoteIdentifier(value) {
  return `"${String(value).replaceAll('"', '""')}"`;
}

async function tableExists(table) {
  const result = await client.query('SELECT to_regclass($1) AS name', [`public.${table}`]);
  return Boolean(result.rows[0]?.name);
}

async function constraintExists(table, constraint) {
  const result = await client.query(
    `SELECT 1
       FROM pg_constraint c
       JOIN pg_class t ON t.oid = c.conrelid
       JOIN pg_namespace n ON n.oid = t.relnamespace
      WHERE n.nspname = 'public'
        AND t.relname = $1
        AND c.conname = $2`,
    [table, constraint]
  );
  return result.rowCount > 0;
}

async function indexExists(indexName) {
  const result = await client.query(
    `SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname=$1`,
    [indexName]
  );
  return result.rowCount > 0;
}

try {
  await client.query('BEGIN');

  // 1. Estrutura global de empresa, filial e permissões.
  await client.query(`
    CREATE TABLE IF NOT EXISTS companies (
      id SERIAL PRIMARY KEY,
      code VARCHAR(20) UNIQUE NOT NULL,
      corporate_name VARCHAR(180) NOT NULL,
      trade_name VARCHAR(180),
      document VARCHAR(20) UNIQUE,
      state_registration VARCHAR(40),
      municipal_registration VARCHAR(40),
      tax_regime VARCHAR(30) DEFAULT 'SIMPLES_NACIONAL',
      email VARCHAR(180),
      phone VARCHAR(30),
      city VARCHAR(120),
      state CHAR(2),
      active BOOLEAN DEFAULT TRUE,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  await client.query(`
    CREATE TABLE IF NOT EXISTS branches (
      id SERIAL PRIMARY KEY,
      company_id INT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
      code VARCHAR(20) NOT NULL,
      name VARCHAR(180) NOT NULL,
      document VARCHAR(20),
      state_registration VARCHAR(40),
      municipal_registration VARCHAR(40),
      city VARCHAR(120),
      state CHAR(2),
      active BOOLEAN DEFAULT TRUE,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(company_id, code)
    )
  `);

  // Permite chave estrangeira composta (company_id, branch_id).
  await client.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS uq_branches_company_id_id
    ON branches(company_id, id)
  `);

  await client.query(`
    CREATE TABLE IF NOT EXISTS user_company_access (
      id SERIAL PRIMARY KEY,
      user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      company_id INT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
      is_default BOOLEAN DEFAULT FALSE,
      active BOOLEAN DEFAULT TRUE,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(user_id, company_id)
    )
  `);

  await client.query(`
    CREATE TABLE IF NOT EXISTS user_branch_access (
      id BIGSERIAL PRIMARY KEY,
      user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      company_id INT NOT NULL,
      branch_id INT NOT NULL,
      is_default BOOLEAN NOT NULL DEFAULT FALSE,
      active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CONSTRAINT fk_user_branch_access_branch
        FOREIGN KEY(company_id, branch_id)
        REFERENCES branches(company_id, id)
        ON DELETE CASCADE,
      UNIQUE(user_id, company_id, branch_id)
    )
  `);

  // 2. Contexto padrão para preservar os registros existentes.
  await client.query(`
    INSERT INTO companies(code, corporate_name, trade_name, document)
    VALUES('001', 'Empresa Principal', 'Empresa Principal', '00000000000000')
    ON CONFLICT(code) DO NOTHING
  `);

  const defaultCompany = (
    await client.query(`SELECT id FROM companies WHERE code='001'`)
  ).rows[0];

  if (!defaultCompany) throw new Error('Empresa padrão 001 não localizada.');

  await client.query(`
    INSERT INTO branches(company_id, code, name, document)
    SELECT id, '01', 'Matriz', document
      FROM companies
     WHERE code='001'
    ON CONFLICT(company_id, code) DO NOTHING
  `);

  const defaultBranch = (
    await client.query(
      `SELECT id FROM branches WHERE company_id=$1 AND code='01'`,
      [defaultCompany.id]
    )
  ).rows[0];

  if (!defaultBranch) throw new Error('Filial padrão 01 não localizada.');

  await client.query(`
    INSERT INTO user_company_access(user_id, company_id, is_default, active)
    SELECT u.id, $1, TRUE, TRUE
      FROM users u
    ON CONFLICT(user_id, company_id)
    DO UPDATE SET active=TRUE
  `, [defaultCompany.id]);

  await client.query(`
    INSERT INTO user_branch_access(user_id, company_id, branch_id, is_default, active)
    SELECT u.id, $1, $2, TRUE, TRUE
      FROM users u
    ON CONFLICT(user_id, company_id, branch_id)
    DO UPDATE SET active=TRUE
  `, [defaultCompany.id, defaultBranch.id]);

  // 3. Função que preenche e valida o contexto em novos registros.
  await client.query(`
    CREATE OR REPLACE FUNCTION apply_company_branch_context()
    RETURNS trigger
    LANGUAGE plpgsql
    AS $$
    DECLARE
      context_company INT;
      context_branch INT;
    BEGIN
      context_company := NULLIF(current_setting('app.company_id', TRUE), '')::INT;
      context_branch := NULLIF(current_setting('app.branch_id', TRUE), '')::INT;

      NEW.company_id := COALESCE(NEW.company_id, context_company);
      NEW.branch_id := COALESCE(NEW.branch_id, context_branch);

      IF NEW.company_id IS NULL THEN
        SELECT id INTO NEW.company_id FROM companies WHERE code='001';
      END IF;

      IF NEW.branch_id IS NULL THEN
        SELECT id INTO NEW.branch_id
          FROM branches
         WHERE company_id=NEW.company_id
           AND active=TRUE
         ORDER BY id
         LIMIT 1;
      END IF;

      IF NOT EXISTS (
        SELECT 1 FROM branches
         WHERE id=NEW.branch_id
           AND company_id=NEW.company_id
           AND active=TRUE
      ) THEN
        RAISE EXCEPTION 'Filial % não pertence à empresa % ou está inativa',
          NEW.branch_id, NEW.company_id;
      END IF;

      RETURN NEW;
    END;
    $$
  `);

  // 4. Acrescenta e consolida contexto em todas as tabelas operacionais.
  for (const table of operationalTables) {
    if (!(await tableExists(table))) {
      console.log(`Tabela ${table} não existe; ignorada.`);
      continue;
    }

    const tableSql = quoteIdentifier(table);

    await client.query(`ALTER TABLE ${tableSql} ADD COLUMN IF NOT EXISTS company_id INT`);
    await client.query(`ALTER TABLE ${tableSql} ADD COLUMN IF NOT EXISTS branch_id INT`);

    // Mantém company_id já existente; preenche somente os nulos.
    await client.query(
      `UPDATE ${tableSql} SET company_id=$1 WHERE company_id IS NULL`,
      [defaultCompany.id]
    );

    // Para cada empresa usa sua primeira filial ativa; cai na filial padrão se necessário.
    await client.query(
      `UPDATE ${tableSql} t
          SET branch_id = COALESCE(
            (SELECT b.id FROM branches b
              WHERE b.company_id=t.company_id AND b.active=TRUE
              ORDER BY b.id LIMIT 1),
            $1
          )
        WHERE branch_id IS NULL`,
      [defaultBranch.id]
    );

    await client.query(`ALTER TABLE ${tableSql} ALTER COLUMN company_id SET NOT NULL`);
    await client.query(`ALTER TABLE ${tableSql} ALTER COLUMN branch_id SET NOT NULL`);

    const oldCompanyFk = `${table}_company_id_fkey`;
    if (await constraintExists(table, oldCompanyFk)) {
      await client.query(`ALTER TABLE ${tableSql} DROP CONSTRAINT ${quoteIdentifier(oldCompanyFk)}`);
    }

    const contextFk = `fk_${table}_company_branch`;
    if (!(await constraintExists(table, contextFk))) {
      await client.query(`
        ALTER TABLE ${tableSql}
        ADD CONSTRAINT ${quoteIdentifier(contextFk)}
        FOREIGN KEY(company_id, branch_id)
        REFERENCES branches(company_id, id)
        ON DELETE RESTRICT
      `);
    }

    await client.query(`
      CREATE INDEX IF NOT EXISTS ${quoteIdentifier(`idx_${table}_company_branch`)}
      ON ${tableSql}(company_id, branch_id)
    `);

    await client.query(`DROP TRIGGER IF EXISTS ${quoteIdentifier(`trg_${table}_company_branch`)} ON ${tableSql}`);
    await client.query(`
      CREATE TRIGGER ${quoteIdentifier(`trg_${table}_company_branch`)}
      BEFORE INSERT OR UPDATE OF company_id, branch_id
      ON ${tableSql}
      FOR EACH ROW
      EXECUTE FUNCTION apply_company_branch_context()
    `);

    await client.query(`ALTER TABLE ${tableSql} ENABLE ROW LEVEL SECURITY`);
    await client.query(`ALTER TABLE ${tableSql} FORCE ROW LEVEL SECURITY`);
    await client.query(`DROP POLICY IF EXISTS ${quoteIdentifier(`p_${table}_context`)} ON ${tableSql}`);
    await client.query(`
      CREATE POLICY ${quoteIdentifier(`p_${table}_context`)}
      ON ${tableSql}
      USING (
        NULLIF(current_setting('app.company_id', TRUE), '') IS NULL
        OR (
          company_id = NULLIF(current_setting('app.company_id', TRUE), '')::INT
          AND branch_id = NULLIF(current_setting('app.branch_id', TRUE), '')::INT
        )
      )
      WITH CHECK (
        NULLIF(current_setting('app.company_id', TRUE), '') IS NULL
        OR (
          company_id = NULLIF(current_setting('app.company_id', TRUE), '')::INT
          AND branch_id = NULLIF(current_setting('app.branch_id', TRUE), '')::INT
        )
      )
    `);

    console.log(`Contexto completo aplicado à tabela ${table}.`);
  }

  // 5. Índices únicos que antes bloqueavam números iguais em empresas diferentes.
  for (const item of scopedUniqueConstraints) {
    if (!(await tableExists(item.table))) continue;

    if (await constraintExists(item.table, item.constraint)) {
      await client.query(
        `ALTER TABLE ${quoteIdentifier(item.table)} DROP CONSTRAINT ${quoteIdentifier(item.constraint)}`
      );
    } else if (await indexExists(item.constraint)) {
      await client.query(`DROP INDEX ${quoteIdentifier(item.constraint)}`);
    }

    const newIndex = `uq_${item.table}_${item.columns.join('_')}`;
    await client.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS ${quoteIdentifier(newIndex)}
      ON ${quoteIdentifier(item.table)}(${item.columns.map(quoteIdentifier).join(', ')})
    `);
  }

  // 6. Sequências documentais por empresa e filial.
  await client.query(`
    CREATE TABLE IF NOT EXISTS document_sequences (
      id BIGSERIAL PRIMARY KEY,
      company_id INT NOT NULL,
      branch_id INT NOT NULL,
      document_type VARCHAR(40) NOT NULL,
      prefix VARCHAR(20),
      current_number BIGINT NOT NULL DEFAULT 0,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CONSTRAINT fk_document_sequences_branch
        FOREIGN KEY(company_id, branch_id)
        REFERENCES branches(company_id, id)
        ON DELETE CASCADE,
      UNIQUE(company_id, branch_id, document_type)
    )
  `);

  await client.query(`
    CREATE OR REPLACE FUNCTION next_document_number(
      p_company_id INT,
      p_branch_id INT,
      p_document_type VARCHAR,
      p_prefix VARCHAR DEFAULT NULL
    ) RETURNS TEXT
    LANGUAGE plpgsql
    AS $$
    DECLARE
      next_value BIGINT;
      effective_prefix VARCHAR;
    BEGIN
      INSERT INTO document_sequences(
        company_id, branch_id, document_type, prefix, current_number
      ) VALUES(
        p_company_id, p_branch_id, p_document_type, p_prefix, 1
      )
      ON CONFLICT(company_id, branch_id, document_type)
      DO UPDATE SET
        current_number=document_sequences.current_number+1,
        prefix=COALESCE(EXCLUDED.prefix, document_sequences.prefix),
        updated_at=NOW()
      RETURNING current_number, prefix
      INTO next_value, effective_prefix;

      RETURN COALESCE(effective_prefix, '') || LPAD(next_value::TEXT, 8, '0');
    END;
    $$
  `);

  // 7. Relatório final de consistência antes do COMMIT.
  for (const table of operationalTables) {
    if (!(await tableExists(table))) continue;
    const result = await client.query(
      `SELECT COUNT(*)::INT AS total
         FROM ${quoteIdentifier(table)}
        WHERE company_id IS NULL OR branch_id IS NULL`
    );
    if (result.rows[0].total !== 0) {
      throw new Error(`A tabela ${table} ainda possui registros sem contexto.`);
    }
  }

  await client.query('COMMIT');
  console.log('Migração multiempresa completa concluída com sucesso.');
} catch (error) {
  await client.query('ROLLBACK');
  console.error('Falha na migração multiempresa completa:', error);
  process.exitCode = 1;
} finally {
  client.release();
  await db.end();
}
