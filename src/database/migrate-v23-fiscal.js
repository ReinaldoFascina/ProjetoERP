import { db } from './db.js';

const client = await db.connect();
try {
  await client.query('BEGIN');

  await client.query(`
    CREATE TABLE IF NOT EXISTS fiscal_taxes (
      id BIGSERIAL PRIMARY KEY,
      company_id INT NOT NULL,
      branch_id INT NOT NULL,
      code VARCHAR(30) NOT NULL,
      name VARCHAR(120) NOT NULL,
      tax_type VARCHAR(30) NOT NULL CHECK (tax_type IN (
        'ISS','PIS','COFINS','INSS','IRRF','CSLL','IBS_ESTADUAL','IBS_MUNICIPAL','CBS','OUTRO'
      )),
      calculation_basis VARCHAR(30) NOT NULL DEFAULT 'VALOR_SERVICO' CHECK (calculation_basis IN (
        'VALOR_SERVICO','RECEITA_BRUTA','LUCRO','FOLHA','VALOR_DOCUMENTO','MANUAL'
      )),
      periodicity VARCHAR(20) NOT NULL DEFAULT 'MENSAL' CHECK (periodicity IN (
        'MENSAL','QUINZENAL','TRIMESTRAL','ANUAL','EVENTO'
      )),
      retained BOOLEAN NOT NULL DEFAULT FALSE,
      recoverable BOOLEAN NOT NULL DEFAULT FALSE,
      active BOOLEAN NOT NULL DEFAULT TRUE,
      notes TEXT,
      created_by INT REFERENCES users(id),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CONSTRAINT fk_fiscal_taxes_branch FOREIGN KEY(company_id,branch_id)
        REFERENCES branches(company_id,id) ON DELETE RESTRICT,
      UNIQUE(company_id,branch_id,code)
    )
  `);

  await client.query(`
    CREATE TABLE IF NOT EXISTS fiscal_tax_rates (
      id BIGSERIAL PRIMARY KEY,
      company_id INT NOT NULL,
      branch_id INT NOT NULL,
      tax_id BIGINT NOT NULL REFERENCES fiscal_taxes(id) ON DELETE CASCADE,
      valid_from DATE NOT NULL,
      valid_to DATE,
      rate NUMERIC(12,6) NOT NULL DEFAULT 0 CHECK (rate >= 0),
      reduction_rate NUMERIC(12,6) NOT NULL DEFAULT 0 CHECK (reduction_rate BETWEEN 0 AND 100),
      deferral_rate NUMERIC(12,6) NOT NULL DEFAULT 0 CHECK (deferral_rate BETWEEN 0 AND 100),
      additional_rate NUMERIC(12,6) NOT NULL DEFAULT 0 CHECK (additional_rate >= 0),
      minimum_base NUMERIC(15,2) NOT NULL DEFAULT 0,
      maximum_base NUMERIC(15,2),
      fixed_amount NUMERIC(15,2) NOT NULL DEFAULT 0,
      tax_classification VARCHAR(30),
      nbs_code VARCHAR(20),
      national_service_code VARCHAR(30),
      municipality_code VARCHAR(7),
      state CHAR(2),
      tax_regime VARCHAR(30),
      active BOOLEAN NOT NULL DEFAULT TRUE,
      created_by INT REFERENCES users(id),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CONSTRAINT ck_fiscal_tax_rate_dates CHECK (valid_to IS NULL OR valid_to >= valid_from),
      CONSTRAINT fk_fiscal_tax_rates_branch FOREIGN KEY(company_id,branch_id)
        REFERENCES branches(company_id,id) ON DELETE RESTRICT
    )
  `);

  await client.query(`
    CREATE TABLE IF NOT EXISTS fiscal_due_date_rules (
      id BIGSERIAL PRIMARY KEY,
      company_id INT NOT NULL,
      branch_id INT NOT NULL,
      tax_id BIGINT NOT NULL REFERENCES fiscal_taxes(id) ON DELETE CASCADE,
      valid_from DATE NOT NULL,
      valid_to DATE,
      due_day SMALLINT NOT NULL CHECK (due_day BETWEEN 1 AND 31),
      due_month_offset SMALLINT NOT NULL DEFAULT 1 CHECK (due_month_offset BETWEEN 0 AND 12),
      adjustment VARCHAR(30) NOT NULL DEFAULT 'ANTECIPAR' CHECK (adjustment IN (
        'SEM_AJUSTE','ANTECIPAR','PRORROGAR'
      )),
      holiday_calendar VARCHAR(40) NOT NULL DEFAULT 'NACIONAL',
      active BOOLEAN NOT NULL DEFAULT TRUE,
      created_by INT REFERENCES users(id),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CONSTRAINT ck_fiscal_due_dates CHECK (valid_to IS NULL OR valid_to >= valid_from),
      CONSTRAINT fk_fiscal_due_rules_branch FOREIGN KEY(company_id,branch_id)
        REFERENCES branches(company_id,id) ON DELETE RESTRICT
    )
  `);

  await client.query(`
    CREATE TABLE IF NOT EXISTS fiscal_holidays (
      id BIGSERIAL PRIMARY KEY,
      company_id INT NOT NULL,
      branch_id INT NOT NULL,
      holiday_date DATE NOT NULL,
      name VARCHAR(120) NOT NULL,
      calendar VARCHAR(40) NOT NULL DEFAULT 'NACIONAL',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CONSTRAINT fk_fiscal_holidays_branch FOREIGN KEY(company_id,branch_id)
        REFERENCES branches(company_id,id) ON DELETE CASCADE,
      UNIQUE(company_id,branch_id,calendar,holiday_date)
    )
  `);

  await client.query(`
    CREATE TABLE IF NOT EXISTS fiscal_assessment_periods (
      id BIGSERIAL PRIMARY KEY,
      company_id INT NOT NULL,
      branch_id INT NOT NULL,
      tax_id BIGINT NOT NULL REFERENCES fiscal_taxes(id) ON DELETE RESTRICT,
      period_start DATE NOT NULL,
      period_end DATE NOT NULL,
      due_date DATE NOT NULL,
      status VARCHAR(20) NOT NULL DEFAULT 'ABERTO' CHECK (status IN (
        'ABERTO','CALCULADO','FECHADO','REABERTO','CANCELADO'
      )),
      tax_base NUMERIC(15,2) NOT NULL DEFAULT 0,
      debit_amount NUMERIC(15,2) NOT NULL DEFAULT 0,
      credit_amount NUMERIC(15,2) NOT NULL DEFAULT 0,
      retained_amount NUMERIC(15,2) NOT NULL DEFAULT 0,
      adjustments_amount NUMERIC(15,2) NOT NULL DEFAULT 0,
      tax_amount NUMERIC(15,2) NOT NULL DEFAULT 0,
      payable_amount NUMERIC(15,2) NOT NULL DEFAULT 0,
      calculated_at TIMESTAMPTZ,
      closed_at TIMESTAMPTZ,
      closed_by INT REFERENCES users(id),
      notes TEXT,
      created_by INT REFERENCES users(id),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CONSTRAINT ck_fiscal_period_dates CHECK (period_end >= period_start),
      CONSTRAINT fk_fiscal_periods_branch FOREIGN KEY(company_id,branch_id)
        REFERENCES branches(company_id,id) ON DELETE RESTRICT,
      UNIQUE(company_id,branch_id,tax_id,period_start,period_end)
    )
  `);

  await client.query(`
    CREATE TABLE IF NOT EXISTS fiscal_assessment_entries (
      id BIGSERIAL PRIMARY KEY,
      company_id INT NOT NULL,
      branch_id INT NOT NULL,
      period_id BIGINT NOT NULL REFERENCES fiscal_assessment_periods(id) ON DELETE CASCADE,
      movement_id INT REFERENCES billing_movements(id) ON DELETE SET NULL,
      movement_item_id INT REFERENCES billing_movement_items(id) ON DELETE SET NULL,
      entry_type VARCHAR(20) NOT NULL CHECK (entry_type IN ('DEBITO','CREDITO','RETENCAO','AJUSTE')),
      entry_date DATE NOT NULL,
      description VARCHAR(250) NOT NULL,
      tax_base NUMERIC(15,2) NOT NULL DEFAULT 0,
      rate NUMERIC(12,6) NOT NULL DEFAULT 0,
      amount NUMERIC(15,2) NOT NULL DEFAULT 0,
      source VARCHAR(30) NOT NULL DEFAULT 'MOVIMENTO',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CONSTRAINT fk_fiscal_entries_branch FOREIGN KEY(company_id,branch_id)
        REFERENCES branches(company_id,id) ON DELETE RESTRICT
    )
  `);

  await client.query(`
    CREATE OR REPLACE FUNCTION prevent_overlapping_fiscal_validity()
    RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      IF EXISTS (
        SELECT 1 FROM fiscal_tax_rates r
         WHERE r.id <> COALESCE(NEW.id,0)
           AND r.company_id=NEW.company_id AND r.branch_id=NEW.branch_id
           AND r.tax_id=NEW.tax_id AND r.active=TRUE
           AND daterange(r.valid_from,COALESCE(r.valid_to,'infinity'::date),'[]') &&
               daterange(NEW.valid_from,COALESCE(NEW.valid_to,'infinity'::date),'[]')
           AND COALESCE(r.tax_classification,'')=COALESCE(NEW.tax_classification,'')
           AND COALESCE(r.nbs_code,'')=COALESCE(NEW.nbs_code,'')
           AND COALESCE(r.national_service_code,'')=COALESCE(NEW.national_service_code,'')
      ) THEN RAISE EXCEPTION 'Existe alíquota vigente sobreposta para o mesmo tributo e enquadramento.'; END IF;
      RETURN NEW;
    END $$
  `);
  await client.query(`DROP TRIGGER IF EXISTS trg_tax_rate_no_overlap ON fiscal_tax_rates`);
  await client.query(`CREATE TRIGGER trg_tax_rate_no_overlap BEFORE INSERT OR UPDATE ON fiscal_tax_rates FOR EACH ROW EXECUTE FUNCTION prevent_overlapping_fiscal_validity()`);

  for (const table of ['fiscal_taxes','fiscal_tax_rates','fiscal_due_date_rules','fiscal_holidays','fiscal_assessment_periods','fiscal_assessment_entries']) {
    await client.query(`ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY`);
    await client.query(`ALTER TABLE ${table} FORCE ROW LEVEL SECURITY`);
    await client.query(`DROP POLICY IF EXISTS p_${table}_context ON ${table}`);
    await client.query(`CREATE POLICY p_${table}_context ON ${table}
      USING (NULLIF(current_setting('app.company_id',TRUE),'') IS NULL OR
        (company_id=NULLIF(current_setting('app.company_id',TRUE),'')::INT AND branch_id=NULLIF(current_setting('app.branch_id',TRUE),'')::INT))
      WITH CHECK (NULLIF(current_setting('app.company_id',TRUE),'') IS NULL OR
        (company_id=NULLIF(current_setting('app.company_id',TRUE),'')::INT AND branch_id=NULLIF(current_setting('app.branch_id',TRUE),'')::INT))`);
  }

  await client.query(`CREATE INDEX IF NOT EXISTS idx_fiscal_rates_lookup ON fiscal_tax_rates(company_id,branch_id,tax_id,valid_from,valid_to)`);
  await client.query(`CREATE INDEX IF NOT EXISTS idx_fiscal_periods_lookup ON fiscal_assessment_periods(company_id,branch_id,status,period_start,period_end)`);
  await client.query(`CREATE INDEX IF NOT EXISTS idx_fiscal_entries_period ON fiscal_assessment_entries(company_id,branch_id,period_id)`);

  await client.query('COMMIT');
  console.log('Versão 23: módulo fiscal instalado.');
} catch (error) {
  await client.query('ROLLBACK');
  console.error('Falha na migração fiscal v23:', error);
  process.exitCode=1;
} finally {
  client.release();
  await db.end();
}
