-- webwaka-cross-cutting: Ticketing module enhancements (XCT-3)
-- Additional table for workflow rules
PRAGMA journal_mode = WAL;

CREATE TABLE IF NOT EXISTS ticket_workflows (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  name TEXT NOT NULL,
  trigger_type TEXT NOT NULL, -- status_change, priority_change, category_match, new_ticket
  trigger_value TEXT NOT NULL,
  action_type TEXT NOT NULL, -- assign_to, set_status, set_priority, send_notification
  action_value TEXT NOT NULL,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()*1000)
);
CREATE INDEX IF NOT EXISTS idx_ticket_workflows_tenant ON ticket_workflows(tenant_id);
CREATE INDEX IF NOT EXISTS idx_ticket_workflows_active ON ticket_workflows(tenant_id, is_active);