BEGIN;

CREATE SEQUENCE IF NOT EXISTS technical_protocol_seq START 1;

ALTER TABLE tickets
  ADD COLUMN IF NOT EXISTS protocol VARCHAR(40),
  ADD COLUMN IF NOT EXISTS channel VARCHAR(20) NOT NULL DEFAULT 'PORTAL',
  ADD COLUMN IF NOT EXISTS support_type VARCHAR(30) NOT NULL DEFAULT 'SUPPORT',
  ADD COLUMN IF NOT EXISTS assigned_group_id BIGINT,
  ADD COLUMN IF NOT EXISTS assigned_user_id BIGINT,
  ADD COLUMN IF NOT EXISTS requester_email VARCHAR(180),
  ADD COLUMN IF NOT EXISTS stage VARCHAR(30) NOT NULL DEFAULT 'TRIAGE',
  ADD COLUMN IF NOT EXISTS solution_summary TEXT,
  ADD COLUMN IF NOT EXISTS conclusion_summary TEXT,
  ADD COLUMN IF NOT EXISTS closed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

UPDATE tickets
SET protocol = 'AT-' || TO_CHAR(COALESCE(created_at,NOW()),'YYYY') || '-' || LPAD(id::text,8,'0')
WHERE protocol IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS ux_tickets_protocol ON tickets(protocol);
CREATE INDEX IF NOT EXISTS ix_tickets_assignment ON tickets(company_id,branch_id,assigned_group_id,assigned_user_id,status);
CREATE INDEX IF NOT EXISTS ix_tickets_requester_email ON tickets(company_id,branch_id,LOWER(requester_email));

CREATE TABLE IF NOT EXISTS technical_crm_groups (
  id BIGSERIAL PRIMARY KEY,
  company_id BIGINT NOT NULL,
  branch_id BIGINT NOT NULL,
  name VARCHAR(120) NOT NULL,
  description TEXT,
  email VARCHAR(180),
  roulette_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(company_id,branch_id,name)
);

CREATE TABLE IF NOT EXISTS technical_crm_group_members (
  id BIGSERIAL PRIMARY KEY,
  company_id BIGINT NOT NULL,
  branch_id BIGINT NOT NULL,
  group_id BIGINT NOT NULL REFERENCES technical_crm_groups(id) ON DELETE CASCADE,
  user_id BIGINT NOT NULL REFERENCES users(id),
  roulette_weight INTEGER NOT NULL DEFAULT 1,
  roulette_order INTEGER NOT NULL DEFAULT 1,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  last_assigned_at TIMESTAMPTZ,
  current_open_tickets INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(company_id,branch_id,group_id,user_id),
  CHECK(roulette_weight > 0)
);

CREATE TABLE IF NOT EXISTS technical_crm_interactions (
  id BIGSERIAL PRIMARY KEY,
  company_id BIGINT NOT NULL,
  branch_id BIGINT NOT NULL,
  ticket_id BIGINT NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  interaction_type VARCHAR(30) NOT NULL,
  visibility VARCHAR(20) NOT NULL DEFAULT 'PUBLIC',
  message TEXT NOT NULL,
  from_group_id BIGINT REFERENCES technical_crm_groups(id),
  to_group_id BIGINT REFERENCES technical_crm_groups(id),
  from_user_id BIGINT REFERENCES users(id),
  to_user_id BIGINT REFERENCES users(id),
  created_by BIGINT REFERENCES users(id),
  source VARCHAR(20) NOT NULL DEFAULT 'PORTAL',
  email_message_id VARCHAR(255),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK(interaction_type IN ('MESSAGE','TRANSFER','DISCUSSION','CONCLUSION','SOLUTION','INTERNAL_NOTE')),
  CHECK(visibility IN ('PUBLIC','INTERNAL')),
  CHECK(source IN ('PORTAL','EMAIL','SYSTEM','API'))
);

CREATE TABLE IF NOT EXISTS technical_crm_assignments (
  id BIGSERIAL PRIMARY KEY,
  company_id BIGINT NOT NULL,
  branch_id BIGINT NOT NULL,
  ticket_id BIGINT NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  previous_group_id BIGINT REFERENCES technical_crm_groups(id),
  new_group_id BIGINT REFERENCES technical_crm_groups(id),
  previous_user_id BIGINT REFERENCES users(id),
  new_user_id BIGINT REFERENCES users(id),
  assignment_method VARCHAR(20) NOT NULL,
  reason TEXT,
  assigned_by BIGINT REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK(assignment_method IN ('MANUAL','ROULETTE','EMAIL_RULE','SYSTEM'))
);

CREATE TABLE IF NOT EXISTS technical_crm_notification_rules (
  id BIGSERIAL PRIMARY KEY,
  company_id BIGINT NOT NULL,
  branch_id BIGINT NOT NULL,
  event_code VARCHAR(50) NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT FALSE,
  notify_requester BOOLEAN NOT NULL DEFAULT FALSE,
  notify_stage_owner BOOLEAN NOT NULL DEFAULT FALSE,
  notify_assigned_user BOOLEAN NOT NULL DEFAULT FALSE,
  notify_assigned_group BOOLEAN NOT NULL DEFAULT FALSE,
  subject_template VARCHAR(240),
  body_template TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(company_id,branch_id,event_code)
);

INSERT INTO technical_crm_notification_rules(company_id,branch_id,event_code,enabled,notify_requester,notify_stage_owner,notify_assigned_user,notify_assigned_group)
SELECT DISTINCT company_id,branch_id,event_code,FALSE,FALSE,FALSE,FALSE,FALSE
FROM tickets
CROSS JOIN (VALUES ('TICKET_CREATED'),('TICKET_ASSIGNED'),('TICKET_TRANSFERRED'),('DISCUSSION_ADDED'),('CONCLUSION_ADDED'),('SOLUTION_ADDED'),('TICKET_CLOSED')) events(event_code)
ON CONFLICT(company_id,branch_id,event_code) DO NOTHING;

CREATE TABLE IF NOT EXISTS technical_crm_mailboxes (
  id BIGSERIAL PRIMARY KEY,
  company_id BIGINT NOT NULL,
  branch_id BIGINT NOT NULL,
  name VARCHAR(120) NOT NULL,
  email_address VARCHAR(180) NOT NULL,
  imap_host VARCHAR(180) NOT NULL,
  imap_port INTEGER NOT NULL DEFAULT 993,
  imap_secure BOOLEAN NOT NULL DEFAULT TRUE,
  username VARCHAR(180) NOT NULL,
  encrypted_password TEXT NOT NULL,
  inbox_folder VARCHAR(180) NOT NULL DEFAULT 'INBOX',
  accepted_folder VARCHAR(180),
  rejected_folder VARCHAR(180),
  default_group_id BIGINT REFERENCES technical_crm_groups(id),
  collect_unread_only BOOLEAN NOT NULL DEFAULT TRUE,
  auto_create_requester BOOLEAN NOT NULL DEFAULT FALSE,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  last_collected_at TIMESTAMPTZ,
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(company_id,branch_id,email_address)
);

CREATE TABLE IF NOT EXISTS technical_crm_email_messages (
  id BIGSERIAL PRIMARY KEY,
  company_id BIGINT NOT NULL,
  branch_id BIGINT NOT NULL,
  mailbox_id BIGINT NOT NULL REFERENCES technical_crm_mailboxes(id) ON DELETE CASCADE,
  ticket_id BIGINT REFERENCES tickets(id) ON DELETE SET NULL,
  internet_message_id VARCHAR(255) NOT NULL,
  in_reply_to VARCHAR(255),
  sender_email VARCHAR(180),
  subject TEXT,
  received_at TIMESTAMPTZ,
  processing_status VARCHAR(20) NOT NULL DEFAULT 'RECEIVED',
  processing_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(mailbox_id,internet_message_id),
  CHECK(processing_status IN ('RECEIVED','PROCESSED','REJECTED','ERROR'))
);

CREATE TABLE IF NOT EXISTS technical_crm_email_outbox (
  id BIGSERIAL PRIMARY KEY,
  company_id BIGINT NOT NULL,
  branch_id BIGINT NOT NULL,
  ticket_id BIGINT REFERENCES tickets(id) ON DELETE SET NULL,
  event_code VARCHAR(50) NOT NULL,
  recipient_email VARCHAR(180) NOT NULL,
  subject TEXT NOT NULL,
  body_html TEXT NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'PENDING',
  attempts INTEGER NOT NULL DEFAULT 0,
  available_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  sent_at TIMESTAMPTZ,
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK(status IN ('PENDING','SENDING','SENT','ERROR','CANCELLED'))
);

CREATE INDEX IF NOT EXISTS ix_crm_interactions_ticket ON technical_crm_interactions(ticket_id,interaction_type,created_at);
CREATE INDEX IF NOT EXISTS ix_crm_email_outbox_worker ON technical_crm_email_outbox(status,available_at,created_at);
CREATE INDEX IF NOT EXISTS ix_crm_mail_messages_ticket ON technical_crm_email_messages(ticket_id,received_at);

COMMIT;
