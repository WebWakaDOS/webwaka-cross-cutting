/**
 * XCT-1: Customer Relationship Management (CRM)
 * Blueprint: Part 10.12 — Customer & Staff Operations
 * Description: Full CRM implementation with contacts, deals, pipeline, activities
 */
import { Hono } from "hono";
import { z } from "zod";
import type { Env, Variables } from "../../worker";

// ============================================================================
// Validation Schemas
// ============================================================================

const ContactSchema = z.object({
  full_name: z.string().min(1).max(200),
  email: z.string().email().optional().or(z.literal("")),
  phone: z.string().min(10).max(20).optional().or(z.literal("")),
  company: z.string().max(200).optional().or(z.literal("")),
  stage: z.enum(["lead", "qualified", "proposal", "negotiation", "won", "lost"]).default("lead"),
  assigned_to: z.string().optional(),
  tags: z.string().optional(), // JSON array string
  notes: z.string().max(5000).optional().or(z.literal("")),
});

const ContactUpdateSchema = ContactSchema.partial();

const DealSchema = z.object({
  contact_id: z.string(),
  title: z.string().min(1).max(500),
  value_kobo: z.number().int().min(0),
  stage: z.enum(["new", "qualified", "proposal", "negotiation", "won", "lost"]).default("new"),
  probability: z.number().int().min(0).max(100).default(0),
});

const DealUpdateSchema = DealSchema.partial();

const ActivitySchema = z.object({
  contact_id: z.string().optional(),
  deal_id: z.string().optional(),
  activity_type: z.enum(["call", "email", "meeting", "note", "task"]),
  subject: z.string().min(1).max(500),
  description: z.string().max(5000).optional().or(z.literal("")),
  due_date: z.number().int().optional(), // Unix timestamp in ms
});

const ActivityUpdateSchema = ActivitySchema.partial().extend({
  completed: z.boolean().optional(),
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

function koboToNaira(kobo: number): number {
  return kobo / 100;
}

// ============================================================================
// Router
// ============================================================================

const crmRouter = new Hono<{ Bindings: Env; Variables: Variables }>();

crmRouter.get("/", (c) =>
  c.json({
    module: "crm",
    version: "1.0.0",
    epic: "XCT-1",
    status: "operational",
    description: "Customer Relationship Management with contacts, deals, pipeline, and activities",
  })
);

// ============================================================================
// Contacts
// ============================================================================

crmRouter.get("/contacts", async (c) => {
  try {
    const tenantId = c.get("tenantId") as string;
    if (!tenantId) return c.json({ error: "Unauthorized" }, 401);

    const page = parseInt(c.req.query("page") || "1");
    const limit = parseInt(c.req.query("limit") || "20");
    const stage = c.req.query("stage");
    const search = c.req.query("search");
    const offset = (page - 1) * limit;

    let query = `SELECT * FROM crm_contacts WHERE tenant_id = ? AND deleted_at IS NULL`;
    const params: any[] = [tenantId];

    if (stage) {
      query += ` AND stage = ?`;
      params.push(stage);
    }

    if (search) {
      query += ` AND (full_name LIKE ? OR email LIKE ? OR company LIKE ?)`;
      const searchPattern = `%${search}%`;
      params.push(searchPattern, searchPattern, searchPattern);
    }

    query += ` ORDER BY updated_at DESC LIMIT ? OFFSET ?`;
    params.push(limit, offset);

    const result = await c.env.DB.prepare(query).bind(...params).all();

    const countQuery = `SELECT COUNT(*) as count FROM crm_contacts WHERE tenant_id = ? AND deleted_at IS NULL`;
    const countResult = await c.env.DB.prepare(countQuery).bind(tenantId).first();
    const total = countResult?.count as number || 0;

    const contacts = (result.results as any[]).map((c: any) => ({
      id: c.id,
      full_name: c.full_name,
      email: c.email,
      phone: c.phone,
      company: c.company,
      stage: c.stage,
      assigned_to: c.assigned_to,
      tags: c.tags ? JSON.parse(c.tags) : [],
      notes: c.notes,
      created_at: c.created_at,
      updated_at: c.updated_at,
    }));

    return c.json({
      contacts,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit),
      },
    });
  } catch (error: any) {
    console.error("Contacts list error:", error);
    return c.json({ error: error.message || "Internal server error" }, 500);
  }
});

crmRouter.post("/contacts", async (c) => {
  try {
    const tenantId = c.get("tenantId") as string;
    if (!tenantId) return c.json({ error: "Unauthorized" }, 401);

    const body = await c.req.json();
    const data = ContactSchema.parse(body);

    const contactId = generateId("contact");
    const now = Date.now();

    await c.env.DB.prepare(`
      INSERT INTO crm_contacts (id, tenant_id, full_name, email, phone, company, stage, assigned_to, tags, notes, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      contactId,
      tenantId,
      data.full_name,
      data.email || null,
      data.phone || null,
      data.company || null,
      data.stage,
      data.assigned_to || null,
      typeof data.tags === 'string' ? data.tags : JSON.stringify(data.tags || []),
      data.notes || null,
      now,
      now
    ).run();

    // TODO: Emit event to event bus

    return c.json({ success: true, id: contactId }, 201);
  } catch (error: any) {
    console.error("Create contact error:", error);
    if (error instanceof z.ZodError) {
      return c.json({ error: "Validation failed", details: error.errors }, 400);
    }
    return c.json({ error: error.message || "Internal server error" }, 500);
  }
});

crmRouter.get("/contacts/:id", async (c) => {
  try {
    const tenantId = c.get("tenantId") as string;
    if (!tenantId) return c.json({ error: "Unauthorized" }, 401);

    const id = c.req.param("id");

    const result = await c.env.DB.prepare(`
      SELECT * FROM crm_contacts WHERE id = ? AND tenant_id = ? AND deleted_at IS NULL
    `).bind(id, tenantId).first();

    if (!result) {
      return c.json({ error: "Contact not found" }, 404);
    }

    const contact = result as any;
    return c.json({
      id: contact.id,
      full_name: contact.full_name,
      email: contact.email,
      phone: contact.phone,
      company: contact.company,
      stage: contact.stage,
      assigned_to: contact.assigned_to,
      tags: contact.tags ? JSON.parse(contact.tags) : [],
      notes: contact.notes,
      created_at: contact.created_at,
      updated_at: contact.updated_at,
    });
  } catch (error: any) {
    console.error("Get contact error:", error);
    return c.json({ error: error.message || "Internal server error" }, 500);
  }
});

crmRouter.patch("/contacts/:id", async (c) => {
  try {
    const tenantId = c.get("tenantId") as string;
    if (!tenantId) return c.json({ error: "Unauthorized" }, 401);

    const id = c.req.param("id");
    const body = await c.req.json();
    const data = ContactUpdateSchema.parse(body);

    const now = Date.now();
    const updates: string[] = [];
    const params: any[] = [];

    if (data.full_name !== undefined) {
      updates.push("full_name = ?");
      params.push(data.full_name);
    }
    if (data.email !== undefined) {
      updates.push("email = ?");
      params.push(data.email || null);
    }
    if (data.phone !== undefined) {
      updates.push("phone = ?");
      params.push(data.phone || null);
    }
    if (data.company !== undefined) {
      updates.push("company = ?");
      params.push(data.company || null);
    }
    if (data.stage !== undefined) {
      updates.push("stage = ?");
      params.push(data.stage);
    }
    if (data.assigned_to !== undefined) {
      updates.push("assigned_to = ?");
      params.push(data.assigned_to || null);
    }
    if (data.tags !== undefined) {
      updates.push("tags = ?");
      params.push(typeof data.tags === 'string' ? data.tags : JSON.stringify(data.tags));
    }
    if (data.notes !== undefined) {
      updates.push("notes = ?");
      params.push(data.notes || null);
    }

    if (updates.length === 0) {
      return c.json({ error: "No fields to update" }, 400);
    }

    updates.push("updated_at = ?");
    params.push(now);
    params.push(id, tenantId);

    await c.env.DB.prepare(`
      UPDATE crm_contacts SET ${updates.join(", ")} WHERE id = ? AND tenant_id = ? AND deleted_at IS NULL
    `).bind(...params).run();

    // TODO: Emit event to event bus

    return c.json({ success: true });
  } catch (error: any) {
    console.error("Update contact error:", error);
    if (error instanceof z.ZodError) {
      return c.json({ error: "Validation failed", details: error.errors }, 400);
    }
    return c.json({ error: error.message || "Internal server error" }, 500);
  }
});

crmRouter.delete("/contacts/:id", async (c) => {
  try {
    const tenantId = c.get("tenantId") as string;
    if (!tenantId) return c.json({ error: "Unauthorized" }, 401);

    const id = c.req.param("id");
    const now = Date.now();

    const result = await c.env.DB.prepare(`
      UPDATE crm_contacts SET deleted_at = ? WHERE id = ? AND tenant_id = ? AND deleted_at IS NULL
    `).bind(now, id, tenantId).run();

    if (!result.meta.changes) {
      return c.json({ error: "Contact not found" }, 404);
    }

    // TODO: Emit event to event bus

    return c.json({ success: true });
  } catch (error: any) {
    console.error("Delete contact error:", error);
    return c.json({ error: error.message || "Internal server error" }, 500);
  }
});

// ============================================================================
// Deals / Pipeline
// ============================================================================

crmRouter.get("/deals", async (c) => {
  try {
    const tenantId = c.get("tenantId") as string;
    if (!tenantId) return c.json({ error: "Unauthorized" }, 401);

    const stage = c.req.query("stage");
    const contact_id = c.req.query("contact_id");

    let query = `
      SELECT d.*, c.full_name as contact_name, c.email as contact_email
      FROM crm_deals d
      LEFT JOIN crm_contacts c ON d.contact_id = c.id
      WHERE d.tenant_id = ?
    `;
    const params: any[] = [tenantId];

    if (stage) {
      query += ` AND d.stage = ?`;
      params.push(stage);
    }
    if (contact_id) {
      query += ` AND d.contact_id = ?`;
      params.push(contact_id);
    }

    query += ` ORDER BY d.created_at DESC`;

    const result = await c.env.DB.prepare(query).bind(...params).all();

    const deals = (result.results as any[]).map((d: any) => ({
      id: d.id,
      contact_id: d.contact_id,
      title: d.title,
      value_kobo: d.value_kobo,
      value_naira: koboToNaira(d.value_kobo),
      stage: d.stage,
      probability: d.probability,
      closed_at: d.closed_at,
      contact_name: d.contact_name,
      contact_email: d.contact_email,
      created_at: d.created_at,
      updated_at: d.updated_at,
    }));

    return c.json({ deals });
  } catch (error: any) {
    console.error("Deals list error:", error);
    return c.json({ error: error.message || "Internal server error" }, 500);
  }
});

crmRouter.post("/deals", async (c) => {
  try {
    const tenantId = c.get("tenantId") as string;
    if (!tenantId) return c.json({ error: "Unauthorized" }, 401);

    const body = await c.req.json();
    const data = DealSchema.parse(body);

    const dealId = generateId("deal");
    const now = Date.now();

    await c.env.DB.prepare(`
      INSERT INTO crm_deals (id, tenant_id, contact_id, title, value_kobo, stage, probability, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(dealId, tenantId, data.contact_id, data.title, data.value_kobo, data.stage, data.probability, now, now).run();

    // TODO: Emit event to event bus

    return c.json({ success: true, id: dealId }, 201);
  } catch (error: any) {
    console.error("Create deal error:", error);
    if (error instanceof z.ZodError) {
      return c.json({ error: "Validation failed", details: error.errors }, 400);
    }
    return c.json({ error: error.message || "Internal server error" }, 500);
  }
});

crmRouter.patch("/deals/:id", async (c) => {
  try {
    const tenantId = c.get("tenantId") as string;
    if (!tenantId) return c.json({ error: "Unauthorized" }, 401);

    const id = c.req.param("id");
    const body = await c.req.json();
    const data = DealUpdateSchema.parse(body);

    const now = Date.now();
    const updates: string[] = [];
    const params: any[] = [];

    if (data.title !== undefined) {
      updates.push("title = ?");
      params.push(data.title);
    }
    if (data.value_kobo !== undefined) {
      updates.push("value_kobo = ?");
      params.push(data.value_kobo);
    }
    if (data.stage !== undefined) {
      updates.push("stage = ?");
      params.push(data.stage);
    }
    if (data.probability !== undefined) {
      updates.push("probability = ?");
      params.push(data.probability);
    }

    if (updates.length === 0) {
      return c.json({ error: "No fields to update" }, 400);
    }

    updates.push("updated_at = ?");
    params.push(now);
    params.push(id, tenantId);

    await c.env.DB.prepare(`
      UPDATE crm_deals SET ${updates.join(", ")} WHERE id = ? AND tenant_id = ?
    `).bind(...params).run();

    // TODO: Emit event to event bus

    return c.json({ success: true });
  } catch (error: any) {
    console.error("Update deal error:", error);
    if (error instanceof z.ZodError) {
      return c.json({ error: "Validation failed", details: error.errors }, 400);
    }
    return c.json({ error: error.message || "Internal server error" }, 500);
  }
});

crmRouter.get("/pipeline", async (c) => {
  try {
    const tenantId = c.get("tenantId") as string;
    if (!tenantId) return c.json({ error: "Unauthorized" }, 401);

    const stagesResult = await c.env.DB.prepare(`
      SELECT * FROM crm_pipeline_stages WHERE tenant_id = ? OR tenant_id = 'default'
      ORDER BY position ASC
    `).bind(tenantId).all();

    const dealsResult = await c.env.DB.prepare(`
      SELECT stage, COUNT(*) as count, SUM(value_kobo) as total_value
      FROM crm_deals
      WHERE tenant_id = ? AND stage != 'won' AND stage != 'lost'
      GROUP BY stage
    `).bind(tenantId).all();

    const stages = stagesResult.results as any[];
    const dealsByStage = (dealsResult.results as any[]).reduce((acc: any, d: any) => {
      acc[d.stage] = { count: d.count, total_value: d.total_value };
      return acc;
    }, {});

    const pipeline = stages.map((s: any) => ({
      id: s.id,
      name: s.name,
      position: s.position,
      probability: s.probability,
      color: s.color,
      deals_count: dealsByStage[s.stage]?.count || 0,
      total_value: dealsByStage[s.stage]?.total_value || 0,
      total_value_naira: koboToNaira(dealsByStage[s.stage]?.total_value || 0),
    }));

    return c.json({ pipeline });
  } catch (error: any) {
    console.error("Pipeline error:", error);
    return c.json({ error: error.message || "Internal server error" }, 500);
  }
});

// ============================================================================
// Activities
// ============================================================================

crmRouter.get("/activities", async (c) => {
  try {
    const tenantId = c.get("tenantId") as string;
    if (!tenantId) return c.json({ error: "Unauthorized" }, 401);

    const contact_id = c.req.query("contact_id");
    const deal_id = c.req.query("deal_id");
    const activity_type = c.req.query("activity_type");
    const limit = parseInt(c.req.query("limit") || "50");

    let query = `
      SELECT a.*, c.full_name as contact_name, d.title as deal_title
      FROM crm_activities a
      LEFT JOIN crm_contacts c ON a.contact_id = c.id
      LEFT JOIN crm_deals d ON a.deal_id = d.id
      WHERE a.tenant_id = ?
    `;
    const params: any[] = [tenantId];

    if (contact_id) {
      query += ` AND a.contact_id = ?`;
      params.push(contact_id);
    }
    if (deal_id) {
      query += ` AND a.deal_id = ?`;
      params.push(deal_id);
    }
    if (activity_type) {
      query += ` AND a.activity_type = ?`;
      params.push(activity_type);
    }

    query += ` ORDER BY a.created_at DESC LIMIT ?`;
    params.push(limit);

    const result = await c.env.DB.prepare(query).bind(...params).all();

    const activities = (result.results as any[]).map((a: any) => ({
      id: a.id,
      contact_id: a.contact_id,
      deal_id: a.deal_id,
      activity_type: a.activity_type,
      subject: a.subject,
      description: a.description,
      due_date: a.due_date,
      completed: a.completed === 1,
      created_by: a.created_by,
      contact_name: a.contact_name,
      deal_title: a.deal_title,
      created_at: a.created_at,
      updated_at: a.updated_at,
    }));

    return c.json({ activities });
  } catch (error: any) {
    console.error("Activities list error:", error);
    return c.json({ error: error.message || "Internal server error" }, 500);
  }
});

crmRouter.post("/activities", async (c) => {
  try {
    const tenantId = c.get("tenantId") as string;
    if (!tenantId) return c.json({ error: "Unauthorized" }, 401);

    const body = await c.req.json();
    const data = ActivitySchema.parse(body);

    const activityId = generateId("activity");
    const now = Date.now();
    const createdBy = c.get("jwtPayload")?.userId || "system";

    await c.env.DB.prepare(`
      INSERT INTO crm_activities (id, tenant_id, contact_id, deal_id, activity_type, subject, description, due_date, completed, created_by, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(activityId, tenantId, data.contact_id || null, data.deal_id || null, data.activity_type, data.subject, data.description || null, data.due_date || null, 0, createdBy, now, now).run();

    // TODO: Emit event to event bus

    return c.json({ success: true, id: activityId }, 201);
  } catch (error: any) {
    console.error("Create activity error:", error);
    if (error instanceof z.ZodError) {
      return c.json({ error: "Validation failed", details: error.errors }, 400);
    }
    return c.json({ error: error.message || "Internal server error" }, 500);
  }
});

crmRouter.patch("/activities/:id", async (c) => {
  try {
    const tenantId = c.get("tenantId") as string;
    if (!tenantId) return c.json({ error: "Unauthorized" }, 401);

    const id = c.req.param("id");
    const body = await c.req.json();
    const data = ActivityUpdateSchema.parse(body);

    const now = Date.now();
    const updates: string[] = [];
    const params: any[] = [];

    if (data.subject !== undefined) {
      updates.push("subject = ?");
      params.push(data.subject);
    }
    if (data.description !== undefined) {
      updates.push("description = ?");
      params.push(data.description || null);
    }
    if (data.due_date !== undefined) {
      updates.push("due_date = ?");
      params.push(data.due_date || null);
    }
    if (data.completed !== undefined) {
      updates.push("completed = ?");
      params.push(data.completed ? 1 : 0);
    }

    if (updates.length === 0) {
      return c.json({ error: "No fields to update" }, 400);
    }

    updates.push("updated_at = ?");
    params.push(now);
    params.push(id, tenantId);

    await c.env.DB.prepare(`
      UPDATE crm_activities SET ${updates.join(", ")} WHERE id = ? AND tenant_id = ?
    `).bind(...params).run();

    // TODO: Emit event to event bus

    return c.json({ success: true });
  } catch (error: any) {
    console.error("Update activity error:", error);
    if (error instanceof z.ZodError) {
      return c.json({ error: "Validation failed", details: error.errors }, 400);
    }
    return c.json({ error: error.message || "Internal server error" }, 500);
  }
});

crmRouter.delete("/activities/:id", async (c) => {
  try {
    const tenantId = c.get("tenantId") as string;
    if (!tenantId) return c.json({ error: "Unauthorized" }, 401);

    const id = c.req.param("id");

    const result = await c.env.DB.prepare(`
      DELETE FROM crm_activities WHERE id = ? AND tenant_id = ?
    `).bind(id, tenantId).run();

    if (!result.meta.changes) {
      return c.json({ error: "Activity not found" }, 404);
    }

    // TODO: Emit event to event bus

    return c.json({ success: true });
  } catch (error: any) {
    console.error("Delete activity error:", error);
    return c.json({ error: error.message || "Internal server error" }, 500);
  }
});

crmRouter.get("/health", async (c) => {
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

export { crmRouter };