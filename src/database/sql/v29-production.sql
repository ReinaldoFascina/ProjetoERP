BEGIN;

CREATE TABLE IF NOT EXISTS production_machines (
  id BIGSERIAL PRIMARY KEY,
  company_id INTEGER NOT NULL,
  branch_id INTEGER NOT NULL,
  code VARCHAR(30) NOT NULL,
  name VARCHAR(160) NOT NULL,
  machine_group VARCHAR(80),
  manufacturer VARCHAR(100),
  model VARCHAR(100),
  serial_number VARCHAR(100),
  hourly_cost NUMERIC(18,4) NOT NULL DEFAULT 0,
  efficiency_percent NUMERIC(9,4) NOT NULL DEFAULT 100,
  capacity_minutes_day INTEGER NOT NULL DEFAULT 480,
  status VARCHAR(20) NOT NULL DEFAULT 'AVAILABLE',
  active BOOLEAN NOT NULL DEFAULT TRUE,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (company_id, branch_id, code),
  CHECK (hourly_cost >= 0),
  CHECK (efficiency_percent > 0 AND efficiency_percent <= 200),
  CHECK (capacity_minutes_day >= 0),
  CHECK (status IN ('AVAILABLE','IN_PRODUCTION','MAINTENANCE','STOPPED'))
);

CREATE TABLE IF NOT EXISTS production_machine_capacity (
  id BIGSERIAL PRIMARY KEY,
  company_id INTEGER NOT NULL,
  branch_id INTEGER NOT NULL,
  machine_id BIGINT NOT NULL REFERENCES production_machines(id),
  capacity_date DATE NOT NULL,
  shift_code VARCHAR(20) NOT NULL DEFAULT 'GENERAL',
  available_minutes INTEGER NOT NULL DEFAULT 0,
  planned_stop_minutes INTEGER NOT NULL DEFAULT 0,
  allocated_minutes INTEGER NOT NULL DEFAULT 0,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (company_id, branch_id, machine_id, capacity_date, shift_code),
  CHECK (available_minutes >= 0),
  CHECK (planned_stop_minutes >= 0),
  CHECK (allocated_minutes >= 0)
);

CREATE TABLE IF NOT EXISTS production_bom_headers (
  id BIGSERIAL PRIMARY KEY,
  company_id INTEGER NOT NULL,
  branch_id INTEGER NOT NULL,
  product_id BIGINT NOT NULL REFERENCES catalog_items(id),
  version VARCHAR(30) NOT NULL DEFAULT '1.0',
  description VARCHAR(200),
  base_quantity NUMERIC(18,6) NOT NULL DEFAULT 1,
  valid_from DATE,
  valid_to DATE,
  status VARCHAR(20) NOT NULL DEFAULT 'DRAFT',
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (company_id, branch_id, product_id, version),
  CHECK (base_quantity > 0),
  CHECK (status IN ('DRAFT','RELEASED','BLOCKED','OBSOLETE'))
);

CREATE TABLE IF NOT EXISTS production_bom_items (
  id BIGSERIAL PRIMARY KEY,
  company_id INTEGER NOT NULL,
  branch_id INTEGER NOT NULL,
  bom_id BIGINT NOT NULL REFERENCES production_bom_headers(id) ON DELETE CASCADE,
  sequence INTEGER NOT NULL,
  component_id BIGINT NOT NULL REFERENCES catalog_items(id),
  quantity NUMERIC(18,6) NOT NULL,
  loss_percent NUMERIC(9,4) NOT NULL DEFAULT 0,
  issue_type VARCHAR(20) NOT NULL DEFAULT 'MANUAL',
  warehouse_id BIGINT,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (bom_id, sequence),
  UNIQUE (bom_id, component_id),
  CHECK (quantity > 0),
  CHECK (loss_percent >= 0 AND loss_percent <= 100),
  CHECK (issue_type IN ('MANUAL','BACKFLUSH'))
);

CREATE TABLE IF NOT EXISTS production_routings (
  id BIGSERIAL PRIMARY KEY,
  company_id INTEGER NOT NULL,
  branch_id INTEGER NOT NULL,
  product_id BIGINT NOT NULL REFERENCES catalog_items(id),
  version VARCHAR(30) NOT NULL DEFAULT '1.0',
  description VARCHAR(200),
  base_quantity NUMERIC(18,6) NOT NULL DEFAULT 1,
  status VARCHAR(20) NOT NULL DEFAULT 'DRAFT',
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (company_id, branch_id, product_id, version),
  CHECK (base_quantity > 0),
  CHECK (status IN ('DRAFT','RELEASED','BLOCKED','OBSOLETE'))
);

CREATE TABLE IF NOT EXISTS production_routing_operations (
  id BIGSERIAL PRIMARY KEY,
  company_id INTEGER NOT NULL,
  branch_id INTEGER NOT NULL,
  routing_id BIGINT NOT NULL REFERENCES production_routings(id) ON DELETE CASCADE,
  sequence INTEGER NOT NULL,
  operation_code VARCHAR(30) NOT NULL,
  operation_name VARCHAR(160) NOT NULL,
  machine_id BIGINT REFERENCES production_machines(id),
  setup_minutes NUMERIC(18,4) NOT NULL DEFAULT 0,
  run_minutes NUMERIC(18,6) NOT NULL DEFAULT 0,
  queue_minutes NUMERIC(18,4) NOT NULL DEFAULT 0,
  labor_quantity NUMERIC(18,4) NOT NULL DEFAULT 1,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (routing_id, sequence),
  CHECK (setup_minutes >= 0),
  CHECK (run_minutes >= 0),
  CHECK (queue_minutes >= 0),
  CHECK (labor_quantity >= 0)
);

CREATE TABLE IF NOT EXISTS production_orders (
  id BIGSERIAL PRIMARY KEY,
  company_id INTEGER NOT NULL,
  branch_id INTEGER NOT NULL,
  order_number VARCHAR(40) NOT NULL,
  product_id BIGINT NOT NULL REFERENCES catalog_items(id),
  bom_id BIGINT REFERENCES production_bom_headers(id),
  routing_id BIGINT REFERENCES production_routings(id),
  planned_quantity NUMERIC(18,6) NOT NULL,
  produced_quantity NUMERIC(18,6) NOT NULL DEFAULT 0,
  rejected_quantity NUMERIC(18,6) NOT NULL DEFAULT 0,
  planned_start TIMESTAMPTZ,
  planned_end TIMESTAMPTZ,
  actual_start TIMESTAMPTZ,
  actual_end TIMESTAMPTZ,
  priority INTEGER NOT NULL DEFAULT 5,
  status VARCHAR(20) NOT NULL DEFAULT 'PLANNED',
  notes TEXT,
  created_by INTEGER REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (company_id, branch_id, order_number),
  CHECK (planned_quantity > 0),
  CHECK (produced_quantity >= 0),
  CHECK (rejected_quantity >= 0),
  CHECK (priority BETWEEN 1 AND 10),
  CHECK (status IN ('PLANNED','RELEASED','IN_PROGRESS','PAUSED','COMPLETED','CANCELLED'))
);

CREATE TABLE IF NOT EXISTS production_order_operations (
  id BIGSERIAL PRIMARY KEY,
  company_id INTEGER NOT NULL,
  branch_id INTEGER NOT NULL,
  order_id BIGINT NOT NULL REFERENCES production_orders(id) ON DELETE CASCADE,
  routing_operation_id BIGINT REFERENCES production_routing_operations(id),
  sequence INTEGER NOT NULL,
  operation_code VARCHAR(30) NOT NULL,
  operation_name VARCHAR(160) NOT NULL,
  machine_id BIGINT REFERENCES production_machines(id),
  setup_minutes_planned NUMERIC(18,4) NOT NULL DEFAULT 0,
  run_minutes_planned NUMERIC(18,4) NOT NULL DEFAULT 0,
  setup_minutes_actual NUMERIC(18,4) NOT NULL DEFAULT 0,
  run_minutes_actual NUMERIC(18,4) NOT NULL DEFAULT 0,
  good_quantity NUMERIC(18,6) NOT NULL DEFAULT 0,
  rejected_quantity NUMERIC(18,6) NOT NULL DEFAULT 0,
  status VARCHAR(20) NOT NULL DEFAULT 'PENDING',
  started_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ,
  UNIQUE (order_id, sequence),
  CHECK (status IN ('PENDING','READY','IN_PROGRESS','PAUSED','COMPLETED','CANCELLED'))
);

CREATE TABLE IF NOT EXISTS production_reports (
  id BIGSERIAL PRIMARY KEY,
  company_id INTEGER NOT NULL,
  branch_id INTEGER NOT NULL,
  order_id BIGINT NOT NULL REFERENCES production_orders(id),
  operation_id BIGINT NOT NULL REFERENCES production_order_operations(id),
  machine_id BIGINT REFERENCES production_machines(id),
  report_date DATE NOT NULL,
  start_time TIMESTAMPTZ,
  end_time TIMESTAMPTZ,
  worked_minutes NUMERIC(18,4) NOT NULL DEFAULT 0,
  produced_quantity NUMERIC(18,6) NOT NULL DEFAULT 0,
  rejected_quantity NUMERIC(18,6) NOT NULL DEFAULT 0,
  downtime_minutes NUMERIC(18,4) NOT NULL DEFAULT 0,
  downtime_reason VARCHAR(200),
  operator_id INTEGER REFERENCES users(id),
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (worked_minutes >= 0),
  CHECK (produced_quantity >= 0),
  CHECK (rejected_quantity >= 0),
  CHECK (downtime_minutes >= 0)
);

CREATE INDEX IF NOT EXISTS idx_production_machine_context ON production_machines(company_id, branch_id, active, code);
CREATE INDEX IF NOT EXISTS idx_production_bom_product ON production_bom_headers(company_id, branch_id, product_id, status);
CREATE INDEX IF NOT EXISTS idx_production_routing_product ON production_routings(company_id, branch_id, product_id, status);
CREATE INDEX IF NOT EXISTS idx_production_orders_period ON production_orders(company_id, branch_id, status, planned_start);
CREATE INDEX IF NOT EXISTS idx_production_reports_machine ON production_reports(company_id, branch_id, machine_id, report_date);

COMMIT;
