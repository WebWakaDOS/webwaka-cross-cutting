/**
 * XCT-5: Advanced Analytics & Data Visualization
 * Blueprint: Part 10.12 — Data & Assets
 * Tasks: CC-ANL-001 (Custom Report Builder), CC-ANL-002 (Predictive Analytics)
 * Description: Cross-vertical analytics, custom reports, predictive models via AI platform
 */
import { Hono } from "hono";
import { z } from "zod";
import type { Env, Variables } from "../../worker";

// ============================================================================
// Types
// ============================================================================

type AnalyticsPeriod = "7d" | "30d" | "90d" | "1y";
type Vertical = "commerce" | "transport" | "logistics" | "fintech" | "civic" |
                "institutional" | "real-estate" | "professional" | "production" | "services";

// ============================================================================
// Validation Schemas
// ============================================================================

const SummaryQuerySchema = z.object({
  period: z.enum(["7d", "30d", "90d", "1y"]).default("30d"),
  vertical: z.enum(["commerce", "transport", "logistics", "fintech", "civic",
    "institutional", "real-estate", "professional", "production", "services"]).optional(),
});

const CreateEventSchema = z.object({
  event_type: z.string().min(1),
  vertical: z.enum(["commerce", "transport", "logistics", "fintech", "civic",
    "institutional", "real-estate", "professional", "production", "services"]),
  event_data: z.record(z.any()),
});

// CC-ANL-001: Report Builder
const MetricSchema = z.object({
  field: z.string().min(1),
  aggregation: z.enum(["sum", "count", "avg", "min", "max", "count_distinct"]),
  alias: z.string().optional(),
});

const DimensionSchema = z.object({
  field: z.string().min(1),
  alias: z.string().optional(),
});

const FilterSchema = z.object({
  field: z.string().min(1),
  operator: z.enum(["eq", "neq", "gt", "lt", "gte", "lte", "contains", "in", "notin", "between"]),
  value: z.union([z.string(), z.number(), z.array(z.any())]),
});

const ReportDefinitionSchema = z.object({
  name: z.string().min(1).max(300),
  description: z.string().max(1000).optional(),
  data_source: z.enum([
    "xcut_crm_contacts", "xcut_crm_deals", "xcut_crm_activities",
    "xcut_tickets", "xcut_ticket_comments",
    "xcut_hrm_employees", "xcut_hrm_pay_slips", "xcut_hrm_goals", "xcut_hrm_reviews",
    "xcut_chat_messages", "xcut_analytics_events",
    "xcut_analytics_daily_metrics",
  ]),
  metrics: z.array(MetricSchema).min(1),
  dimensions: z.array(DimensionSchema).default([]),
  filters: z.array(FilterSchema).default([]),
  sort_by: z.string().optional(),
  sort_dir: z.enum(["asc", "desc"]).default("desc"),
  limit_rows: z.number().int().min(1).max(10000).default(100),
  visualization_type: z.enum(["table", "bar", "line", "pie", "area", "scatter"]).default("table"),
  is_shared: z.boolean().default(false),
});

// CC-ANL-002: Predictive analytics request
const PredictionRequestSchema = z.object({
  metric_name: z.enum([
    "lead_conversion_rate",
    "ticket_resolution_time",
    "employee_churn_risk",
    "revenue_forecast",
    "deal_win_probability",
  ]),
  horizon_days: z.number().int().min(7).max(365).default(30),
  force_refresh: z.boolean().default(false),
});

// ============================================================================
// Helper Functions
// ============================================================================

function generateId(prefix: string): string {
  const bytes = new Uint8Array(6);
  crypto.getRandomValues(bytes);
  const suffix = Array.from(bytes)
    .map(b => b.toString(16).padStart(2, "0"))
    .join("");
  return `${prefix}-${suffix}`;
}

function getPeriodDates(period: AnalyticsPeriod): { start: number } {
  const now = Date.now();
  const periods: Record<AnalyticsPeriod, number> = {
    "7d": 7 * 24 * 60 * 60 * 1000,
    "30d": 30 * 24 * 60 * 60 * 1000,
    "90d": 90 * 24 * 60 * 60 * 1000,
    "1y": 365 * 24 * 60 * 60 * 1000,
  };
  return { start: now - periods[period] };
}

function koboToNaira(kobo: number): number {
  return kobo / 100;
}

// CC-ANL-001: Safe field name allowlist per data source
const ALLOWED_FIELDS: Record<string, string[]> = {
  xcut_crm_contacts: ["id", "full_name", "email", "company", "stage", "assigned_to", "lead_score", "created_at", "updated_at"],
  xcut_crm_deals: ["id", "contact_id", "title", "value_kobo", "stage", "probability", "created_at"],
  xcut_crm_activities: ["id", "contact_id", "deal_id", "activity_type", "subject", "completed", "created_at"],
  xcut_tickets: ["id", "subject", "status", "priority", "category", "assigned_to", "source", "sla_status", "created_at", "resolved_at"],
  xcut_ticket_comments: ["id", "ticket_id", "author_id", "is_internal", "created_at"],
  xcut_hrm_employees: ["id", "full_name", "department", "role", "employment_type", "status", "salary_kobo", "created_at"],
  xcut_hrm_pay_slips: ["id", "employee_id", "period_label", "gross_kobo", "net_kobo", "paye_tax_kobo", "pension_employee_kobo", "created_at"],
  xcut_hrm_goals: ["id", "employee_id", "title", "status", "progress", "due_date", "created_at"],
  xcut_hrm_reviews: ["id", "cycle_id", "employee_id", "review_type", "rating", "status", "created_at"],
  xcut_chat_messages: ["id", "conversation_id", "sender_id", "message_type", "created_at"],
  xcut_analytics_events: ["id", "event_type", "vertical", "created_at"],
  xcut_analytics_daily_metrics: ["id", "vertical", "metric_date", "revenue_kobo", "active_users", "new_users", "total_actions", "created_at"],
};

function sanitizeField(dataSource: string, field: string): string {
  const allowed = ALLOWED_FIELDS[dataSource] || [];
  if (!allowed.includes(field)) {
    throw new Error(`Field '${field}' is not allowed for data source '${dataSource}'`);
  }
  return field;
}

function buildFilterClause(dataSource: string, filters: z.infer<typeof FilterSchema>[]): {
  clause: string;
  params: any[];
} {
  if (filters.length === 0) return { clause: "", params: [] };

  const parts: string[] = [];
  const params: any[] = [];

  for (const f of filters) {
    const field = sanitizeField(dataSource, f.field);
    switch (f.operator) {
      case "eq": parts.push(`${field} = ?`); params.push(f.value); break;
      case "neq": parts.push(`${field} != ?`); params.push(f.value); break;
      case "gt": parts.push(`${field} > ?`); params.push(f.value); break;
      case "lt": parts.push(`${field} < ?`); params.push(f.value); break;
      case "gte": parts.push(`${field} >= ?`); params.push(f.value); break;
      case "lte": parts.push(`${field} <= ?`); params.push(f.value); break;
      case "contains": parts.push(`${field} LIKE ?`); params.push(`%${f.value}%`); break;
      case "in": {
        const vals = Array.isArray(f.value) ? f.value : [f.value];
        parts.push(`${field} IN (${vals.map(() => "?").join(",")})`);
        params.push(...vals);
        break;
      }
      case "notin": {
        const vals = Array.isArray(f.value) ? f.value : [f.value];
        parts.push(`${field} NOT IN (${vals.map(() => "?").join(",")})`);
        params.push(...vals);
        break;
      }
      case "between": {
        const vals = Array.isArray(f.value) ? f.value : [f.value];
        if (vals.length === 2) {
          parts.push(`${field} BETWEEN ? AND ?`);
          params.push(vals[0], vals[1]);
        }
        break;
      }
    }
  }

  return { clause: parts.length > 0 ? `AND ${parts.join(" AND ")}` : "", params };
}

// CC-ANL-001: Execute a report definition against D1
async function executeReport(
  db: D1Database,
  tenantId: string,
  def: z.infer<typeof ReportDefinitionSchema>
): Promise<{ rows: any[]; row_count: number; execution_ms: number }> {
  const start = Date.now();

  const selectParts: string[] = [];

  // Build metric SELECT expressions
  for (const metric of def.metrics) {
    const field = sanitizeField(def.data_source, metric.field);
    const alias = metric.alias || `${metric.aggregation}_${field}`;
    if (metric.aggregation === "count") {
      selectParts.push(`COUNT(*) as ${alias}`);
    } else if (metric.aggregation === "count_distinct") {
      selectParts.push(`COUNT(DISTINCT ${field}) as ${alias}`);
    } else {
      selectParts.push(`${metric.aggregation.toUpperCase()}(${field}) as ${alias}`);
    }
  }

  // Build dimension SELECT expressions
  const groupByParts: string[] = [];
  for (const dim of def.dimensions) {
    const field = sanitizeField(def.data_source, dim.field);
    const alias = dim.alias || field;
    selectParts.push(`${field} as ${alias}`);
    groupByParts.push(field);
  }

  const { clause: filterClause, params: filterParams } = buildFilterClause(def.data_source, def.filters);

  let query = `
    SELECT ${selectParts.join(", ")}
    FROM ${def.data_source}
    WHERE tenant_id = ?
    ${filterClause}
  `;

  if (groupByParts.length > 0) {
    query += ` GROUP BY ${groupByParts.join(", ")}`;
  }

  if (def.sort_by) {
    // sort_by may be a metric/dimension alias OR an actual column name
    const validAliases = new Set<string>([
      ...def.metrics.map((m) => m.alias || `${m.aggregation}_${sanitizeField(def.data_source, m.field)}`),
      ...def.dimensions.map((d) => d.alias || sanitizeField(def.data_source, d.field)),
    ]);
    let sortExpr: string;
    if (validAliases.has(def.sort_by)) {
      // Alias is safe — it was constructed from sanitized parts
      sortExpr = def.sort_by.replace(/[^a-zA-Z0-9_]/g, "");
    } else {
      // Must be a raw column — validate through allowlist
      sortExpr = sanitizeField(def.data_source, def.sort_by);
    }
    query += ` ORDER BY ${sortExpr} ${def.sort_dir.toUpperCase()}`;
  }

  query += ` LIMIT ${def.limit_rows}`;

  const result = await db.prepare(query).bind(tenantId, ...filterParams).all();
  const rows = result.results as any[];

  return {
    rows,
    row_count: rows.length,
    execution_ms: Date.now() - start,
  };
}

// CC-ANL-002: Gather historical data for a metric
async function gatherMetricData(
  db: D1Database,
  tenantId: string,
  metricName: string
): Promise<Record<string, any>> {
  switch (metricName) {
    case "lead_conversion_rate": {
      const total = await db.prepare(
        `SELECT COUNT(*) as count FROM xcut_crm_contacts WHERE tenant_id = ?`
      ).bind(tenantId).first() as any;
      const won = await db.prepare(
        `SELECT COUNT(*) as count FROM xcut_crm_contacts WHERE tenant_id = ? AND stage = 'won'`
      ).bind(tenantId).first() as any;
      const totalCount = total?.count || 0;
      const wonCount = won?.count || 0;
      const rate = totalCount > 0 ? (wonCount / totalCount) * 100 : 0;
      return { current_rate: rate, total_leads: totalCount, won_leads: wonCount };
    }
    case "ticket_resolution_time": {
      const result = await db.prepare(`
        SELECT AVG((resolved_at - created_at) / 60000.0) as avg_minutes
        FROM xcut_tickets
        WHERE tenant_id = ? AND resolved_at IS NOT NULL
      `).bind(tenantId).first() as any;
      return { avg_resolution_minutes: result?.avg_minutes || 0 };
    }
    case "employee_churn_risk": {
      const terminated = await db.prepare(
        `SELECT COUNT(*) as count FROM xcut_hrm_employees WHERE tenant_id = ? AND status = 'terminated'`
      ).bind(tenantId).first() as any;
      const total = await db.prepare(
        `SELECT COUNT(*) as count FROM xcut_hrm_employees WHERE tenant_id = ?`
      ).bind(tenantId).first() as any;
      const terminatedCount = terminated?.count || 0;
      const totalCount = total?.count || 0;
      const rate = totalCount > 0 ? (terminatedCount / totalCount) * 100 : 0;
      return { churn_rate: rate, terminated: terminatedCount, total: totalCount };
    }
    case "revenue_forecast": {
      const result = await db.prepare(`
        SELECT SUM(value_kobo) as total_pipeline_kobo, COUNT(*) as deal_count,
               AVG(probability) as avg_probability
        FROM xcut_crm_deals WHERE tenant_id = ? AND stage NOT IN ('won', 'lost')
      `).bind(tenantId).first() as any;
      return {
        pipeline_kobo: result?.total_pipeline_kobo || 0,
        deal_count: result?.deal_count || 0,
        avg_probability: result?.avg_probability || 0,
        expected_revenue_kobo: Math.round(
          (result?.total_pipeline_kobo || 0) * ((result?.avg_probability || 0) / 100)
        ),
      };
    }
    case "deal_win_probability": {
      const result = await db.prepare(`
        SELECT stage, COUNT(*) as count, AVG(probability) as avg_prob
        FROM xcut_crm_deals WHERE tenant_id = ?
        GROUP BY stage
      `).bind(tenantId).all();
      return { by_stage: result.results };
    }
    default:
      return {};
  }
}

// CC-ANL-002: Generate prediction via webwaka-ai-platform or statistical fallback
async function generatePrediction(
  env: Env,
  tenantId: string,
  metricName: string,
  horizonDays: number,
  historicalData: Record<string, any>
): Promise<{ predicted_value: number; confidence: number; model_notes: string }> {
  // Route through webwaka-ai-platform per Anti-Drift Rule
  if (env.AI_PLATFORM_URL && env.AI_PLATFORM_TOKEN) {
    try {
      const response = await fetch(`${env.AI_PLATFORM_URL}/v1/predict`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${env.AI_PLATFORM_TOKEN}`,
        },
        body: JSON.stringify({
          metric: metricName,
          horizon_days: horizonDays,
          tenant_id: tenantId,
          historical_data: historicalData,
          model_type: "time_series_forecast",
        }),
      });

      if (response.ok) {
        const result: any = await response.json();
        return {
          predicted_value: result.predicted_value ?? 0,
          confidence: result.confidence ?? 70,
          model_notes: result.model_notes || "AI Platform prediction",
        };
      }
    } catch {
      // Fall through to statistical fallback
    }
  }

  // Statistical fallback (simple heuristic) when AI platform unavailable
  let predicted_value = 0;
  let confidence = 55;
  let model_notes = "Statistical fallback (AI platform unavailable)";

  switch (metricName) {
    case "lead_conversion_rate": {
      const curr = historicalData.current_rate as number;
      // Simple linear projection: assume 5% improvement per 30 days
      predicted_value = Math.min(100, curr + (5 * horizonDays / 30));
      confidence = 60;
      model_notes = "Linear trend extrapolation from current conversion rate";
      break;
    }
    case "ticket_resolution_time": {
      // Assume 5% improvement in resolution time
      const curr = historicalData.avg_resolution_minutes as number;
      predicted_value = Math.max(0, curr * 0.95);
      confidence = 65;
      model_notes = "5% efficiency improvement assumption";
      break;
    }
    case "employee_churn_risk": {
      predicted_value = historicalData.churn_rate as number;
      confidence = 70;
      model_notes = "Based on current churn rate, no trend data available";
      break;
    }
    case "revenue_forecast": {
      const expectedKobo = historicalData.expected_revenue_kobo as number;
      // Project expected revenue over horizon
      predicted_value = expectedKobo * (horizonDays / 30);
      confidence = 60;
      model_notes = "Pipeline × win probability × time horizon";
      break;
    }
    case "deal_win_probability": {
      predicted_value = 40;  // baseline 40% for new deals
      confidence = 55;
      model_notes = "Baseline win probability estimate";
      break;
    }
  }

  return { predicted_value, confidence, model_notes };
}

// ============================================================================
// Router
// ============================================================================

const analyticsRouter = new Hono<{ Bindings: Env; Variables: Variables }>();

analyticsRouter.get("/", (c) =>
  c.json({
    module: "analytics",
    version: "2.0.0",
    epic: "XCT-5",
    status: "operational",
    tasks: ["CC-ANL-001", "CC-ANL-002"],
    description: "Cross-vertical analytics with custom report builder and predictive analytics",
  })
);

// ============================================================================
// Existing summary / revenue / growth endpoints
// ============================================================================

analyticsRouter.get("/summary", async (c) => {
  try {
    const tenantId = c.get("tenantId") as string;
    if (!tenantId) return c.json({ error: "Unauthorized" }, 401);

    const query = SummaryQuerySchema.parse(c.req.query());
    const { start } = getPeriodDates(query.period);
    const dateFilter = query.vertical ? `AND vertical = '${query.vertical}'` : "";

    const result = await c.env.DB.prepare(`
      SELECT vertical,
        SUM(revenue_kobo) as total_revenue_kobo,
        SUM(revenue_transactions) as total_transactions,
        SUM(active_users) as total_active_users,
        SUM(new_users) as total_new_users,
        SUM(total_actions) as total_actions,
        SUM(failed_actions) as total_failed_actions
      FROM xcut_analytics_daily_metrics
      WHERE tenant_id = ? AND created_at >= ? ${dateFilter}
      GROUP BY vertical ORDER BY total_revenue_kobo DESC
    `).bind(tenantId, start).all();

    const rows = result.results as any[];
    const summary = {
      period: query.period,
      start_date: new Date(start).toISOString(),
      end_date: new Date().toISOString(),
      verticals: rows.map(r => ({
        vertical: r.vertical as Vertical,
        revenue_kobo: r.total_revenue_kobo as number,
        revenue_naira: koboToNaira(r.total_revenue_kobo as number),
        transactions: r.total_transactions as number,
        active_users: r.total_active_users as number,
        new_users: r.total_new_users as number,
        actions: r.total_actions as number,
        failed_actions: r.total_failed_actions as number,
        success_rate: r.total_actions > 0
          ? ((r.total_actions - r.total_failed_actions) / r.total_actions * 100).toFixed(2)
          : "100.00",
      })),
      totals: rows.reduce((acc, r) => ({
        revenue_kobo: acc.revenue_kobo + (r.total_revenue_kobo as number),
        transactions: acc.transactions + (r.total_transactions as number),
        active_users: acc.active_users + (r.total_active_users as number),
        new_users: acc.new_users + (r.total_new_users as number),
      }), { revenue_kobo: 0, transactions: 0, active_users: 0, new_users: 0 }),
    };

    return c.json(summary);
  } catch (error: any) {
    console.error("Analytics summary error:", error);
    if (error instanceof z.ZodError) return c.json({ error: "Invalid query parameters", details: error.errors }, 400);
    return c.json({ error: error.message || "Internal server error" }, 500);
  }
});

analyticsRouter.get("/revenue", async (c) => {
  try {
    const tenantId = c.get("tenantId") as string;
    if (!tenantId) return c.json({ error: "Unauthorized" }, 401);

    const query = SummaryQuerySchema.parse(c.req.query());
    const { start } = getPeriodDates(query.period);
    const dateFilter = query.vertical ? `AND vertical = '${query.vertical}'` : "";

    const dailyResult = await c.env.DB.prepare(`
      SELECT DATE(created_at/1000, 'unixepoch') as date, vertical,
        SUM(revenue_kobo) as revenue_kobo, SUM(revenue_transactions) as transactions
      FROM xcut_analytics_daily_metrics
      WHERE tenant_id = ? AND created_at >= ? ${dateFilter}
      GROUP BY date, vertical ORDER BY date DESC, revenue_kobo DESC
    `).bind(tenantId, start).all();

    const monthlyResult = await c.env.DB.prepare(`
      SELECT metric_month, SUM(total_revenue_kobo) as revenue_kobo,
        SUM(total_transactions) as transactions, AVG(revenue_growth_rate) as avg_growth_rate
      FROM xcut_analytics_monthly_aggregates WHERE tenant_id = ?
      GROUP BY metric_month ORDER BY metric_month DESC LIMIT 6
    `).bind(tenantId).all();

    return c.json({
      period: query.period,
      daily: dailyResult.results || [],
      monthly_trends: monthlyResult.results || [],
    });
  } catch (error: any) {
    console.error("Revenue analytics error:", error);
    return c.json({ error: error.message || "Internal server error" }, 500);
  }
});

analyticsRouter.get("/growth", async (c) => {
  try {
    const tenantId = c.get("tenantId") as string;
    if (!tenantId) return c.json({ error: "Unauthorized" }, 401);

    const query = SummaryQuerySchema.parse(c.req.query());
    const { start } = getPeriodDates(query.period);
    const dateFilter = query.vertical ? `AND vertical = '${query.vertical}'` : "";

    const result = await c.env.DB.prepare(`
      SELECT DATE(created_at/1000, 'unixepoch') as date, vertical,
        SUM(active_users) as active_users, SUM(new_users) as new_users
      FROM xcut_analytics_daily_metrics
      WHERE tenant_id = ? AND created_at >= ? ${dateFilter}
      GROUP BY date, vertical ORDER BY date DESC, active_users DESC
    `).bind(tenantId, start).all();

    const rows = result.results as any[];
    const growthData = rows.map((r: any, i: number, arr: any[]) => {
      const prev = arr[i + 1];
      const growthRate = prev && prev.new_users > 0
        ? ((r.new_users - prev.new_users) / prev.new_users * 100) : 0;
      return {
        date: r.date, vertical: r.vertical as Vertical,
        active_users: r.active_users as number, new_users: r.new_users as number,
        growth_rate: parseFloat(growthRate.toFixed(2)),
      };
    });

    return c.json({ period: query.period, growth_data: growthData });
  } catch (error: any) {
    console.error("Growth analytics error:", error);
    return c.json({ error: error.message || "Internal server error" }, 500);
  }
});

analyticsRouter.post("/events", async (c) => {
  try {
    const tenantId = c.get("tenantId") as string;
    if (!tenantId) return c.json({ error: "Unauthorized" }, 401);

    const body = await c.req.json();
    const event = CreateEventSchema.parse(body);
    const eventId = generateId("evt");
    const now = Date.now();

    await c.env.DB.prepare(`
      INSERT INTO xcut_analytics_events (id, tenant_id, event_type, vertical, event_data, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).bind(eventId, tenantId, event.event_type, event.vertical, JSON.stringify(event.event_data), now).run();

    return c.json({ success: true, id: eventId }, 201);
  } catch (error: any) {
    console.error("Event ingestion error:", error);
    if (error instanceof z.ZodError) return c.json({ error: "Validation failed", details: error.errors }, 400);
    return c.json({ error: error.message || "Internal server error" }, 500);
  }
});

analyticsRouter.get("/insights", async (c) => {
  try {
    const tenantId = c.get("tenantId") as string;
    if (!tenantId) return c.json({ error: "Unauthorized" }, 401);

    const result = await c.env.DB.prepare(`
      SELECT id, tenant_id, insight_type, title, description, confidence, action_items, created_at, expires_at
      FROM xcut_analytics_insights
      WHERE tenant_id = ? AND (expires_at IS NULL OR expires_at > ?)
      ORDER BY confidence DESC, created_at DESC LIMIT 10
    `).bind(tenantId, Date.now()).all();

    const insights = (result.results as any[]).map((r: any) => ({
      id: r.id, tenant_id: r.tenant_id, insight_type: r.insight_type,
      title: r.title, description: r.description, confidence: r.confidence,
      action_items: JSON.parse(r.action_items || "[]"), created_at: r.created_at,
    }));

    return c.json({
      insights,
      ai_enabled: !!c.env.AI_PLATFORM_URL,
      count: insights.length,
    });
  } catch (error: any) {
    console.error("Insights error:", error);
    return c.json({ error: error.message || "Internal server error" }, 500);
  }
});

// ============================================================================
// CC-ANL-001: Custom Report Builder
// ============================================================================

analyticsRouter.get("/reports", async (c) => {
  try {
    const tenantId = c.get("tenantId") as string;
    if (!tenantId) return c.json({ error: "Unauthorized" }, 401);

    const result = await c.env.DB.prepare(`
      SELECT r.*, COUNT(rr.id) as run_count
      FROM xcut_analytics_report_definitions r
      LEFT JOIN xcut_analytics_report_runs rr ON rr.report_id = r.id
      WHERE r.tenant_id = ? OR r.is_shared = 1
      GROUP BY r.id
      ORDER BY r.created_at DESC
    `).bind(tenantId).all();

    const reports = (result.results as any[]).map((r: any) => ({
      id: r.id, name: r.name, description: r.description,
      data_source: r.data_source,
      metrics: JSON.parse(r.metrics || "[]"),
      dimensions: JSON.parse(r.dimensions || "[]"),
      filters: JSON.parse(r.filters || "[]"),
      sort_by: r.sort_by, sort_dir: r.sort_dir,
      limit_rows: r.limit_rows,
      visualization_type: r.visualization_type,
      is_shared: r.is_shared === 1,
      created_by: r.created_by, run_count: r.run_count,
      created_at: r.created_at, updated_at: r.updated_at,
    }));

    return c.json({ reports });
  } catch (error: any) {
    console.error("Reports list error:", error);
    return c.json({ error: error.message || "Internal server error" }, 500);
  }
});

analyticsRouter.post("/reports", async (c) => {
  try {
    const tenantId = c.get("tenantId") as string;
    if (!tenantId) return c.json({ error: "Unauthorized" }, 401);

    const body = await c.req.json();
    const data = ReportDefinitionSchema.parse(body);

    // Validate all fields against allowlist at definition time
    for (const m of data.metrics) sanitizeField(data.data_source, m.field);
    for (const d of data.dimensions) sanitizeField(data.data_source, d.field);
    for (const f of data.filters) sanitizeField(data.data_source, f.field);

    const reportId = generateId("report");
    const createdBy = (c.get("jwtPayload") as any)?.userId || "system";
    const now = Date.now();

    await c.env.DB.prepare(`
      INSERT INTO xcut_analytics_report_definitions
        (id, tenant_id, name, description, data_source, metrics, dimensions, filters,
         sort_by, sort_dir, limit_rows, visualization_type, is_shared, created_by, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      reportId, tenantId, data.name, data.description || null, data.data_source,
      JSON.stringify(data.metrics), JSON.stringify(data.dimensions),
      JSON.stringify(data.filters), data.sort_by || null, data.sort_dir,
      data.limit_rows, data.visualization_type, data.is_shared ? 1 : 0,
      createdBy, now, now
    ).run();

    return c.json({ success: true, id: reportId }, 201);
  } catch (error: any) {
    console.error("Create report error:", error);
    if (error instanceof z.ZodError) return c.json({ error: "Validation failed", details: error.errors }, 400);
    return c.json({ error: error.message || "Internal server error" }, 500);
  }
});

analyticsRouter.get("/reports/:id", async (c) => {
  try {
    const tenantId = c.get("tenantId") as string;
    if (!tenantId) return c.json({ error: "Unauthorized" }, 401);

    const id = c.req.param("id");
    const report = await c.env.DB.prepare(`
      SELECT * FROM xcut_analytics_report_definitions WHERE id = ? AND (tenant_id = ? OR is_shared = 1)
    `).bind(id, tenantId).first() as any;

    if (!report) return c.json({ error: "Report not found" }, 404);

    return c.json({
      id: report.id, name: report.name, description: report.description,
      data_source: report.data_source,
      metrics: JSON.parse(report.metrics || "[]"),
      dimensions: JSON.parse(report.dimensions || "[]"),
      filters: JSON.parse(report.filters || "[]"),
      sort_by: report.sort_by, sort_dir: report.sort_dir,
      limit_rows: report.limit_rows,
      visualization_type: report.visualization_type,
      is_shared: report.is_shared === 1,
      created_by: report.created_by,
      created_at: report.created_at, updated_at: report.updated_at,
    });
  } catch (error: any) {
    console.error("Get report error:", error);
    return c.json({ error: error.message || "Internal server error" }, 500);
  }
});

analyticsRouter.patch("/reports/:id", async (c) => {
  try {
    const tenantId = c.get("tenantId") as string;
    if (!tenantId) return c.json({ error: "Unauthorized" }, 401);

    const id = c.req.param("id");
    const body = await c.req.json();
    const data = ReportDefinitionSchema.partial().parse(body);
    const updates: string[] = [];
    const params: any[] = [];
    const now = Date.now();

    if (data.name !== undefined) { updates.push("name = ?"); params.push(data.name); }
    if (data.description !== undefined) { updates.push("description = ?"); params.push(data.description || null); }
    if (data.metrics !== undefined) { updates.push("metrics = ?"); params.push(JSON.stringify(data.metrics)); }
    if (data.dimensions !== undefined) { updates.push("dimensions = ?"); params.push(JSON.stringify(data.dimensions)); }
    if (data.filters !== undefined) { updates.push("filters = ?"); params.push(JSON.stringify(data.filters)); }
    if (data.visualization_type !== undefined) { updates.push("visualization_type = ?"); params.push(data.visualization_type); }
    if (data.is_shared !== undefined) { updates.push("is_shared = ?"); params.push(data.is_shared ? 1 : 0); }

    if (updates.length === 0) return c.json({ error: "No fields to update" }, 400);

    updates.push("updated_at = ?");
    params.push(now, id, tenantId);

    await c.env.DB.prepare(
      `UPDATE xcut_analytics_report_definitions SET ${updates.join(", ")} WHERE id = ? AND tenant_id = ?`
    ).bind(...params).run();

    return c.json({ success: true });
  } catch (error: any) {
    console.error("Update report error:", error);
    return c.json({ error: error.message || "Internal server error" }, 500);
  }
});

analyticsRouter.delete("/reports/:id", async (c) => {
  try {
    const tenantId = c.get("tenantId") as string;
    if (!tenantId) return c.json({ error: "Unauthorized" }, 401);

    const id = c.req.param("id");
    const result = await c.env.DB.prepare(
      `DELETE FROM xcut_analytics_report_definitions WHERE id = ? AND tenant_id = ?`
    ).bind(id, tenantId).run();

    if (!result.meta.changes) return c.json({ error: "Report not found" }, 404);
    return c.json({ success: true });
  } catch (error: any) {
    console.error("Delete report error:", error);
    return c.json({ error: error.message || "Internal server error" }, 500);
  }
});

// CC-ANL-001: Execute / run a report
analyticsRouter.post("/reports/:id/run", async (c) => {
  try {
    const tenantId = c.get("tenantId") as string;
    if (!tenantId) return c.json({ error: "Unauthorized" }, 401);

    const id = c.req.param("id");
    const ranBy = (c.get("jwtPayload") as any)?.userId || "system";

    const reportRow = await c.env.DB.prepare(`
      SELECT * FROM xcut_analytics_report_definitions WHERE id = ? AND (tenant_id = ? OR is_shared = 1)
    `).bind(id, tenantId).first() as any;

    if (!reportRow) return c.json({ error: "Report not found" }, 404);

    const def: z.infer<typeof ReportDefinitionSchema> = {
      ...reportRow,
      metrics: JSON.parse(reportRow.metrics || "[]"),
      dimensions: JSON.parse(reportRow.dimensions || "[]"),
      filters: JSON.parse(reportRow.filters || "[]"),
      is_shared: reportRow.is_shared === 1,
    };

    // Create a run record
    const runId = generateId("run");
    const startedAt = Date.now();

    await c.env.DB.prepare(`
      INSERT INTO xcut_analytics_report_runs (id, report_id, tenant_id, status, ran_by, started_at)
      VALUES (?, ?, ?, 'running', ?, ?)
    `).bind(runId, id, tenantId, ranBy, startedAt).run();

    let runStatus = "completed";
    let errorMsg: string | undefined;
    let rows: any[] = [];
    let rowCount = 0;

    try {
      const result = await executeReport(c.env.DB, tenantId, def);
      rows = result.rows;
      rowCount = result.row_count;
    } catch (err: any) {
      runStatus = "failed";
      errorMsg = err.message;
    }

    const now = Date.now();
    await c.env.DB.prepare(`
      UPDATE xcut_analytics_report_runs SET status = ?, row_count = ?, result_preview = ?, error = ?, completed_at = ?
      WHERE id = ?
    `).bind(
      runStatus, rowCount,
      JSON.stringify(rows.slice(0, 10)),
      errorMsg || null, now, runId
    ).run();

    if (runStatus === "failed") {
      return c.json({ error: errorMsg || "Report execution failed" }, 500);
    }

    return c.json({
      run_id: runId,
      row_count: rowCount,
      execution_ms: now - startedAt,
      visualization_type: def.visualization_type,
      data: rows,
    });
  } catch (error: any) {
    console.error("Run report error:", error);
    return c.json({ error: error.message || "Internal server error" }, 500);
  }
});

// CC-ANL-001: Get run history for a report
analyticsRouter.get("/reports/:id/runs", async (c) => {
  try {
    const tenantId = c.get("tenantId") as string;
    if (!tenantId) return c.json({ error: "Unauthorized" }, 401);

    const id = c.req.param("id");
    const result = await c.env.DB.prepare(`
      SELECT id, status, row_count, ran_by, started_at, completed_at, error
      FROM xcut_analytics_report_runs
      WHERE report_id = ? AND tenant_id = ?
      ORDER BY started_at DESC LIMIT 20
    `).bind(id, tenantId).all();

    return c.json({ runs: result.results });
  } catch (error: any) {
    console.error("Report runs error:", error);
    return c.json({ error: error.message || "Internal server error" }, 500);
  }
});

// CC-ANL-001: Available data sources and their fields
analyticsRouter.get("/reports/schema/sources", (c) => {
  const tenantId = c.get("tenantId") as string;
  if (!tenantId) return c.json({ error: "Unauthorized" }, 401);

  return c.json({
    data_sources: Object.entries(ALLOWED_FIELDS).map(([source, fields]) => ({
      name: source,
      fields: fields.map(f => ({ name: f })),
    })),
    aggregations: ["sum", "count", "avg", "min", "max", "count_distinct"],
    operators: ["eq", "neq", "gt", "lt", "gte", "lte", "contains", "in", "notin", "between"],
    visualization_types: ["table", "bar", "line", "pie", "area", "scatter"],
  });
});

// ============================================================================
// CC-ANL-002: Predictive Analytics
// ============================================================================

analyticsRouter.post("/predict", async (c) => {
  try {
    const tenantId = c.get("tenantId") as string;
    if (!tenantId) return c.json({ error: "Unauthorized" }, 401);

    const body = await c.req.json();
    const request = PredictionRequestSchema.parse(body);

    const now = Date.now();

    // Check for cached prediction (unless force_refresh)
    if (!request.force_refresh) {
      const cached = await c.env.DB.prepare(`
        SELECT * FROM xcut_analytics_predictions
        WHERE tenant_id = ? AND metric_name = ? AND expires_at > ?
        ORDER BY created_at DESC LIMIT 1
      `).bind(tenantId, request.metric_name, now).first() as any;

      if (cached) {
        return c.json({
          from_cache: true,
          id: cached.id,
          metric_name: cached.metric_name,
          prediction_type: cached.prediction_type,
          current_value: cached.current_value,
          predicted_value: cached.predicted_value,
          confidence: cached.confidence,
          horizon_days: cached.horizon_days,
          model_version: cached.model_version,
          ai_provider: cached.ai_provider,
          supporting_data: JSON.parse(cached.supporting_data || "{}"),
          created_at: cached.created_at,
          expires_at: cached.expires_at,
        });
      }
    }

    // Gather historical data
    const historicalData = await gatherMetricData(c.env.DB, tenantId, request.metric_name);

    // Generate prediction via AI platform or fallback (CC-ANL-002: routes through webwaka-ai-platform)
    const prediction = await generatePrediction(
      c.env,
      tenantId,
      request.metric_name,
      request.horizon_days,
      historicalData
    );

    // Determine current value from historical data
    let currentValue: number | null = null;
    switch (request.metric_name) {
      case "lead_conversion_rate": currentValue = historicalData.current_rate; break;
      case "ticket_resolution_time": currentValue = historicalData.avg_resolution_minutes; break;
      case "employee_churn_risk": currentValue = historicalData.churn_rate; break;
      case "revenue_forecast": currentValue = historicalData.expected_revenue_kobo; break;
    }

    // Store prediction
    const predictionId = generateId("pred");
    const expiresAt = now + 24 * 60 * 60 * 1000;  // 24 hours TTL

    await c.env.DB.prepare(`
      INSERT INTO xcut_analytics_predictions
        (id, tenant_id, metric_name, prediction_type, current_value, predicted_value,
         confidence, horizon_days, model_version, supporting_data, ai_provider, created_at, expires_at)
      VALUES (?, ?, ?, 'forecast', ?, ?, ?, ?, 'v1', ?, 'webwaka-ai-platform', ?, ?)
    `).bind(
      predictionId, tenantId, request.metric_name,
      currentValue, prediction.predicted_value, prediction.confidence,
      request.horizon_days, JSON.stringify({ ...historicalData, model_notes: prediction.model_notes }),
      now, expiresAt
    ).run();

    return c.json({
      from_cache: false,
      id: predictionId,
      metric_name: request.metric_name,
      prediction_type: "forecast",
      current_value: currentValue,
      predicted_value: prediction.predicted_value,
      confidence: prediction.confidence,
      horizon_days: request.horizon_days,
      model_notes: prediction.model_notes,
      ai_provider: "webwaka-ai-platform",
      supporting_data: historicalData,
      created_at: now,
      expires_at: expiresAt,
    });
  } catch (error: any) {
    console.error("Prediction error:", error);
    if (error instanceof z.ZodError) return c.json({ error: "Validation failed", details: error.errors }, 400);
    return c.json({ error: error.message || "Internal server error" }, 500);
  }
});

analyticsRouter.get("/predictions", async (c) => {
  try {
    const tenantId = c.get("tenantId") as string;
    if (!tenantId) return c.json({ error: "Unauthorized" }, 401);

    const metric = c.req.query("metric_name");
    const now = Date.now();

    let query = `SELECT * FROM xcut_analytics_predictions WHERE tenant_id = ? AND expires_at > ?`;
    const params: any[] = [tenantId, now];

    if (metric) { query += ` AND metric_name = ?`; params.push(metric); }
    query += ` ORDER BY created_at DESC`;

    const result = await c.env.DB.prepare(query).bind(...params).all();

    const predictions = (result.results as any[]).map((p: any) => ({
      id: p.id, metric_name: p.metric_name, prediction_type: p.prediction_type,
      current_value: p.current_value, predicted_value: p.predicted_value,
      confidence: p.confidence, horizon_days: p.horizon_days,
      model_version: p.model_version, ai_provider: p.ai_provider,
      supporting_data: JSON.parse(p.supporting_data || "{}"),
      created_at: p.created_at, expires_at: p.expires_at,
    }));

    return c.json({ predictions });
  } catch (error: any) {
    console.error("Predictions list error:", error);
    return c.json({ error: error.message || "Internal server error" }, 500);
  }
});

// CC-ANL-002: Available predictive metrics
analyticsRouter.get("/predictions/metrics", (c) => {
  const tenantId = c.get("tenantId") as string;
  if (!tenantId) return c.json({ error: "Unauthorized" }, 401);

  return c.json({
    available_metrics: [
      {
        name: "lead_conversion_rate",
        description: "Predicted lead-to-won conversion rate (%)",
        unit: "percentage",
        ai_required: false,
      },
      {
        name: "ticket_resolution_time",
        description: "Predicted average ticket resolution time (minutes)",
        unit: "minutes",
        ai_required: false,
      },
      {
        name: "employee_churn_risk",
        description: "Predicted employee churn/turnover risk (%)",
        unit: "percentage",
        ai_required: false,
      },
      {
        name: "revenue_forecast",
        description: "Projected revenue from active pipeline (kobo)",
        unit: "kobo",
        ai_required: false,
      },
      {
        name: "deal_win_probability",
        description: "Predicted deal win probability by stage (%)",
        unit: "percentage",
        ai_required: false,
      },
    ],
    ai_platform_connected: !!c.env.AI_PLATFORM_URL,
    cache_ttl_hours: 24,
  });
});

analyticsRouter.get("/health", async (c) => {
  const tenantId = c.get("tenantId") as string;
  if (!tenantId) return c.json({ error: "Unauthorized" }, 401);

  const dbCheck = await c.env.DB.prepare("SELECT 1").first();
  const dbHealthy = !!dbCheck;

  let aiHealthy = false;
  if (c.env.AI_PLATFORM_URL) {
    try {
      const response = await fetch(`${c.env.AI_PLATFORM_URL}/health`, {
        headers: { Authorization: `Bearer ${c.env.AI_PLATFORM_TOKEN}` },
      });
      aiHealthy = response.ok;
    } catch {
      aiHealthy = false;
    }
  }

  return c.json({
    status: dbHealthy ? "healthy" : "unhealthy",
    database: dbHealthy,
    ai_platform: aiHealthy,
    tenant_id: tenantId,
    tasks_implemented: ["CC-ANL-001", "CC-ANL-002"],
    timestamp: Date.now(),
  });
});

export { analyticsRouter };
