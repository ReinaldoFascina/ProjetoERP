BEGIN;

CREATE TABLE IF NOT EXISTS maintenance_assets (
  id BIGSERIAL PRIMARY KEY,
  company_id INTEGER NOT NULL,
  branch_id INTEGER NOT NULL,
  code VARCHAR(40) NOT NULL,
  name VARCHAR(180) NOT NULL,
  asset_type VARCHAR(30) NOT NULL,
  production_machine_id BIGINT REFERENCES production_machines(id),
  patrimonial_asset_id BIGINT REFERENCES assets(id),
  catalog_item_id BIGINT REFERENCES catalog_items(id),
  parent_asset_id BIGINT REFERENCES maintenance_assets(id),
  manufacturer VARCHAR(100),
  model VARCHAR(100),
  serial_number VARCHAR(100),
  plate_number VARCHAR(20),
  odometer NUMERIC(18,2) NOT NULL DEFAULT 0,
  hour_meter NUMERIC(18,2) NOT NULL DEFAULT 0,
  location VARCHAR(200),
  cost_center_id BIGINT REFERENCES accounting_cost_centers(id),
  responsible_id BIGINT REFERENCES asset_responsibles(id),
  status VARCHAR(30) NOT NULL DEFAULT 'AVAILABLE',
  criticality VARCHAR(20) NOT NULL DEFAULT 'MEDIUM',
  active BOOLEAN NOT NULL DEFAULT TRUE,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(company_id, branch_id, code),
  CHECK(asset_type IN ('MACHINE','VEHICLE','PROPERTY','FURNITURE','EQUIPMENT','OTHER')),
  CHECK(status IN ('AVAILABLE','IN_USE','STOPPED','IN_MAINTENANCE','DISABLED')),
  CHECK(criticality IN ('LOW','MEDIUM','HIGH','CRITICAL'))
);

CREATE TABLE IF NOT EXISTS maintenance_service_types (
  id BIGSERIAL PRIMARY KEY,
  company_id INTEGER NOT NULL,
  branch_id INTEGER NOT NULL,
  code VARCHAR(30) NOT NULL,
  name VARCHAR(160) NOT NULL,
  maintenance_type VARCHAR(20) NOT NULL,
  default_duration_minutes INTEGER NOT NULL DEFAULT 0,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  UNIQUE(company_id, branch_id, code),
  CHECK(maintenance_type IN ('PREVENTIVE','CORRECTIVE','PREDICTIVE','INSPECTION'))
);

CREATE TABLE IF NOT EXISTS maintenance_plans (
  id BIGSERIAL PRIMARY KEY,
  company_id INTEGER NOT NULL,
  branch_id INTEGER NOT NULL,
  code VARCHAR(40) NOT NULL,
  name VARCHAR(180) NOT NULL,
  maintenance_asset_id BIGINT REFERENCES maintenance_assets(id),
  asset_type VARCHAR(30),
  service_type_id BIGINT NOT NULL REFERENCES maintenance_service_types(id),
  trigger_type VARCHAR(30) NOT NULL,
  interval_days INTEGER,
  interval_odometer NUMERIC(18,2),
  interval_hours NUMERIC(18,2),
  last_execution_date DATE,
  last_odometer NUMERIC(18,2),
  last_hour_meter NUMERIC(18,2),
  next_execution_date DATE,
  next_odometer NUMERIC(18,2),
  next_hour_meter NUMERIC(18,2),
  priority VARCHAR(20) NOT NULL DEFAULT 'NORMAL',
  active BOOLEAN NOT NULL DEFAULT TRUE,
  instructions TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(company_id, branch_id, code),
  CHECK(trigger_type IN ('DATE','ODOMETER','HOUR_METER','MIXED')),
  CHECK(priority IN ('LOW','NORMAL','HIGH','URGENT'))
);

CREATE TABLE IF NOT EXISTS maintenance_plan_items (
  id BIGSERIAL PRIMARY KEY,
  company_id INTEGER NOT NULL,
  branch_id INTEGER NOT NULL,
  plan_id BIGINT NOT NULL REFERENCES maintenance_plans(id) ON DELETE CASCADE,
  catalog_item_id BIGINT NOT NULL REFERENCES catalog_items(id),
  quantity NUMERIC(18,6) NOT NULL DEFAULT 1,
  warehouse_id BIGINT,
  required BOOLEAN NOT NULL DEFAULT TRUE,
  notes TEXT,
  UNIQUE(plan_id, catalog_item_id),
  CHECK(quantity > 0)
);

CREATE TABLE IF NOT EXISTS maintenance_orders (
  id BIGSERIAL PRIMARY KEY,
  company_id INTEGER NOT NULL,
  branch_id INTEGER NOT NULL,
  order_number VARCHAR(40) NOT NULL,
  maintenance_asset_id BIGINT NOT NULL REFERENCES maintenance_assets(id),
  plan_id BIGINT REFERENCES maintenance_plans(id),
  service_type_id BIGINT REFERENCES maintenance_service_types(id),
  maintenance_type VARCHAR(20) NOT NULL,
  title VARCHAR(200) NOT NULL,
  problem_description TEXT,
  diagnosis TEXT,
  solution TEXT,
  priority VARCHAR(20) NOT NULL DEFAULT 'NORMAL',
  status VARCHAR(30) NOT NULL DEFAULT 'OPEN',
  requested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  scheduled_start TIMESTAMPTZ,
  scheduled_end TIMESTAMPTZ,
  actual_start TIMESTAMPTZ,
  actual_end TIMESTAMPTZ,
  odometer NUMERIC(18,2),
  hour_meter NUMERIC(18,2),
  downtime_minutes NUMERIC(18,2) NOT NULL DEFAULT 0,
  internal_labor_cost NUMERIC(18,2) NOT NULL DEFAULT 0,
  external_service_cost NUMERIC(18,2) NOT NULL DEFAULT 0,
  parts_cost NUMERIC(18,2) NOT NULL DEFAULT 0,
  other_cost NUMERIC(18,2) NOT NULL DEFAULT 0,
  total_cost NUMERIC(18,2) NOT NULL DEFAULT 0,
  supplier_id INTEGER REFERENCES clients(id),
  cost_center_id BIGINT REFERENCES accounting_cost_centers(id),
  requested_by INTEGER REFERENCES users(id),
  assigned_to INTEGER REFERENCES users(id),
  approved_by INTEGER REFERENCES users(id),
  closed_by INTEGER REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(company_id, branch_id, order_number),
  CHECK(maintenance_type IN ('PREVENTIVE','CORRECTIVE','PREDICTIVE','INSPECTION')),
  CHECK(priority IN ('LOW','NORMAL','HIGH','URGENT')),
  CHECK(status IN ('OPEN','PLANNED','APPROVED','IN_PROGRESS','PAUSED','COMPLETED','CANCELLED'))
);

CREATE TABLE IF NOT EXISTS maintenance_order_parts (
  id BIGSERIAL PRIMARY KEY,
  company_id INTEGER NOT NULL,
  branch_id INTEGER NOT NULL,
  order_id BIGINT NOT NULL REFERENCES maintenance_orders(id) ON DELETE CASCADE,
  catalog_item_id BIGINT NOT NULL REFERENCES catalog_items(id),
  quantity NUMERIC(18,6) NOT NULL,
  unit_cost NUMERIC(18,6) NOT NULL DEFAULT 0,
  total_cost NUMERIC(18,2) NOT NULL DEFAULT 0,
  stock_transaction_id BIGINT,
  old_part_serial VARCHAR(100),
  new_part_serial VARCHAR(100),
  position VARCHAR(80),
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK(quantity > 0),
  CHECK(unit_cost >= 0),
  CHECK(total_cost >= 0)
);

CREATE TABLE IF NOT EXISTS maintenance_order_labor (
  id BIGSERIAL PRIMARY KEY,
  company_id INTEGER NOT NULL,
  branch_id INTEGER NOT NULL,
  order_id BIGINT NOT NULL REFERENCES maintenance_orders(id) ON DELETE CASCADE,
  technician_id INTEGER REFERENCES users(id),
  work_date DATE NOT NULL,
  minutes_worked NUMERIC(18,2) NOT NULL,
  hourly_cost NUMERIC(18,4) NOT NULL DEFAULT 0,
  total_cost NUMERIC(18,2) NOT NULL DEFAULT 0,
  description TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK(minutes_worked > 0)
);

CREATE TABLE IF NOT EXISTS maintenance_asset_components (
  id BIGSERIAL PRIMARY KEY,
  company_id INTEGER NOT NULL,
  branch_id INTEGER NOT NULL,
  maintenance_asset_id BIGINT NOT NULL REFERENCES maintenance_assets(id) ON DELETE CASCADE,
  catalog_item_id BIGINT REFERENCES catalog_items(id),
  component_type VARCHAR(50) NOT NULL,
  position VARCHAR(80),
  serial_number VARCHAR(100),
  installation_date DATE,
  installation_odometer NUMERIC(18,2),
  installation_hour_meter NUMERIC(18,2),
  expected_life_km NUMERIC(18,2),
  expected_life_hours NUMERIC(18,2),
  removed_date DATE,
  removed_order_id BIGINT REFERENCES maintenance_orders(id),
  status VARCHAR(20) NOT NULL DEFAULT 'INSTALLED',
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK(status IN ('INSTALLED','REMOVED','SCRAPPED','RECONDITIONED'))
);

CREATE INDEX IF NOT EXISTS idx_maintenance_asset_context ON maintenance_assets(company_id,branch_id,status,asset_type);
CREATE INDEX IF NOT EXISTS idx_maintenance_order_context ON maintenance_orders(company_id,branch_id,status,maintenance_type);
CREATE INDEX IF NOT EXISTS idx_maintenance_plan_due ON maintenance_plans(company_id,branch_id,active,next_execution_date);
CREATE INDEX IF NOT EXISTS idx_maintenance_parts_order ON maintenance_order_parts(order_id,catalog_item_id);

ALTER TABLE CATALOG_ITEMS ADD COLUMN IF NOT EXISTS cost_price NUMERIC(18,2) DEFAULT 0;

COMMIT;
