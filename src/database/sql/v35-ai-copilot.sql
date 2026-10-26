BEGIN;

CREATE TABLE IF NOT EXISTS ai_conversations (
  id BIGSERIAL PRIMARY KEY,
  company_id INTEGER NOT NULL,
  branch_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL REFERENCES users(id),
  module_key VARCHAR(40),
  entity_type VARCHAR(80),
  entity_id BIGINT,
  page_path TEXT,
  title VARCHAR(200),
  summary JSONB,
  status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK(status IN ('ACTIVE','ARCHIVED','CLOSED'))
);

CREATE TABLE IF NOT EXISTS ai_messages (
  id BIGSERIAL PRIMARY KEY,
  conversation_id BIGINT NOT NULL REFERENCES ai_conversations(id) ON DELETE CASCADE,
  role VARCHAR(20) NOT NULL,
  content TEXT NOT NULL,
  structured_content JSONB,
  model_name VARCHAR(100),
  input_tokens INTEGER,
  output_tokens INTEGER,
  latency_ms INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK(role IN ('SYSTEM','USER','ASSISTANT','TOOL'))
);

CREATE TABLE IF NOT EXISTS ai_tool_executions (
  id BIGSERIAL PRIMARY KEY,
  conversation_id BIGINT NOT NULL REFERENCES ai_conversations(id) ON DELETE CASCADE,
  message_id BIGINT REFERENCES ai_messages(id) ON DELETE SET NULL,
  company_id INTEGER NOT NULL,
  branch_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL REFERENCES users(id),
  tool_name VARCHAR(100) NOT NULL,
  input_data JSONB NOT NULL,
  output_data JSONB,
  status VARCHAR(20) NOT NULL,
  duration_ms INTEGER,
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK(status IN ('STARTED','SUCCESS','ERROR','DENIED','TIMEOUT'))
);

CREATE TABLE IF NOT EXISTS ai_actions (
  id BIGSERIAL PRIMARY KEY,
  conversation_id BIGINT NOT NULL REFERENCES ai_conversations(id) ON DELETE CASCADE,
  source_message_id BIGINT REFERENCES ai_messages(id) ON DELETE SET NULL,
  company_id INTEGER NOT NULL,
  branch_id INTEGER NOT NULL,
  requested_by INTEGER NOT NULL REFERENCES users(id),
  action_type VARCHAR(80) NOT NULL,
  entity_type VARCHAR(80),
  entity_id BIGINT,
  title VARCHAR(200) NOT NULL,
  description TEXT,
  payload JSONB NOT NULL,
  risk_level VARCHAR(20) NOT NULL DEFAULT 'MEDIUM',
  status VARCHAR(20) NOT NULL DEFAULT 'PENDING',
  approved_by INTEGER REFERENCES users(id),
  approval_reason TEXT,
  approved_at TIMESTAMPTZ,
  executed_at TIMESTAMPTZ,
  execution_result JSONB,
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK(risk_level IN ('LOW','MEDIUM','HIGH','CRITICAL')),
  CHECK(status IN ('PENDING','APPROVED','REJECTED','EXECUTED','FAILED','EXPIRED'))
);

CREATE TABLE IF NOT EXISTS ai_alerts (
  id BIGSERIAL PRIMARY KEY,
  company_id INTEGER NOT NULL,
  branch_id INTEGER NOT NULL,
  module_key VARCHAR(40) NOT NULL,
  alert_type VARCHAR(80) NOT NULL,
  deduplication_key VARCHAR(200) NOT NULL,
  entity_type VARCHAR(80),
  entity_id BIGINT,
  title VARCHAR(200) NOT NULL,
  description TEXT NOT NULL,
  severity VARCHAR(20) NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'OPEN',
  assigned_to INTEGER REFERENCES users(id),
  detected_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  due_at TIMESTAMPTZ,
  resolved_at TIMESTAMPTZ,
  resolution_notes TEXT,
  metadata JSONB,
  UNIQUE(company_id, branch_id, deduplication_key),
  CHECK(severity IN ('LOW','MEDIUM','HIGH','CRITICAL')),
  CHECK(status IN ('OPEN','IN_PROGRESS','RESOLVED','DISMISSED'))
);

CREATE TABLE IF NOT EXISTS ai_feedback (
  id BIGSERIAL PRIMARY KEY,
  message_id BIGINT NOT NULL REFERENCES ai_messages(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id),
  rating SMALLINT NOT NULL,
  reason VARCHAR(80),
  comments TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(message_id,user_id),
  CHECK(rating IN (-1,1))
);

CREATE TABLE IF NOT EXISTS ai_settings (
  id BIGSERIAL PRIMARY KEY,
  company_id INTEGER NOT NULL,
  branch_id INTEGER NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  provider VARCHAR(30) NOT NULL DEFAULT 'AZURE_OPENAI',
  model_deployment VARCHAR(100),
  max_output_tokens INTEGER NOT NULL DEFAULT 1200,
  daily_request_limit INTEGER NOT NULL DEFAULT 500,
  tools_enabled JSONB NOT NULL DEFAULT '{}'::jsonb,
  drafts_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  alerts_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  retain_days INTEGER NOT NULL DEFAULT 180,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(company_id,branch_id)
);

CREATE INDEX IF NOT EXISTS idx_ai_conversations_context ON ai_conversations(company_id,branch_id,user_id,status,updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_messages_conversation ON ai_messages(conversation_id,created_at);
CREATE INDEX IF NOT EXISTS idx_ai_actions_status ON ai_actions(company_id,branch_id,status,created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_alerts_status ON ai_alerts(company_id,branch_id,status,severity,detected_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_tools_audit ON ai_tool_executions(company_id,branch_id,tool_name,created_at DESC);

ALTER TABLE catalog_items ADD COLUMN IF NOT EXISTS unit_price NUMERIC(18,2) DEFAULT 0;

ALTER TABLE catalog_items ADD COLUMN IF NOT EXISTS cost_price NUMERIC(18,2) DEFAULT 0;
COMMIT;
