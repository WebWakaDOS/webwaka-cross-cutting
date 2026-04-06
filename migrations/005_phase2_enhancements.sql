-- webwaka-cross-cutting: Phase 2 Enhancement Schema
-- Tasks: CC-CRM-001, CC-CRM-002, CC-HRM-001, CC-HRM-002,
--        CC-TKT-001, CC-TKT-002, CC-CHAT-001, CC-CHAT-002,
--        CC-ANL-001, CC-ANL-002
PRAGMA journal_mode = WAL;

-- ============================================================================
-- Schema backfills (columns referenced by new code, absent from prior schemas)
-- ============================================================================

-- xcut_chat_conversations: add title column (referenced since v1 code but missing from schema)
ALTER TABLE xcut_chat_conversations ADD COLUMN title TEXT;

-- xcut_chat_messages: file_id and metadata for CC-CHAT-001 / CC-CHAT-002
-- (also declared later in CC-CHAT section, declared here for logical order)

-- xcut_hrm_employees: payroll-related fields for CC-HRM-001
ALTER TABLE xcut_hrm_employees ADD COLUMN bank_account TEXT;
ALTER TABLE xcut_hrm_employees ADD COLUMN bank_name TEXT;
ALTER TABLE xcut_hrm_employees ADD COLUMN tax_id TEXT;
ALTER TABLE xcut_hrm_employees ADD COLUMN pension_id TEXT;

-- ============================================================================
-- CC-CRM-001: Lead Scoring
-- ============================================================================

ALTER TABLE xcut_crm_contacts ADD COLUMN lead_score INTEGER NOT NULL DEFAULT 0;
ALTER TABLE xcut_crm_contacts ADD COLUMN score_updated_at INTEGER;

CREATE TABLE IF NOT EXISTS xcut_crm_scoring_rules (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  name TEXT NOT NULL,
  attribute TEXT NOT NULL,        -- field to evaluate: stage, company, tags, activity_type, etc.
  operator TEXT NOT NULL,         -- eq, neq, contains, gt, lt
  value TEXT NOT NULL,            -- value to compare against
  score_delta INTEGER NOT NULL DEFAULT 0,  -- points to add (+) or remove (-)
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()*1000),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch()*1000)
);
CREATE INDEX IF NOT EXISTS idx_scoring_rules_tenant ON xcut_crm_scoring_rules(tenant_id, is_active);

CREATE TABLE IF NOT EXISTS xcut_crm_score_events (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  contact_id TEXT NOT NULL REFERENCES xcut_crm_contacts(id) ON DELETE CASCADE,
  rule_id TEXT REFERENCES xcut_crm_scoring_rules(id),
  score_delta INTEGER NOT NULL,
  reason TEXT NOT NULL,
  score_after INTEGER NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()*1000)
);
CREATE INDEX IF NOT EXISTS idx_score_events_contact ON xcut_crm_score_events(contact_id);

-- Default scoring rules (tenant_id = 'default' = platform defaults)
INSERT OR IGNORE INTO xcut_crm_scoring_rules (id, tenant_id, name, attribute, operator, value, score_delta)
VALUES
  ('rule-stage-qualified',    'default', 'Stage: Qualified',    'stage', 'eq', 'qualified',    20),
  ('rule-stage-proposal',     'default', 'Stage: Proposal',     'stage', 'eq', 'proposal',     35),
  ('rule-stage-negotiation',  'default', 'Stage: Negotiation',  'stage', 'eq', 'negotiation',  50),
  ('rule-stage-won',          'default', 'Stage: Won',          'stage', 'eq', 'won',          100),
  ('rule-stage-lost',         'default', 'Stage: Lost',         'stage', 'eq', 'lost',         -50),
  ('rule-has-email',          'default', 'Has Email',           'email', 'neq', '',             10),
  ('rule-has-phone',          'default', 'Has Phone',           'phone', 'neq', '',             5),
  ('rule-has-company',        'default', 'Has Company',         'company','neq','',             5),
  ('rule-activity-call',      'default', 'Activity: Call',      'activity_type','eq','call',    15),
  ('rule-activity-meeting',   'default', 'Activity: Meeting',   'activity_type','eq','meeting', 25),
  ('rule-activity-email',     'default', 'Activity: Email',     'activity_type','eq','email',   10);

-- ============================================================================
-- CC-CRM-002: Marketing Automation Workflows
-- ============================================================================

CREATE TABLE IF NOT EXISTS xcut_crm_automation_workflows (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  trigger_event TEXT NOT NULL,   -- contact_created, stage_changed, score_threshold, deal_created
  trigger_config TEXT NOT NULL DEFAULT '{}',  -- JSON: conditions e.g. {"stage":"qualified","score_gte":50}
  is_active INTEGER NOT NULL DEFAULT 1,
  execution_count INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()*1000),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch()*1000)
);
CREATE INDEX IF NOT EXISTS idx_crm_workflows_tenant ON xcut_crm_automation_workflows(tenant_id, is_active);

CREATE TABLE IF NOT EXISTS xcut_crm_automation_actions (
  id TEXT PRIMARY KEY,
  workflow_id TEXT NOT NULL REFERENCES xcut_crm_automation_workflows(id) ON DELETE CASCADE,
  step_order INTEGER NOT NULL DEFAULT 0,
  action_type TEXT NOT NULL,     -- send_notification, create_activity, update_stage, assign_contact
  action_config TEXT NOT NULL DEFAULT '{}',  -- JSON: e.g. {"message":"Welcome!","channel":"email"}
  created_at INTEGER NOT NULL DEFAULT (unixepoch()*1000)
);
CREATE INDEX IF NOT EXISTS idx_crm_actions_workflow ON xcut_crm_automation_actions(workflow_id, step_order);

CREATE TABLE IF NOT EXISTS xcut_crm_automation_logs (
  id TEXT PRIMARY KEY,
  workflow_id TEXT NOT NULL REFERENCES xcut_crm_automation_workflows(id),
  contact_id TEXT REFERENCES xcut_crm_contacts(id),
  deal_id TEXT,
  trigger_event TEXT NOT NULL,
  actions_executed TEXT NOT NULL DEFAULT '[]',  -- JSON array of executed action IDs
  status TEXT NOT NULL DEFAULT 'completed',      -- completed, failed, skipped
  error TEXT,
  executed_at INTEGER NOT NULL DEFAULT (unixepoch()*1000)
);
CREATE INDEX IF NOT EXISTS idx_crm_logs_workflow ON xcut_crm_automation_logs(workflow_id);
CREATE INDEX IF NOT EXISTS idx_crm_logs_contact ON xcut_crm_automation_logs(contact_id);

-- ============================================================================
-- CC-HRM-001: Payroll Processing
-- ============================================================================

CREATE TABLE IF NOT EXISTS xcut_hrm_payroll_configs (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL UNIQUE,
  pension_rate_pct INTEGER NOT NULL DEFAULT 800,   -- 8.00% stored as integer*100
  nhf_rate_pct INTEGER NOT NULL DEFAULT 250,        -- 2.50%
  employer_pension_pct INTEGER NOT NULL DEFAULT 1000, -- 10.00%
  pay_frequency TEXT NOT NULL DEFAULT 'monthly',    -- monthly, weekly, biweekly
  paye_enabled INTEGER NOT NULL DEFAULT 1,
  updated_at INTEGER NOT NULL DEFAULT (unixepoch()*1000)
);

CREATE TABLE IF NOT EXISTS xcut_hrm_payroll_runs (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  period_label TEXT NOT NULL,    -- e.g. "2026-03"
  period_start TEXT NOT NULL,    -- YYYY-MM-DD
  period_end TEXT NOT NULL,      -- YYYY-MM-DD
  status TEXT NOT NULL DEFAULT 'draft',  -- draft, processing, completed, cancelled
  employee_count INTEGER NOT NULL DEFAULT 0,
  total_gross_kobo INTEGER NOT NULL DEFAULT 0,
  total_net_kobo INTEGER NOT NULL DEFAULT 0,
  total_deductions_kobo INTEGER NOT NULL DEFAULT 0,
  total_tax_kobo INTEGER NOT NULL DEFAULT 0,
  processed_by TEXT,
  processed_at INTEGER,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()*1000)
);
CREATE INDEX IF NOT EXISTS idx_payroll_runs_tenant ON xcut_hrm_payroll_runs(tenant_id);

CREATE TABLE IF NOT EXISTS xcut_hrm_pay_slips (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  payroll_run_id TEXT NOT NULL REFERENCES xcut_hrm_payroll_runs(id),
  employee_id TEXT NOT NULL REFERENCES xcut_hrm_employees(id),
  period_label TEXT NOT NULL,
  gross_kobo INTEGER NOT NULL DEFAULT 0,
  basic_kobo INTEGER NOT NULL DEFAULT 0,
  transport_allowance_kobo INTEGER NOT NULL DEFAULT 0,
  housing_allowance_kobo INTEGER NOT NULL DEFAULT 0,
  pension_employee_kobo INTEGER NOT NULL DEFAULT 0,
  pension_employer_kobo INTEGER NOT NULL DEFAULT 0,
  nhf_kobo INTEGER NOT NULL DEFAULT 0,
  paye_tax_kobo INTEGER NOT NULL DEFAULT 0,
  total_deductions_kobo INTEGER NOT NULL DEFAULT 0,
  net_kobo INTEGER NOT NULL DEFAULT 0,
  bank_account TEXT,
  bank_name TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()*1000)
);
CREATE INDEX IF NOT EXISTS idx_pay_slips_tenant ON xcut_hrm_pay_slips(tenant_id);
CREATE INDEX IF NOT EXISTS idx_pay_slips_run ON xcut_hrm_pay_slips(payroll_run_id);
CREATE INDEX IF NOT EXISTS idx_pay_slips_employee ON xcut_hrm_pay_slips(employee_id);

-- ============================================================================
-- CC-HRM-002: Performance Management
-- ============================================================================

CREATE TABLE IF NOT EXISTS xcut_hrm_goals (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  employee_id TEXT NOT NULL REFERENCES xcut_hrm_employees(id),
  title TEXT NOT NULL,
  description TEXT,
  target TEXT,                    -- measurable target description
  due_date TEXT,                  -- YYYY-MM-DD
  status TEXT NOT NULL DEFAULT 'active',  -- active, completed, cancelled, overdue
  progress INTEGER NOT NULL DEFAULT 0,    -- 0-100 percent
  created_by TEXT NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()*1000),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch()*1000)
);
CREATE INDEX IF NOT EXISTS idx_hrm_goals_tenant ON xcut_hrm_goals(tenant_id);
CREATE INDEX IF NOT EXISTS idx_hrm_goals_employee ON xcut_hrm_goals(employee_id);

CREATE TABLE IF NOT EXISTS xcut_hrm_review_cycles (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  name TEXT NOT NULL,
  period_type TEXT NOT NULL DEFAULT 'annual',  -- annual, quarterly, monthly
  start_date TEXT NOT NULL,    -- YYYY-MM-DD
  end_date TEXT NOT NULL,      -- YYYY-MM-DD
  status TEXT NOT NULL DEFAULT 'active',  -- active, completed, cancelled
  created_by TEXT NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()*1000)
);
CREATE INDEX IF NOT EXISTS idx_review_cycles_tenant ON xcut_hrm_review_cycles(tenant_id);

CREATE TABLE IF NOT EXISTS xcut_hrm_reviews (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  cycle_id TEXT NOT NULL REFERENCES xcut_hrm_review_cycles(id),
  employee_id TEXT NOT NULL REFERENCES xcut_hrm_employees(id),
  reviewer_id TEXT NOT NULL,
  review_type TEXT NOT NULL DEFAULT 'manager',  -- manager, self, peer
  rating INTEGER,               -- 1-5
  strengths TEXT,
  improvements TEXT,
  comments TEXT,
  status TEXT NOT NULL DEFAULT 'pending',  -- pending, submitted, acknowledged
  submitted_at INTEGER,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()*1000),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch()*1000)
);
CREATE INDEX IF NOT EXISTS idx_hrm_reviews_tenant ON xcut_hrm_reviews(tenant_id);
CREATE INDEX IF NOT EXISTS idx_hrm_reviews_cycle ON xcut_hrm_reviews(cycle_id);
CREATE INDEX IF NOT EXISTS idx_hrm_reviews_employee ON xcut_hrm_reviews(employee_id);

CREATE TABLE IF NOT EXISTS xcut_hrm_feedback (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  from_employee_id TEXT NOT NULL,
  to_employee_id TEXT NOT NULL,
  goal_id TEXT REFERENCES xcut_hrm_goals(id),
  message TEXT NOT NULL,
  feedback_type TEXT NOT NULL DEFAULT 'general',  -- general, goal, recognition, improvement
  is_private INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()*1000)
);
CREATE INDEX IF NOT EXISTS idx_hrm_feedback_tenant ON xcut_hrm_feedback(tenant_id);
CREATE INDEX IF NOT EXISTS idx_hrm_feedback_to ON xcut_hrm_feedback(to_employee_id);

-- ============================================================================
-- CC-TKT-001: SLA Management
-- ============================================================================

CREATE TABLE IF NOT EXISTS xcut_ticket_sla_policies (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  name TEXT NOT NULL,
  priority TEXT NOT NULL,              -- low, medium, high, critical
  response_time_minutes INTEGER NOT NULL DEFAULT 60,
  resolution_time_minutes INTEGER NOT NULL DEFAULT 480,
  escalate_to TEXT,                    -- agent/team ID for escalation
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()*1000),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch()*1000)
);
CREATE INDEX IF NOT EXISTS idx_sla_policies_tenant ON xcut_ticket_sla_policies(tenant_id, is_active);

ALTER TABLE xcut_tickets ADD COLUMN sla_policy_id TEXT;
ALTER TABLE xcut_tickets ADD COLUMN sla_status TEXT DEFAULT 'within_sla';  -- within_sla, at_risk, breached
ALTER TABLE xcut_tickets ADD COLUMN response_due_at INTEGER;
ALTER TABLE xcut_tickets ADD COLUMN resolution_due_at INTEGER;
ALTER TABLE xcut_tickets ADD COLUMN first_responded_at INTEGER;

-- Default SLA policies (platform-wide)
INSERT OR IGNORE INTO xcut_ticket_sla_policies (id, tenant_id, name, priority, response_time_minutes, resolution_time_minutes)
VALUES
  ('sla-default-low',      'default', 'Low Priority SLA',      'low',      240, 2880),
  ('sla-default-medium',   'default', 'Medium Priority SLA',   'medium',   120, 1440),
  ('sla-default-high',     'default', 'High Priority SLA',     'high',     60,  480),
  ('sla-default-critical', 'default', 'Critical Priority SLA', 'critical', 15,  120);

-- ============================================================================
-- CC-TKT-002: Automated Ticket Routing
-- ============================================================================

CREATE TABLE IF NOT EXISTS xcut_ticket_routing_rules (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  name TEXT NOT NULL,
  priority_order INTEGER NOT NULL DEFAULT 0,  -- lower = higher priority
  match_type TEXT NOT NULL DEFAULT 'any',     -- any, all (AND vs OR conditions)
  keyword_patterns TEXT,          -- JSON array of keywords to match in subject/body
  urgency_keywords TEXT,          -- JSON array of urgent keywords → override to critical
  category_match TEXT,            -- exact category to match
  source_match TEXT,              -- source channel to match (web, email, whatsapp, etc.)
  assign_to TEXT,                 -- agent ID
  assign_team TEXT,               -- team label
  set_priority TEXT,              -- override priority
  set_category TEXT,              -- override category
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()*1000),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch()*1000)
);
CREATE INDEX IF NOT EXISTS idx_routing_rules_tenant ON xcut_ticket_routing_rules(tenant_id, is_active, priority_order);

CREATE TABLE IF NOT EXISTS xcut_ticket_routing_logs (
  id TEXT PRIMARY KEY,
  ticket_id TEXT NOT NULL REFERENCES xcut_tickets(id),
  rule_id TEXT REFERENCES xcut_ticket_routing_rules(id),
  matched_keywords TEXT,          -- JSON array of matched keywords
  action_taken TEXT NOT NULL,     -- JSON describing what was done
  routed_to TEXT,
  fallback_used INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()*1000)
);
CREATE INDEX IF NOT EXISTS idx_routing_logs_ticket ON xcut_ticket_routing_logs(ticket_id);

-- ============================================================================
-- CC-CHAT-001 + CC-CHAT-002: File Sharing & Rich Media
-- ============================================================================

CREATE TABLE IF NOT EXISTS xcut_chat_files (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  conversation_id TEXT NOT NULL REFERENCES xcut_chat_conversations(id),
  uploaded_by TEXT NOT NULL,
  filename TEXT NOT NULL,
  original_name TEXT NOT NULL,
  mimetype TEXT NOT NULL,
  size_bytes INTEGER NOT NULL DEFAULT 0,
  storage_url TEXT NOT NULL,       -- R2 or CDN URL
  thumbnail_url TEXT,              -- For image/video thumbnails
  media_type TEXT NOT NULL DEFAULT 'file',  -- file, image, video, audio
  width INTEGER,                   -- For images/videos
  height INTEGER,                  -- For images/videos
  duration_seconds INTEGER,        -- For audio/video
  is_accessible INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()*1000)
);
CREATE INDEX IF NOT EXISTS idx_chat_files_conv ON xcut_chat_files(conversation_id);
CREATE INDEX IF NOT EXISTS idx_chat_files_tenant ON xcut_chat_files(tenant_id);

ALTER TABLE xcut_chat_messages ADD COLUMN file_id TEXT REFERENCES xcut_chat_files(id);
ALTER TABLE xcut_chat_messages ADD COLUMN metadata TEXT;  -- JSON: alt_text, caption, etc.

-- ============================================================================
-- CC-ANL-001: Custom Report Builder
-- ============================================================================

CREATE TABLE IF NOT EXISTS xcut_analytics_report_definitions (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  data_source TEXT NOT NULL,       -- xcut_crm_contacts, xcut_tickets, xcut_hrm_employees, xcut_analytics_events, etc.
  metrics TEXT NOT NULL DEFAULT '[]',     -- JSON array: [{field, aggregation: sum|count|avg|min|max}]
  dimensions TEXT NOT NULL DEFAULT '[]',  -- JSON array: [{field, alias}]
  filters TEXT NOT NULL DEFAULT '[]',     -- JSON array: [{field, operator, value}]
  sort_by TEXT,
  sort_dir TEXT NOT NULL DEFAULT 'desc',
  limit_rows INTEGER NOT NULL DEFAULT 100,
  visualization_type TEXT NOT NULL DEFAULT 'table',  -- table, bar, line, pie, area
  is_shared INTEGER NOT NULL DEFAULT 0,
  created_by TEXT NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()*1000),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch()*1000)
);
CREATE INDEX IF NOT EXISTS idx_report_defs_tenant ON xcut_analytics_report_definitions(tenant_id);

CREATE TABLE IF NOT EXISTS xcut_analytics_report_runs (
  id TEXT PRIMARY KEY,
  report_id TEXT NOT NULL REFERENCES xcut_analytics_report_definitions(id) ON DELETE CASCADE,
  tenant_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',   -- pending, running, completed, failed
  row_count INTEGER,
  result_preview TEXT,            -- JSON: first 10 rows for preview
  error TEXT,
  ran_by TEXT NOT NULL,
  started_at INTEGER NOT NULL DEFAULT (unixepoch()*1000),
  completed_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_report_runs_report ON xcut_analytics_report_runs(report_id);
CREATE INDEX IF NOT EXISTS idx_report_runs_tenant ON xcut_analytics_report_runs(tenant_id);

-- ============================================================================
-- CC-ANL-002: Predictive Analytics
-- ============================================================================

CREATE TABLE IF NOT EXISTS xcut_analytics_predictions (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  metric_name TEXT NOT NULL,       -- lead_conversion_rate, ticket_resolution_time, employee_churn
  prediction_type TEXT NOT NULL,   -- forecast, anomaly, trend
  current_value REAL,
  predicted_value REAL NOT NULL,
  confidence INTEGER NOT NULL,     -- 0-100
  horizon_days INTEGER NOT NULL DEFAULT 30,
  model_version TEXT NOT NULL DEFAULT 'v1',
  supporting_data TEXT,            -- JSON: data points used
  ai_provider TEXT NOT NULL DEFAULT 'webwaka-ai-platform',
  created_at INTEGER NOT NULL DEFAULT (unixepoch()*1000),
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_predictions_tenant ON xcut_analytics_predictions(tenant_id, metric_name);
CREATE INDEX IF NOT EXISTS idx_predictions_expires ON xcut_analytics_predictions(expires_at);
