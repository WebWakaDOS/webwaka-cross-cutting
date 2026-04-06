/**
 * XCT-2: Human Resources Management & Payroll
 * Blueprint: Part 10.12 — Staff Operations
 * Tasks: CC-HRM-001 (Payroll Processing), CC-HRM-002 (Performance Management)
 */
import { Hono } from "hono";
import { z } from "zod";
import type { Env, Variables } from "../../worker";

// ============================================================================
// Validation Schemas
// ============================================================================

const EmployeeSchema = z.object({
  full_name: z.string().min(1).max(200),
  email: z.string().email().optional().or(z.literal("")),
  phone: z.string().min(10).max(20).optional().or(z.literal("")),
  department: z.string().max(100).optional().or(z.literal("")),
  role: z.string().max(100).optional().or(z.literal("")),
  employment_type: z.enum(["full_time", "part_time", "contract", "intern"]).default("full_time"),
  status: z.enum(["active", "inactive", "terminated", "on_leave"]).default("active"),
  start_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  salary_kobo: z.number().int().min(0).default(0),
  bank_account: z.string().max(20).optional(),
  bank_name: z.string().max(100).optional(),
  tax_id: z.string().max(50).optional(),
  pension_id: z.string().max(50).optional(),
});

const EmployeeUpdateSchema = EmployeeSchema.partial();

const LeaveRequestSchema = z.object({
  employee_id: z.string(),
  leave_type: z.enum(["annual", "sick", "maternity", "paternity", "unpaid", "other"]),
  start_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  end_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  reason: z.string().max(1000).optional().or(z.literal("")),
});

const LeaveUpdateSchema = LeaveRequestSchema.partial().extend({
  status: z.enum(["pending", "approved", "rejected", "cancelled"]).optional(),
  approved_by: z.string().optional(),
});

// CC-HRM-001: Payroll
const PayrollRunSchema = z.object({
  period_label: z.string().min(1).max(20),  // e.g. "2026-03"
  period_start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  period_end: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  employee_ids: z.array(z.string()).optional(),  // If empty, process all active
});

const PayrollConfigSchema = z.object({
  pension_rate_pct: z.number().int().min(0).max(2000).default(800),
  nhf_rate_pct: z.number().int().min(0).max(1000).default(250),
  employer_pension_pct: z.number().int().min(0).max(2000).default(1000),
  pay_frequency: z.enum(["monthly", "weekly", "biweekly"]).default("monthly"),
  paye_enabled: z.boolean().default(true),
});

// CC-HRM-002: Performance
const GoalSchema = z.object({
  employee_id: z.string(),
  title: z.string().min(1).max(300),
  description: z.string().max(2000).optional(),
  target: z.string().max(500).optional(),
  due_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

const GoalUpdateSchema = GoalSchema.partial().extend({
  status: z.enum(["active", "completed", "cancelled", "overdue"]).optional(),
  progress: z.number().int().min(0).max(100).optional(),
});

const ReviewCycleSchema = z.object({
  name: z.string().min(1).max(200),
  period_type: z.enum(["annual", "quarterly", "monthly"]).default("annual"),
  start_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  end_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

const ReviewSchema = z.object({
  cycle_id: z.string(),
  employee_id: z.string(),
  review_type: z.enum(["manager", "self", "peer"]).default("manager"),
  rating: z.number().int().min(1).max(5).optional(),
  strengths: z.string().max(2000).optional(),
  improvements: z.string().max(2000).optional(),
  comments: z.string().max(3000).optional(),
});

const ReviewUpdateSchema = ReviewSchema.partial().extend({
  status: z.enum(["pending", "submitted", "acknowledged"]).optional(),
});

const FeedbackSchema = z.object({
  to_employee_id: z.string(),
  goal_id: z.string().optional(),
  message: z.string().min(1).max(2000),
  feedback_type: z.enum(["general", "goal", "recognition", "improvement"]).default("general"),
  is_private: z.boolean().default(false),
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

// CC-HRM-001: Nigerian PAYE tax calculation (2024 Finance Act)
// Income bands in kobo per annum
function calculatePAYE(annualGrossKobo: number): number {
  const annualGrossNaira = annualGrossKobo / 100;

  // Personal relief allowance: 200k or 1% of gross (whichever is higher) + 20% of gross
  const personalRelief = Math.max(200000, annualGrossNaira * 0.01) + annualGrossNaira * 0.20;
  const taxableIncome = Math.max(0, annualGrossNaira - personalRelief);

  const bands = [
    { limit: 300000,   rate: 0.07 },
    { limit: 300000,   rate: 0.11 },
    { limit: 500000,   rate: 0.15 },
    { limit: 500000,   rate: 0.19 },
    { limit: 1600000,  rate: 0.21 },
    { limit: Infinity, rate: 0.24 },
  ];

  let annualTaxNaira = 0;
  let remaining = taxableIncome;

  for (const band of bands) {
    if (remaining <= 0) break;
    const taxable = Math.min(remaining, band.limit);
    annualTaxNaira += taxable * band.rate;
    remaining -= taxable;
  }

  // Monthly PAYE in kobo
  return Math.round((annualTaxNaira / 12) * 100);
}

// CC-HRM-001: Process a single employee payslip
function calculatePaySlip(
  salaryKobo: number,
  config: any
): {
  basic_kobo: number;
  transport_kobo: number;
  housing_kobo: number;
  gross_kobo: number;
  pension_employee_kobo: number;
  pension_employer_kobo: number;
  nhf_kobo: number;
  paye_kobo: number;
  total_deductions_kobo: number;
  net_kobo: number;
} {
  // Standard Nigerian salary split: 60% basic, 20% transport, 20% housing
  const basic_kobo = Math.round(salaryKobo * 0.60);
  const transport_kobo = Math.round(salaryKobo * 0.20);
  const housing_kobo = salaryKobo - basic_kobo - transport_kobo;
  const gross_kobo = salaryKobo;

  // Pension: employee contributes 8% of (basic + transport + housing = gross)
  const pension_rate = config.pension_rate_pct / 10000;  // stored as integer * 100
  const pension_employee_kobo = Math.round(gross_kobo * pension_rate);
  const employer_pension_rate = config.employer_pension_pct / 10000;
  const pension_employer_kobo = Math.round(gross_kobo * employer_pension_rate);

  // NHF: 2.5% of basic salary
  const nhf_rate = config.nhf_rate_pct / 10000;
  const nhf_kobo = Math.round(basic_kobo * nhf_rate);

  // PAYE: on gross annual (excluding pension and NHF deductions)
  const taxableGrossKobo = Math.max(0, gross_kobo - pension_employee_kobo - nhf_kobo);
  const paye_kobo = config.paye_enabled ? calculatePAYE(taxableGrossKobo * 12) : 0;

  const total_deductions_kobo = pension_employee_kobo + nhf_kobo + paye_kobo;
  const net_kobo = Math.max(0, gross_kobo - total_deductions_kobo);

  return {
    basic_kobo, transport_kobo, housing_kobo, gross_kobo,
    pension_employee_kobo, pension_employer_kobo, nhf_kobo,
    paye_kobo, total_deductions_kobo, net_kobo,
  };
}

// ============================================================================
// Router
// ============================================================================

const hrmRouter = new Hono<{ Bindings: Env; Variables: Variables }>();

hrmRouter.get("/", (c) =>
  c.json({
    module: "hrm",
    version: "2.0.0",
    epic: "XCT-2",
    status: "operational",
    tasks: ["CC-HRM-001", "CC-HRM-002"],
    description: "HRM with employees, leave, payroll processing, and performance management",
  })
);

// ============================================================================
// Employees
// ============================================================================

hrmRouter.get("/employees", async (c) => {
  try {
    const tenantId = c.get("tenantId") as string;
    if (!tenantId) return c.json({ error: "Unauthorized" }, 401);

    const page = parseInt(c.req.query("page") || "1");
    const limit = parseInt(c.req.query("limit") || "20");
    const department = c.req.query("department");
    const status = c.req.query("status");
    const search = c.req.query("search");
    const offset = (page - 1) * limit;

    let query = `SELECT * FROM xcut_hrm_employees WHERE tenant_id = ?`;
    const params: any[] = [tenantId];

    if (department) { query += ` AND department = ?`; params.push(department); }
    if (status) { query += ` AND status = ?`; params.push(status); }
    if (search) {
      query += ` AND (full_name LIKE ? OR email LIKE ? OR role LIKE ?)`;
      const s = `%${search}%`;
      params.push(s, s, s);
    }

    query += ` ORDER BY created_at DESC LIMIT ? OFFSET ?`;
    params.push(limit, offset);

    const result = await c.env.DB.prepare(query).bind(...params).all();
    const countResult = await c.env.DB.prepare(
      `SELECT COUNT(*) as count FROM xcut_hrm_employees WHERE tenant_id = ?`
    ).bind(tenantId).first();
    const total = (countResult?.count as number) || 0;

    const employees = (result.results as any[]).map((e: any) => ({
      id: e.id, full_name: e.full_name, email: e.email, phone: e.phone,
      department: e.department, role: e.role, employment_type: e.employment_type,
      status: e.status, start_date: e.start_date,
      salary_kobo: e.salary_kobo, salary_naira: koboToNaira(e.salary_kobo),
      bank_account: e.bank_account, bank_name: e.bank_name,
      created_at: e.created_at, updated_at: e.updated_at,
    }));

    return c.json({ employees, pagination: { page, limit, total, pages: Math.ceil(total / limit) } });
  } catch (error: any) {
    console.error("Employees list error:", error);
    return c.json({ error: error.message || "Internal server error" }, 500);
  }
});

hrmRouter.post("/employees", async (c) => {
  try {
    const tenantId = c.get("tenantId") as string;
    if (!tenantId) return c.json({ error: "Unauthorized" }, 401);

    const body = await c.req.json();
    const data = EmployeeSchema.parse(body);
    const employeeId = generateId("employee");
    const now = Date.now();

    await c.env.DB.prepare(`
      INSERT INTO xcut_hrm_employees (id, tenant_id, full_name, email, phone, department, role, employment_type, status, start_date, salary_kobo, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      employeeId, tenantId, data.full_name, data.email || null, data.phone || null,
      data.department || null, data.role || null, data.employment_type, data.status,
      data.start_date || null, data.salary_kobo, now, now
    ).run();

    return c.json({ success: true, id: employeeId }, 201);
  } catch (error: any) {
    console.error("Create employee error:", error);
    if (error instanceof z.ZodError) return c.json({ error: "Validation failed", details: error.errors }, 400);
    return c.json({ error: error.message || "Internal server error" }, 500);
  }
});

hrmRouter.get("/employees/:id", async (c) => {
  try {
    const tenantId = c.get("tenantId") as string;
    if (!tenantId) return c.json({ error: "Unauthorized" }, 401);

    const id = c.req.param("id");
    const result = await c.env.DB.prepare(
      `SELECT * FROM xcut_hrm_employees WHERE id = ? AND tenant_id = ?`
    ).bind(id, tenantId).first();

    if (!result) return c.json({ error: "Employee not found" }, 404);

    const e = result as any;
    return c.json({
      id: e.id, full_name: e.full_name, email: e.email, phone: e.phone,
      department: e.department, role: e.role, employment_type: e.employment_type,
      status: e.status, start_date: e.start_date,
      salary_kobo: e.salary_kobo, salary_naira: koboToNaira(e.salary_kobo),
      bank_account: e.bank_account, bank_name: e.bank_name,
      tax_id: e.tax_id, pension_id: e.pension_id,
      created_at: e.created_at, updated_at: e.updated_at,
    });
  } catch (error: any) {
    console.error("Get employee error:", error);
    return c.json({ error: error.message || "Internal server error" }, 500);
  }
});

hrmRouter.patch("/employees/:id", async (c) => {
  try {
    const tenantId = c.get("tenantId") as string;
    if (!tenantId) return c.json({ error: "Unauthorized" }, 401);

    const id = c.req.param("id");
    const body = await c.req.json();
    const data = EmployeeUpdateSchema.parse(body);
    const now = Date.now();
    const updates: string[] = [];
    const params: any[] = [];

    if (data.full_name !== undefined) { updates.push("full_name = ?"); params.push(data.full_name); }
    if (data.email !== undefined) { updates.push("email = ?"); params.push(data.email || null); }
    if (data.phone !== undefined) { updates.push("phone = ?"); params.push(data.phone || null); }
    if (data.department !== undefined) { updates.push("department = ?"); params.push(data.department || null); }
    if (data.role !== undefined) { updates.push("role = ?"); params.push(data.role || null); }
    if (data.employment_type !== undefined) { updates.push("employment_type = ?"); params.push(data.employment_type); }
    if (data.status !== undefined) { updates.push("status = ?"); params.push(data.status); }
    if (data.start_date !== undefined) { updates.push("start_date = ?"); params.push(data.start_date || null); }
    if (data.salary_kobo !== undefined) { updates.push("salary_kobo = ?"); params.push(data.salary_kobo); }
    if (data.bank_account !== undefined) { updates.push("bank_account = ?"); params.push(data.bank_account || null); }
    if (data.bank_name !== undefined) { updates.push("bank_name = ?"); params.push(data.bank_name || null); }

    if (updates.length === 0) return c.json({ error: "No fields to update" }, 400);

    updates.push("updated_at = ?");
    params.push(now, id, tenantId);

    await c.env.DB.prepare(
      `UPDATE xcut_hrm_employees SET ${updates.join(", ")} WHERE id = ? AND tenant_id = ?`
    ).bind(...params).run();

    return c.json({ success: true });
  } catch (error: any) {
    console.error("Update employee error:", error);
    if (error instanceof z.ZodError) return c.json({ error: "Validation failed", details: error.errors }, 400);
    return c.json({ error: error.message || "Internal server error" }, 500);
  }
});

hrmRouter.delete("/employees/:id", async (c) => {
  try {
    const tenantId = c.get("tenantId") as string;
    if (!tenantId) return c.json({ error: "Unauthorized" }, 401);

    const id = c.req.param("id");
    const result = await c.env.DB.prepare(
      `UPDATE xcut_hrm_employees SET status = 'terminated', updated_at = ? WHERE id = ? AND tenant_id = ?`
    ).bind(Date.now(), id, tenantId).run();

    if (!result.meta.changes) return c.json({ error: "Employee not found" }, 404);
    return c.json({ success: true });
  } catch (error: any) {
    console.error("Terminate employee error:", error);
    return c.json({ error: error.message || "Internal server error" }, 500);
  }
});

// ============================================================================
// Leave Requests
// ============================================================================

hrmRouter.get("/leave", async (c) => {
  try {
    const tenantId = c.get("tenantId") as string;
    if (!tenantId) return c.json({ error: "Unauthorized" }, 401);

    const employee_id = c.req.query("employee_id");
    const status = c.req.query("status");
    const leave_type = c.req.query("leave_type");

    let query = `
      SELECT lr.*, e.full_name as employee_name
      FROM xcut_hrm_leave_requests lr
      LEFT JOIN xcut_hrm_employees e ON lr.employee_id = e.id
      WHERE lr.tenant_id = ?
    `;
    const params: any[] = [tenantId];

    if (employee_id) { query += ` AND lr.employee_id = ?`; params.push(employee_id); }
    if (status) { query += ` AND lr.status = ?`; params.push(status); }
    if (leave_type) { query += ` AND lr.leave_type = ?`; params.push(leave_type); }

    query += ` ORDER BY lr.created_at DESC`;

    const result = await c.env.DB.prepare(query).bind(...params).all();
    const requests = (result.results as any[]).map((lr: any) => ({
      id: lr.id, employee_id: lr.employee_id, employee_name: lr.employee_name,
      leave_type: lr.leave_type, start_date: lr.start_date, end_date: lr.end_date,
      days: lr.days, status: lr.status, approved_by: lr.approved_by,
      reason: lr.reason, created_at: lr.created_at,
    }));

    return c.json({ requests });
  } catch (error: any) {
    console.error("Leave requests list error:", error);
    return c.json({ error: error.message || "Internal server error" }, 500);
  }
});

hrmRouter.post("/leave", async (c) => {
  try {
    const tenantId = c.get("tenantId") as string;
    if (!tenantId) return c.json({ error: "Unauthorized" }, 401);

    const body = await c.req.json();
    const data = LeaveRequestSchema.parse(body);
    const requestId = generateId("leave");
    const now = Date.now();

    await c.env.DB.prepare(`
      INSERT INTO xcut_hrm_leave_requests (id, tenant_id, employee_id, leave_type, start_date, end_date, status, reason, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(requestId, tenantId, data.employee_id, data.leave_type, data.start_date, data.end_date, "pending", data.reason || null, now).run();

    return c.json({ success: true, id: requestId }, 201);
  } catch (error: any) {
    console.error("Create leave request error:", error);
    if (error instanceof z.ZodError) return c.json({ error: "Validation failed", details: error.errors }, 400);
    return c.json({ error: error.message || "Internal server error" }, 500);
  }
});

hrmRouter.patch("/leave/:id", async (c) => {
  try {
    const tenantId = c.get("tenantId") as string;
    if (!tenantId) return c.json({ error: "Unauthorized" }, 401);

    const id = c.req.param("id");
    const body = await c.req.json();
    const data = LeaveUpdateSchema.parse(body);
    const updates: string[] = [];
    const params: any[] = [];

    if (data.status !== undefined) { updates.push("status = ?"); params.push(data.status); }
    if (data.approved_by !== undefined) { updates.push("approved_by = ?"); params.push(data.approved_by || null); }
    if (data.reason !== undefined) { updates.push("reason = ?"); params.push(data.reason || null); }

    if (updates.length === 0) return c.json({ error: "No fields to update" }, 400);

    params.push(id, tenantId);
    await c.env.DB.prepare(
      `UPDATE xcut_hrm_leave_requests SET ${updates.join(", ")} WHERE id = ? AND tenant_id = ?`
    ).bind(...params).run();

    return c.json({ success: true });
  } catch (error: any) {
    console.error("Update leave request error:", error);
    if (error instanceof z.ZodError) return c.json({ error: "Validation failed", details: error.errors }, 400);
    return c.json({ error: error.message || "Internal server error" }, 500);
  }
});

// ============================================================================
// CC-HRM-001: Payroll Config
// ============================================================================

hrmRouter.get("/payroll/config", async (c) => {
  try {
    const tenantId = c.get("tenantId") as string;
    if (!tenantId) return c.json({ error: "Unauthorized" }, 401);

    let config = await c.env.DB.prepare(
      `SELECT * FROM xcut_hrm_payroll_configs WHERE tenant_id = ?`
    ).bind(tenantId).first() as any;

    if (!config) {
      // Return defaults
      config = {
        tenant_id: tenantId,
        pension_rate_pct: 800, nhf_rate_pct: 250, employer_pension_pct: 1000,
        pay_frequency: "monthly", paye_enabled: 1,
      };
    }

    return c.json({
      tenant_id: config.tenant_id,
      pension_rate_pct: config.pension_rate_pct,
      pension_rate_display: `${config.pension_rate_pct / 100}%`,
      nhf_rate_pct: config.nhf_rate_pct,
      nhf_rate_display: `${config.nhf_rate_pct / 100}%`,
      employer_pension_pct: config.employer_pension_pct,
      employer_pension_display: `${config.employer_pension_pct / 100}%`,
      pay_frequency: config.pay_frequency,
      paye_enabled: config.paye_enabled === 1,
    });
  } catch (error: any) {
    console.error("Payroll config error:", error);
    return c.json({ error: error.message || "Internal server error" }, 500);
  }
});

hrmRouter.put("/payroll/config", async (c) => {
  try {
    const tenantId = c.get("tenantId") as string;
    if (!tenantId) return c.json({ error: "Unauthorized" }, 401);

    const body = await c.req.json();
    const data = PayrollConfigSchema.parse(body);
    const now = Date.now();

    await c.env.DB.prepare(`
      INSERT INTO xcut_hrm_payroll_configs (tenant_id, pension_rate_pct, nhf_rate_pct, employer_pension_pct, pay_frequency, paye_enabled, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(tenant_id) DO UPDATE SET
        pension_rate_pct = excluded.pension_rate_pct,
        nhf_rate_pct = excluded.nhf_rate_pct,
        employer_pension_pct = excluded.employer_pension_pct,
        pay_frequency = excluded.pay_frequency,
        paye_enabled = excluded.paye_enabled,
        updated_at = excluded.updated_at
    `).bind(
      tenantId, data.pension_rate_pct, data.nhf_rate_pct, data.employer_pension_pct,
      data.pay_frequency, data.paye_enabled ? 1 : 0, now
    ).run();

    return c.json({ success: true });
  } catch (error: any) {
    console.error("Update payroll config error:", error);
    if (error instanceof z.ZodError) return c.json({ error: "Validation failed", details: error.errors }, 400);
    return c.json({ error: error.message || "Internal server error" }, 500);
  }
});

// CC-HRM-001: Payroll Runs
hrmRouter.get("/payroll", async (c) => {
  try {
    const tenantId = c.get("tenantId") as string;
    if (!tenantId) return c.json({ error: "Unauthorized" }, 401);

    const result = await c.env.DB.prepare(
      `SELECT * FROM xcut_hrm_payroll_runs WHERE tenant_id = ? ORDER BY created_at DESC LIMIT 20`
    ).bind(tenantId).all();

    const runs = (result.results as any[]).map((r: any) => ({
      id: r.id, period_label: r.period_label, period_start: r.period_start,
      period_end: r.period_end, status: r.status,
      employee_count: r.employee_count,
      total_gross_kobo: r.total_gross_kobo,
      total_gross_naira: koboToNaira(r.total_gross_kobo),
      total_net_kobo: r.total_net_kobo,
      total_net_naira: koboToNaira(r.total_net_kobo),
      total_deductions_kobo: r.total_deductions_kobo,
      total_tax_kobo: r.total_tax_kobo,
      processed_by: r.processed_by, processed_at: r.processed_at,
      created_at: r.created_at,
    }));

    return c.json({ runs });
  } catch (error: any) {
    console.error("Payroll runs list error:", error);
    return c.json({ error: error.message || "Internal server error" }, 500);
  }
});

hrmRouter.post("/payroll/run", async (c) => {
  try {
    const tenantId = c.get("tenantId") as string;
    if (!tenantId) return c.json({ error: "Unauthorized" }, 401);

    const body = await c.req.json();
    const data = PayrollRunSchema.parse(body);

    // Get payroll config
    let configRow = await c.env.DB.prepare(
      `SELECT * FROM xcut_hrm_payroll_configs WHERE tenant_id = ?`
    ).bind(tenantId).first() as any;

    const config = configRow || {
      pension_rate_pct: 800, nhf_rate_pct: 250,
      employer_pension_pct: 1000, pay_frequency: "monthly", paye_enabled: 1,
    };

    // Get employees to process
    let employeeQuery = `SELECT * FROM xcut_hrm_employees WHERE tenant_id = ? AND status = 'active'`;
    const employeeParams: any[] = [tenantId];

    if (data.employee_ids && data.employee_ids.length > 0) {
      employeeQuery += ` AND id IN (${data.employee_ids.map(() => "?").join(",")})`;
      employeeParams.push(...data.employee_ids);
    }

    const employeesResult = await c.env.DB.prepare(employeeQuery).bind(...employeeParams).all();
    const employees = employeesResult.results as any[];

    if (employees.length === 0) {
      return c.json({ error: "No active employees found to process" }, 400);
    }

    // Create payroll run
    const runId = generateId("payrun");
    const processedBy = (c.get("jwtPayload") as any)?.userId || "system";
    const now = Date.now();

    await c.env.DB.prepare(`
      INSERT INTO xcut_hrm_payroll_runs (id, tenant_id, period_label, period_start, period_end, status, employee_count, processed_by, created_at)
      VALUES (?, ?, ?, ?, ?, 'processing', ?, ?, ?)
    `).bind(runId, tenantId, data.period_label, data.period_start, data.period_end, employees.length, processedBy, now).run();

    let totalGross = 0, totalNet = 0, totalDeductions = 0, totalTax = 0;

    // Generate pay slips for each employee
    const slipInserts: Promise<any>[] = [];
    for (const employee of employees) {
      const slip = calculatePaySlip(employee.salary_kobo, config);

      totalGross += slip.gross_kobo;
      totalNet += slip.net_kobo;
      totalDeductions += slip.total_deductions_kobo;
      totalTax += slip.paye_kobo;

      const slipId = generateId("slip");
      slipInserts.push(
        c.env.DB.prepare(`
          INSERT INTO xcut_hrm_pay_slips (id, tenant_id, payroll_run_id, employee_id, period_label,
            gross_kobo, basic_kobo, transport_allowance_kobo, housing_allowance_kobo,
            pension_employee_kobo, pension_employer_kobo, nhf_kobo, paye_tax_kobo,
            total_deductions_kobo, net_kobo, bank_account, bank_name, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).bind(
          slipId, tenantId, runId, employee.id, data.period_label,
          slip.gross_kobo, slip.basic_kobo, slip.transport_kobo, slip.housing_kobo,
          slip.pension_employee_kobo, slip.pension_employer_kobo, slip.nhf_kobo, slip.paye_kobo,
          slip.total_deductions_kobo, slip.net_kobo,
          employee.bank_account || null, employee.bank_name || null, now
        ).run()
      );
    }

    await Promise.all(slipInserts);

    // Update payroll run with totals
    await c.env.DB.prepare(`
      UPDATE xcut_hrm_payroll_runs SET
        status = 'completed', total_gross_kobo = ?, total_net_kobo = ?,
        total_deductions_kobo = ?, total_tax_kobo = ?, processed_at = ?
      WHERE id = ?
    `).bind(totalGross, totalNet, totalDeductions, totalTax, now, runId).run();

    return c.json({
      success: true,
      run_id: runId,
      summary: {
        employee_count: employees.length,
        total_gross_kobo: totalGross,
        total_gross_naira: koboToNaira(totalGross),
        total_net_kobo: totalNet,
        total_net_naira: koboToNaira(totalNet),
        total_deductions_kobo: totalDeductions,
        total_tax_kobo: totalTax,
        total_tax_naira: koboToNaira(totalTax),
      },
    }, 201);
  } catch (error: any) {
    console.error("Payroll run error:", error);
    if (error instanceof z.ZodError) return c.json({ error: "Validation failed", details: error.errors }, 400);
    return c.json({ error: error.message || "Internal server error" }, 500);
  }
});

hrmRouter.get("/payroll/:runId/slips", async (c) => {
  try {
    const tenantId = c.get("tenantId") as string;
    if (!tenantId) return c.json({ error: "Unauthorized" }, 401);

    const runId = c.req.param("runId");
    const result = await c.env.DB.prepare(`
      SELECT ps.*, e.full_name as employee_name, e.email as employee_email, e.department, e.role
      FROM xcut_hrm_pay_slips ps
      JOIN xcut_hrm_employees e ON ps.employee_id = e.id
      WHERE ps.payroll_run_id = ? AND ps.tenant_id = ?
      ORDER BY e.full_name ASC
    `).bind(runId, tenantId).all();

    const slips = (result.results as any[]).map((s: any) => ({
      id: s.id, employee_id: s.employee_id, employee_name: s.employee_name,
      employee_email: s.employee_email, department: s.department, role: s.role,
      period_label: s.period_label,
      gross_kobo: s.gross_kobo, gross_naira: koboToNaira(s.gross_kobo),
      basic_kobo: s.basic_kobo, basic_naira: koboToNaira(s.basic_kobo),
      transport_allowance_kobo: s.transport_allowance_kobo,
      housing_allowance_kobo: s.housing_allowance_kobo,
      deductions: {
        pension_employee_kobo: s.pension_employee_kobo,
        pension_employee_naira: koboToNaira(s.pension_employee_kobo),
        pension_employer_kobo: s.pension_employer_kobo,
        nhf_kobo: s.nhf_kobo, nhf_naira: koboToNaira(s.nhf_kobo),
        paye_tax_kobo: s.paye_tax_kobo, paye_tax_naira: koboToNaira(s.paye_tax_kobo),
        total_deductions_kobo: s.total_deductions_kobo,
        total_deductions_naira: koboToNaira(s.total_deductions_kobo),
      },
      net_kobo: s.net_kobo, net_naira: koboToNaira(s.net_kobo),
      bank_account: s.bank_account, bank_name: s.bank_name,
      created_at: s.created_at,
    }));

    return c.json({ slips });
  } catch (error: any) {
    console.error("Pay slips error:", error);
    return c.json({ error: error.message || "Internal server error" }, 500);
  }
});

hrmRouter.get("/payroll/employee/:employeeId/slips", async (c) => {
  try {
    const tenantId = c.get("tenantId") as string;
    if (!tenantId) return c.json({ error: "Unauthorized" }, 401);

    const employeeId = c.req.param("employeeId");
    const result = await c.env.DB.prepare(`
      SELECT ps.*, pr.period_start, pr.period_end, pr.status as run_status
      FROM xcut_hrm_pay_slips ps
      JOIN xcut_hrm_payroll_runs pr ON ps.payroll_run_id = pr.id
      WHERE ps.employee_id = ? AND ps.tenant_id = ?
      ORDER BY ps.created_at DESC
    `).bind(employeeId, tenantId).all();

    const slips = (result.results as any[]).map((s: any) => ({
      id: s.id, payroll_run_id: s.payroll_run_id, period_label: s.period_label,
      period_start: s.period_start, period_end: s.period_end,
      gross_naira: koboToNaira(s.gross_kobo), net_naira: koboToNaira(s.net_kobo),
      paye_naira: koboToNaira(s.paye_tax_kobo), pension_naira: koboToNaira(s.pension_employee_kobo),
      total_deductions_naira: koboToNaira(s.total_deductions_kobo),
      run_status: s.run_status, created_at: s.created_at,
    }));

    return c.json({ slips });
  } catch (error: any) {
    console.error("Employee pay slips error:", error);
    return c.json({ error: error.message || "Internal server error" }, 500);
  }
});

// CC-HRM-001: Preview payslip calculation without committing
hrmRouter.post("/payroll/preview", async (c) => {
  try {
    const tenantId = c.get("tenantId") as string;
    if (!tenantId) return c.json({ error: "Unauthorized" }, 401);

    const body = await c.req.json();
    const salary_kobo = z.number().int().min(0).parse(body.salary_kobo);

    let configRow = await c.env.DB.prepare(
      `SELECT * FROM xcut_hrm_payroll_configs WHERE tenant_id = ?`
    ).bind(tenantId).first() as any;

    const config = configRow || {
      pension_rate_pct: 800, nhf_rate_pct: 250,
      employer_pension_pct: 1000, paye_enabled: 1,
    };

    const slip = calculatePaySlip(salary_kobo, config);
    return c.json({
      gross_naira: koboToNaira(slip.gross_kobo),
      basic_naira: koboToNaira(slip.basic_kobo),
      transport_naira: koboToNaira(slip.transport_kobo),
      housing_naira: koboToNaira(slip.housing_kobo),
      pension_employee_naira: koboToNaira(slip.pension_employee_kobo),
      pension_employer_naira: koboToNaira(slip.pension_employer_kobo),
      nhf_naira: koboToNaira(slip.nhf_kobo),
      paye_naira: koboToNaira(slip.paye_kobo),
      total_deductions_naira: koboToNaira(slip.total_deductions_kobo),
      net_naira: koboToNaira(slip.net_kobo),
    });
  } catch (error: any) {
    console.error("Payroll preview error:", error);
    return c.json({ error: error.message || "Internal server error" }, 500);
  }
});

// ============================================================================
// CC-HRM-002: Goals
// ============================================================================

hrmRouter.get("/goals", async (c) => {
  try {
    const tenantId = c.get("tenantId") as string;
    if (!tenantId) return c.json({ error: "Unauthorized" }, 401);

    const employee_id = c.req.query("employee_id");
    const status = c.req.query("status");

    let query = `
      SELECT g.*, e.full_name as employee_name
      FROM xcut_hrm_goals g
      JOIN xcut_hrm_employees e ON g.employee_id = e.id
      WHERE g.tenant_id = ?
    `;
    const params: any[] = [tenantId];

    if (employee_id) { query += ` AND g.employee_id = ?`; params.push(employee_id); }
    if (status) { query += ` AND g.status = ?`; params.push(status); }

    query += ` ORDER BY g.due_date ASC, g.created_at DESC`;

    const result = await c.env.DB.prepare(query).bind(...params).all();
    return c.json({ goals: result.results });
  } catch (error: any) {
    console.error("Goals list error:", error);
    return c.json({ error: error.message || "Internal server error" }, 500);
  }
});

hrmRouter.post("/goals", async (c) => {
  try {
    const tenantId = c.get("tenantId") as string;
    if (!tenantId) return c.json({ error: "Unauthorized" }, 401);

    const body = await c.req.json();
    const data = GoalSchema.parse(body);
    const goalId = generateId("goal");
    const createdBy = (c.get("jwtPayload") as any)?.userId || "system";
    const now = Date.now();

    await c.env.DB.prepare(`
      INSERT INTO xcut_hrm_goals (id, tenant_id, employee_id, title, description, target, due_date, status, progress, created_by, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'active', 0, ?, ?, ?)
    `).bind(goalId, tenantId, data.employee_id, data.title, data.description || null,
      data.target || null, data.due_date || null, createdBy, now, now).run();

    return c.json({ success: true, id: goalId }, 201);
  } catch (error: any) {
    console.error("Create goal error:", error);
    if (error instanceof z.ZodError) return c.json({ error: "Validation failed", details: error.errors }, 400);
    return c.json({ error: error.message || "Internal server error" }, 500);
  }
});

hrmRouter.patch("/goals/:id", async (c) => {
  try {
    const tenantId = c.get("tenantId") as string;
    if (!tenantId) return c.json({ error: "Unauthorized" }, 401);

    const id = c.req.param("id");
    const body = await c.req.json();
    const data = GoalUpdateSchema.parse(body);
    const updates: string[] = [];
    const params: any[] = [];

    if (data.title !== undefined) { updates.push("title = ?"); params.push(data.title); }
    if (data.description !== undefined) { updates.push("description = ?"); params.push(data.description || null); }
    if (data.target !== undefined) { updates.push("target = ?"); params.push(data.target || null); }
    if (data.due_date !== undefined) { updates.push("due_date = ?"); params.push(data.due_date || null); }
    if (data.status !== undefined) { updates.push("status = ?"); params.push(data.status); }
    if (data.progress !== undefined) { updates.push("progress = ?"); params.push(data.progress); }

    if (updates.length === 0) return c.json({ error: "No fields to update" }, 400);

    updates.push("updated_at = ?");
    params.push(Date.now(), id, tenantId);

    await c.env.DB.prepare(
      `UPDATE xcut_hrm_goals SET ${updates.join(", ")} WHERE id = ? AND tenant_id = ?`
    ).bind(...params).run();

    return c.json({ success: true });
  } catch (error: any) {
    console.error("Update goal error:", error);
    if (error instanceof z.ZodError) return c.json({ error: "Validation failed", details: error.errors }, 400);
    return c.json({ error: error.message || "Internal server error" }, 500);
  }
});

hrmRouter.delete("/goals/:id", async (c) => {
  try {
    const tenantId = c.get("tenantId") as string;
    if (!tenantId) return c.json({ error: "Unauthorized" }, 401);

    const id = c.req.param("id");
    await c.env.DB.prepare(
      `UPDATE xcut_hrm_goals SET status = 'cancelled', updated_at = ? WHERE id = ? AND tenant_id = ?`
    ).bind(Date.now(), id, tenantId).run();

    return c.json({ success: true });
  } catch (error: any) {
    console.error("Cancel goal error:", error);
    return c.json({ error: error.message || "Internal server error" }, 500);
  }
});

// ============================================================================
// CC-HRM-002: Review Cycles
// ============================================================================

hrmRouter.get("/reviews/cycles", async (c) => {
  try {
    const tenantId = c.get("tenantId") as string;
    if (!tenantId) return c.json({ error: "Unauthorized" }, 401);

    const result = await c.env.DB.prepare(
      `SELECT * FROM xcut_hrm_review_cycles WHERE tenant_id = ? ORDER BY start_date DESC`
    ).bind(tenantId).all();

    return c.json({ cycles: result.results });
  } catch (error: any) {
    console.error("Review cycles error:", error);
    return c.json({ error: error.message || "Internal server error" }, 500);
  }
});

hrmRouter.post("/reviews/cycles", async (c) => {
  try {
    const tenantId = c.get("tenantId") as string;
    if (!tenantId) return c.json({ error: "Unauthorized" }, 401);

    const body = await c.req.json();
    const data = ReviewCycleSchema.parse(body);
    const cycleId = generateId("cycle");
    const createdBy = (c.get("jwtPayload") as any)?.userId || "system";

    await c.env.DB.prepare(`
      INSERT INTO xcut_hrm_review_cycles (id, tenant_id, name, period_type, start_date, end_date, status, created_by, created_at)
      VALUES (?, ?, ?, ?, ?, ?, 'active', ?, ?)
    `).bind(cycleId, tenantId, data.name, data.period_type, data.start_date, data.end_date, createdBy, Date.now()).run();

    return c.json({ success: true, id: cycleId }, 201);
  } catch (error: any) {
    console.error("Create review cycle error:", error);
    if (error instanceof z.ZodError) return c.json({ error: "Validation failed", details: error.errors }, 400);
    return c.json({ error: error.message || "Internal server error" }, 500);
  }
});

hrmRouter.patch("/reviews/cycles/:id", async (c) => {
  try {
    const tenantId = c.get("tenantId") as string;
    if (!tenantId) return c.json({ error: "Unauthorized" }, 401);

    const id = c.req.param("id");
    const body = await c.req.json();
    const status = z.enum(["active", "completed", "cancelled"]).parse(body.status);

    await c.env.DB.prepare(
      `UPDATE xcut_hrm_review_cycles SET status = ? WHERE id = ? AND tenant_id = ?`
    ).bind(status, id, tenantId).run();

    return c.json({ success: true });
  } catch (error: any) {
    console.error("Update review cycle error:", error);
    return c.json({ error: error.message || "Internal server error" }, 500);
  }
});

// CC-HRM-002: Reviews
hrmRouter.get("/reviews", async (c) => {
  try {
    const tenantId = c.get("tenantId") as string;
    if (!tenantId) return c.json({ error: "Unauthorized" }, 401);

    const cycle_id = c.req.query("cycle_id");
    const employee_id = c.req.query("employee_id");
    const review_type = c.req.query("review_type");

    let query = `
      SELECT r.*, e.full_name as employee_name, rc.name as cycle_name
      FROM xcut_hrm_reviews r
      JOIN xcut_hrm_employees e ON r.employee_id = e.id
      JOIN xcut_hrm_review_cycles rc ON r.cycle_id = rc.id
      WHERE r.tenant_id = ?
    `;
    const params: any[] = [tenantId];

    if (cycle_id) { query += ` AND r.cycle_id = ?`; params.push(cycle_id); }
    if (employee_id) { query += ` AND r.employee_id = ?`; params.push(employee_id); }
    if (review_type) { query += ` AND r.review_type = ?`; params.push(review_type); }

    query += ` ORDER BY r.created_at DESC`;

    const result = await c.env.DB.prepare(query).bind(...params).all();
    return c.json({ reviews: result.results });
  } catch (error: any) {
    console.error("Reviews list error:", error);
    return c.json({ error: error.message || "Internal server error" }, 500);
  }
});

hrmRouter.post("/reviews", async (c) => {
  try {
    const tenantId = c.get("tenantId") as string;
    if (!tenantId) return c.json({ error: "Unauthorized" }, 401);

    const body = await c.req.json();
    const data = ReviewSchema.parse(body);
    const reviewId = generateId("review");
    const reviewerId = (c.get("jwtPayload") as any)?.userId || "system";
    const now = Date.now();

    await c.env.DB.prepare(`
      INSERT INTO xcut_hrm_reviews (id, tenant_id, cycle_id, employee_id, reviewer_id, review_type, rating, strengths, improvements, comments, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)
    `).bind(
      reviewId, tenantId, data.cycle_id, data.employee_id, reviewerId,
      data.review_type, data.rating || null, data.strengths || null,
      data.improvements || null, data.comments || null, now, now
    ).run();

    return c.json({ success: true, id: reviewId }, 201);
  } catch (error: any) {
    console.error("Create review error:", error);
    if (error instanceof z.ZodError) return c.json({ error: "Validation failed", details: error.errors }, 400);
    return c.json({ error: error.message || "Internal server error" }, 500);
  }
});

hrmRouter.patch("/reviews/:id", async (c) => {
  try {
    const tenantId = c.get("tenantId") as string;
    if (!tenantId) return c.json({ error: "Unauthorized" }, 401);

    const id = c.req.param("id");
    const body = await c.req.json();
    const data = ReviewUpdateSchema.parse(body);
    const now = Date.now();
    const updates: string[] = [];
    const params: any[] = [];

    if (data.rating !== undefined) { updates.push("rating = ?"); params.push(data.rating || null); }
    if (data.strengths !== undefined) { updates.push("strengths = ?"); params.push(data.strengths || null); }
    if (data.improvements !== undefined) { updates.push("improvements = ?"); params.push(data.improvements || null); }
    if (data.comments !== undefined) { updates.push("comments = ?"); params.push(data.comments || null); }
    if (data.status !== undefined) {
      updates.push("status = ?");
      params.push(data.status);
      if (data.status === "submitted") {
        updates.push("submitted_at = ?");
        params.push(now);
      }
    }

    if (updates.length === 0) return c.json({ error: "No fields to update" }, 400);

    updates.push("updated_at = ?");
    params.push(now, id, tenantId);

    await c.env.DB.prepare(
      `UPDATE xcut_hrm_reviews SET ${updates.join(", ")} WHERE id = ? AND tenant_id = ?`
    ).bind(...params).run();

    return c.json({ success: true });
  } catch (error: any) {
    console.error("Update review error:", error);
    if (error instanceof z.ZodError) return c.json({ error: "Validation failed", details: error.errors }, 400);
    return c.json({ error: error.message || "Internal server error" }, 500);
  }
});

// CC-HRM-002: Feedback
hrmRouter.get("/feedback", async (c) => {
  try {
    const tenantId = c.get("tenantId") as string;
    if (!tenantId) return c.json({ error: "Unauthorized" }, 401);

    const employee_id = c.req.query("employee_id");
    const feedback_type = c.req.query("feedback_type");

    let query = `
      SELECT f.*, giver.full_name as from_name, receiver.full_name as to_name
      FROM xcut_hrm_feedback f
      JOIN xcut_hrm_employees giver ON f.from_employee_id = giver.id
      JOIN xcut_hrm_employees receiver ON f.to_employee_id = receiver.id
      WHERE f.tenant_id = ?
    `;
    const params: any[] = [tenantId];

    if (employee_id) {
      query += ` AND (f.to_employee_id = ? OR f.from_employee_id = ?)`;
      params.push(employee_id, employee_id);
    }
    if (feedback_type) { query += ` AND f.feedback_type = ?`; params.push(feedback_type); }

    query += ` ORDER BY f.created_at DESC LIMIT 100`;

    const result = await c.env.DB.prepare(query).bind(...params).all();
    const feedback = (result.results as any[]).map((f: any) => ({
      ...f, is_private: f.is_private === 1,
    }));

    return c.json({ feedback });
  } catch (error: any) {
    console.error("Feedback list error:", error);
    return c.json({ error: error.message || "Internal server error" }, 500);
  }
});

hrmRouter.post("/feedback", async (c) => {
  try {
    const tenantId = c.get("tenantId") as string;
    if (!tenantId) return c.json({ error: "Unauthorized" }, 401);

    const body = await c.req.json();
    const data = FeedbackSchema.parse(body);
    const fromEmployeeId = body.from_employee_id || (c.get("jwtPayload") as any)?.userId || "system";

    const feedbackId = generateId("fb");

    await c.env.DB.prepare(`
      INSERT INTO xcut_hrm_feedback (id, tenant_id, from_employee_id, to_employee_id, goal_id, message, feedback_type, is_private, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      feedbackId, tenantId, fromEmployeeId, data.to_employee_id, data.goal_id || null,
      data.message, data.feedback_type, data.is_private ? 1 : 0, Date.now()
    ).run();

    return c.json({ success: true, id: feedbackId }, 201);
  } catch (error: any) {
    console.error("Create feedback error:", error);
    if (error instanceof z.ZodError) return c.json({ error: "Validation failed", details: error.errors }, 400);
    return c.json({ error: error.message || "Internal server error" }, 500);
  }
});

hrmRouter.get("/attendance", async (c) => {
  const tenantId = c.get("tenantId") as string;
  if (!tenantId) return c.json({ error: "Unauthorized" }, 401);
  return c.json({ records: [], message: "Attendance module — biometric integration coming soon" });
});

hrmRouter.get("/health", async (c) => {
  const tenantId = c.get("tenantId") as string;
  if (!tenantId) return c.json({ error: "Unauthorized" }, 401);

  const dbCheck = await c.env.DB.prepare("SELECT 1").first();
  const dbHealthy = !!dbCheck;

  return c.json({
    status: dbHealthy ? "healthy" : "unhealthy",
    database: dbHealthy,
    tenant_id: tenantId,
    tasks_implemented: ["CC-HRM-001", "CC-HRM-002"],
    timestamp: Date.now(),
  });
});

export { hrmRouter };
