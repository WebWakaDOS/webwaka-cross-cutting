/**
 * XCT-5: Advanced Analytics & Data Visualization
 * Blueprint: Part 10.12 — Data & Assets
 * Description: Cross-vertical analytics with revenue tracking, user growth,
 *              operational metrics, and AI-generated insights
 */
import { Hono } from "hono";
import { z } from "zod";
import type { Env, Variables } from "../../worker";

type AnalyticsPeriod = "7d" | "30d" | "90d" | "1y";
type Vertical = "commerce" | "transport" | "logistics" | "fintech" | "civic" |
                 "institutional" | "real-estate" | "professional" | "production" | "services";

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

function generateId(prefix: string): string {
  const bytes = new Uint8Array(6);
  crypto.getRandomValues(bytes);
  const suffix = Array.from(bytes)
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
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
  const start = now - periods[period];
  return { start };
}

function koboToNaira(kobo: number): number {
  return kobo / 100;
}

const analyticsRouter = new Hono<{ Bindings: Env; Variables: Variables }>();

analyticsRouter.get("/", (c) =>
  c.json({
    module: "analytics",
    version: "1.0.0",
    epic: "XCT-5",
    status: "operational",
    description: "Cross-vertical analytics with revenue tracking, user growth, operational metrics, and AI-generated insights",
  })
);

analyticsRouter.get("/summary", async (c) => {
  try {
    const tenantId = c.get("tenantId") as string;
    if (!tenantId) {
      return c.json({ error: "Unauthorized" }, 401);
    }

    const query = SummaryQuerySchema.parse(c.req.query());
    const { start } = getPeriodDates(query.period);

    const dateFilter = query.vertical
      ? `AND vertical = '${query.vertical}'`
      : "";

    const result = await c.env.DB.prepare(`
      SELECT
        vertical,
        SUM(revenue_kobo) as total_revenue_kobo,
        SUM(revenue_transactions) as total_transactions,
        SUM(active_users) as total_active_users,
        SUM(new_users) as total_new_users,
        SUM(total_actions) as total_actions,
        SUM(failed_actions) as total_failed_actions
      FROM analytics_daily_metrics
      WHERE tenant_id = ?
        AND created_at >= ?
        ${dateFilter}
      GROUP BY vertical
      ORDER BY total_revenue_kobo DESC
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
    return c.json({ error: error.message || "Internal server error" }, 500);
  }
});

analyticsRouter.get("/revenue", async (c) => {
  try {
    const tenantId = c.get("tenantId") as string;
    if (!tenantId) {
      return c.json({ error: "Unauthorized" }, 401);
    }

    const query = SummaryQuerySchema.parse(c.req.query());
    const { start } = getPeriodDates(query.period);

    const dateFilter = query.vertical
      ? `AND vertical = '${query.vertical}'`
      : "";

    const dailyResult = await c.env.DB.prepare(`
      SELECT
        DATE(created_at/1000, 'unixepoch') as date,
        vertical,
        SUM(revenue_kobo) as revenue_kobo,
        SUM(revenue_transactions) as transactions
      FROM analytics_daily_metrics
      WHERE tenant_id = ?
        AND created_at >= ?
        ${dateFilter}
      GROUP BY date, vertical
      ORDER BY date DESC, revenue_kobo DESC
    `).bind(tenantId, start).all();

    const monthlyResult = await c.env.DB.prepare(`
      SELECT
        metric_month,
        SUM(total_revenue_kobo) as revenue_kobo,
        SUM(total_transactions) as transactions,
        AVG(revenue_growth_rate) as avg_growth_rate
      FROM analytics_monthly_aggregates
      WHERE tenant_id = ?
      GROUP BY metric_month
      ORDER BY metric_month DESC
      LIMIT 6
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
    if (!tenantId) {
      return c.json({ error: "Unauthorized" }, 401);
    }

    const query = SummaryQuerySchema.parse(c.req.query());
    const { start } = getPeriodDates(query.period);

    const dateFilter = query.vertical
      ? `AND vertical = '${query.vertical}'`
      : "";

    const result = await c.env.DB.prepare(`
      SELECT
        DATE(created_at/1000, 'unixepoch') as date,
        vertical,
        SUM(active_users) as active_users,
        SUM(new_users) as new_users
      FROM analytics_daily_metrics
      WHERE tenant_id = ?
        AND created_at >= ?
        ${dateFilter}
      GROUP BY date, vertical
      ORDER BY date DESC, active_users DESC
    `).bind(tenantId, start).all();

    const rows = result.results as any[];
    const growthData = rows.map((r: any, i: number, arr: any[]) => {
      const prev = arr[i + 1];
      const growthRate = prev && prev.new_users > 0
        ? ((r.new_users - prev.new_users) / prev.new_users * 100)
        : 0;

      return {
        date: r.date,
        vertical: r.vertical as Vertical,
        active_users: r.active_users as number,
        new_users: r.new_users as number,
        growth_rate: parseFloat(growthRate.toFixed(2)),
      };
    });

    return c.json({
      period: query.period,
      growth_data: growthData,
    });
  } catch (error: any) {
    console.error("Growth analytics error:", error);
    return c.json({ error: error.message || "Internal server error" }, 500);
  }
});

analyticsRouter.post("/events", async (c) => {
  try {
    const tenantId = c.get("tenantId") as string;
    if (!tenantId) {
      return c.json({ error: "Unauthorized" }, 401);
    }

    const body = await c.req.json();
    const event = CreateEventSchema.parse(body);

    const eventId = generateId("evt");
    const now = Date.now();

    await c.env.DB.prepare(`
      INSERT INTO analytics_events (id, tenant_id, event_type, vertical, event_data, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).bind(eventId, tenantId, event.event_type, event.vertical, JSON.stringify(event.event_data), now).run();

    return c.json({ success: true, id: eventId }, 201);
  } catch (error: any) {
    console.error("Event ingestion error:", error);
    if (error instanceof z.ZodError) {
      return c.json({ error: "Validation failed", details: error.errors }, 400);
    }
    return c.json({ error: error.message || "Internal server error" }, 500);
  }
});

analyticsRouter.get("/insights", async (c) => {
  try {
    const tenantId = c.get("tenantId") as string;
    if (!tenantId) {
      return c.json({ error: "Unauthorized" }, 401);
    }

    const result = await c.env.DB.prepare(`
      SELECT
        id, tenant_id, insight_type, title, description, confidence,
        action_items, created_at, expires_at
      FROM analytics_insights
      WHERE tenant_id = ?
        AND (expires_at IS NULL OR expires_at > ?)
      ORDER BY confidence DESC, created_at DESC
      LIMIT 10
    `).bind(tenantId, Date.now()).all();

    const insights = (result.results as any[]).map((r: any) => ({
      id: r.id,
      tenant_id: r.tenant_id,
      insight_type: r.insight_type,
      title: r.title,
      description: r.description,
      confidence: r.confidence,
      action_items: JSON.parse(r.action_items || "[]"),
      created_at: r.created_at,
    }));

    if (insights.length === 0 && c.env.AI_PLATFORM_URL && c.env.AI_PLATFORM_TOKEN) {
      return c.json({
        insights: [],
        ai_enabled: true,
        message: "Insights generation in progress",
      });
    }

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

analyticsRouter.get("/health", async (c) => {
  const tenantId = c.get("tenantId") as string;
  if (!tenantId) {
    return c.json({ error: "Unauthorized" }, 401);
  }

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
    timestamp: Date.now(),
  });
});

export { analyticsRouter };