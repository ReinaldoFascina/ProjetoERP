BEGIN;

CREATE TABLE IF NOT EXISTS real_estate_developments (
  id BIGSERIAL PRIMARY KEY,
  company_id INTEGER NOT NULL,
  branch_id INTEGER NOT NULL,
  code VARCHAR(40) NOT NULL,
  name VARCHAR(180) NOT NULL,
  development_type VARCHAR(30) NOT NULL DEFAULT 'SUBDIVISION',
  description TEXT,
  registration_number VARCHAR(100),
  city VARCHAR(100),
  state CHAR(2),
  address VARCHAR(200),
  launch_date DATE,
  expected_delivery_date DATE,
  status VARCHAR(30) NOT NULL DEFAULT 'PLANNING',
  cost_center_id BIGINT REFERENCES accounting_cost_centers(id),
  revenue_account_id BIGINT REFERENCES accounting_accounts(id),
  receivable_account_id BIGINT REFERENCES accounting_accounts(id),
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(company_id, branch_id, code),
  CHECK(development_type IN ('SUBDIVISION','CONDOMINIUM','BUILDING','COMMERCIAL','OTHER')),
  CHECK(status IN ('PLANNING','PRE_LAUNCH','LAUNCHED','IN_PROGRESS','DELIVERED','SUSPENDED','CANCELLED'))
);

CREATE TABLE IF NOT EXISTS real_estate_blocks (
  id BIGSERIAL PRIMARY KEY,
  company_id INTEGER NOT NULL,
  branch_id INTEGER NOT NULL,
  development_id BIGINT NOT NULL REFERENCES real_estate_developments(id) ON DELETE CASCADE,
  code VARCHAR(40) NOT NULL,
  name VARCHAR(120) NOT NULL,
  sequence INTEGER NOT NULL DEFAULT 1,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  UNIQUE(development_id, code)
);

CREATE TABLE IF NOT EXISTS real_estate_units (
  id BIGSERIAL PRIMARY KEY,
  company_id INTEGER NOT NULL,
  branch_id INTEGER NOT NULL,
  development_id BIGINT NOT NULL REFERENCES real_estate_developments(id),
  block_id BIGINT REFERENCES real_estate_blocks(id),
  code VARCHAR(50) NOT NULL,
  unit_type VARCHAR(30) NOT NULL DEFAULT 'LOT',
  area NUMERIC(18,4) NOT NULL DEFAULT 0,
  private_area NUMERIC(18,4),
  common_area NUMERIC(18,4),
  frontage NUMERIC(18,4),
  depth NUMERIC(18,4),
  registration_number VARCHAR(100),
  municipal_registration VARCHAR(100),
  list_price NUMERIC(18,2) NOT NULL DEFAULT 0,
  minimum_price NUMERIC(18,2) NOT NULL DEFAULT 0,
  status VARCHAR(30) NOT NULL DEFAULT 'AVAILABLE',
  reserved_until TIMESTAMPTZ,
  notes TEXT,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(development_id, code),
  CHECK(unit_type IN ('LOT','HOUSE','APARTMENT','STORE','OFFICE','GARAGE','OTHER')),
  CHECK(status IN ('AVAILABLE','QUOTED','RESERVED','SOLD','BLOCKED','CANCELLED')),
  CHECK(area >= 0),
  CHECK(list_price >= 0),
  CHECK(minimum_price >= 0)
);

CREATE TABLE IF NOT EXISTS real_estate_quotes (
  id BIGSERIAL PRIMARY KEY,
  company_id INTEGER NOT NULL,
  branch_id INTEGER NOT NULL,
  quote_number VARCHAR(40) NOT NULL,
  development_id BIGINT NOT NULL REFERENCES real_estate_developments(id),
  unit_id BIGINT NOT NULL REFERENCES real_estate_units(id),
  customer_id INTEGER NOT NULL REFERENCES clients(id),
  salesperson_id INTEGER REFERENCES users(id),
  quote_date DATE NOT NULL DEFAULT CURRENT_DATE,
  valid_until DATE NOT NULL,
  list_price NUMERIC(18,2) NOT NULL,
  discount_amount NUMERIC(18,2) NOT NULL DEFAULT 0,
  negotiated_price NUMERIC(18,2) NOT NULL,
  down_payment NUMERIC(18,2) NOT NULL DEFAULT 0,
  installment_count INTEGER NOT NULL DEFAULT 1,
  monthly_interest_rate NUMERIC(12,8) NOT NULL DEFAULT 0,
  correction_index VARCHAR(30),
  first_due_date DATE,
  status VARCHAR(30) NOT NULL DEFAULT 'DRAFT',
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(company_id, branch_id, quote_number),
  CHECK(status IN ('DRAFT','SENT','APPROVED','REJECTED','EXPIRED','CONVERTED','CANCELLED')),
  CHECK(negotiated_price >= 0),
  CHECK(installment_count > 0)
);

CREATE TABLE IF NOT EXISTS real_estate_sales (
  id BIGSERIAL PRIMARY KEY,
  company_id INTEGER NOT NULL,
  branch_id INTEGER NOT NULL,
  sale_number VARCHAR(40) NOT NULL,
  quote_id BIGINT REFERENCES real_estate_quotes(id),
  development_id BIGINT NOT NULL REFERENCES real_estate_developments(id),
  unit_id BIGINT NOT NULL REFERENCES real_estate_units(id),
  customer_id INTEGER NOT NULL REFERENCES clients(id),
  salesperson_id INTEGER REFERENCES users(id),
  contract_date DATE NOT NULL,
  contract_number VARCHAR(80),
  sale_price NUMERIC(18,2) NOT NULL,
  down_payment NUMERIC(18,2) NOT NULL DEFAULT 0,
  financed_amount NUMERIC(18,2) NOT NULL DEFAULT 0,
  installment_count INTEGER NOT NULL DEFAULT 1,
  monthly_interest_rate NUMERIC(12,8) NOT NULL DEFAULT 0,
  correction_index VARCHAR(30),
  first_due_date DATE,
  status VARCHAR(30) NOT NULL DEFAULT 'ACTIVE',
  notes TEXT,
  created_by INTEGER REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(company_id, branch_id, sale_number),
  UNIQUE(unit_id) DEFERRABLE INITIALLY IMMEDIATE,
  CHECK(status IN ('ACTIVE','PAID','DEFAULTED','CANCELLED','RESCINDED'))
);

CREATE TABLE IF NOT EXISTS real_estate_installments (
  id BIGSERIAL PRIMARY KEY,
  company_id INTEGER NOT NULL,
  branch_id INTEGER NOT NULL,
  sale_id BIGINT NOT NULL REFERENCES real_estate_sales(id) ON DELETE CASCADE,
  installment_number INTEGER NOT NULL,
  installment_type VARCHAR(30) NOT NULL DEFAULT 'MONTHLY',
  due_date DATE NOT NULL,
  original_amount NUMERIC(18,2) NOT NULL,
  correction_amount NUMERIC(18,2) NOT NULL DEFAULT 0,
  interest_amount NUMERIC(18,2) NOT NULL DEFAULT 0,
  penalty_amount NUMERIC(18,2) NOT NULL DEFAULT 0,
  discount_amount NUMERIC(18,2) NOT NULL DEFAULT 0,
  paid_amount NUMERIC(18,2) NOT NULL DEFAULT 0,
  open_amount NUMERIC(18,2) NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'OPEN',
  financial_title_id BIGINT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(sale_id, installment_number),
  CHECK(installment_type IN ('DOWN_PAYMENT','MONTHLY','INTERMEDIATE','ANNUAL','BALLOON','OTHER')),
  CHECK(status IN ('OPEN','PARTIAL','PAID','OVERDUE','CANCELLED','RENEGOTIATED'))
);

CREATE TABLE IF NOT EXISTS real_estate_payments (
  id BIGSERIAL PRIMARY KEY,
  company_id INTEGER NOT NULL,
  branch_id INTEGER NOT NULL,
  installment_id BIGINT NOT NULL REFERENCES real_estate_installments(id),
  payment_date DATE NOT NULL,
  amount NUMERIC(18,2) NOT NULL,
  interest_amount NUMERIC(18,2) NOT NULL DEFAULT 0,
  penalty_amount NUMERIC(18,2) NOT NULL DEFAULT 0,
  discount_amount NUMERIC(18,2) NOT NULL DEFAULT 0,
  payment_method_id BIGINT,
  cash_account_id BIGINT,
  receipt_number VARCHAR(80),
  notes TEXT,
  received_by INTEGER REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK(amount > 0)
);

CREATE INDEX IF NOT EXISTS idx_re_units_status ON real_estate_units(company_id, branch_id, development_id, status);
CREATE INDEX IF NOT EXISTS idx_re_quotes_status ON real_estate_quotes(company_id, branch_id, status, valid_until);
CREATE INDEX IF NOT EXISTS idx_re_sales_customer ON real_estate_sales(company_id, branch_id, customer_id, status);
CREATE INDEX IF NOT EXISTS idx_re_installments_due ON real_estate_installments(company_id, branch_id, status, due_date);

COMMIT;
