/**
 * XCT-3: Support Ticketing & Workflow Automation
 * Blueprint: Part 10.12 — Operations
 * Tasks: CC-TKT-001 (SLA Management), CC-TKT-002 (Automated Ticket Routing)
 */
import { Hono } from "hono";
import { z } from "zod";
import type { Env, Variables } from "../../worker";

// ============================================================================
// Validation Schemas
// ============================================================================

const TicketSchema = z.object({
  subject: z.string().min(1).max(500),
  body: z.string().max(10000),
  status: z.enum(["open", "in_progress", "pending", "resolved", "closed"]).default("open"),
  priority: z.enum(["low", "medium", "high", "critical"]).default("medium"),
  category: z.string().max(100).optional().or(z.literal("")),
  assigned_to: z.string().optional(),
  requester_id: z.string().optional(),
  source: z.enum(["web", "email", "whatsapp", "telegram", "api"]).default("web"),
});

const TicketUpdateSchema = TicketSchema.partial();

const CommentSchema = z.object({
  body: z.string().min(1).max(10000),
  is_internal: z.boolean().default(false),
});

const WorkflowRuleSchema = z.object({
  name: z.string().min(1).max(200),
  trigger_type: z.enum(["status_change", "priority_change", "category_match", "new_ticket"]),
  trigger_value: z.string(),
  action_type: z.enum(["assign_to", "set_status", "set_priority", "send_notification"]),
  action_value: z.string(),
  is_active: z.boolean().default(true),
});

// CC-TKT-001: SLA
const SLAPolicySchema = z.object({
  name: z.string().min(1).max(200),
  priority: z.enum(["low", "medium", "high", "critical"]),
  response_time_minutes: z.number().int().min(1),
  resolution_time_minutes: z.number().int().min(1),
  escalate_to: z.string().optional(),
  is_active: z.boolean().default(true),
});

// CC-TKT-002: Routing
const RoutingRuleSchema = z.object({
  name: z.string().min(1).max(200),
  priority_order: z.number().int().min(0).default(0),
  match_type: z.enum(["any", "all"]).default("any"),
  keyword_patterns: z.array(z.string()).optional().default([]),
  urgency_keywords: z.array(z.string()).optional().default([]),
  category_match: z.string().optional(),
  source_match: z.string().optional(),
  assign_to: z.string().optional(),
  assign_team: z.string().optional(),
  set_priority: z.enum(["low", "medium", "high", "critical"]).optional(),
  set_category: z.string().optional(),
  is_active: z.boolean().default(true),
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

// CC-TKT-001: Apply SLA policy to a ticket
async function applySLAPolicy(
  db: D1Database,
  tenantId: string,
  ticketId: string,
  priority: string,
  createdAt: number
): Promise<void> {
  try {
    // Look for tenant-specific SLA first, then default
    let policy = await db.prepare(`
      SELECT * FROM ticket_sla_policies
      WHERE (tenant_id = ? OR tenant_id = 'default') AND priority = ? AND is_active = 1
      ORDER BY CASE WHEN tenant_id = ? THEN 0 ELSE 1 END ASC
      LIMIT 1
    `).bind(tenantId, priority, tenantId).first() as any;

    if (!policy) return;

    const responseDue = createdAt + policy.response_time_minutes * 60 * 1000;
    const resolutionDue = createdAt + policy.resolution_time_minutes * 60 * 1000;

    await db.prepare(`
      UPDATE tickets SET
        sla_policy_id = ?, sla_status = 'within_sla',
        response_due_at = ?, resolution_due_at = ?
      WHERE id = ? AND tenant_id = ?
    `).bind(policy.id, responseDue, resolutionDue, ticketId, tenantId).run();
  } catch (err: any) {
    console.error("Apply SLA error:", err.message);
  }
}

// CC-TKT-001: Check and update SLA status
function computeSLAStatus(
  now: number,
  responseDueAt: number | null,
  resolutionDueAt: number | null,
  firstRespondedAt: number | null,
  ticketStatus: string
): string {
  if (ticketStatus === "resolved" || ticketStatus === "closed") return "within_sla";

  if (resolutionDueAt && now > resolutionDueAt) return "breached";

  const atRiskThreshold = 0.8; // 80% of time elapsed = at_risk
  if (resolutionDueAt) {
    const totalTime = resolutionDueAt - (responseDueAt ? responseDueAt - 60 * 60 * 1000 : now - 60 * 60 * 1000);
    const elapsed = now - (resolutionDueAt - totalTime);
    if (elapsed / totalTime >= atRiskThreshold) return "at_risk";
  }

  if (!firstRespondedAt && responseDueAt && now > responseDueAt) return "breached";

  return "within_sla";
}

// CC-TKT-002: Extract keywords and determine urgency
function extractKeywords(text: string): string[] {
  return text.toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(w => w.length > 3);
}

// CC-TKT-002: Apply routing rules to a newly created ticket
async function applyRoutingRules(
  db: D1Database,
  tenantId: string,
  ticketId: string,
  subject: string,
  body: string,
  source: string,
  category: string | null,
  priority: string
): Promise<{ assigned_to?: string; assign_team?: string; new_priority?: string; new_category?: string }> {
  try {
    const rulesResult = await db.prepare(`
      SELECT * FROM ticket_routing_rules
      WHERE (tenant_id = ? OR tenant_id = 'default') AND is_active = 1
      ORDER BY priority_order ASC, tenant_id DESC
    `).bind(tenantId).all();

    const rules = rulesResult.results as any[];
    const textToSearch = `${subject} ${body}`.toLowerCase();
    const keywords = extractKeywords(textToSearch);

    for (const rule of rules) {
      const keywordPatterns: string[] = JSON.parse(rule.keyword_patterns || "[]");
      const urgencyKeywords: string[] = JSON.parse(rule.urgency_keywords || "[]");

      let matched = false;
      const matchedKws: string[] = [];

      // Check urgency keywords first (override to critical)
      const hasUrgency = urgencyKeywords.some(uk => textToSearch.includes(uk.toLowerCase()));
      if (hasUrgency) {
        urgencyKeywords.forEach(uk => {
          if (textToSearch.includes(uk.toLowerCase())) matchedKws.push(uk);
        });
      }

      // Check keyword patterns
      if (keywordPatterns.length > 0) {
        const kwMatches = keywordPatterns.filter(kp =>
          keywords.some(k => k.includes(kp.toLowerCase()) || kp.toLowerCase().includes(k))
        );
        if (kwMatches.length > 0) {
          matchedKws.push(...kwMatches);
          matched = true;
        }
      }

      // Check category match
      if (rule.category_match && rule.category_match === category) matched = true;

      // Check source match
      if (rule.source_match && rule.source_match === source) matched = true;

      if (hasUrgency) matched = true;

      if (!matched) continue;

      // Apply routing actions
      const actions: any = {};
      const updates: string[] = [];
      const params: any[] = [];

      if (rule.assign_to) {
        updates.push("assigned_to = ?");
        params.push(rule.assign_to);
        actions.assigned_to = rule.assign_to;
      }
      if (rule.set_priority || hasUrgency) {
        const newPriority = hasUrgency ? "critical" : (rule.set_priority || priority);
        updates.push("priority = ?");
        params.push(newPriority);
        actions.new_priority = newPriority;
      }
      if (rule.set_category) {
        updates.push("category = ?");
        params.push(rule.set_category);
        actions.new_category = rule.set_category;
      }

      if (updates.length > 0) {
        updates.push("updated_at = ?");
        params.push(Date.now(), ticketId, tenantId);
        await db.prepare(
          `UPDATE tickets SET ${updates.join(", ")} WHERE id = ? AND tenant_id = ?`
        ).bind(...params).run();
      }

      // Log routing decision
      await db.prepare(`
        INSERT INTO ticket_routing_logs (id, ticket_id, rule_id, matched_keywords, action_taken, routed_to, fallback_used, created_at)
        VALUES (?, ?, ?, ?, ?, ?, 0, ?)
      `).bind(
        generateId("rtlog"), ticketId, rule.id,
        JSON.stringify(matchedKws), JSON.stringify(actions),
        rule.assign_to || rule.assign_team || null, Date.now()
      ).run();

      return { ...actions, assign_team: rule.assign_team };
    }

    // Fallback: no rule matched — log fallback
    await db.prepare(`
      INSERT INTO ticket_routing_logs (id, ticket_id, rule_id, matched_keywords, action_taken, routed_to, fallback_used, created_at)
      VALUES (?, ?, NULL, '[]', '{"fallback":"general_queue"}', NULL, 1, ?)
    `).bind(generateId("rtlog"), ticketId, Date.now()).run();

    return {};
  } catch (err: any) {
    console.error("Routing rules error:", err.message);
    return {};
  }
}

// ============================================================================
// Router
// ============================================================================

const ticketingRouter = new Hono<{ Bindings: Env; Variables: Variables }>();

ticketingRouter.get("/", (c) =>
  c.json({
    module: "ticketing",
    version: "2.0.0",
    epic: "XCT-3",
    status: "operational",
    tasks: ["CC-TKT-001", "CC-TKT-002"],
    description: "Support ticketing with SLA management and automated routing",
  })
);

// ============================================================================
// Tickets
// ============================================================================

ticketingRouter.get("/tickets", async (c) => {
  try {
    const tenantId = c.get("tenantId") as string;
    if (!tenantId) return c.json({ error: "Unauthorized" }, 401);

    const page = parseInt(c.req.query("page") || "1");
    const limit = parseInt(c.req.query("limit") || "20");
    const status = c.req.query("status");
    const priority = c.req.query("priority");
    const assigned_to = c.req.query("assigned_to");
    const sla_status = c.req.query("sla_status");
    const search = c.req.query("search");
    const offset = (page - 1) * limit;

    let query = `SELECT * FROM tickets WHERE tenant_id = ?`;
    const params: any[] = [tenantId];

    if (status) { query += ` AND status = ?`; params.push(status); }
    if (priority) { query += ` AND priority = ?`; params.push(priority); }
    if (assigned_to) { query += ` AND assigned_to = ?`; params.push(assigned_to); }
    if (sla_status) { query += ` AND sla_status = ?`; params.push(sla_status); }
    if (search) {
      query += ` AND (subject LIKE ? OR body LIKE ?)`;
      const s = `%${search}%`;
      params.push(s, s);
    }

    query += ` ORDER BY created_at DESC LIMIT ? OFFSET ?`;
    params.push(limit, offset);

    const result = await c.env.DB.prepare(query).bind(...params).all();
    const countResult = await c.env.DB.prepare(
      `SELECT COUNT(*) as count FROM tickets WHERE tenant_id = ?`
    ).bind(tenantId).first();
    const total = (countResult?.count as number) || 0;
    const now = Date.now();

    const tickets = (result.results as any[]).map((t: any) => {
      const slaStatus = computeSLAStatus(
        now, t.response_due_at, t.resolution_due_at, t.first_responded_at, t.status
      );
      return {
        id: t.id, subject: t.subject, body: t.body, status: t.status,
        priority: t.priority, category: t.category, assigned_to: t.assigned_to,
        requester_id: t.requester_id, source: t.source,
        sla_status: slaStatus,
        response_due_at: t.response_due_at,
        resolution_due_at: t.resolution_due_at,
        first_responded_at: t.first_responded_at,
        resolved_at: t.resolved_at,
        created_at: t.created_at, updated_at: t.updated_at,
      };
    });

    return c.json({ tickets, pagination: { page, limit, total, pages: Math.ceil(total / limit) } });
  } catch (error: any) {
    console.error("Tickets list error:", error);
    return c.json({ error: error.message || "Internal server error" }, 500);
  }
});

ticketingRouter.post("/tickets", async (c) => {
  try {
    const tenantId = c.get("tenantId") as string;
    if (!tenantId) return c.json({ error: "Unauthorized" }, 401);

    const body = await c.req.json();
    const data = TicketSchema.parse(body);

    const ticketId = generateId("ticket");
    const now = Date.now();

    await c.env.DB.prepare(`
      INSERT INTO tickets (id, tenant_id, subject, body, status, priority, category, assigned_to, requester_id, source, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      ticketId, tenantId, data.subject, data.body || null, data.status, data.priority,
      data.category || null, data.assigned_to || null, data.requester_id || null, data.source, now, now
    ).run();

    // CC-TKT-002: Apply routing rules before SLA (routing may change priority)
    const routingResult = await applyRoutingRules(
      c.env.DB, tenantId, ticketId,
      data.subject, data.body || "",
      data.source, data.category || null,
      data.priority
    );

    // CC-TKT-001: Apply SLA policy (using possibly-updated priority)
    const effectivePriority = routingResult.new_priority || data.priority;
    await applySLAPolicy(c.env.DB, tenantId, ticketId, effectivePriority, now);

    return c.json({
      success: true, id: ticketId,
      routing: routingResult,
    }, 201);
  } catch (error: any) {
    console.error("Create ticket error:", error);
    if (error instanceof z.ZodError) return c.json({ error: "Validation failed", details: error.errors }, 400);
    return c.json({ error: error.message || "Internal server error" }, 500);
  }
});

ticketingRouter.get("/tickets/:id", async (c) => {
  try {
    const tenantId = c.get("tenantId") as string;
    if (!tenantId) return c.json({ error: "Unauthorized" }, 401);

    const id = c.req.param("id");
    const result = await c.env.DB.prepare(
      `SELECT * FROM tickets WHERE id = ? AND tenant_id = ?`
    ).bind(id, tenantId).first();

    if (!result) return c.json({ error: "Ticket not found" }, 404);

    const t = result as any;
    const now = Date.now();
    const slaStatus = computeSLAStatus(
      now, t.response_due_at, t.resolution_due_at, t.first_responded_at, t.status
    );

    return c.json({
      id: t.id, subject: t.subject, body: t.body, status: t.status,
      priority: t.priority, category: t.category, assigned_to: t.assigned_to,
      requester_id: t.requester_id, source: t.source,
      sla_policy_id: t.sla_policy_id, sla_status: slaStatus,
      response_due_at: t.response_due_at, resolution_due_at: t.resolution_due_at,
      first_responded_at: t.first_responded_at, resolved_at: t.resolved_at,
      created_at: t.created_at, updated_at: t.updated_at,
    });
  } catch (error: any) {
    console.error("Get ticket error:", error);
    return c.json({ error: error.message || "Internal server error" }, 500);
  }
});

ticketingRouter.patch("/tickets/:id", async (c) => {
  try {
    const tenantId = c.get("tenantId") as string;
    if (!tenantId) return c.json({ error: "Unauthorized" }, 401);

    const id = c.req.param("id");
    const body = await c.req.json();
    const data = TicketUpdateSchema.parse(body);

    const now = Date.now();
    const updates: string[] = [];
    const params: any[] = [];

    if (data.subject !== undefined) { updates.push("subject = ?"); params.push(data.subject); }
    if (data.body !== undefined) { updates.push("body = ?"); params.push(data.body || null); }
    if (data.status !== undefined) {
      updates.push("status = ?");
      params.push(data.status);
      if (data.status === "resolved") { updates.push("resolved_at = ?"); params.push(now); }
      // CC-TKT-001: Record first response when going from open → in_progress
      if (data.status === "in_progress") {
        updates.push("first_responded_at = COALESCE(first_responded_at, ?)");
        params.push(now);
      }
    }
    if (data.priority !== undefined) { updates.push("priority = ?"); params.push(data.priority); }
    if (data.category !== undefined) { updates.push("category = ?"); params.push(data.category || null); }
    if (data.assigned_to !== undefined) { updates.push("assigned_to = ?"); params.push(data.assigned_to || null); }

    if (updates.length === 0) return c.json({ error: "No fields to update" }, 400);

    updates.push("updated_at = ?");
    params.push(now, id, tenantId);

    await c.env.DB.prepare(
      `UPDATE tickets SET ${updates.join(", ")} WHERE id = ? AND tenant_id = ?`
    ).bind(...params).run();

    // CC-TKT-001: Update SLA status after ticket state change
    if (data.status || data.priority) {
      const ticket = await c.env.DB.prepare(
        `SELECT * FROM tickets WHERE id = ? AND tenant_id = ?`
      ).bind(id, tenantId).first() as any;

      if (ticket) {
        const newSlaStatus = computeSLAStatus(
          now, ticket.response_due_at, ticket.resolution_due_at,
          ticket.first_responded_at, ticket.status
        );
        await c.env.DB.prepare(
          `UPDATE tickets SET sla_status = ? WHERE id = ? AND tenant_id = ?`
        ).bind(newSlaStatus, id, tenantId).run();
      }
    }

    return c.json({ success: true });
  } catch (error: any) {
    console.error("Update ticket error:", error);
    if (error instanceof z.ZodError) return c.json({ error: "Validation failed", details: error.errors }, 400);
    return c.json({ error: error.message || "Internal server error" }, 500);
  }
});

ticketingRouter.delete("/tickets/:id", async (c) => {
  try {
    const tenantId = c.get("tenantId") as string;
    if (!tenantId) return c.json({ error: "Unauthorized" }, 401);

    const id = c.req.param("id");
    const result = await c.env.DB.prepare(
      `DELETE FROM tickets WHERE id = ? AND tenant_id = ?`
    ).bind(id, tenantId).run();

    if (!result.meta.changes) return c.json({ error: "Ticket not found" }, 404);
    return c.json({ success: true });
  } catch (error: any) {
    console.error("Delete ticket error:", error);
    return c.json({ error: error.message || "Internal server error" }, 500);
  }
});

// ============================================================================
// Comments
// ============================================================================

ticketingRouter.get("/tickets/:id/comments", async (c) => {
  try {
    const tenantId = c.get("tenantId") as string;
    if (!tenantId) return c.json({ error: "Unauthorized" }, 401);

    const ticketId = c.req.param("id");
    const result = await c.env.DB.prepare(
      `SELECT * FROM ticket_comments WHERE ticket_id = ? ORDER BY created_at ASC`
    ).bind(ticketId).all();

    const comments = (result.results as any[]).map((cm: any) => ({
      id: cm.id, author_id: cm.author_id, body: cm.body,
      is_internal: cm.is_internal === 1, created_at: cm.created_at,
    }));

    return c.json({ comments });
  } catch (error: any) {
    console.error("Comments list error:", error);
    return c.json({ error: error.message || "Internal server error" }, 500);
  }
});

ticketingRouter.post("/tickets/:id/comments", async (c) => {
  try {
    const tenantId = c.get("tenantId") as string;
    if (!tenantId) return c.json({ error: "Unauthorized" }, 401);

    const ticketId = c.req.param("id");
    const body = await c.req.json();
    const data = CommentSchema.parse(body);

    const commentId = generateId("comment");
    const now = Date.now();
    const authorId = (c.get("jwtPayload") as any)?.userId || "system";

    await c.env.DB.prepare(`
      INSERT INTO ticket_comments (id, ticket_id, author_id, body, is_internal, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).bind(commentId, ticketId, authorId, data.body, data.is_internal ? 1 : 0, now).run();

    // CC-TKT-001: Mark first response time when non-internal comment is added
    if (!data.is_internal) {
      await c.env.DB.prepare(`
        UPDATE tickets SET
          first_responded_at = COALESCE(first_responded_at, ?),
          updated_at = ?
        WHERE id = ? AND tenant_id = ?
      `).bind(now, now, ticketId, tenantId).run();
    }

    return c.json({ success: true, id: commentId }, 201);
  } catch (error: any) {
    console.error("Create comment error:", error);
    if (error instanceof z.ZodError) return c.json({ error: "Validation failed", details: error.errors }, 400);
    return c.json({ error: error.message || "Internal server error" }, 500);
  }
});

// ============================================================================
// CC-TKT-001: SLA Policies
// ============================================================================

ticketingRouter.get("/sla-policies", async (c) => {
  try {
    const tenantId = c.get("tenantId") as string;
    if (!tenantId) return c.json({ error: "Unauthorized" }, 401);

    const result = await c.env.DB.prepare(`
      SELECT * FROM ticket_sla_policies
      WHERE tenant_id = ? OR tenant_id = 'default'
      ORDER BY CASE WHEN tenant_id = ? THEN 0 ELSE 1 END, priority ASC
    `).bind(tenantId, tenantId).all();

    return c.json({
      policies: (result.results as any[]).map((p: any) => ({
        ...p,
        is_active: p.is_active === 1,
        is_default: p.tenant_id === "default",
        response_time_display: `${p.response_time_minutes} min`,
        resolution_time_display: `${Math.floor(p.resolution_time_minutes / 60)}h ${p.resolution_time_minutes % 60}m`,
      })),
    });
  } catch (error: any) {
    console.error("SLA policies error:", error);
    return c.json({ error: error.message || "Internal server error" }, 500);
  }
});

ticketingRouter.post("/sla-policies", async (c) => {
  try {
    const tenantId = c.get("tenantId") as string;
    if (!tenantId) return c.json({ error: "Unauthorized" }, 401);

    const body = await c.req.json();
    const data = SLAPolicySchema.parse(body);
    const policyId = generateId("sla");
    const now = Date.now();

    await c.env.DB.prepare(`
      INSERT INTO ticket_sla_policies (id, tenant_id, name, priority, response_time_minutes, resolution_time_minutes, escalate_to, is_active, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      policyId, tenantId, data.name, data.priority,
      data.response_time_minutes, data.resolution_time_minutes,
      data.escalate_to || null, data.is_active ? 1 : 0, now, now
    ).run();

    return c.json({ success: true, id: policyId }, 201);
  } catch (error: any) {
    console.error("Create SLA policy error:", error);
    if (error instanceof z.ZodError) return c.json({ error: "Validation failed", details: error.errors }, 400);
    return c.json({ error: error.message || "Internal server error" }, 500);
  }
});

ticketingRouter.patch("/sla-policies/:id", async (c) => {
  try {
    const tenantId = c.get("tenantId") as string;
    if (!tenantId) return c.json({ error: "Unauthorized" }, 401);

    const id = c.req.param("id");
    const body = await c.req.json();
    const data = SLAPolicySchema.partial().parse(body);
    const updates: string[] = [];
    const params: any[] = [];

    if (data.name !== undefined) { updates.push("name = ?"); params.push(data.name); }
    if (data.response_time_minutes !== undefined) { updates.push("response_time_minutes = ?"); params.push(data.response_time_minutes); }
    if (data.resolution_time_minutes !== undefined) { updates.push("resolution_time_minutes = ?"); params.push(data.resolution_time_minutes); }
    if (data.is_active !== undefined) { updates.push("is_active = ?"); params.push(data.is_active ? 1 : 0); }
    if (data.escalate_to !== undefined) { updates.push("escalate_to = ?"); params.push(data.escalate_to || null); }

    if (updates.length === 0) return c.json({ error: "No fields to update" }, 400);

    updates.push("updated_at = ?");
    params.push(Date.now(), id, tenantId);

    await c.env.DB.prepare(
      `UPDATE ticket_sla_policies SET ${updates.join(", ")} WHERE id = ? AND tenant_id = ?`
    ).bind(...params).run();

    return c.json({ success: true });
  } catch (error: any) {
    console.error("Update SLA policy error:", error);
    return c.json({ error: error.message || "Internal server error" }, 500);
  }
});

ticketingRouter.delete("/sla-policies/:id", async (c) => {
  try {
    const tenantId = c.get("tenantId") as string;
    if (!tenantId) return c.json({ error: "Unauthorized" }, 401);

    const id = c.req.param("id");
    await c.env.DB.prepare(
      `UPDATE ticket_sla_policies SET is_active = 0, updated_at = ? WHERE id = ? AND tenant_id = ?`
    ).bind(Date.now(), id, tenantId).run();

    return c.json({ success: true });
  } catch (error: any) {
    console.error("Delete SLA policy error:", error);
    return c.json({ error: error.message || "Internal server error" }, 500);
  }
});

// CC-TKT-001: SLA performance report
ticketingRouter.get("/sla-report", async (c) => {
  try {
    const tenantId = c.get("tenantId") as string;
    if (!tenantId) return c.json({ error: "Unauthorized" }, 401);

    const result = await c.env.DB.prepare(`
      SELECT
        priority,
        sla_status,
        COUNT(*) as count,
        AVG(CASE WHEN resolved_at IS NOT NULL AND resolution_due_at IS NOT NULL
            THEN (resolved_at - created_at) / 60000.0 ELSE NULL END) as avg_resolution_minutes
      FROM tickets
      WHERE tenant_id = ?
      GROUP BY priority, sla_status
      ORDER BY priority, sla_status
    `).bind(tenantId).all();

    const summary = await c.env.DB.prepare(`
      SELECT
        COUNT(*) as total,
        SUM(CASE WHEN sla_status = 'within_sla' THEN 1 ELSE 0 END) as within_sla,
        SUM(CASE WHEN sla_status = 'at_risk' THEN 1 ELSE 0 END) as at_risk,
        SUM(CASE WHEN sla_status = 'breached' THEN 1 ELSE 0 END) as breached
      FROM tickets WHERE tenant_id = ?
    `).bind(tenantId).first() as any;

    const compliance_rate = summary?.total > 0
      ? ((summary.within_sla / summary.total) * 100).toFixed(1)
      : "100.0";

    return c.json({
      by_priority_and_status: result.results,
      summary: {
        total: summary?.total || 0,
        within_sla: summary?.within_sla || 0,
        at_risk: summary?.at_risk || 0,
        breached: summary?.breached || 0,
        compliance_rate: `${compliance_rate}%`,
      },
    });
  } catch (error: any) {
    console.error("SLA report error:", error);
    return c.json({ error: error.message || "Internal server error" }, 500);
  }
});

// ============================================================================
// CC-TKT-002: Routing Rules
// ============================================================================

ticketingRouter.get("/routing-rules", async (c) => {
  try {
    const tenantId = c.get("tenantId") as string;
    if (!tenantId) return c.json({ error: "Unauthorized" }, 401);

    const result = await c.env.DB.prepare(`
      SELECT * FROM ticket_routing_rules
      WHERE tenant_id = ? OR tenant_id = 'default'
      ORDER BY priority_order ASC, tenant_id DESC
    `).bind(tenantId).all();

    const rules = (result.results as any[]).map((r: any) => ({
      ...r,
      keyword_patterns: JSON.parse(r.keyword_patterns || "[]"),
      urgency_keywords: JSON.parse(r.urgency_keywords || "[]"),
      is_active: r.is_active === 1,
      is_default: r.tenant_id === "default",
    }));

    return c.json({ rules });
  } catch (error: any) {
    console.error("Routing rules error:", error);
    return c.json({ error: error.message || "Internal server error" }, 500);
  }
});

ticketingRouter.post("/routing-rules", async (c) => {
  try {
    const tenantId = c.get("tenantId") as string;
    if (!tenantId) return c.json({ error: "Unauthorized" }, 401);

    const body = await c.req.json();
    const data = RoutingRuleSchema.parse(body);
    const ruleId = generateId("routerule");
    const now = Date.now();

    await c.env.DB.prepare(`
      INSERT INTO ticket_routing_rules (id, tenant_id, name, priority_order, match_type,
        keyword_patterns, urgency_keywords, category_match, source_match,
        assign_to, assign_team, set_priority, set_category, is_active, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      ruleId, tenantId, data.name, data.priority_order, data.match_type,
      JSON.stringify(data.keyword_patterns || []),
      JSON.stringify(data.urgency_keywords || []),
      data.category_match || null, data.source_match || null,
      data.assign_to || null, data.assign_team || null,
      data.set_priority || null, data.set_category || null,
      data.is_active ? 1 : 0, now, now
    ).run();

    return c.json({ success: true, id: ruleId }, 201);
  } catch (error: any) {
    console.error("Create routing rule error:", error);
    if (error instanceof z.ZodError) return c.json({ error: "Validation failed", details: error.errors }, 400);
    return c.json({ error: error.message || "Internal server error" }, 500);
  }
});

ticketingRouter.patch("/routing-rules/:id", async (c) => {
  try {
    const tenantId = c.get("tenantId") as string;
    if (!tenantId) return c.json({ error: "Unauthorized" }, 401);

    const id = c.req.param("id");
    const body = await c.req.json();
    const data = RoutingRuleSchema.partial().parse(body);
    const updates: string[] = [];
    const params: any[] = [];

    if (data.name !== undefined) { updates.push("name = ?"); params.push(data.name); }
    if (data.priority_order !== undefined) { updates.push("priority_order = ?"); params.push(data.priority_order); }
    if (data.is_active !== undefined) { updates.push("is_active = ?"); params.push(data.is_active ? 1 : 0); }
    if (data.assign_to !== undefined) { updates.push("assign_to = ?"); params.push(data.assign_to || null); }
    if (data.set_priority !== undefined) { updates.push("set_priority = ?"); params.push(data.set_priority || null); }
    if (data.keyword_patterns !== undefined) {
      updates.push("keyword_patterns = ?");
      params.push(JSON.stringify(data.keyword_patterns));
    }
    if (data.urgency_keywords !== undefined) {
      updates.push("urgency_keywords = ?");
      params.push(JSON.stringify(data.urgency_keywords));
    }

    if (updates.length === 0) return c.json({ error: "No fields to update" }, 400);

    updates.push("updated_at = ?");
    params.push(Date.now(), id, tenantId);

    await c.env.DB.prepare(
      `UPDATE ticket_routing_rules SET ${updates.join(", ")} WHERE id = ? AND tenant_id = ?`
    ).bind(...params).run();

    return c.json({ success: true });
  } catch (error: any) {
    console.error("Update routing rule error:", error);
    return c.json({ error: error.message || "Internal server error" }, 500);
  }
});

ticketingRouter.delete("/routing-rules/:id", async (c) => {
  try {
    const tenantId = c.get("tenantId") as string;
    if (!tenantId) return c.json({ error: "Unauthorized" }, 401);

    const id = c.req.param("id");
    await c.env.DB.prepare(
      `UPDATE ticket_routing_rules SET is_active = 0, updated_at = ? WHERE id = ? AND tenant_id = ?`
    ).bind(Date.now(), id, tenantId).run();

    return c.json({ success: true });
  } catch (error: any) {
    console.error("Delete routing rule error:", error);
    return c.json({ error: error.message || "Internal server error" }, 500);
  }
});

ticketingRouter.get("/routing-logs", async (c) => {
  try {
    const tenantId = c.get("tenantId") as string;
    if (!tenantId) return c.json({ error: "Unauthorized" }, 401);

    const ticket_id = c.req.query("ticket_id");
    const limit = parseInt(c.req.query("limit") || "50");

    let query = `
      SELECT rl.*, t.subject as ticket_subject FROM ticket_routing_logs rl
      JOIN tickets t ON rl.ticket_id = t.id
      WHERE t.tenant_id = ?
    `;
    const params: any[] = [tenantId];

    if (ticket_id) { query += ` AND rl.ticket_id = ?`; params.push(ticket_id); }
    query += ` ORDER BY rl.created_at DESC LIMIT ?`;
    params.push(limit);

    const result = await c.env.DB.prepare(query).bind(...params).all();
    const logs = (result.results as any[]).map((l: any) => ({
      ...l,
      matched_keywords: JSON.parse(l.matched_keywords || "[]"),
      action_taken: JSON.parse(l.action_taken || "{}"),
      fallback_used: l.fallback_used === 1,
    }));

    return c.json({ logs });
  } catch (error: any) {
    console.error("Routing logs error:", error);
    return c.json({ error: error.message || "Internal server error" }, 500);
  }
});

// ============================================================================
// Ticket Workflows (existing + enhanced)
// ============================================================================

ticketingRouter.get("/workflows", async (c) => {
  try {
    const tenantId = c.get("tenantId") as string;
    if (!tenantId) return c.json({ error: "Unauthorized" }, 401);

    const result = await c.env.DB.prepare(
      `SELECT * FROM ticket_workflows WHERE tenant_id = ? ORDER BY created_at DESC`
    ).bind(tenantId).all();

    const workflows = (result.results as any[]).map((w: any) => ({
      ...w, is_active: w.is_active === 1,
    }));

    return c.json({ workflows });
  } catch (error: any) {
    console.error("Workflows list error:", error);
    return c.json({ error: error.message || "Internal server error" }, 500);
  }
});

ticketingRouter.post("/workflows", async (c) => {
  try {
    const tenantId = c.get("tenantId") as string;
    if (!tenantId) return c.json({ error: "Unauthorized" }, 401);

    const body = await c.req.json();
    const data = WorkflowRuleSchema.parse(body);
    const workflowId = generateId("workflow");
    const now = Date.now();

    await c.env.DB.prepare(`
      INSERT INTO ticket_workflows (id, tenant_id, name, trigger_type, trigger_value, action_type, action_value, is_active, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(workflowId, tenantId, data.name, data.trigger_type, data.trigger_value, data.action_type, data.action_value, data.is_active ? 1 : 0, now).run();

    return c.json({ success: true, id: workflowId }, 201);
  } catch (error: any) {
    console.error("Create workflow error:", error);
    if (error instanceof z.ZodError) return c.json({ error: "Validation failed", details: error.errors }, 400);
    return c.json({ error: error.message || "Internal server error" }, 500);
  }
});

ticketingRouter.delete("/workflows/:id", async (c) => {
  try {
    const tenantId = c.get("tenantId") as string;
    if (!tenantId) return c.json({ error: "Unauthorized" }, 401);

    const id = c.req.param("id");
    const result = await c.env.DB.prepare(
      `DELETE FROM ticket_workflows WHERE id = ? AND tenant_id = ?`
    ).bind(id, tenantId).run();

    if (!result.meta.changes) return c.json({ error: "Workflow not found" }, 404);
    return c.json({ success: true });
  } catch (error: any) {
    console.error("Delete workflow error:", error);
    return c.json({ error: error.message || "Internal server error" }, 500);
  }
});

ticketingRouter.get("/health", async (c) => {
  const tenantId = c.get("tenantId") as string;
  if (!tenantId) return c.json({ error: "Unauthorized" }, 401);

  const dbCheck = await c.env.DB.prepare("SELECT 1").first();
  const dbHealthy = !!dbCheck;

  return c.json({
    status: dbHealthy ? "healthy" : "unhealthy",
    database: dbHealthy,
    tenant_id: tenantId,
    tasks_implemented: ["CC-TKT-001", "CC-TKT-002"],
    timestamp: Date.now(),
  });
});

export { ticketingRouter };
