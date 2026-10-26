BEGIN;

ALTER TABLE movement_types
  ADD COLUMN IF NOT EXISTS module_context VARCHAR(20) NOT NULL DEFAULT 'ES',
  ADD COLUMN IF NOT EXISTS group_code VARCHAR(10),
  ADD COLUMN IF NOT EXISTS status_initial VARCHAR(30) NOT NULL DEFAULT 'RASCUNHO',
  ADD COLUMN IF NOT EXISTS participant_type VARCHAR(20) NOT NULL DEFAULT 'CLIENTE_FORNECEDOR',
  ADD COLUMN IF NOT EXISTS nature_selection_mode VARCHAR(20) NOT NULL DEFAULT 'PADRAO_EDITAVEL',
  ADD COLUMN IF NOT EXISTS allows_item_nature BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS allows_manual_tax BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS creates_financial BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS financial_direction VARCHAR(10),
  ADD COLUMN IF NOT EXISTS creates_fiscal_posting BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS creates_nfe BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS creates_nfse BOOLEAN NOT NULL DEFAULT FALSE;

CREATE TABLE IF NOT EXISTS movement_type_relations (
  id BIGSERIAL PRIMARY KEY,
  company_id INTEGER NOT NULL,
  branch_id INTEGER NOT NULL,
  source_type_id BIGINT NOT NULL REFERENCES movement_types(id) ON DELETE CASCADE,
  target_type_id BIGINT NOT NULL REFERENCES movement_types(id) ON DELETE CASCADE,
  process_code VARCHAR(30) NOT NULL,
  grouping_mode VARCHAR(20) NOT NULL DEFAULT 'ONE_TO_ONE',
  copies_items BOOLEAN NOT NULL DEFAULT TRUE,
  copies_taxes BOOLEAN NOT NULL DEFAULT TRUE,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  FOREIGN KEY (company_id, branch_id) REFERENCES branches(company_id, id),
  UNIQUE (company_id, branch_id, source_type_id, target_type_id, process_code)
);

CREATE TABLE IF NOT EXISTS movement_header_taxes (
  id BIGSERIAL PRIMARY KEY,
  company_id INTEGER NOT NULL,
  branch_id INTEGER NOT NULL,
  movement_id INTEGER NOT NULL REFERENCES billing_movements(id) ON DELETE CASCADE,
  movement_type_tax_id BIGINT REFERENCES movement_type_taxes(id),
  tax_id BIGINT NOT NULL REFERENCES fiscal_taxes(id),
  calculation_origin VARCHAR(20) NOT NULL DEFAULT 'TIPO_MOVIMENTO',
  tax_base NUMERIC(15,2) NOT NULL DEFAULT 0,
  rate NUMERIC(12,6) NOT NULL DEFAULT 0,
  reduction_rate NUMERIC(12,6) NOT NULL DEFAULT 0,
  deferral_rate NUMERIC(12,6) NOT NULL DEFAULT 0,
  tax_amount NUMERIC(15,2) NOT NULL DEFAULT 0,
  withheld_amount NUMERIC(15,2) NOT NULL DEFAULT 0,
  credit_amount NUMERIC(15,2) NOT NULL DEFAULT 0,
  cst VARCHAR(10),
  tax_classification VARCHAR(30),
  nature_of_income VARCHAR(30),
  manually_changed BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  FOREIGN KEY (company_id, branch_id) REFERENCES branches(company_id, id),
  UNIQUE (company_id, branch_id, movement_id, tax_id)
);

CREATE TABLE IF NOT EXISTS movement_item_taxes (
  id BIGSERIAL PRIMARY KEY,
  company_id INTEGER NOT NULL,
  branch_id INTEGER NOT NULL,
  movement_id INTEGER NOT NULL REFERENCES billing_movements(id) ON DELETE CASCADE,
  movement_item_id INTEGER NOT NULL REFERENCES billing_movement_items(id) ON DELETE CASCADE,
  movement_type_tax_id BIGINT REFERENCES movement_type_taxes(id),
  tax_id BIGINT NOT NULL REFERENCES fiscal_taxes(id),
  calculation_origin VARCHAR(20) NOT NULL DEFAULT 'TIPO_MOVIMENTO',
  tax_base NUMERIC(15,2) NOT NULL DEFAULT 0,
  rate NUMERIC(12,6) NOT NULL DEFAULT 0,
  reduction_rate NUMERIC(12,6) NOT NULL DEFAULT 0,
  deferral_rate NUMERIC(12,6) NOT NULL DEFAULT 0,
  tax_amount NUMERIC(15,2) NOT NULL DEFAULT 0,
  withheld_amount NUMERIC(15,2) NOT NULL DEFAULT 0,
  credit_amount NUMERIC(15,2) NOT NULL DEFAULT 0,
  cst VARCHAR(10),
  csosn VARCHAR(10),
  tax_classification VARCHAR(30),
  nature_of_income VARCHAR(30),
  manually_changed BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  FOREIGN KEY (company_id, branch_id) REFERENCES branches(company_id, id),
  UNIQUE (company_id, branch_id, movement_item_id, tax_id)
);

CREATE TABLE IF NOT EXISTS movement_stock_events (
  id BIGSERIAL PRIMARY KEY,
  company_id INTEGER NOT NULL,
  branch_id INTEGER NOT NULL,
  movement_id INTEGER NOT NULL REFERENCES billing_movements(id) ON DELETE CASCADE,
  event_type VARCHAR(20) NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'PENDENTE',
  warehouse_id BIGINT REFERENCES stock_warehouses(id),
  target_branch_id INTEGER,
  target_warehouse_id BIGINT REFERENCES stock_warehouses(id),
  processed_at TIMESTAMPTZ,
  reversed_at TIMESTAMPTZ,
  user_id INTEGER REFERENCES users(id),
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  FOREIGN KEY (company_id, branch_id) REFERENCES branches(company_id, id)
);

CREATE TABLE IF NOT EXISTS movement_process_queue (
  id BIGSERIAL PRIMARY KEY,
  company_id INTEGER NOT NULL,
  branch_id INTEGER NOT NULL,
  movement_id INTEGER NOT NULL REFERENCES billing_movements(id) ON DELETE CASCADE,
  process_code VARCHAR(40) NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'PENDENTE',
  attempts INTEGER NOT NULL DEFAULT 0,
  payload JSONB,
  scheduled_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  started_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ,
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  FOREIGN KEY (company_id, branch_id) REFERENCES branches(company_id, id)
);

ALTER TABLE billing_movements
  ADD COLUMN IF NOT EXISTS stock_status VARCHAR(30) NOT NULL DEFAULT 'NAO_PROCESSADO',
  ADD COLUMN IF NOT EXISTS financial_status VARCHAR(30) NOT NULL DEFAULT 'NAO_GERADO',
  ADD COLUMN IF NOT EXISTS posting_status VARCHAR(30) NOT NULL DEFAULT 'NAO_ESCRITURADO',
  ADD COLUMN IF NOT EXISTS source_movement_id INTEGER REFERENCES billing_movements(id),
  ADD COLUMN IF NOT EXISTS destination_branch_id INTEGER,
  ADD COLUMN IF NOT EXISTS movement_notes TEXT;

CREATE INDEX IF NOT EXISTS idx_movement_item_taxes_item ON movement_item_taxes(company_id, branch_id, movement_item_id);
CREATE INDEX IF NOT EXISTS idx_movement_header_taxes_movement ON movement_header_taxes(company_id, branch_id, movement_id);
CREATE INDEX IF NOT EXISTS idx_movement_stock_events_movement ON movement_stock_events(company_id, branch_id, movement_id);
CREATE INDEX IF NOT EXISTS idx_movement_process_queue_status ON movement_process_queue(company_id, branch_id, status, scheduled_at);
CREATE INDEX IF NOT EXISTS idx_movement_types_context ON movement_types(company_id, branch_id, module_context, group_code);

INSERT INTO movement_types (
  company_id, branch_id, code, name, direction, series, document_model,
  generates_financial, generates_fiscal, generates_nfse, active,
  module_context, group_code, status_initial, creates_financial,
  financial_direction, creates_fiscal_posting, creates_nfe, creates_nfse
)
SELECT b.company_id, b.id, seed.code, seed.name, seed.direction, seed.series,
       seed.document_model, seed.creates_financial, seed.creates_fiscal,
       seed.creates_nfse, TRUE, 'ES', seed.group_code, 'RASCUNHO',
       seed.creates_financial, seed.financial_direction,
       seed.creates_fiscal, seed.creates_nfe, seed.creates_nfse
FROM branches b
CROSS JOIN (
  VALUES
    ('1.1.01','Solicitação de compra','ENTRADA',NULL,'SEM_DOCUMENTO','1.1',FALSE,NULL,FALSE,FALSE,FALSE),
    ('1.1.02','Ordem de compra','ENTRADA',NULL,'SEM_DOCUMENTO','1.1',FALSE,NULL,FALSE,FALSE,FALSE),
    ('1.2.01','Entrada de mercadoria','ENTRADA','1','55','1.2',TRUE,'PAGAR',TRUE,FALSE,FALSE),
    ('1.2.02','Devolução de venda','ENTRADA','1','55','1.2',TRUE,'PAGAR',TRUE,TRUE,FALSE),
    ('2.1.01','Pedido de venda','SAIDA',NULL,'SEM_DOCUMENTO','2.1',FALSE,NULL,FALSE,FALSE,FALSE),
    ('2.2.01','Venda de mercadoria','SAIDA','1','55','2.2',TRUE,'RECEBER',TRUE,TRUE,FALSE),
    ('2.2.02','Venda de serviço','SAIDA','1','NFSE','2.2',TRUE,'RECEBER',TRUE,FALSE,TRUE),
    ('2.2.03','Devolução de compra','SAIDA','1','55','2.2',TRUE,'RECEBER',TRUE,TRUE,FALSE),
    ('3.1.01','Transferência entre filiais','SAIDA',NULL,'SEM_DOCUMENTO','3.1',FALSE,NULL,FALSE,FALSE,FALSE),
    ('4.1.01','Ajuste de entrada','ENTRADA',NULL,'SEM_DOCUMENTO','4.1',FALSE,NULL,FALSE,FALSE,FALSE),
    ('4.1.02','Ajuste de saída','SAIDA',NULL,'SEM_DOCUMENTO','4.1',FALSE,NULL,FALSE,FALSE,FALSE),
    ('4.1.03','Inventário de estoque','ENTRADA',NULL,'SEM_DOCUMENTO','4.1',FALSE,NULL,FALSE,FALSE,FALSE)
) AS seed(code,name,direction,series,document_model,group_code,creates_financial,financial_direction,creates_fiscal,creates_nfe,creates_nfse)
ON CONFLICT (company_id, branch_id, code) DO UPDATE SET
  module_context='ES', group_code=EXCLUDED.group_code,
  creates_financial=EXCLUDED.creates_financial,
  financial_direction=EXCLUDED.financial_direction,
  creates_fiscal_posting=EXCLUDED.creates_fiscal_posting,
  creates_nfe=EXCLUDED.creates_nfe,
  creates_nfse=EXCLUDED.creates_nfse;

COMMIT;
