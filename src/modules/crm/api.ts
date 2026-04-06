/**
 * XCT-1: Customer Relationship Management (CRM)
 * Blueprint: Part 10.12 — Customer & Staff Operations
 * Tasks: CC-CRM-001 (Lead Scoring), CC-CRM-002 (Marketing Automation)
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
  tags: z.string().optional(),
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
  due_date: z.number().int().optional(),
});

const ActivityUpdateSchema = ActivitySchema.partial().extend({
  completed: z.boolean().optional(),
});

// CC-CRM-001: Scoring Rules
const ScoringRuleSchema = z.object({
  name: z.string().min(1).max(200),
  attribute: z.string().min(1),
  operator: z.enum(["eq", "neq", "contains", "gt", "lt"]),
  value: z.string(),
  score_delta: z.number().int(),
  is_active: z.boolean().default(true),
});

// CC-CRM-002: Automation Workflows
const AutomationWorkflowSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(1000).optional(),
  trigger_event: z.enum(["contact_created", "stage_changed", "score_threshold", "deal_created", "activity_logged"]),
  trigger_config: z.record(z.any()).default({}),
  is_active: z.boolean().default(true),
});

const AutomationActionSchema = z.object({
  step_order: z.number().int().min(0).default(0),
  action_type: z.enum(["send_notification", "create_activity", "update_stage", "assign_contact", "update_score"]),
  action_config: z.record(z.any()).default({}),
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

function koboToNaira(kobo: number): number {
  return kobo / 100;
}

// CC-CRM-001: Calculate lead score from scoring rules
async function recalculateLeadScore(
  db: D1Database,
  tenantId: string,
  contactId: string,
  contact: any
): Promise<number> {
  // Fetch rules for tenant + platform defaults
  const rulesResult = await db.prepare(`
    SELECT * FROM crm_scoring_rules
    WHERE (tenant_id = ? OR tenant_id = 'default') AND is_active = 1
    ORDER BY tenant_id DESC
  `).bind(tenantId).all();

  const rules = rulesResult.results as any[];
  let score = 0;

  for (const rule of rules) {
    const fieldValue = contact[rule.attribute] ?? "";
    let matched = false;

    switch (rule.operator) {
      case "eq":
        matched = String(fieldValue) === rule.value;
        break;
      case "neq":
        matched = String(fieldValue) !== rule.value && fieldValue !== null && fieldValue !== "";
        break;
      case "contains":
        matched = String(fieldValue).toLowerCase().includes(rule.value.toLowerCase());
        break;
      case "gt":
        matched = Number(fieldValue) > Number(rule.value);
        break;
      case "lt":
        matched = Number(fieldValue) < Number(rule.value);
        break;
    }

    if (matched) {
      score += rule.score_delta;
    }
  }

  score = Math.max(0, Math.min(100, score));

  const now = Date.now();
  await db.prepare(`
    UPDATE crm_contacts SET lead_score = ?, score_updated_at = ? WHERE id = ? AND tenant_id = ?
  `).bind(score, now, contactId, tenantId).run();

  return score;
}

// CC-CRM-002: Fire automation workflow
async function fireAutomationWorkflows(
  db: D1Database,
  tenantId: string,
  triggerEvent: string,
  contactId: string | null,
  dealId: string | null,
  context: Record<string, any>
): Promise<void> {
  try {
    const workflowsResult = await db.prepare(`
      SELECT * FROM crm_automation_workflows
      WHERE (tenant_id = ? OR tenant_id = 'default') AND trigger_event = ? AND is_active = 1
    `).bind(tenantId, triggerEvent).all();

    for (const workflow of workflowsResult.results as any[]) {
      const triggerConfig = JSON.parse(workflow.trigger_config || "{}");
      let conditionsMet = true;

      // Evaluate trigger conditions
      for (const [key, value] of Object.entries(triggerConfig)) {
        if (key.endsWith("_gte")) {
          const field = key.slice(0, -4);
          if ((context[field] ?? 0) < (value as number)) conditionsMet = false;
        } else if (key.endsWith("_lte")) {
          const field = key.slice(0, -4);
          if ((context[field] ?? 0) > (value as number)) conditionsMet = false;
        } else {
          if (context[key] !== value) conditionsMet = false;
        }
      }

      if (!conditionsMet) continue;

      const actionsResult = await db.prepare(`
        SELECT * FROM crm_automation_actions WHERE workflow_id = ? ORDER BY step_order ASC
      `).bind(workflow.id).all();

      const executedActions: string[] = [];
      let logStatus = "completed";
      let logError: string | undefined;

      for (const action of actionsResult.results as any[]) {
        try {
          const config = JSON.parse(action.action_config || "{}");
          const actionId = action.id;

          switch (action.action_type) {
            case "create_activity": {
              if (contactId) {
                const actId = generateId("act");
                await db.prepare(`
                  INSERT INTO crm_activities (id, tenant_id, contact_id, deal_id, activity_type, subject, description, completed, created_by, created_at, updated_at)
                  VALUES (?, ?, ?, ?, ?, ?, ?, 0, 'automation', ?, ?)
                `).bind(
                  actId, tenantId, contactId, dealId || null,
                  config.activity_type || "note",
                  config.subject || `Auto: ${workflow.name}`,
                  config.description || null,
                  Date.now(), Date.now()
                ).run();
              }
              break;
            }
            case "update_stage": {
              if (contactId && config.stage) {
                await db.prepare(`
                  UPDATE crm_contacts SET stage = ?, updated_at = ? WHERE id = ? AND tenant_id = ?
                `).bind(config.stage, Date.now(), contactId, tenantId).run();
              }
              break;
            }
            case "assign_contact": {
              if (contactId && config.assigned_to) {
                await db.prepare(`
                  UPDATE crm_contacts SET assigned_to = ?, updated_at = ? WHERE id = ? AND tenant_id = ?
                `).bind(config.assigned_to, Date.now(), contactId, tenantId).run();
              }
              break;
            }
          }
          executedActions.push(actionId);
        } catch (err: any) {
          logStatus = "failed";
          logError = err.message;
        }
      }

      // Log execution
      await db.prepare(`
        INSERT INTO crm_automation_logs (id, workflow_id, contact_id, deal_id, trigger_event, actions_executed, status, error, executed_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        generateId("log"), workflow.id, contactId || null, dealId || null,
        triggerEvent, JSON.stringify(executedActions), logStatus, logError || null, Date.now()
      ).run();

      // Increment execution count
      await db.prepare(`
        UPDATE crm_automation_workflows SET execution_count = execution_count + 1 WHERE id = ?
      `).bind(workflow.id).run();
    }
  } catch (err: any) {
    console.error("Automation workflow execution error:", err.message);
  }
}

// ============================================================================
// Router
// ============================================================================

const crmRouter = new Hono<{ Bindings: Env; Variables: Variables }>();

crmRouter.get("/", (c) =>
  c.json({
    module: "crm",
    version: "2.0.0",
    epic: "XCT-1",
    status: "operational",
    tasks: ["CC-CRM-001", "CC-CRM-002"],
    description: "CRM with contacts, deals, pipeline, activities, lead scoring, and marketing automation",
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
    const min_score = c.req.query("min_score");
    const offset = (page - 1) * limit;

    let query = `SELECT * FROM crm_contacts WHERE tenant_id = ? AND deleted_at IS NULL`;
    const params: any[] = [tenantId];

    if (stage) {
      query += ` AND stage = ?`;
      params.push(stage);
    }
    if (search) {
      query += ` AND (full_name LIKE ? OR email LIKE ? OR company LIKE ?)`;
      const s = `%${search}%`;
      params.push(s, s, s);
    }
    if (min_score) {
      query += ` AND lead_score >= ?`;
      params.push(parseInt(min_score));
    }

    query += ` ORDER BY lead_score DESC, updated_at DESC LIMIT ? OFFSET ?`;
    params.push(limit, offset);

    const result = await c.env.DB.prepare(query).bind(...params).all();
    const countResult = await c.env.DB.prepare(
      `SELECT COUNT(*) as count FROM crm_contacts WHERE tenant_id = ? AND deleted_at IS NULL`
    ).bind(tenantId).first();
    const total = (countResult?.count as number) || 0;

    const contacts = (result.results as any[]).map((ct: any) => ({
      id: ct.id,
      full_name: ct.full_name,
      email: ct.email,
      phone: ct.phone,
      company: ct.company,
      stage: ct.stage,
      assigned_to: ct.assigned_to,
      tags: ct.tags ? JSON.parse(ct.tags) : [],
      notes: ct.notes,
      lead_score: ct.lead_score ?? 0,
      score_updated_at: ct.score_updated_at,
      created_at: ct.created_at,
      updated_at: ct.updated_at,
    }));

    return c.json({ contacts, pagination: { page, limit, total, pages: Math.ceil(total / limit) } });
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
      INSERT INTO crm_contacts (id, tenant_id, full_name, email, phone, company, stage, assigned_to, tags, notes, lead_score, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)
    `).bind(
      contactId, tenantId, data.full_name,
      data.email || null, data.phone || null, data.company || null,
      data.stage, data.assigned_to || null,
      typeof data.tags === "string" ? data.tags : JSON.stringify(data.tags || []),
      data.notes || null, now, now
    ).run();

    // CC-CRM-001: Initial lead score calculation
    const contact = { ...data, email: data.email || "", phone: data.phone || "", company: data.company || "" };
    const score = await recalculateLeadScore(c.env.DB, tenantId, contactId, contact);

    // CC-CRM-002: Fire contact_created automation
    await fireAutomationWorkflows(c.env.DB, tenantId, "contact_created", contactId, null, {
      stage: data.stage, score, email: data.email || "", company: data.company || "",
    });

    return c.json({ success: true, id: contactId, lead_score: score }, 201);
  } catch (error: any) {
    console.error("Create contact error:", error);
    if (error instanceof z.ZodError) return c.json({ error: "Validation failed", details: error.errors }, 400);
    return c.json({ error: error.message || "Internal server error" }, 500);
  }
});

crmRouter.get("/contacts/:id", async (c) => {
  try {
    const tenantId = c.get("tenantId") as string;
    if (!tenantId) return c.json({ error: "Unauthorized" }, 401);

    const id = c.req.param("id");
    const result = await c.env.DB.prepare(
      `SELECT * FROM crm_contacts WHERE id = ? AND tenant_id = ? AND deleted_at IS NULL`
    ).bind(id, tenantId).first();

    if (!result) return c.json({ error: "Contact not found" }, 404);

    const ct = result as any;
    return c.json({
      id: ct.id, full_name: ct.full_name, email: ct.email, phone: ct.phone,
      company: ct.company, stage: ct.stage, assigned_to: ct.assigned_to,
      tags: ct.tags ? JSON.parse(ct.tags) : [], notes: ct.notes,
      lead_score: ct.lead_score ?? 0, score_updated_at: ct.score_updated_at,
      created_at: ct.created_at, updated_at: ct.updated_at,
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

    if (data.full_name !== undefined) { updates.push("full_name = ?"); params.push(data.full_name); }
    if (data.email !== undefined) { updates.push("email = ?"); params.push(data.email || null); }
    if (data.phone !== undefined) { updates.push("phone = ?"); params.push(data.phone || null); }
    if (data.company !== undefined) { updates.push("company = ?"); params.push(data.company || null); }
    if (data.stage !== undefined) { updates.push("stage = ?"); params.push(data.stage); }
    if (data.assigned_to !== undefined) { updates.push("assigned_to = ?"); params.push(data.assigned_to || null); }
    if (data.tags !== undefined) {
      updates.push("tags = ?");
      params.push(typeof data.tags === "string" ? data.tags : JSON.stringify(data.tags));
    }
    if (data.notes !== undefined) { updates.push("notes = ?"); params.push(data.notes || null); }

    if (updates.length === 0) return c.json({ error: "No fields to update" }, 400);

    updates.push("updated_at = ?");
    params.push(now, id, tenantId);

    await c.env.DB.prepare(
      `UPDATE crm_contacts SET ${updates.join(", ")} WHERE id = ? AND tenant_id = ? AND deleted_at IS NULL`
    ).bind(...params).run();

    // CC-CRM-001: Recalculate score after update
    const updated = await c.env.DB.prepare(
      `SELECT * FROM crm_contacts WHERE id = ? AND tenant_id = ?`
    ).bind(id, tenantId).first() as any;

    let newScore = 0;
    if (updated) {
      newScore = await recalculateLeadScore(c.env.DB, tenantId, id, updated);
    }

    // CC-CRM-002: Fire stage_changed automation if stage was updated
    if (data.stage && updated) {
      await fireAutomationWorkflows(c.env.DB, tenantId, "stage_changed", id, null, {
        stage: data.stage, score: newScore,
      });
    }

    return c.json({ success: true, lead_score: newScore });
  } catch (error: any) {
    console.error("Update contact error:", error);
    if (error instanceof z.ZodError) return c.json({ error: "Validation failed", details: error.errors }, 400);
    return c.json({ error: error.message || "Internal server error" }, 500);
  }
});

crmRouter.delete("/contacts/:id", async (c) => {
  try {
    const tenantId = c.get("tenantId") as string;
    if (!tenantId) return c.json({ error: "Unauthorized" }, 401);

    const id = c.req.param("id");
    const result = await c.env.DB.prepare(
      `UPDATE crm_contacts SET deleted_at = ? WHERE id = ? AND tenant_id = ? AND deleted_at IS NULL`
    ).bind(Date.now(), id, tenantId).run();

    if (!result.meta.changes) return c.json({ error: "Contact not found" }, 404);
    return c.json({ success: true });
  } catch (error: any) {
    console.error("Delete contact error:", error);
    return c.json({ error: error.message || "Internal server error" }, 500);
  }
});

// ============================================================================
// CC-CRM-001: Lead Scoring Endpoints
// ============================================================================

crmRouter.post("/contacts/:id/rescore", async (c) => {
  try {
    const tenantId = c.get("tenantId") as string;
    if (!tenantId) return c.json({ error: "Unauthorized" }, 401);

    const id = c.req.param("id");
    const contact = await c.env.DB.prepare(
      `SELECT * FROM crm_contacts WHERE id = ? AND tenant_id = ? AND deleted_at IS NULL`
    ).bind(id, tenantId).first() as any;

    if (!contact) return c.json({ error: "Contact not found" }, 404);

    const score = await recalculateLeadScore(c.env.DB, tenantId, id, contact);

    // Log the scoring event
    await c.env.DB.prepare(`
      INSERT INTO crm_score_events (id, tenant_id, contact_id, score_delta, reason, score_after, created_at)
      VALUES (?, ?, ?, ?, 'Manual rescore', ?, ?)
    `).bind(generateId("se"), tenantId, id, 0, score, Date.now()).run();

    return c.json({ success: true, lead_score: score });
  } catch (error: any) {
    console.error("Rescore error:", error);
    return c.json({ error: error.message || "Internal server error" }, 500);
  }
});

crmRouter.get("/scoring-rules", async (c) => {
  try {
    const tenantId = c.get("tenantId") as string;
    if (!tenantId) return c.json({ error: "Unauthorized" }, 401);

    const result = await c.env.DB.prepare(`
      SELECT * FROM crm_scoring_rules
      WHERE tenant_id = ? OR tenant_id = 'default'
      ORDER BY tenant_id DESC, created_at DESC
    `).bind(tenantId).all();

    return c.json({ rules: result.results });
  } catch (error: any) {
    console.error("Scoring rules error:", error);
    return c.json({ error: error.message || "Internal server error" }, 500);
  }
});

crmRouter.post("/scoring-rules", async (c) => {
  try {
    const tenantId = c.get("tenantId") as string;
    if (!tenantId) return c.json({ error: "Unauthorized" }, 401);

    const body = await c.req.json();
    const data = ScoringRuleSchema.parse(body);

    const ruleId = generateId("rule");
    const now = Date.now();

    await c.env.DB.prepare(`
      INSERT INTO crm_scoring_rules (id, tenant_id, name, attribute, operator, value, score_delta, is_active, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(ruleId, tenantId, data.name, data.attribute, data.operator, data.value,
      data.score_delta, data.is_active ? 1 : 0, now, now).run();

    return c.json({ success: true, id: ruleId }, 201);
  } catch (error: any) {
    console.error("Create scoring rule error:", error);
    if (error instanceof z.ZodError) return c.json({ error: "Validation failed", details: error.errors }, 400);
    return c.json({ error: error.message || "Internal server error" }, 500);
  }
});

crmRouter.patch("/scoring-rules/:id", async (c) => {
  try {
    const tenantId = c.get("tenantId") as string;
    if (!tenantId) return c.json({ error: "Unauthorized" }, 401);

    const id = c.req.param("id");
    const body = await c.req.json();
    const data = ScoringRuleSchema.partial().parse(body);

    const updates: string[] = [];
    const params: any[] = [];

    if (data.name !== undefined) { updates.push("name = ?"); params.push(data.name); }
    if (data.score_delta !== undefined) { updates.push("score_delta = ?"); params.push(data.score_delta); }
    if (data.is_active !== undefined) { updates.push("is_active = ?"); params.push(data.is_active ? 1 : 0); }

    if (updates.length === 0) return c.json({ error: "No fields to update" }, 400);

    updates.push("updated_at = ?");
    params.push(Date.now(), id, tenantId);

    await c.env.DB.prepare(
      `UPDATE crm_scoring_rules SET ${updates.join(", ")} WHERE id = ? AND tenant_id = ?`
    ).bind(...params).run();

    return c.json({ success: true });
  } catch (error: any) {
    console.error("Update scoring rule error:", error);
    return c.json({ error: error.message || "Internal server error" }, 500);
  }
});

crmRouter.delete("/scoring-rules/:id", async (c) => {
  try {
    const tenantId = c.get("tenantId") as string;
    if (!tenantId) return c.json({ error: "Unauthorized" }, 401);

    const id = c.req.param("id");
    const result = await c.env.DB.prepare(
      `DELETE FROM crm_scoring_rules WHERE id = ? AND tenant_id = ?`
    ).bind(id, tenantId).run();

    if (!result.meta.changes) return c.json({ error: "Scoring rule not found" }, 404);
    return c.json({ success: true });
  } catch (error: any) {
    console.error("Delete scoring rule error:", error);
    return c.json({ error: error.message || "Internal server error" }, 500);
  }
});

crmRouter.get("/contacts/:id/score-history", async (c) => {
  try {
    const tenantId = c.get("tenantId") as string;
    if (!tenantId) return c.json({ error: "Unauthorized" }, 401);

    const id = c.req.param("id");
    const result = await c.env.DB.prepare(`
      SELECT se.*, sr.name as rule_name FROM crm_score_events se
      LEFT JOIN crm_scoring_rules sr ON se.rule_id = sr.id
      WHERE se.contact_id = ? AND se.tenant_id = ?
      ORDER BY se.created_at DESC LIMIT 50
    `).bind(id, tenantId).all();

    return c.json({ history: result.results });
  } catch (error: any) {
    console.error("Score history error:", error);
    return c.json({ error: error.message || "Internal server error" }, 500);
  }
});

// ============================================================================
// CC-CRM-002: Marketing Automation Workflows
// ============================================================================

crmRouter.get("/automation/workflows", async (c) => {
  try {
    const tenantId = c.get("tenantId") as string;
    if (!tenantId) return c.json({ error: "Unauthorized" }, 401);

    const result = await c.env.DB.prepare(`
      SELECT w.*, COUNT(a.id) as action_count
      FROM crm_automation_workflows w
      LEFT JOIN crm_automation_actions a ON a.workflow_id = w.id
      WHERE w.tenant_id = ?
      GROUP BY w.id
      ORDER BY w.created_at DESC
    `).bind(tenantId).all();

    const workflows = (result.results as any[]).map((w: any) => ({
      ...w,
      trigger_config: JSON.parse(w.trigger_config || "{}"),
      is_active: w.is_active === 1,
    }));

    return c.json({ workflows });
  } catch (error: any) {
    console.error("Automation workflows list error:", error);
    return c.json({ error: error.message || "Internal server error" }, 500);
  }
});

crmRouter.post("/automation/workflows", async (c) => {
  try {
    const tenantId = c.get("tenantId") as string;
    if (!tenantId) return c.json({ error: "Unauthorized" }, 401);

    const body = await c.req.json();
    const data = AutomationWorkflowSchema.parse(body);

    const workflowId = generateId("wf");
    const now = Date.now();

    await c.env.DB.prepare(`
      INSERT INTO crm_automation_workflows (id, tenant_id, name, description, trigger_event, trigger_config, is_active, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      workflowId, tenantId, data.name, data.description || null,
      data.trigger_event, JSON.stringify(data.trigger_config),
      data.is_active ? 1 : 0, now, now
    ).run();

    return c.json({ success: true, id: workflowId }, 201);
  } catch (error: any) {
    console.error("Create automation workflow error:", error);
    if (error instanceof z.ZodError) return c.json({ error: "Validation failed", details: error.errors }, 400);
    return c.json({ error: error.message || "Internal server error" }, 500);
  }
});

crmRouter.patch("/automation/workflows/:id", async (c) => {
  try {
    const tenantId = c.get("tenantId") as string;
    if (!tenantId) return c.json({ error: "Unauthorized" }, 401);

    const id = c.req.param("id");
    const body = await c.req.json();
    const data = AutomationWorkflowSchema.partial().parse(body);

    const updates: string[] = [];
    const params: any[] = [];

    if (data.name !== undefined) { updates.push("name = ?"); params.push(data.name); }
    if (data.description !== undefined) { updates.push("description = ?"); params.push(data.description || null); }
    if (data.is_active !== undefined) { updates.push("is_active = ?"); params.push(data.is_active ? 1 : 0); }
    if (data.trigger_config !== undefined) {
      updates.push("trigger_config = ?");
      params.push(JSON.stringify(data.trigger_config));
    }

    if (updates.length === 0) return c.json({ error: "No fields to update" }, 400);

    updates.push("updated_at = ?");
    params.push(Date.now(), id, tenantId);

    await c.env.DB.prepare(
      `UPDATE crm_automation_workflows SET ${updates.join(", ")} WHERE id = ? AND tenant_id = ?`
    ).bind(...params).run();

    return c.json({ success: true });
  } catch (error: any) {
    console.error("Update automation workflow error:", error);
    return c.json({ error: error.message || "Internal server error" }, 500);
  }
});

crmRouter.delete("/automation/workflows/:id", async (c) => {
  try {
    const tenantId = c.get("tenantId") as string;
    if (!tenantId) return c.json({ error: "Unauthorized" }, 401);

    const id = c.req.param("id");
    const result = await c.env.DB.prepare(
      `DELETE FROM crm_automation_workflows WHERE id = ? AND tenant_id = ?`
    ).bind(id, tenantId).run();

    if (!result.meta.changes) return c.json({ error: "Workflow not found" }, 404);
    return c.json({ success: true });
  } catch (error: any) {
    console.error("Delete automation workflow error:", error);
    return c.json({ error: error.message || "Internal server error" }, 500);
  }
});

crmRouter.get("/automation/workflows/:id/actions", async (c) => {
  try {
    const tenantId = c.get("tenantId") as string;
    if (!tenantId) return c.json({ error: "Unauthorized" }, 401);

    const workflowId = c.req.param("id");
    const result = await c.env.DB.prepare(`
      SELECT a.* FROM crm_automation_actions a
      JOIN crm_automation_workflows w ON a.workflow_id = w.id
      WHERE a.workflow_id = ? AND w.tenant_id = ?
      ORDER BY a.step_order ASC
    `).bind(workflowId, tenantId).all();

    return c.json({
      actions: (result.results as any[]).map((a: any) => ({
        ...a, action_config: JSON.parse(a.action_config || "{}"),
      })),
    });
  } catch (error: any) {
    console.error("Workflow actions error:", error);
    return c.json({ error: error.message || "Internal server error" }, 500);
  }
});

crmRouter.post("/automation/workflows/:id/actions", async (c) => {
  try {
    const tenantId = c.get("tenantId") as string;
    if (!tenantId) return c.json({ error: "Unauthorized" }, 401);

    const workflowId = c.req.param("id");

    // Verify workflow belongs to tenant
    const wf = await c.env.DB.prepare(
      `SELECT id FROM crm_automation_workflows WHERE id = ? AND tenant_id = ?`
    ).bind(workflowId, tenantId).first();
    if (!wf) return c.json({ error: "Workflow not found" }, 404);

    const body = await c.req.json();
    const data = AutomationActionSchema.parse(body);

    const actionId = generateId("action");
    await c.env.DB.prepare(`
      INSERT INTO crm_automation_actions (id, workflow_id, step_order, action_type, action_config, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).bind(actionId, workflowId, data.step_order, data.action_type, JSON.stringify(data.action_config), Date.now()).run();

    return c.json({ success: true, id: actionId }, 201);
  } catch (error: any) {
    console.error("Create workflow action error:", error);
    if (error instanceof z.ZodError) return c.json({ error: "Validation failed", details: error.errors }, 400);
    return c.json({ error: error.message || "Internal server error" }, 500);
  }
});

crmRouter.delete("/automation/workflows/:id/actions/:actionId", async (c) => {
  try {
    const tenantId = c.get("tenantId") as string;
    if (!tenantId) return c.json({ error: "Unauthorized" }, 401);

    const workflowId = c.req.param("id");
    const actionId = c.req.param("actionId");

    const wf = await c.env.DB.prepare(
      `SELECT id FROM crm_automation_workflows WHERE id = ? AND tenant_id = ?`
    ).bind(workflowId, tenantId).first();
    if (!wf) return c.json({ error: "Workflow not found" }, 404);

    await c.env.DB.prepare(
      `DELETE FROM crm_automation_actions WHERE id = ? AND workflow_id = ?`
    ).bind(actionId, workflowId).run();

    return c.json({ success: true });
  } catch (error: any) {
    console.error("Delete workflow action error:", error);
    return c.json({ error: error.message || "Internal server error" }, 500);
  }
});

crmRouter.get("/automation/logs", async (c) => {
  try {
    const tenantId = c.get("tenantId") as string;
    if (!tenantId) return c.json({ error: "Unauthorized" }, 401);

    const workflowId = c.req.query("workflow_id");
    const limit = parseInt(c.req.query("limit") || "50");

    let query = `
      SELECT l.*, w.name as workflow_name FROM crm_automation_logs l
      JOIN crm_automation_workflows w ON l.workflow_id = w.id
      WHERE w.tenant_id = ?
    `;
    const params: any[] = [tenantId];

    if (workflowId) {
      query += ` AND l.workflow_id = ?`;
      params.push(workflowId);
    }

    query += ` ORDER BY l.executed_at DESC LIMIT ?`;
    params.push(limit);

    const result = await c.env.DB.prepare(query).bind(...params).all();
    const logs = (result.results as any[]).map((l: any) => ({
      ...l,
      actions_executed: JSON.parse(l.actions_executed || "[]"),
    }));

    return c.json({ logs });
  } catch (error: any) {
    console.error("Automation logs error:", error);
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
      SELECT d.*, c.full_name as contact_name, c.email as contact_email, c.lead_score as contact_score
      FROM crm_deals d
      LEFT JOIN crm_contacts c ON d.contact_id = c.id
      WHERE d.tenant_id = ?
    `;
    const params: any[] = [tenantId];

    if (stage) { query += ` AND d.stage = ?`; params.push(stage); }
    if (contact_id) { query += ` AND d.contact_id = ?`; params.push(contact_id); }
    query += ` ORDER BY d.created_at DESC`;

    const result = await c.env.DB.prepare(query).bind(...params).all();
    const deals = (result.results as any[]).map((d: any) => ({
      id: d.id, contact_id: d.contact_id, title: d.title,
      value_kobo: d.value_kobo, value_naira: koboToNaira(d.value_kobo),
      stage: d.stage, probability: d.probability, closed_at: d.closed_at,
      contact_name: d.contact_name, contact_email: d.contact_email,
      contact_score: d.contact_score ?? 0,
      created_at: d.created_at, updated_at: d.updated_at,
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

    // CC-CRM-002: Fire deal_created automation
    await fireAutomationWorkflows(c.env.DB, tenantId, "deal_created", data.contact_id, dealId, {
      stage: data.stage, value_kobo: data.value_kobo,
    });

    return c.json({ success: true, id: dealId }, 201);
  } catch (error: any) {
    console.error("Create deal error:", error);
    if (error instanceof z.ZodError) return c.json({ error: "Validation failed", details: error.errors }, 400);
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

    if (data.title !== undefined) { updates.push("title = ?"); params.push(data.title); }
    if (data.value_kobo !== undefined) { updates.push("value_kobo = ?"); params.push(data.value_kobo); }
    if (data.stage !== undefined) { updates.push("stage = ?"); params.push(data.stage); }
    if (data.probability !== undefined) { updates.push("probability = ?"); params.push(data.probability); }

    if (updates.length === 0) return c.json({ error: "No fields to update" }, 400);

    updates.push("updated_at = ?");
    params.push(now, id, tenantId);

    await c.env.DB.prepare(
      `UPDATE crm_deals SET ${updates.join(", ")} WHERE id = ? AND tenant_id = ?`
    ).bind(...params).run();

    return c.json({ success: true });
  } catch (error: any) {
    console.error("Update deal error:", error);
    if (error instanceof z.ZodError) return c.json({ error: "Validation failed", details: error.errors }, 400);
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
      FROM crm_deals WHERE tenant_id = ? AND stage != 'won' AND stage != 'lost'
      GROUP BY stage
    `).bind(tenantId).all();

    const dealsByStage = (dealsResult.results as any[]).reduce((acc: any, d: any) => {
      acc[d.stage] = { count: d.count, total_value: d.total_value };
      return acc;
    }, {});

    const pipeline = (stagesResult.results as any[]).map((s: any) => ({
      id: s.id, name: s.name, position: s.position, probability: s.probability, color: s.color,
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

    if (contact_id) { query += ` AND a.contact_id = ?`; params.push(contact_id); }
    if (deal_id) { query += ` AND a.deal_id = ?`; params.push(deal_id); }
    if (activity_type) { query += ` AND a.activity_type = ?`; params.push(activity_type); }

    query += ` ORDER BY a.created_at DESC LIMIT ?`;
    params.push(limit);

    const result = await c.env.DB.prepare(query).bind(...params).all();
    const activities = (result.results as any[]).map((a: any) => ({
      id: a.id, contact_id: a.contact_id, deal_id: a.deal_id,
      activity_type: a.activity_type, subject: a.subject, description: a.description,
      due_date: a.due_date, completed: a.completed === 1,
      created_by: a.created_by, contact_name: a.contact_name, deal_title: a.deal_title,
      created_at: a.created_at, updated_at: a.updated_at,
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
    const createdBy = (c.get("jwtPayload") as any)?.userId || "system";

    await c.env.DB.prepare(`
      INSERT INTO crm_activities (id, tenant_id, contact_id, deal_id, activity_type, subject, description, due_date, completed, created_by, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      activityId, tenantId, data.contact_id || null, data.deal_id || null,
      data.activity_type, data.subject, data.description || null,
      data.due_date || null, 0, createdBy, now, now
    ).run();

    // CC-CRM-001: Scoring bump for activity-based rules
    if (data.contact_id) {
      const contact = await c.env.DB.prepare(
        `SELECT * FROM crm_contacts WHERE id = ? AND tenant_id = ?`
      ).bind(data.contact_id, tenantId).first() as any;

      if (contact) {
        const contactWithActivity = { ...contact, activity_type: data.activity_type };
        await recalculateLeadScore(c.env.DB, tenantId, data.contact_id, contactWithActivity);

        // CC-CRM-002: Fire activity_logged automation
        await fireAutomationWorkflows(c.env.DB, tenantId, "activity_logged", data.contact_id, data.deal_id || null, {
          activity_type: data.activity_type,
        });
      }
    }

    return c.json({ success: true, id: activityId }, 201);
  } catch (error: any) {
    console.error("Create activity error:", error);
    if (error instanceof z.ZodError) return c.json({ error: "Validation failed", details: error.errors }, 400);
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

    if (data.subject !== undefined) { updates.push("subject = ?"); params.push(data.subject); }
    if (data.description !== undefined) { updates.push("description = ?"); params.push(data.description || null); }
    if (data.due_date !== undefined) { updates.push("due_date = ?"); params.push(data.due_date || null); }
    if (data.completed !== undefined) { updates.push("completed = ?"); params.push(data.completed ? 1 : 0); }

    if (updates.length === 0) return c.json({ error: "No fields to update" }, 400);

    updates.push("updated_at = ?");
    params.push(now, id, tenantId);

    await c.env.DB.prepare(
      `UPDATE crm_activities SET ${updates.join(", ")} WHERE id = ? AND tenant_id = ?`
    ).bind(...params).run();

    return c.json({ success: true });
  } catch (error: any) {
    console.error("Update activity error:", error);
    if (error instanceof z.ZodError) return c.json({ error: "Validation failed", details: error.errors }, 400);
    return c.json({ error: error.message || "Internal server error" }, 500);
  }
});

crmRouter.delete("/activities/:id", async (c) => {
  try {
    const tenantId = c.get("tenantId") as string;
    if (!tenantId) return c.json({ error: "Unauthorized" }, 401);

    const id = c.req.param("id");
    const result = await c.env.DB.prepare(
      `DELETE FROM crm_activities WHERE id = ? AND tenant_id = ?`
    ).bind(id, tenantId).run();

    if (!result.meta.changes) return c.json({ error: "Activity not found" }, 404);
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
    tasks_implemented: ["CC-CRM-001", "CC-CRM-002"],
    timestamp: Date.now(),
  });
});

export { crmRouter };
