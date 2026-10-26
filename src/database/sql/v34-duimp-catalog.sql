BEGIN;

CREATE TABLE IF NOT EXISTS comex_importer_profiles (
  id BIGSERIAL PRIMARY KEY,
  company_id INTEGER NOT NULL,
  branch_id INTEGER NOT NULL,
  client_id INTEGER NOT NULL REFERENCES clients(id),
  importer_document VARCHAR(20) NOT NULL,
  importer_root VARCHAR(8) NOT NULL,
  siscomex_environment VARCHAR(20) NOT NULL DEFAULT 'VALIDATION',
  catalog_manager BOOLEAN NOT NULL DEFAULT FALSE,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(company_id, branch_id, client_id),
  CHECK(siscomex_environment IN ('VALIDATION','PRODUCTION'))
);

CREATE TABLE IF NOT EXISTS comex_foreign_operators (
  id BIGSERIAL PRIMARY KEY,
  company_id INTEGER NOT NULL,
  branch_id INTEGER NOT NULL,
  importer_profile_id BIGINT NOT NULL REFERENCES comex_importer_profiles(id) ON DELETE CASCADE,
  internal_code VARCHAR(60) NOT NULL,
  siscomex_code VARCHAR(80),
  operator_type VARCHAR(30) NOT NULL,
  name VARCHAR(200) NOT NULL,
  country_code CHAR(2) NOT NULL,
  tax_identifier VARCHAR(80),
  address TEXT,
  city VARCHAR(120),
  version_number INTEGER NOT NULL DEFAULT 1,
  status VARCHAR(30) NOT NULL DEFAULT 'DRAFT',
  last_submission_id BIGINT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(importer_profile_id, internal_code),
  CHECK(operator_type IN ('MANUFACTURER','PRODUCER','SUPPLIER','EXPORTER','SELLER','OTHER')),
  CHECK(status IN ('DRAFT','PENDING','ACTIVE','REJECTED','INACTIVE'))
);

CREATE TABLE IF NOT EXISTS comex_import_product_catalog (
  id BIGSERIAL PRIMARY KEY,
  company_id INTEGER NOT NULL,
  branch_id INTEGER NOT NULL,
  importer_profile_id BIGINT NOT NULL REFERENCES comex_importer_profiles(id) ON DELETE CASCADE,
  catalog_item_id BIGINT NOT NULL REFERENCES catalog_items(id),
  internal_product_code VARCHAR(60) NOT NULL,
  siscomex_product_code VARCHAR(80),
  version_number INTEGER NOT NULL DEFAULT 1,
  ncm_code VARCHAR(10) NOT NULL,
  denomination VARCHAR(120) NOT NULL,
  detailed_description TEXT NOT NULL,
  measurement_unit VARCHAR(10),
  modality VARCHAR(20) NOT NULL DEFAULT 'IMPORT',
  manufacturer_id BIGINT REFERENCES comex_foreign_operators(id),
  producer_id BIGINT REFERENCES comex_foreign_operators(id),
  country_of_origin CHAR(2),
  effective_from DATE NOT NULL DEFAULT CURRENT_DATE,
  effective_to DATE,
  status VARCHAR(30) NOT NULL DEFAULT 'DRAFT',
  last_submission_id BIGINT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(importer_profile_id, internal_product_code, version_number),
  CHECK(modality IN ('IMPORT','EXPORT','BOTH')),
  CHECK(status IN ('DRAFT','PENDING','ACTIVE','REJECTED','INACTIVE'))
);

CREATE TABLE IF NOT EXISTS comex_catalog_attributes (
  id BIGSERIAL PRIMARY KEY,
  company_id INTEGER NOT NULL,
  branch_id INTEGER NOT NULL,
  catalog_product_id BIGINT NOT NULL REFERENCES comex_import_product_catalog(id) ON DELETE CASCADE,
  attribute_code VARCHAR(80) NOT NULL,
  attribute_name VARCHAR(180),
  domain_code VARCHAR(80),
  value_text TEXT,
  value_number NUMERIC(24,8),
  value_boolean BOOLEAN,
  value_date DATE,
  required BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(catalog_product_id, attribute_code)
);

CREATE TABLE IF NOT EXISTS comex_duimp_declarations (
  id BIGSERIAL PRIMARY KEY,
  company_id INTEGER NOT NULL,
  branch_id INTEGER NOT NULL,
  process_id BIGINT NOT NULL REFERENCES comex_processes(id) ON DELETE CASCADE,
  importer_profile_id BIGINT NOT NULL REFERENCES comex_importer_profiles(id),
  internal_reference VARCHAR(60) NOT NULL,
  duimp_number VARCHAR(80),
  version_number INTEGER NOT NULL DEFAULT 1,
  declaration_type VARCHAR(30) NOT NULL DEFAULT 'CONSUMPTION',
  dispatch_unit_code VARCHAR(30),
  entry_unit_code VARCHAR(30),
  cargo_location_code VARCHAR(60),
  transport_mode VARCHAR(20),
  importer_type VARCHAR(30) NOT NULL DEFAULT 'OWN_ACCOUNT',
  acquirer_client_id INTEGER REFERENCES clients(id),
  ordering_client_id INTEGER REFERENCES clients(id),
  operation_consumption_state CHAR(2),
  operation_consumption_city_code VARCHAR(10),
  general_information TEXT,
  status VARCHAR(30) NOT NULL DEFAULT 'DRAFT',
  last_submission_id BIGINT,
  registered_at TIMESTAMPTZ,
  released_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(company_id, branch_id, internal_reference),
  CHECK(declaration_type IN ('CONSUMPTION','ADMISSION','WAREHOUSE','OTHER')),
  CHECK(importer_type IN ('OWN_ACCOUNT','ON_BEHALF','BY_ORDER')),
  CHECK(status IN ('DRAFT','VALIDATED','QUEUED','SENT','REGISTERED','REQUIREMENT','RELEASED','REJECTED','CANCELLED'))
);

CREATE TABLE IF NOT EXISTS comex_duimp_items (
  id BIGSERIAL PRIMARY KEY,
  company_id INTEGER NOT NULL,
  branch_id INTEGER NOT NULL,
  duimp_id BIGINT NOT NULL REFERENCES comex_duimp_declarations(id) ON DELETE CASCADE,
  sequence INTEGER NOT NULL,
  process_item_id BIGINT REFERENCES comex_process_items(id),
  catalog_product_id BIGINT NOT NULL REFERENCES comex_import_product_catalog(id),
  quantity NUMERIC(18,6) NOT NULL,
  statistical_quantity NUMERIC(18,6),
  commercial_unit VARCHAR(10),
  net_weight NUMERIC(18,6),
  currency_code CHAR(3) NOT NULL DEFAULT 'USD',
  unit_value NUMERIC(18,8) NOT NULL,
  total_value NUMERIC(18,2) NOT NULL,
  incoterm VARCHAR(10),
  condition_sale VARCHAR(30),
  country_acquisition CHAR(2),
  country_origin CHAR(2),
  lpco_number VARCHAR(80),
  legal_basis_code VARCHAR(80),
  other_taxes_due NUMERIC(18,2) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(duimp_id, sequence),
  CHECK(quantity > 0)
);

CREATE TABLE IF NOT EXISTS comex_obligations (
  id BIGSERIAL PRIMARY KEY,
  company_id INTEGER NOT NULL,
  branch_id INTEGER NOT NULL,
  process_id BIGINT NOT NULL REFERENCES comex_processes(id) ON DELETE CASCADE,
  duimp_id BIGINT REFERENCES comex_duimp_declarations(id) ON DELETE CASCADE,
  obligation_type VARCHAR(40) NOT NULL,
  code VARCHAR(80),
  description VARCHAR(240) NOT NULL,
  authority VARCHAR(120),
  due_date DATE,
  required_before_submission BOOLEAN NOT NULL DEFAULT FALSE,
  status VARCHAR(30) NOT NULL DEFAULT 'PENDING',
  external_reference VARCHAR(100),
  evidence_document_id BIGINT REFERENCES comex_documents(id),
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK(obligation_type IN ('CATALOG_PRODUCT','FOREIGN_OPERATOR','LPCO','DOCUMENT','PCCE','TAX','CUSTOMS_DATA','CARGO_DATA','PAYMENT','OTHER')),
  CHECK(status IN ('PENDING','IN_PROGRESS','COMPLETED','WAIVED','BLOCKED','REJECTED'))
);

CREATE TABLE IF NOT EXISTS comex_api_submissions (
  id BIGSERIAL PRIMARY KEY,
  company_id INTEGER NOT NULL,
  branch_id INTEGER NOT NULL,
  process_id BIGINT REFERENCES comex_processes(id) ON DELETE CASCADE,
  resource_type VARCHAR(40) NOT NULL,
  resource_id BIGINT NOT NULL,
  operation VARCHAR(30) NOT NULL,
  environment VARCHAR(20) NOT NULL,
  idempotency_key VARCHAR(100) NOT NULL,
  endpoint_path TEXT,
  request_payload JSONB NOT NULL,
  response_status INTEGER,
  response_payload JSONB,
  protocol_number VARCHAR(120),
  status VARCHAR(30) NOT NULL DEFAULT 'QUEUED',
  attempt_count INTEGER NOT NULL DEFAULT 0,
  error_message TEXT,
  submitted_by INTEGER REFERENCES users(id),
  submitted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(company_id, branch_id, idempotency_key),
  CHECK(resource_type IN ('FOREIGN_OPERATOR','CATALOG_PRODUCT','DUIMP','LPCO','DOCUMENT')),
  CHECK(status IN ('QUEUED','SENDING','SENT','ACCEPTED','REJECTED','ERROR','SIMULATED'))
);

CREATE INDEX IF NOT EXISTS idx_comex_catalog_client ON comex_import_product_catalog(company_id,branch_id,importer_profile_id,status,ncm_code);
CREATE INDEX IF NOT EXISTS idx_comex_duimp_process ON comex_duimp_declarations(company_id,branch_id,process_id,status);
CREATE INDEX IF NOT EXISTS idx_comex_obligation_status ON comex_obligations(company_id,branch_id,process_id,status,due_date);
CREATE INDEX IF NOT EXISTS idx_comex_submission_queue ON comex_api_submissions(status,created_at);

COMMIT;
