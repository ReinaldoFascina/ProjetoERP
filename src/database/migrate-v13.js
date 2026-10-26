import { db } from "./db.js";

const migration = `
CREATE TABLE IF NOT EXISTS catalog_items (
  id SERIAL PRIMARY KEY,
  item_type VARCHAR(20) NOT NULL CHECK (item_type IN ('SERVICO','PRODUTO')),
  code VARCHAR(60) UNIQUE NOT NULL,
  description VARCHAR(250) NOT NULL,
  unit VARCHAR(20) NOT NULL DEFAULT 'UN',
  sale_price NUMERIC(14,4) NOT NULL DEFAULT 0,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  gtin VARCHAR(30), ncm VARCHAR(20), cest VARCHAR(20), cfop VARCHAR(10),
  fiscal_origin VARCHAR(5), cst_icms VARCHAR(10), csosn VARCHAR(10),
  icms_rate NUMERIC(8,4) NOT NULL DEFAULT 0,
  ipi_rate NUMERIC(8,4) NOT NULL DEFAULT 0,
  pis_cst VARCHAR(10), pis_rate NUMERIC(8,4) NOT NULL DEFAULT 0,
  cofins_cst VARCHAR(10), cofins_rate NUMERIC(8,4) NOT NULL DEFAULT 0,
  national_service_code VARCHAR(30), lc116_code VARCHAR(30),
  nbs_code VARCHAR(30), cnae VARCHAR(20), municipality_code VARCHAR(20),
  iss_rate NUMERIC(8,4) NOT NULL DEFAULT 0,
  service_description TEXT, notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE rats ADD COLUMN IF NOT EXISTS catalog_item_id INT REFERENCES catalog_items(id);
CREATE INDEX IF NOT EXISTS idx_rats_catalog_item ON rats(catalog_item_id);

ALTER TABLE billing_movement_items ADD COLUMN IF NOT EXISTS sequence INT NOT NULL DEFAULT 1;
ALTER TABLE billing_movement_items ADD COLUMN IF NOT EXISTS catalog_item_id INT REFERENCES catalog_items(id);
ALTER TABLE billing_movement_items ADD COLUMN IF NOT EXISTS service_date DATE;
ALTER TABLE billing_movement_items ADD COLUMN IF NOT EXISTS notes TEXT;
ALTER TABLE billing_movement_items ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
ALTER TABLE billing_movement_items ADD COLUMN IF NOT EXISTS national_service_code VARCHAR(30);
ALTER TABLE billing_movement_items ADD COLUMN IF NOT EXISTS nbs_code VARCHAR(30);
ALTER TABLE billing_movement_items ADD COLUMN IF NOT EXISTS ncm VARCHAR(20);
ALTER TABLE billing_movement_items ADD COLUMN IF NOT EXISTS cest VARCHAR(20);
ALTER TABLE billing_movement_items ADD COLUMN IF NOT EXISTS cfop VARCHAR(10);
ALTER TABLE billing_movement_items ADD COLUMN IF NOT EXISTS fiscal_origin VARCHAR(5);
ALTER TABLE billing_movement_items ADD COLUMN IF NOT EXISTS cst_icms VARCHAR(10);
ALTER TABLE billing_movement_items ADD COLUMN IF NOT EXISTS csosn VARCHAR(10);
ALTER TABLE billing_movement_items ADD COLUMN IF NOT EXISTS icms_rate NUMERIC(8,4) NOT NULL DEFAULT 0;
ALTER TABLE billing_movement_items ADD COLUMN IF NOT EXISTS ipi_rate NUMERIC(8,4) NOT NULL DEFAULT 0;
ALTER TABLE billing_movement_items ADD COLUMN IF NOT EXISTS pis_cst VARCHAR(10);
ALTER TABLE billing_movement_items ADD COLUMN IF NOT EXISTS pis_rate NUMERIC(8,4) NOT NULL DEFAULT 0;
ALTER TABLE billing_movement_items ADD COLUMN IF NOT EXISTS cofins_cst VARCHAR(10);
ALTER TABLE billing_movement_items ADD COLUMN IF NOT EXISTS cofins_rate NUMERIC(8,4) NOT NULL DEFAULT 0;
ALTER TABLE billing_movement_items ADD COLUMN IF NOT EXISTS lc116_code VARCHAR(30);
ALTER TABLE billing_movement_items ADD COLUMN IF NOT EXISTS cnae VARCHAR(20);
ALTER TABLE billing_movement_items ADD COLUMN IF NOT EXISTS municipality_code VARCHAR(20);
ALTER TABLE billing_movement_items ADD COLUMN IF NOT EXISTS iss_rate NUMERIC(8,4) NOT NULL DEFAULT 0;
ALTER TABLE billing_movement_items ADD COLUMN IF NOT EXISTS iss_value NUMERIC(14,2) NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_catalog_items_type_active ON catalog_items(item_type,active);
CREATE INDEX IF NOT EXISTS idx_billing_item_service_date ON billing_movement_items(service_date);
CREATE INDEX IF NOT EXISTS idx_billing_item_catalog ON billing_movement_items(catalog_item_id);
`;

try {
  console.log("Aplicando migração v13...");
  await db.query("BEGIN");
  await db.query(migration);
  await db.query("COMMIT");

  const { rows } = await db.query(`
    SELECT table_name, column_name, data_type
    FROM information_schema.columns
    WHERE table_schema='public'
      AND table_name='billing_movement_items'
      AND ((table_name='billing_movement_items' AND column_name IN ('service_date','catalog_item_id','sequence','ncm')) OR (table_name='rats' AND column_name='catalog_item_id'))
    ORDER BY column_name
  `);
  console.log("Migração v13 concluída.");
  console.table(rows);
} catch (error) {
  await db.query("ROLLBACK");
  console.error("Falha na migração v13:", error.message);
  console.error("Código:", error.code);
  process.exitCode = 1;
} finally {
  await db.end();
}
