BEGIN;

CREATE TABLE IF NOT EXISTS asset_categories (
  id BIGSERIAL PRIMARY KEY,
  company_id INTEGER NOT NULL,
  branch_id INTEGER NOT NULL,
  code VARCHAR(30) NOT NULL,
  name VARCHAR(160) NOT NULL,
  useful_life_months INTEGER NOT NULL,
  residual_percent NUMERIC(9,4) NOT NULL DEFAULT 0,
  depreciation_method VARCHAR(30) NOT NULL DEFAULT 'STRAIGHT_LINE',
  asset_account_id BIGINT REFERENCES accounting_accounts(id),
  accumulated_depreciation_account_id BIGINT REFERENCES accounting_accounts(id),
  depreciation_expense_account_id BIGINT REFERENCES accounting_accounts(id),
  gain_account_id BIGINT REFERENCES accounting_accounts(id),
  loss_account_id BIGINT REFERENCES accounting_accounts(id),
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (company_id, branch_id, code),
  CHECK (useful_life_months > 0),
  CHECK (residual_percent >= 0 AND residual_percent < 100),
  CHECK (depreciation_method IN ('STRAIGHT_LINE','UNITS_OF_PRODUCTION','NO_DEPRECIATION'))
);

CREATE TABLE IF NOT EXISTS asset_responsibles (
  id BIGSERIAL PRIMARY KEY,
  company_id INTEGER NOT NULL,
  branch_id INTEGER NOT NULL,
  user_id INTEGER REFERENCES users(id),
  client_id INTEGER REFERENCES clients(id),
  name VARCHAR(160) NOT NULL,
  document VARCHAR(30),
  email VARCHAR(160),
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (company_id, branch_id, name)
);

CREATE TABLE IF NOT EXISTS assets (
  id BIGSERIAL PRIMARY KEY,
  company_id INTEGER NOT NULL,
  branch_id INTEGER NOT NULL,
  asset_number VARCHAR(40) NOT NULL,
  tag_number VARCHAR(80),
  description VARCHAR(200) NOT NULL,
  category_id BIGINT NOT NULL REFERENCES asset_categories(id),
  catalog_item_id BIGINT REFERENCES catalog_items(id),
  purchase_movement_id BIGINT,
  purchase_movement_type_code VARCHAR(40),
  supplier_id INTEGER REFERENCES clients(id),
  invoice_number VARCHAR(60),
  invoice_key VARCHAR(60),
  purchase_date DATE NOT NULL,
  acquisition_date DATE NOT NULL,
  in_service_date DATE,
  depreciation_start_date DATE,
  acquisition_cost NUMERIC(18,2) NOT NULL,
  residual_value NUMERIC(18,2) NOT NULL DEFAULT 0,
  depreciable_amount NUMERIC(18,2) NOT NULL DEFAULT 0,
  useful_life_months INTEGER NOT NULL,
  depreciation_method VARCHAR(30) NOT NULL DEFAULT 'STRAIGHT_LINE',
  production_capacity_units NUMERIC(18,6),
  accumulated_units NUMERIC(18,6) NOT NULL DEFAULT 0,
  accumulated_depreciation NUMERIC(18,2) NOT NULL DEFAULT 0,
  impairment_amount NUMERIC(18,2) NOT NULL DEFAULT 0,
  book_value NUMERIC(18,2) NOT NULL DEFAULT 0,
  responsible_id BIGINT REFERENCES asset_responsibles(id),
  cost_center_id BIGINT REFERENCES accounting_cost_centers(id),
  location VARCHAR(200),
  status VARCHAR(30) NOT NULL DEFAULT 'ACTIVE',
  acquisition_accounting_entry_id BIGINT REFERENCES accounting_entries(id),
  notes TEXT,
  created_by INTEGER REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (company_id, branch_id, asset_number),
  UNIQUE (company_id, branch_id, tag_number),
  CHECK (acquisition_cost >= 0),
  CHECK (residual_value >= 0),
  CHECK (depreciable_amount >= 0),
  CHECK (useful_life_months > 0),
  CHECK (accumulated_depreciation >= 0),
  CHECK (book_value >= 0),
  CHECK (depreciation_method IN ('STRAIGHT_LINE','UNITS_OF_PRODUCTION','NO_DEPRECIATION')),
  CHECK (status IN ('PENDING','ACTIVE','IDLE','MAINTENANCE','TRANSFERRED','SOLD','WRITTEN_OFF'))
);

CREATE TABLE IF NOT EXISTS asset_transfers (
  id BIGSERIAL PRIMARY KEY,
  company_id INTEGER NOT NULL,
  branch_id INTEGER NOT NULL,
  asset_id BIGINT NOT NULL REFERENCES assets(id),
  transfer_date DATE NOT NULL,
  previous_responsible_id BIGINT REFERENCES asset_responsibles(id),
  new_responsible_id BIGINT REFERENCES asset_responsibles(id),
  previous_cost_center_id BIGINT REFERENCES accounting_cost_centers(id),
  new_cost_center_id BIGINT REFERENCES accounting_cost_centers(id),
  previous_location VARCHAR(200),
  new_location VARCHAR(200),
  notes TEXT,
  created_by INTEGER REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS asset_depreciation_periods (
  id BIGSERIAL PRIMARY KEY,
  company_id INTEGER NOT NULL,
  branch_id INTEGER NOT NULL,
  period_start DATE NOT NULL,
  period_end DATE NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'OPEN',
  processed_at TIMESTAMPTZ,
  processed_by INTEGER REFERENCES users(id),
  accounting_entry_id BIGINT REFERENCES accounting_entries(id),
  reversal_entry_id BIGINT REFERENCES accounting_entries(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (company_id, branch_id, period_start, period_end),
  CHECK (status IN ('OPEN','CALCULATED','POSTED','REVERSED'))
);

CREATE TABLE IF NOT EXISTS asset_depreciation_entries (
  id BIGSERIAL PRIMARY KEY,
  company_id INTEGER NOT NULL,
  branch_id INTEGER NOT NULL,
  period_id BIGINT NOT NULL REFERENCES asset_depreciation_periods(id) ON DELETE CASCADE,
  asset_id BIGINT NOT NULL REFERENCES assets(id),
  depreciation_date DATE NOT NULL,
  opening_book_value NUMERIC(18,2) NOT NULL,
  depreciation_amount NUMERIC(18,2) NOT NULL,
  accumulated_depreciation NUMERIC(18,2) NOT NULL,
  closing_book_value NUMERIC(18,2) NOT NULL,
  units_in_period NUMERIC(18,6),
  accounting_entry_id BIGINT REFERENCES accounting_entries(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (period_id, asset_id),
  CHECK (depreciation_amount >= 0),
  CHECK (closing_book_value >= 0)
);

CREATE TABLE IF NOT EXISTS asset_purchase_rules (
  id BIGSERIAL PRIMARY KEY,
  company_id INTEGER NOT NULL,
  branch_id INTEGER NOT NULL,
  movement_type_code VARCHAR(40) NOT NULL,
  category_id BIGINT REFERENCES asset_categories(id),
  minimum_value NUMERIC(18,2) NOT NULL DEFAULT 0,
  auto_create BOOLEAN NOT NULL DEFAULT TRUE,
  start_depreciation_rule VARCHAR(30) NOT NULL DEFAULT 'IN_SERVICE_DATE',
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (company_id, branch_id, movement_type_code),
  CHECK (minimum_value >= 0),
  CHECK (start_depreciation_rule IN ('PURCHASE_DATE','ACQUISITION_DATE','IN_SERVICE_DATE','NEXT_MONTH'))
);

CREATE INDEX IF NOT EXISTS idx_assets_context ON assets(company_id, branch_id, status, category_id);
CREATE INDEX IF NOT EXISTS idx_assets_responsible ON assets(company_id, branch_id, responsible_id, cost_center_id);
CREATE INDEX IF NOT EXISTS idx_assets_purchase_movement ON assets(company_id, branch_id, purchase_movement_id);
CREATE INDEX IF NOT EXISTS idx_asset_depreciation_period ON asset_depreciation_entries(company_id, branch_id, depreciation_date);

COMMIT;
