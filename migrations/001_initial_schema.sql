-- webwaka-cross-cutting: initial D1 schema
-- Epic: XCT-1 (CRM), XCT-2 (HRM), XCT-3 (Ticketing), XCT-4 (Chat)
PRAGMA journal_mode = WAL;

CREATE TABLE IF NOT EXISTS crm_contacts (
  id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, full_name TEXT NOT NULL,
  email TEXT, phone TEXT, company TEXT, stage TEXT NOT NULL DEFAULT 'lead',
  assigned_to TEXT, tags TEXT, notes TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()*1000),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch()*1000), deleted_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_crm_contacts_tenant ON crm_contacts(tenant_id);
CREATE INDEX IF NOT EXISTS idx_crm_contacts_stage ON crm_contacts(tenant_id,stage);

CREATE TABLE IF NOT EXISTS crm_deals (
  id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, contact_id TEXT REFERENCES crm_contacts(id),
  title TEXT NOT NULL, value_kobo INTEGER NOT NULL DEFAULT 0,
  stage TEXT NOT NULL DEFAULT 'new', probability INTEGER NOT NULL DEFAULT 0,
  closed_at INTEGER, created_at INTEGER NOT NULL DEFAULT (unixepoch()*1000),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch()*1000)
);
CREATE INDEX IF NOT EXISTS idx_crm_deals_tenant ON crm_deals(tenant_id);

CREATE TABLE IF NOT EXISTS hrm_employees (
  id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, full_name TEXT NOT NULL,
  email TEXT, phone TEXT, department TEXT, role TEXT,
  employment_type TEXT NOT NULL DEFAULT 'full_time',
  status TEXT NOT NULL DEFAULT 'active', start_date TEXT,
  salary_kobo INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()*1000),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch()*1000)
);
CREATE INDEX IF NOT EXISTS idx_hrm_employees_tenant ON hrm_employees(tenant_id);

CREATE TABLE IF NOT EXISTS hrm_leave_requests (
  id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL,
  employee_id TEXT NOT NULL REFERENCES hrm_employees(id),
  leave_type TEXT NOT NULL, start_date TEXT NOT NULL, end_date TEXT NOT NULL,
  days INTEGER NOT NULL DEFAULT 1, status TEXT NOT NULL DEFAULT 'pending',
  approved_by TEXT, reason TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()*1000)
);

CREATE TABLE IF NOT EXISTS tickets (
  id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL,
  subject TEXT NOT NULL, body TEXT,
  status TEXT NOT NULL DEFAULT 'open', priority TEXT NOT NULL DEFAULT 'medium',
  category TEXT, assigned_to TEXT, requester_id TEXT,
  source TEXT NOT NULL DEFAULT 'web', resolved_at INTEGER,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()*1000),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch()*1000)
);
CREATE INDEX IF NOT EXISTS idx_tickets_tenant_status ON tickets(tenant_id,status);
CREATE INDEX IF NOT EXISTS idx_tickets_assigned ON tickets(tenant_id,assigned_to);

CREATE TABLE IF NOT EXISTS ticket_comments (
  id TEXT PRIMARY KEY, ticket_id TEXT NOT NULL REFERENCES tickets(id),
  author_id TEXT NOT NULL, body TEXT NOT NULL,
  is_internal INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()*1000)
);

CREATE TABLE IF NOT EXISTS chat_conversations (
  id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL,
  channel TEXT NOT NULL DEFAULT 'internal', status TEXT NOT NULL DEFAULT 'open',
  participants TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()*1000),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch()*1000)
);

CREATE TABLE IF NOT EXISTS chat_messages (
  id TEXT PRIMARY KEY, conversation_id TEXT NOT NULL REFERENCES chat_conversations(id),
  sender_id TEXT NOT NULL, body TEXT NOT NULL,
  message_type TEXT NOT NULL DEFAULT 'text', read_by TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()*1000)
);
CREATE INDEX IF NOT EXISTS idx_chat_messages_conv ON chat_messages(conversation_id,created_at);
