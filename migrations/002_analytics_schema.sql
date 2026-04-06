-- webwaka-cross-cutting: Analytics module schema (XCT-5)
-- Epic: XCT-5 - Advanced Analytics & Data Visualization
-- Description: Aggregated analytics storage for cross-vertical metrics
PRAGMA journal_mode = WAL;

-- Analytics Events (raw event log from event bus)
CREATE TABLE IF NOT EXISTS xcut_analytics_events (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  vertical TEXT NOT NULL,
  event_data TEXT NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()*1000)
);
CREATE INDEX IF NOT EXISTS idx_analytics_tenant ON xcut_analytics_events(tenant_id);
CREATE INDEX IF NOT EXISTS idx_analytics_type ON xcut_analytics_events(tenant_id, event_type);
CREATE INDEX IF NOT EXISTS idx_analytics_vertical ON xcut_analytics_events(tenant_id, vertical);
CREATE INDEX IF NOT EXISTS idx_analytics_created ON xcut_analytics_events(created_at);

-- Daily Metrics (aggregated per vertical per day)
CREATE TABLE IF NOT EXISTS xcut_analytics_daily_metrics (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  vertical TEXT NOT NULL,
  metric_date TEXT NOT NULL,
  revenue_kobo INTEGER NOT NULL DEFAULT 0,
  revenue_transactions INTEGER NOT NULL DEFAULT 0,
  active_users INTEGER NOT NULL DEFAULT 0,
  new_users INTEGER NOT NULL DEFAULT 0,
  total_actions INTEGER NOT NULL DEFAULT 0,
  failed_actions INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()*1000),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch()*1000),
  UNIQUE(tenant_id, vertical, metric_date)
);
CREATE INDEX IF NOT EXISTS idx_metrics_date ON xcut_analytics_daily_metrics(tenant_id, metric_date);
CREATE INDEX IF NOT EXISTS idx_metrics_vertical ON xcut_analytics_daily_metrics(tenant_id, vertical);

-- Monthly Aggregates (for faster dashboard queries)
CREATE TABLE IF NOT EXISTS xcut_analytics_monthly_aggregates (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  metric_month TEXT NOT NULL,
  total_revenue_kobo INTEGER NOT NULL DEFAULT 0,
  total_transactions INTEGER NOT NULL DEFAULT 0,
  total_active_users INTEGER NOT NULL DEFAULT 0,
  total_new_users INTEGER NOT NULL DEFAULT 0,
  revenue_growth_rate INTEGER,
  user_growth_rate INTEGER,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()*1000),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch()*1000),
  UNIQUE(tenant_id, metric_month)
);
CREATE INDEX IF NOT EXISTS idx_aggregates_month ON xcut_analytics_monthly_aggregates(metric_month);

-- AI-Generated Insights
CREATE TABLE IF NOT EXISTS xcut_analytics_insights (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  insight_type TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  confidence INTEGER NOT NULL DEFAULT 0,
  action_items TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()*1000),
  expires_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_insights_tenant ON xcut_analytics_insights(tenant_id);
CREATE INDEX IF NOT EXISTS idx_insights_type ON xcut_analytics_insights(tenant_id, insight_type);
CREATE INDEX IF NOT EXISTS idx_insights_created ON xcut_analytics_insights(created_at);
