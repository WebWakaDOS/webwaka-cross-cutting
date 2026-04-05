-- webwaka-cross-cutting: CRM module enhancements (XCT-1)
-- Additional tables for CRM functionality not in initial schema
PRAGMA journal_mode = WAL;

-- CRM Activities (calls, emails, meetings, notes)
CREATE TABLE IF NOT EXISTS crm_activities (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  contact_id TEXT REFERENCES crm_contacts(id) ON DELETE CASCADE,
  deal_id TEXT REFERENCES crm_deals(id) ON DELETE CASCADE,
  activity_type TEXT NOT NULL, -- call, email, meeting, note, task
  subject TEXT NOT NULL,
  description TEXT,
  due_date INTEGER, -- For tasks
  completed INTEGER NOT NULL DEFAULT 0,
  created_by TEXT NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()*1000),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch()*1000)
);
CREATE INDEX IF NOT EXISTS idx_crm_activities_tenant ON crm_activities(tenant_id);
CREATE INDEX IF NOT EXISTS idx_crm_activities_contact ON crm_activities(tenant_id, contact_id);
CREATE INDEX IF NOT EXISTS idx_crm_activities_deal ON crm_activities(tenant_id, deal_id);
CREATE INDEX IF NOT EXISTS idx_crm_activities_type ON crm_activities(tenant_id, activity_type);
CREATE INDEX IF NOT EXISTS idx_crm_activities_due ON crm_activities(tenant_id, due_date);

-- CRM Pipeline Stages (configurable per tenant)
CREATE TABLE IF NOT EXISTS crm_pipeline_stages (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  name TEXT NOT NULL,
  position INTEGER NOT NULL,
  probability INTEGER NOT NULL DEFAULT 50,
  color TEXT DEFAULT '#6366f1',
  is_default INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()*1000),
  UNIQUE(tenant_id, position)
);
CREATE INDEX IF NOT EXISTS idx_crm_stages_tenant ON crm_pipeline_stages(tenant_id);

-- Insert default stages if none exist
INSERT OR IGNORE INTO crm_pipeline_stages (id, tenant_id, name, position, probability, is_default)
VALUES
  ('stage-new', 'default', 'New Lead', 0, 10, 1),
  ('stage-qualified', 'default', 'Qualified', 1, 30, 1),
  ('stage-proposal', 'default', 'Proposal Sent', 2, 50, 1),
  ('stage-negotiation', 'default', 'Negotiation', 3, 70, 1),
  ('stage-won', 'default', 'Closed Won', 4, 100, 1),
  ('stage-lost', 'default', 'Closed Lost', 5, 0, 1);