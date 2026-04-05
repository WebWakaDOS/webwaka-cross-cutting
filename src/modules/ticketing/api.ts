/**
 * XCT-3: Support Ticketing & Workflow Automation
 * Blueprint: Part 10.12 — Operations
 * Description: Full ticketing implementation with tickets, comments, and workflows
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

// ============================================================================
// Helper Functions
// ============================================================================

function generateId(prefix: string): string {
  const bytes = new Uint8Array(6);
  crypto.getRandomValues(bytes);
  const suffix = Array.from(bytes)
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
  return `${prefix}-${suffix}`;
}

// ============================================================================
// Router
// ============================================================================

const ticketingRouter = new Hono<{ Bindings: Env; Variables: Variables }>();

ticketingRouter.get("/", (c) =>
  c.json({
    module: "ticketing",
    version: "1.0.0",
    epic: "XCT-3",
    status: "operational",
    description: "Support ticketing with workflow automation",
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
    const search = c.req.query("search");
    const offset = (page - 1) * limit;

    let query = `SELECT * FROM tickets WHERE tenant_id = ?`;
    const params: any[] = [tenantId];

    if (status) {
      query += ` AND status = ?`;
      params.push(status);
    }
    if (priority) {
      query += ` AND priority = ?`;
      params.push(priority);
    }
    if (assigned_to) {
      query += ` AND assigned_to = ?`;
      params.push(assigned_to);
    }
    if (search) {
      query += ` AND (subject LIKE ? OR body LIKE ?)`;
      const searchPattern = `%${search}%`;
      params.push(searchPattern, searchPattern);
    }

    query += ` ORDER BY created_at DESC LIMIT ? OFFSET ?`;
    params.push(limit, offset);

    const result = await c.env.DB.prepare(query).bind(...params).all();

    const countQuery = `SELECT COUNT(*) as count FROM tickets WHERE tenant_id = ?`;
    const countResult = await c.env.DB.prepare(countQuery).bind(tenantId).first();
    const total = countResult?.count as number || 0;

    const tickets = (result.results as any[]).map((t: any) => ({
      id: t.id,
      subject: t.subject,
      body: t.body,
      status: t.status,
      priority: t.priority,
      category: t.category,
      assigned_to: t.assigned_to,
      requester_id: t.requester_id,
      source: t.source,
      resolved_at: t.resolved_at,
      created_at: t.created_at,
      updated_at: t.updated_at,
    }));

    return c.json({
      tickets,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit),
      },
    });
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
      ticketId,
      tenantId,
      data.subject,
      data.body || null,
      data.status,
      data.priority,
      data.category || null,
      data.assigned_to || null,
      data.requester_id || null,
      data.source,
      now,
      now
    ).run();

    // TODO: Emit event to event bus, apply workflow rules

    return c.json({ success: true, id: ticketId }, 201);
  } catch (error: any) {
    console.error("Create ticket error:", error);
    if (error instanceof z.ZodError) {
      return c.json({ error: "Validation failed", details: error.errors }, 400);
    }
    return c.json({ error: error.message || "Internal server error" }, 500);
  }
});

ticketingRouter.get("/tickets/:id", async (c) => {
  try {
    const tenantId = c.get("tenantId") as string;
    if (!tenantId) return c.json({ error: "Unauthorized" }, 401);

    const id = c.req.param("id");

    const result = await c.env.DB.prepare(`
      SELECT * FROM tickets WHERE id = ? AND tenant_id = ?
    `).bind(id, tenantId).first();

    if (!result) {
      return c.json({ error: "Ticket not found" }, 404);
    }

    const ticket = result as any;
    return c.json({
      id: ticket.id,
      subject: ticket.subject,
      body: ticket.body,
      status: ticket.status,
      priority: ticket.priority,
      category: ticket.category,
      assigned_to: ticket.assigned_to,
      requester_id: ticket.requester_id,
      source: ticket.source,
      resolved_at: ticket.resolved_at,
      created_at: ticket.created_at,
      updated_at: ticket.updated_at,
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

    if (data.subject !== undefined) {
      updates.push("subject = ?");
      params.push(data.subject);
    }
    if (data.body !== undefined) {
      updates.push("body = ?");
      params.push(data.body || null);
    }
    if (data.status !== undefined) {
      updates.push("status = ?");
      params.push(data.status);
      if (data.status === "resolved") {
        updates.push("resolved_at = ?");
        params.push(now);
      }
    }
    if (data.priority !== undefined) {
      updates.push("priority = ?");
      params.push(data.priority);
    }
    if (data.category !== undefined) {
      updates.push("category = ?");
      params.push(data.category || null);
    }
    if (data.assigned_to !== undefined) {
      updates.push("assigned_to = ?");
      params.push(data.assigned_to || null);
    }

    if (updates.length === 0) {
      return c.json({ error: "No fields to update" }, 400);
    }

    updates.push("updated_at = ?");
    params.push(now);
    params.push(id, tenantId);

    await c.env.DB.prepare(`
      UPDATE tickets SET ${updates.join(", ")} WHERE id = ? AND tenant_id = ?
    `).bind(...params).run();

    // TODO: Emit event to event bus, apply workflow rules

    return c.json({ success: true });
  } catch (error: any) {
    console.error("Update ticket error:", error);
    if (error instanceof z.ZodError) {
      return c.json({ error: "Validation failed", details: error.errors }, 400);
    }
    return c.json({ error: error.message || "Internal server error" }, 500);
  }
});

ticketingRouter.delete("/tickets/:id", async (c) => {
  try {
    const tenantId = c.get("tenantId") as string;
    if (!tenantId) return c.json({ error: "Unauthorized" }, 401);

    const id = c.req.param("id");

    const result = await c.env.DB.prepare(`
      DELETE FROM tickets WHERE id = ? AND tenant_id = ?
    `).bind(id, tenantId).run();

    if (!result.meta.changes) {
      return c.json({ error: "Ticket not found" }, 404);
    }

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

    const result = await c.env.DB.prepare(`
      SELECT * FROM ticket_comments WHERE ticket_id = ? ORDER BY created_at ASC
    `).bind(ticketId).all();

    const comments = (result.results as any[]).map((cm: any) => ({
      id: cm.id,
      author_id: cm.author_id,
      body: cm.body,
      is_internal: cm.is_internal === 1,
      created_at: cm.created_at,
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
    const authorId = c.get("jwtPayload")?.userId || "system";

    await c.env.DB.prepare(`
      INSERT INTO ticket_comments (id, ticket_id, author_id, body, is_internal, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).bind(commentId, ticketId, authorId, data.body, data.is_internal ? 1 : 0, now).run();

    return c.json({ success: true, id: commentId }, 201);
  } catch (error: any) {
    console.error("Create comment error:", error);
    if (error instanceof z.ZodError) {
      return c.json({ error: "Validation failed", details: error.errors }, 400);
    }
    return c.json({ error: error.message || "Internal server error" }, 500);
  }
});

// ============================================================================
// Workflows (simplified for MVP)
// ============================================================================

ticketingRouter.get("/workflows", async (c) => {
  try {
    const tenantId = c.get("tenantId") as string;
    if (!tenantId) return c.json({ error: "Unauthorized" }, 401);

    const result = await c.env.DB.prepare(`
      SELECT * FROM ticket_workflows WHERE tenant_id = ? ORDER BY created_at DESC
    `).bind(tenantId).all();

    const workflows = (result.results as any[]).map((w: any) => ({
      id: w.id,
      name: w.name,
      trigger_type: w.trigger_type,
      trigger_value: w.trigger_value,
      action_type: w.action_type,
      action_value: w.action_value,
      is_active: w.is_active === 1,
      created_at: w.created_at,
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
    if (error instanceof z.ZodError) {
      return c.json({ error: "Validation failed", details: error.errors }, 400);
    }
    return c.json({ error: error.message || "Internal server error" }, 500);
  }
});

ticketingRouter.delete("/workflows/:id", async (c) => {
  try {
    const tenantId = c.get("tenantId") as string;
    if (!tenantId) return c.json({ error: "Unauthorized" }, 401);

    const id = c.req.param("id");

    const result = await c.env.DB.prepare(`
      DELETE FROM ticket_workflows WHERE id = ? AND tenant_id = ?
    `).bind(id, tenantId).run();

    if (!result.meta.changes) {
      return c.json({ error: "Workflow not found" }, 404);
    }

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
    timestamp: Date.now(),
  });
});

export { ticketingRouter };