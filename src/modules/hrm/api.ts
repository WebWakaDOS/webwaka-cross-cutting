/**
 * XCT-2: Human Resources Management & Payroll
 * Blueprint: Part 10.12 — Staff Operations
 * Description: HRM with employees, leave requests, payroll, and attendance
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

const hrmRouter = new Hono<{ Bindings: Env; Variables: Variables }>();

hrmRouter.get("/", (c) =>
  c.json({
    module: "hrm",
    version: "1.0.0",
    epic: "XCT-2",
    status: "operational",
    description: "Human Resources Management & Payroll",
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

    let query = `SELECT * FROM hrm_employees WHERE tenant_id = ?`;
    const params: any[] = [tenantId];

    if (department) {
      query += ` AND department = ?`;
      params.push(department);
    }
    if (status) {
      query += ` AND status = ?`;
      params.push(status);
    }
    if (search) {
      query += ` AND (full_name LIKE ? OR email LIKE ? OR role LIKE ?)`;
      const searchPattern = `%${search}%`;
      params.push(searchPattern, searchPattern, searchPattern);
    }

    query += ` ORDER BY created_at DESC LIMIT ? OFFSET ?`;
    params.push(limit, offset);

    const result = await c.env.DB.prepare(query).bind(...params).all();

    const countQuery = `SELECT COUNT(*) as count FROM hrm_employees WHERE tenant_id = ?`;
    const countResult = await c.env.DB.prepare(countQuery).bind(tenantId).first();
    const total = countResult?.count as number || 0;

    const employees = (result.results as any[]).map((e: any) => ({
      id: e.id,
      full_name: e.full_name,
      email: e.email,
      phone: e.phone,
      department: e.department,
      role: e.role,
      employment_type: e.employment_type,
      status: e.status,
      start_date: e.start_date,
      salary_kobo: e.salary_kobo,
      salary_naira: koboToNaira(e.salary_kobo),
      created_at: e.created_at,
      updated_at: e.updated_at,
    }));

    return c.json({
      employees,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit),
      },
    });
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
      INSERT INTO hrm_employees (id, tenant_id, full_name, email, phone, department, role, employment_type, status, start_date, salary_kobo, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      employeeId,
      tenantId,
      data.full_name,
      data.email || null,
      data.phone || null,
      data.department || null,
      data.role || null,
      data.employment_type,
      data.status,
      data.start_date || null,
      data.salary_kobo,
      now,
      now
    ).run();

    // TODO: Emit event to event bus

    return c.json({ success: true, id: employeeId }, 201);
  } catch (error: any) {
    console.error("Create employee error:", error);
    if (error instanceof z.ZodError) {
      return c.json({ error: "Validation failed", details: error.errors }, 400);
    }
    return c.json({ error: error.message || "Internal server error" }, 500);
  }
});

hrmRouter.get("/employees/:id", async (c) => {
  try {
    const tenantId = c.get("tenantId") as string;
    if (!tenantId) return c.json({ error: "Unauthorized" }, 401);

    const id = c.req.param("id");

    const result = await c.env.DB.prepare(`
      SELECT * FROM hrm_employees WHERE id = ? AND tenant_id = ?
    `).bind(id, tenantId).first();

    if (!result) {
      return c.json({ error: "Employee not found" }, 404);
    }

    const employee = result as any;
    return c.json({
      id: employee.id,
      full_name: employee.full_name,
      email: employee.email,
      phone: employee.phone,
      department: employee.department,
      role: employee.role,
      employment_type: employee.employment_type,
      status: employee.status,
      start_date: employee.start_date,
      salary_kobo: employee.salary_kobo,
      salary_naira: koboToNaira(employee.salary_kobo),
      created_at: employee.created_at,
      updated_at: employee.updated_at,
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
    if (data.department !== undefined) {
      updates.push("department = ?");
      params.push(data.department || null);
    }
    if (data.role !== undefined) {
      updates.push("role = ?");
      params.push(data.role || null);
    }
    if (data.employment_type !== undefined) {
      updates.push("employment_type = ?");
      params.push(data.employment_type);
    }
    if (data.status !== undefined) {
      updates.push("status = ?");
      params.push(data.status);
    }
    if (data.start_date !== undefined) {
      updates.push("start_date = ?");
      params.push(data.start_date || null);
    }
    if (data.salary_kobo !== undefined) {
      updates.push("salary_kobo = ?");
      params.push(data.salary_kobo);
    }

    if (updates.length === 0) {
      return c.json({ error: "No fields to update" }, 400);
    }

    updates.push("updated_at = ?");
    params.push(now);
    params.push(id, tenantId);

    await c.env.DB.prepare(`
      UPDATE hrm_employees SET ${updates.join(", ")} WHERE id = ? AND tenant_id = ?
    `).bind(...params).run();

    // TODO: Emit event to event bus

    return c.json({ success: true });
  } catch (error: any) {
    console.error("Update employee error:", error);
    if (error instanceof z.ZodError) {
      return c.json({ error: "Validation failed", details: error.errors }, 400);
    }
    return c.json({ error: error.message || "Internal server error" }, 500);
  }
});

hrmRouter.delete("/employees/:id", async (c) => {
  try {
    const tenantId = c.get("tenantId") as string;
    if (!tenantId) return c.json({ error: "Unauthorized" }, 401);

    const id = c.req.param("id");

    const result = await c.env.DB.prepare(`
      UPDATE hrm_employees SET status = 'terminated', updated_at = ? WHERE id = ? AND tenant_id = ?
    `).bind(Date.now(), id, tenantId).run();

    if (!result.meta.changes) {
      return c.json({ error: "Employee not found" }, 404);
    }

    return c.json({ success: true });
  } catch (error: any) {
    console.error("Delete employee error:", error);
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
      FROM hrm_leave_requests lr
      LEFT JOIN hrm_employees e ON lr.employee_id = e.id
      WHERE lr.tenant_id = ?
    `;
    const params: any[] = [tenantId];

    if (employee_id) {
      query += ` AND lr.employee_id = ?`;
      params.push(employee_id);
    }
    if (status) {
      query += ` AND lr.status = ?`;
      params.push(status);
    }
    if (leave_type) {
      query += ` AND lr.leave_type = ?`;
      params.push(leave_type);
    }

    query += ` ORDER BY lr.created_at DESC`;

    const result = await c.env.DB.prepare(query).bind(...params).all();

    const requests = (result.results as any[]).map((lr: any) => ({
      id: lr.id,
      employee_id: lr.employee_id,
      employee_name: lr.employee_name,
      leave_type: lr.leave_type,
      start_date: lr.start_date,
      end_date: lr.end_date,
      days: lr.days,
      status: lr.status,
      approved_by: lr.approved_by,
      reason: lr.reason,
      created_at: lr.created_at,
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
      INSERT INTO hrm_leave_requests (id, tenant_id, employee_id, leave_type, start_date, end_date, status, reason, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(requestId, tenantId, data.employee_id, data.leave_type, data.start_date, data.end_date, "pending", data.reason || null, now).run();

    return c.json({ success: true, id: requestId }, 201);
  } catch (error: any) {
    console.error("Create leave request error:", error);
    if (error instanceof z.ZodError) {
      return c.json({ error: "Validation failed", details: error.errors }, 400);
    }
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

    if (data.status !== undefined) {
      updates.push("status = ?");
      params.push(data.status);
    }
    if (data.approved_by !== undefined) {
      updates.push("approved_by = ?");
      params.push(data.approved_by || null);
    }
    if (data.reason !== undefined) {
      updates.push("reason = ?");
      params.push(data.reason || null);
    }

    if (updates.length === 0) {
      return c.json({ error: "No fields to update" }, 400);
    }

    params.push(id, tenantId);

    await c.env.DB.prepare(`
      UPDATE hrm_leave_requests SET ${updates.join(", ")} WHERE id = ? AND tenant_id = ?
    `).bind(...params).run();

    return c.json({ success: true });
  } catch (error: any) {
    console.error("Update leave request error:", error);
    if (error instanceof z.ZodError) {
      return c.json({ error: "Validation failed", details: error.errors }, 400);
    }
    return c.json({ error: error.message || "Internal server error" }, 500);
  }
});

// ============================================================================
// Payroll & Attendance (stubs for MVP)
// ============================================================================

hrmRouter.get("/payroll", async (c) => {
  const tenantId = c.get("tenantId") as string;
  if (!tenantId) return c.json({ error: "Unauthorized" }, 401);

  return c.json({ runs: [], message: "Payroll module coming soon" });
});

hrmRouter.get("/attendance", async (c) => {
  const tenantId = c.get("tenantId") as string;
  if (!tenantId) return c.json({ error: "Unauthorized" }, 401);

  return c.json({ records: [], message: "Attendance module coming soon" });
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
    timestamp: Date.now(),
  });
});

export { hrmRouter };