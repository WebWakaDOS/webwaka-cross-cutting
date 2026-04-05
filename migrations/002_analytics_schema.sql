-- webwaka-cross-cutting: Analytics module schema (XCT-5)
-- Epic: XCT-5 - Advanced Analytics & Data Visualization
-- Description: Aggregated analytics storage for cross-vertical metrics
PRAGMA journal_mode = WAL;

-- Analytics Events (raw event log from event bus)
CREATE TABLE IF NOT EXISTS analytics_events (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  vertical TEXT NOT NULL, -- commerce, transport, fintech, civic, etc.
  event_data TEXT NOT NULL, -- JSON payload
  created_at INTEGER NOT NULL DEFAULT (unixepoch()*1000),
  INDEX idx_analytics_tenant ON analytics_events(tenant_id),
  INDEX idx_analytics_type ON analytics_events(tenant_id,event_type),
  INDEX idx_analytics_vertical ON analytics_events(tenant_id,vertical),
  INDEX idx_analytics_created ON analytics_events(created_at)
);

-- Daily Metrics (aggregated per vertical per day)
CREATE TABLE IF NOT EXISTS analytics_daily_metrics (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  vertical TEXT NOT NULL,
  metric_date TEXT NOT NULL, -- YYYY-MM-DD

  -- Revenue metrics (in kobo)
  revenue_kobo INTEGER NOT NULL DEFAULT 0,
  revenue_transactions INTEGER NOT NULL DEFAULT 0,

  -- User/tenant metrics
  active_users INTEGER NOT NULL DEFAULT 0,
  new_users INTEGER NOT NULL DEFAULT 0,

  -- Operational metrics
  total_actions INTEGER NOT NULL DEFAULT 0,
  failed_actions INTEGER NOT NULL DEFAULT 0,

  created_at INTEGER NOT NULL DEFAULT (unixepoch()*1000),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch()*1000),

  UNIQUE(tenant_id, vertical, metric_date),
  INDEX idx_metrics_date ON analytics_daily_metrics(tenant_id,metric_date),
  INDEX idx_metrics_vertical ON analytics_daily_metrics(tenant_id,vertical)
);

-- Monthly Aggregates (for faster dashboard queries)
CREATE TABLE IF NOT EXISTS analytics_monthly_aggregates (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  metric_month TEXT NOT NULL, -- YYYY-MM

  -- Revenue
  total_revenue_kobo INTEGER NOT NULL DEFAULT 0,
  total_transactions INTEGER NOT NULL DEFAULT 0,

  -- Users
  total_active_users INTEGER NOT NULL DEFAULT 0,
  total_new_users INTEGER NOT NULL DEFAULT 0,

  -- Growth rates (percentage, stored as integer * 100)
  revenue_growth_rate INTEGER, -- e.g., 1250 = 12.5%
  user_growth_rate INTEGER,

  created_at INTEGER NOT NULL DEFAULT (unixepoch()*1000),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch()*1000),

  UNIQUE(tenant_id, metric_month),
  INDEX idx_aggregates_month ON analytics_monthly_aggregates(metric_month)
);

-- AI-Generated Insights
CREATE TABLE IF NOT EXISTS analytics_insights (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  insight_type TEXT NOT NULL, -- revenue, user, operational, risk
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  confidence INTEGER NOT NULL, -- 0-100
  action_items TEXT, -- JSON array of recommended actions
  created_at INTEGER NOT NULL DEFAULT (unixepoch()*1000),
  expires_at INTEGER, -- Insights expire after 7 days

  INDEX idx_insights_tenant ON analytics_insights(tenant_id),
  INDEX idx_insights_type ON analytics_insights(tenant_id,insight_type),
  INDEX idx_insights_created ON analytics_insights(created_at)
);