BEGIN;

/*
 * RESistemas - Versao 36
 * Estrutura complementar para confirmacao, tributacao e processamento
 * de movimentos de estoque, compras e faturamento.
 *
 * A migracao e idempotente e pode ser executada mais de uma vez.
 */

/* ================================================================
 * 1. PARAMETROS DO TIPO DE MOVIMENTO
 * ================================================================ */

CREATE TABLE IF NOT EXISTS movement_type_parameters (
  id BIGSERIAL PRIMARY KEY,
  company_id BIGINT NOT NULL,
  branch_id BIGINT NOT NULL,
  movement_type_id BIGINT NOT NULL,
  fiscal_nature_id BIGINT,
  default_warehouse_id BIGINT,
  updates_stock BOOLEAN NOT NULL DEFAULT FALSE,
  stock_moment VARCHAR(30),
  generates_nfe BOOLEAN NOT NULL DEFAULT FALSE,
  nfe_send_mode VARCHAR(30),
  environment VARCHAR(20) NOT NULL DEFAULT 'HOMOLOGACAO',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE movement_type_parameters
  ADD COLUMN IF NOT EXISTS fiscal_nature_id BIGINT,
  ADD COLUMN IF NOT EXISTS default_warehouse_id BIGINT,
  ADD COLUMN IF NOT EXISTS updates_stock BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS stock_moment VARCHAR(30),
  ADD COLUMN IF NOT EXISTS generates_nfe BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS nfe_send_mode VARCHAR(30),
  ADD COLUMN IF NOT EXISTS environment VARCHAR(20) NOT NULL DEFAULT 'HOMOLOGACAO',
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

CREATE UNIQUE INDEX IF NOT EXISTS ux_movement_type_parameters_scope
  ON movement_type_parameters (
    company_id,
    branch_id,
    movement_type_id
  );

CREATE INDEX IF NOT EXISTS ix_movement_type_parameters_nature
  ON movement_type_parameters (
    company_id,
    branch_id,
    fiscal_nature_id
  );

CREATE INDEX IF NOT EXISTS ix_movement_type_parameters_warehouse
  ON movement_type_parameters (
    company_id,
    branch_id,
    default_warehouse_id
  );

/* Normaliza valores conhecidos sem bloquear configuracoes antigas. */
UPDATE movement_type_parameters
SET environment = 'HOMOLOGACAO'
WHERE environment IS NULL;

/* ================================================================
 * 2. CAMPOS DE INTEGRACAO NO TIPO DE MOVIMENTO
 * ================================================================ */

ALTER TABLE movement_types
  ADD COLUMN IF NOT EXISTS module_context VARCHAR(20) NOT NULL DEFAULT 'ES',
  ADD COLUMN IF NOT EXISTS status_initial VARCHAR(30) NOT NULL DEFAULT 'RASCUNHO',
  ADD COLUMN IF NOT EXISTS creates_financial BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS creates_fiscal_posting BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS creates_nfe BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS creates_nfse BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS active BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

CREATE INDEX IF NOT EXISTS ix_movement_types_module_active
  ON movement_types (
    company_id,
    branch_id,
    module_context,
    active
  );

/* ================================================================
 * 3. PARAMETRIZACAO DOS TRIBUTOS DO TIPO
 * ================================================================ */

CREATE TABLE IF NOT EXISTS movement_type_taxes (
  id BIGSERIAL PRIMARY KEY,
  company_id BIGINT NOT NULL,
  branch_id BIGINT NOT NULL,
  movement_type_id BIGINT NOT NULL,
  tax_id BIGINT NOT NULL,
  application_level VARCHAR(20) NOT NULL,
  calculation_order INTEGER NOT NULL DEFAULT 1,
  default_rate NUMERIC(18,8) NOT NULL DEFAULT 0,
  default_cst VARCHAR(10),
  default_csosn VARCHAR(10),
  default_tax_classification VARCHAR(30),
  nature_of_income VARCHAR(30),
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE movement_type_taxes
  ADD COLUMN IF NOT EXISTS application_level VARCHAR(20),
  ADD COLUMN IF NOT EXISTS calculation_order INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS default_rate NUMERIC(18,8) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS default_cst VARCHAR(10),
  ADD COLUMN IF NOT EXISTS default_csosn VARCHAR(10),
  ADD COLUMN IF NOT EXISTS default_tax_classification VARCHAR(30),
  ADD COLUMN IF NOT EXISTS nature_of_income VARCHAR(30),
  ADD COLUMN IF NOT EXISTS active BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

/* Remove duplicidades antes de criar a unicidade logica. */
DELETE FROM movement_type_taxes duplicated
USING movement_type_taxes retained
WHERE duplicated.id > retained.id
  AND duplicated.company_id = retained.company_id
  AND duplicated.branch_id = retained.branch_id
  AND duplicated.movement_type_id = retained.movement_type_id
  AND duplicated.tax_id = retained.tax_id
  AND duplicated.application_level = retained.application_level;

CREATE UNIQUE INDEX IF NOT EXISTS ux_movement_type_taxes_rule
  ON movement_type_taxes (
    company_id,
    branch_id,
    movement_type_id,
    tax_id,
    application_level
  );

CREATE INDEX IF NOT EXISTS ix_movement_type_taxes_processing
  ON movement_type_taxes (
    company_id,
    branch_id,
    movement_type_id,
    application_level,
    active,
    calculation_order
  );

/* ================================================================
 * 4. CAMPOS NECESSARIOS NO CABECALHO DO MOVIMENTO
 * ================================================================ */

ALTER TABLE billing_movements
  ADD COLUMN IF NOT EXISTS partner_id BIGINT,
  ADD COLUMN IF NOT EXISTS payment_condition_id BIGINT,
  ADD COLUMN IF NOT EXISTS total_amount NUMERIC(18,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS stock_status VARCHAR(30) NOT NULL DEFAULT 'NAO_PROCESSADO',
  ADD COLUMN IF NOT EXISTS financial_status VARCHAR(30) NOT NULL DEFAULT 'NAO_PROCESSADO',
  ADD COLUMN IF NOT EXISTS posting_status VARCHAR(30) NOT NULL DEFAULT 'NAO_PROCESSADO',
  ADD COLUMN IF NOT EXISTS confirmed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS confirmed_by BIGINT,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

CREATE INDEX IF NOT EXISTS ix_billing_movements_process_status
  ON billing_movements (
    company_id,
    branch_id,
    status,
    stock_status,
    financial_status,
    posting_status
  );

/* ================================================================
 * 5. CAMPOS NECESSARIOS NOS ITENS DO MOVIMENTO
 * ================================================================ */

ALTER TABLE billing_movement_items
  ADD COLUMN IF NOT EXISTS catalog_item_id BIGINT,
  ADD COLUMN IF NOT EXISTS warehouse_id BIGINT,
  ADD COLUMN IF NOT EXISTS quantity NUMERIC(18,6) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS unit_price NUMERIC(18,8) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS total_amount NUMERIC(18,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

CREATE INDEX IF NOT EXISTS ix_billing_movement_items_movement
  ON billing_movement_items (
    company_id,
    branch_id,
    movement_id,
    id
  );

CREATE INDEX IF NOT EXISTS ix_billing_movement_items_product
  ON billing_movement_items (
    company_id,
    branch_id,
    catalog_item_id
  );

/* ================================================================
 * 6. TRIBUTOS DO CABECALHO
 * ================================================================ */

CREATE TABLE IF NOT EXISTS movement_header_taxes (
  id BIGSERIAL PRIMARY KEY,
  company_id BIGINT NOT NULL,
  branch_id BIGINT NOT NULL,
  movement_id BIGINT NOT NULL,
  movement_type_tax_id BIGINT NOT NULL,
  tax_id BIGINT NOT NULL,
  rate NUMERIC(18,8) NOT NULL DEFAULT 0,
  cst VARCHAR(10),
  tax_classification VARCHAR(30),
  nature_of_income VARCHAR(30),
  taxable_base NUMERIC(18,2) NOT NULL DEFAULT 0,
  tax_amount NUMERIC(18,2) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DELETE FROM movement_header_taxes duplicated
USING movement_header_taxes retained
WHERE duplicated.id > retained.id
  AND duplicated.company_id = retained.company_id
  AND duplicated.branch_id = retained.branch_id
  AND duplicated.movement_id = retained.movement_id
  AND duplicated.movement_type_tax_id = retained.movement_type_tax_id
  AND duplicated.tax_id = retained.tax_id;

CREATE UNIQUE INDEX IF NOT EXISTS ux_movement_header_taxes_rule
  ON movement_header_taxes (
    company_id,
    branch_id,
    movement_id,
    movement_type_tax_id,
    tax_id
  );

CREATE INDEX IF NOT EXISTS ix_movement_header_taxes_movement
  ON movement_header_taxes (
    company_id,
    branch_id,
    movement_id
  );

/* ================================================================
 * 7. TRIBUTOS DOS ITENS
 * ================================================================ */

CREATE TABLE IF NOT EXISTS movement_item_taxes (
  id BIGSERIAL PRIMARY KEY,
  company_id BIGINT NOT NULL,
  branch_id BIGINT NOT NULL,
  movement_id BIGINT NOT NULL,
  movement_item_id BIGINT NOT NULL,
  movement_type_tax_id BIGINT NOT NULL,
  tax_id BIGINT NOT NULL,
  rate NUMERIC(18,8) NOT NULL DEFAULT 0,
  cst VARCHAR(10),
  csosn VARCHAR(10),
  tax_classification VARCHAR(30),
  nature_of_income VARCHAR(30),
  taxable_base NUMERIC(18,2) NOT NULL DEFAULT 0,
  tax_amount NUMERIC(18,2) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DELETE FROM movement_item_taxes duplicated
USING movement_item_taxes retained
WHERE duplicated.id > retained.id
  AND duplicated.company_id = retained.company_id
  AND duplicated.branch_id = retained.branch_id
  AND duplicated.movement_id = retained.movement_id
  AND duplicated.movement_item_id = retained.movement_item_id
  AND duplicated.movement_type_tax_id = retained.movement_type_tax_id
  AND duplicated.tax_id = retained.tax_id;

CREATE UNIQUE INDEX IF NOT EXISTS ux_movement_item_taxes_rule
  ON movement_item_taxes (
    company_id,
    branch_id,
    movement_id,
    movement_item_id,
    movement_type_tax_id,
    tax_id
  );

CREATE INDEX IF NOT EXISTS ix_movement_item_taxes_item
  ON movement_item_taxes (
    company_id,
    branch_id,
    movement_id,
    movement_item_id
  );

/* ================================================================
 * 8. FILA DE PROCESSAMENTO
 * ================================================================ */

CREATE TABLE IF NOT EXISTS movement_process_queue (
  id BIGSERIAL PRIMARY KEY,
  company_id BIGINT NOT NULL,
  branch_id BIGINT NOT NULL,
  movement_id BIGINT NOT NULL,
  process_code VARCHAR(50) NOT NULL,
  status VARCHAR(30) NOT NULL DEFAULT 'PENDENTE',
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  available_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  started_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ,
  locked_by VARCHAR(120),
  locked_at TIMESTAMPTZ,
  error_message TEXT,
  result_payload JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE movement_process_queue
  ADD COLUMN IF NOT EXISTS status VARCHAR(30) NOT NULL DEFAULT 'PENDENTE',
  ADD COLUMN IF NOT EXISTS payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS attempt_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS available_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS started_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS finished_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS locked_by VARCHAR(120),
  ADD COLUMN IF NOT EXISTS locked_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS error_message TEXT,
  ADD COLUMN IF NOT EXISTS result_payload JSONB,
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

/* Mantem somente o registro ativo mais antigo de cada processo. */
UPDATE movement_process_queue
SET status = 'CANCELADO',
    error_message = COALESCE(
      error_message,
      'Registro duplicado cancelado pela migracao v36.'
    ),
    updated_at = NOW()
WHERE id IN (
  SELECT duplicated_id
  FROM (
    SELECT
      id AS duplicated_id,
      ROW_NUMBER() OVER (
        PARTITION BY
          company_id,
          branch_id,
          movement_id,
          process_code
        ORDER BY id
      ) AS position
    FROM movement_process_queue
    WHERE status IN ('PENDENTE', 'PROCESSANDO')
  ) duplicated
  WHERE duplicated.position > 1
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_movement_process_queue_active
  ON movement_process_queue (
    company_id,
    branch_id,
    movement_id,
    process_code
  )
  WHERE status IN ('PENDENTE', 'PROCESSANDO');

CREATE INDEX IF NOT EXISTS ix_movement_process_queue_worker
  ON movement_process_queue (
    status,
    available_at,
    created_at
  );

CREATE INDEX IF NOT EXISTS ix_movement_process_queue_movement
  ON movement_process_queue (
    company_id,
    branch_id,
    movement_id,
    process_code,
    status
  );

/* ================================================================
 * 9. HISTORICO DOS STATUS
 * ================================================================ */

CREATE TABLE IF NOT EXISTS movement_status_history (
  id BIGSERIAL PRIMARY KEY,
  company_id BIGINT NOT NULL,
  branch_id BIGINT NOT NULL,
  movement_id BIGINT NOT NULL,
  previous_status VARCHAR(30),
  new_status VARCHAR(30) NOT NULL,
  operation VARCHAR(50) NOT NULL,
  message TEXT,
  user_id BIGINT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE movement_status_history
  ADD COLUMN IF NOT EXISTS previous_status VARCHAR(30),
  ADD COLUMN IF NOT EXISTS new_status VARCHAR(30),
  ADD COLUMN IF NOT EXISTS operation VARCHAR(50),
  ADD COLUMN IF NOT EXISTS message TEXT,
  ADD COLUMN IF NOT EXISTS user_id BIGINT,
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

CREATE INDEX IF NOT EXISTS ix_movement_status_history_movement
  ON movement_status_history (
    company_id,
    branch_id,
    movement_id,
    created_at DESC
  );

/* ================================================================
 * 10. FUNCAO PADRAO PARA UPDATED_AT
 * ================================================================ */

CREATE OR REPLACE FUNCTION set_movement_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_movement_type_parameters_updated_at
  ON movement_type_parameters;

CREATE TRIGGER trg_movement_type_parameters_updated_at
BEFORE UPDATE ON movement_type_parameters
FOR EACH ROW
EXECUTE FUNCTION set_movement_updated_at();

DROP TRIGGER IF EXISTS trg_movement_type_taxes_updated_at
  ON movement_type_taxes;

CREATE TRIGGER trg_movement_type_taxes_updated_at
BEFORE UPDATE ON movement_type_taxes
FOR EACH ROW
EXECUTE FUNCTION set_movement_updated_at();

DROP TRIGGER IF EXISTS trg_movement_header_taxes_updated_at
  ON movement_header_taxes;

CREATE TRIGGER trg_movement_header_taxes_updated_at
BEFORE UPDATE ON movement_header_taxes
FOR EACH ROW
EXECUTE FUNCTION set_movement_updated_at();

DROP TRIGGER IF EXISTS trg_movement_item_taxes_updated_at
  ON movement_item_taxes;

CREATE TRIGGER trg_movement_item_taxes_updated_at
BEFORE UPDATE ON movement_item_taxes
FOR EACH ROW
EXECUTE FUNCTION set_movement_updated_at();

DROP TRIGGER IF EXISTS trg_movement_process_queue_updated_at
  ON movement_process_queue;

CREATE TRIGGER trg_movement_process_queue_updated_at
BEFORE UPDATE ON movement_process_queue
FOR EACH ROW
EXECUTE FUNCTION set_movement_updated_at();

COMMIT;
