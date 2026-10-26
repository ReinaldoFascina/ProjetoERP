BEGIN;

CREATE TABLE IF NOT EXISTS accounting_cost_centers (
  id BIGSERIAL PRIMARY KEY,
  company_id INTEGER NOT NULL,
  branch_id INTEGER NOT NULL,
  code VARCHAR(30) NOT NULL,
  name VARCHAR(150) NOT NULL,
  parent_id BIGINT REFERENCES accounting_cost_centers(id),
  analytical BOOLEAN NOT NULL DEFAULT TRUE,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  FOREIGN KEY (company_id, branch_id) REFERENCES branches(company_id, id),
  UNIQUE (company_id, branch_id, code)
);

CREATE TABLE IF NOT EXISTS accounting_reference_accounts (
  id BIGSERIAL PRIMARY KEY,
  company_id INTEGER NOT NULL,
  branch_id INTEGER NOT NULL,
  code VARCHAR(40) NOT NULL,
  description VARCHAR(200) NOT NULL,
  institution VARCHAR(20) NOT NULL DEFAULT 'RFB',
  layout_code VARCHAR(20) NOT NULL DEFAULT 'ECD_9',
  valid_from DATE,
  valid_to DATE,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  FOREIGN KEY (company_id, branch_id) REFERENCES branches(company_id, id),
  UNIQUE (company_id, branch_id, institution, layout_code, code)
);

CREATE TABLE IF NOT EXISTS accounting_accounts (
  id BIGSERIAL PRIMARY KEY,
  company_id INTEGER NOT NULL,
  branch_id INTEGER NOT NULL,
  code VARCHAR(40) NOT NULL,
  name VARCHAR(200) NOT NULL,
  parent_id BIGINT REFERENCES accounting_accounts(id),
  account_type VARCHAR(20) NOT NULL,
  nature VARCHAR(10) NOT NULL,
  analytical BOOLEAN NOT NULL DEFAULT TRUE,
  accepts_cost_center BOOLEAN NOT NULL DEFAULT FALSE,
  reference_account_id BIGINT REFERENCES accounting_reference_accounts(id),
  opening_balance NUMERIC(18,2) NOT NULL DEFAULT 0,
  opening_balance_nature CHAR(1) NOT NULL DEFAULT 'D',
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  FOREIGN KEY (company_id, branch_id) REFERENCES branches(company_id, id),
  UNIQUE (company_id, branch_id, code),
  CHECK (account_type IN ('ATIVO','PASSIVO','PATRIMONIO_LIQUIDO','RECEITA','DESPESA','COMPENSACAO')),
  CHECK (nature IN ('DEVEDORA','CREDORA')),
  CHECK (opening_balance_nature IN ('D','C'))
);

CREATE TABLE IF NOT EXISTS accounting_books (
  id BIGSERIAL PRIMARY KEY,
  company_id INTEGER NOT NULL,
  branch_id INTEGER NOT NULL,
  code VARCHAR(20) NOT NULL,
  name VARCHAR(120) NOT NULL,
  book_type CHAR(1) NOT NULL DEFAULT 'G',
  book_number INTEGER NOT NULL DEFAULT 1,
  period_start DATE NOT NULL,
  period_end DATE NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'ABERTO',
  sped_layout VARCHAR(20) NOT NULL DEFAULT 'ECD_9',
  hash_book VARCHAR(100),
  receipt_number VARCHAR(100),
  transmission_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  FOREIGN KEY (company_id, branch_id) REFERENCES branches(company_id, id),
  UNIQUE (company_id, branch_id, code, book_number),
  CHECK (status IN ('ABERTO','ENCERRADO','GERADO','VALIDADO','TRANSMITIDO','SUBSTITUIDO'))
);

CREATE TABLE IF NOT EXISTS accounting_entries (
  id BIGSERIAL PRIMARY KEY,
  company_id INTEGER NOT NULL,
  branch_id INTEGER NOT NULL,
  book_id BIGINT NOT NULL REFERENCES accounting_books(id),
  entry_number VARCHAR(40) NOT NULL,
  entry_date DATE NOT NULL,
  source_module VARCHAR(20) NOT NULL DEFAULT 'CT',
  source_id BIGINT,
  history TEXT NOT NULL,
  total_debit NUMERIC(18,2) NOT NULL DEFAULT 0,
  total_credit NUMERIC(18,2) NOT NULL DEFAULT 0,
  status VARCHAR(20) NOT NULL DEFAULT 'RASCUNHO',
  created_by INTEGER REFERENCES users(id),
  posted_by INTEGER REFERENCES users(id),
  posted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  FOREIGN KEY (company_id, branch_id) REFERENCES branches(company_id, id),
  UNIQUE (company_id, branch_id, entry_number),
  CHECK (status IN ('RASCUNHO','LANCADO','ESTORNADO'))
);

CREATE TABLE IF NOT EXISTS accounting_entry_lines (
  id BIGSERIAL PRIMARY KEY,
  company_id INTEGER NOT NULL,
  branch_id INTEGER NOT NULL,
  entry_id BIGINT NOT NULL REFERENCES accounting_entries(id) ON DELETE CASCADE,
  sequence INTEGER NOT NULL,
  account_id BIGINT NOT NULL REFERENCES accounting_accounts(id),
  cost_center_id BIGINT REFERENCES accounting_cost_centers(id),
  debit NUMERIC(18,2) NOT NULL DEFAULT 0,
  credit NUMERIC(18,2) NOT NULL DEFAULT 0,
  history_complement TEXT,
  participant_id INTEGER REFERENCES clients(id),
  document_number VARCHAR(60),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  FOREIGN KEY (company_id, branch_id) REFERENCES branches(company_id, id),
  UNIQUE (entry_id, sequence),
  CHECK (debit >= 0 AND credit >= 0),
  CHECK ((debit > 0 AND credit = 0) OR (credit > 0 AND debit = 0))
);

CREATE TABLE IF NOT EXISTS accounting_sped_files (
  id BIGSERIAL PRIMARY KEY,
  company_id INTEGER NOT NULL,
  branch_id INTEGER NOT NULL,
  book_id BIGINT NOT NULL REFERENCES accounting_books(id),
  obligation VARCHAR(10) NOT NULL DEFAULT 'ECD',
  layout_version VARCHAR(20) NOT NULL DEFAULT '9',
  period_start DATE NOT NULL,
  period_end DATE NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'RASCUNHO',
  file_name VARCHAR(255),
  file_content TEXT,
  validation_errors JSONB NOT NULL DEFAULT '[]'::jsonb,
  generated_by INTEGER REFERENCES users(id),
  generated_at TIMESTAMPTZ,
  validated_at TIMESTAMPTZ,
  transmitted_at TIMESTAMPTZ,
  receipt_number VARCHAR(100),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  FOREIGN KEY (company_id, branch_id) REFERENCES branches(company_id, id),
  CHECK (obligation IN ('ECD','ECF')),
  CHECK (status IN ('RASCUNHO','GERADO','VALIDADO','TRANSMITIDO','ERRO'))
);

CREATE INDEX IF NOT EXISTS idx_accounting_accounts_context ON accounting_accounts(company_id, branch_id, active, code);
CREATE INDEX IF NOT EXISTS idx_accounting_cost_centers_context ON accounting_cost_centers(company_id, branch_id, active, code);
CREATE INDEX IF NOT EXISTS idx_accounting_entries_period ON accounting_entries(company_id, branch_id, entry_date, status);
CREATE INDEX IF NOT EXISTS idx_accounting_lines_account ON accounting_entry_lines(company_id, branch_id, account_id, cost_center_id);
CREATE INDEX IF NOT EXISTS idx_accounting_sped_book ON accounting_sped_files(company_id, branch_id, book_id, status);

COMMIT;
