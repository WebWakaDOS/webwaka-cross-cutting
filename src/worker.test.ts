/**
 * webwaka-cross-cutting — Integration Test Suite
 * Covers: all 10 task IDs + API contract + auth invariant
 *
 * Run: npm test
 */
import { describe, it, expect, vi } from "vitest";

// ── Mock @webwaka/core verifyJWT ──────────────────────────────────────────────
vi.mock("@webwaka/core", () => ({
  verifyJWT: async (token: string, _secret: string) => {
    try {
      const parts = token.split(".");
      if (parts.length !== 3) return null;
      const payload = JSON.parse(atob(parts[1].replace(/-/g, "+").replace(/_/g, "/")));
      if (payload.exp < Math.floor(Date.now() / 1000)) return null;
      if (!payload.tenantId) return null;
      return payload;
    } catch {
      return null;
    }
  },
}));

import app from "./worker";

// ── Mock D1 Database ──────────────────────────────────────────────────────────
type Row = Record<string, any>;

class MockD1 {
  private tables: Map<string, Row[]> = new Map();

  private tbl(name: string): Row[] {
    if (!this.tables.has(name)) this.tables.set(name, []);
    return this.tables.get(name)!;
  }

  prepare(sql: string) {
    const self = this;
    const bound: any[] = [];
    const ctx = { sql, bound };
    return {
      bind(...args: any[]) { ctx.bound.push(...args); return this; },
      async first<T = any>(): Promise<T | null> {
        return (self.dbExec(ctx) as T[])[0] ?? null;
      },
      async all<T = any>(): Promise<{ results: T[] }> {
        return { results: self.dbExec(ctx) as T[] };
      },
      async run() {
        self.dbExec(ctx);
        return { success: true, meta: { changes: 1 } };
      },
    };
  }

  dbExec({ sql, bound }: { sql: string; bound: any[] }): Row[] {
    const upper = sql.trim().toUpperCase();
    if (upper.startsWith("SELECT 1")) return [{ 1: 1 }];

    const tableMatch = sql.match(/(?:FROM|INTO|UPDATE)\s+(\w+)/i);
    const tblName = tableMatch?.[1]?.toLowerCase() ?? "";
    const rows = this.tbl(tblName);

    if (upper.startsWith("INSERT")) {
      const colMatch = sql.match(/\(([^)]+)\)\s+VALUES/i);
      if (colMatch) {
        const cols = colMatch[1].split(",").map((c: string) => c.trim());
        const row: Row = {};
        cols.forEach((col: string, i: number) => { row[col] = bound[i]; });
        rows.push(row);
      }
      return [];
    }

    if (upper.startsWith("UPDATE")) {
      const id = bound[bound.length - 2];
      rows.forEach(r => { if (!id || r.id === id) r._updated = true; });
      return [];
    }

    if (upper.startsWith("DELETE")) {
      this.tables.set(tblName, rows.filter(r => r.id !== bound[0]));
      return [];
    }

    if (upper.includes("COUNT(")) return [{ count: rows.length }];

    let filtered = [...rows];
    const limitMatch = sql.match(/LIMIT\s+(\d+)/i);
    if (limitMatch) filtered = filtered.slice(0, parseInt(limitMatch[1]));
    return filtered;
  }
}

// ── JWT builder ───────────────────────────────────────────────────────────────
function makeJWT(tenantId = "tenant-001", sub = "user-001"): string {
  const enc = (obj: any) => btoa(JSON.stringify(obj))
    .replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
  const header = enc({ alg: "HS256", typ: "JWT" });
  const payload = enc({
    sub, email: "test@webwaka.dev", tenantId,
    role: "TENANT_ADMIN", permissions: [],
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + 3600,
  });
  return `${header}.${payload}.fakesig`;
}

function makeEnv(db?: MockD1) {
  return {
    DB: db ?? new MockD1(),
    SESSIONS_KV: {} as KVNamespace,
    TENANT_CONFIG_KV: {} as KVNamespace,
    JWT_SECRET: "test-secret",
    AI_PLATFORM_URL: "https://test.ai.platform",
    AI_PLATFORM_TOKEN: "test-ai-token",
    INTER_SERVICE_SECRET: "test-inter-secret",
    ENVIRONMENT: "test",
  };
}

// ── Request helper ────────────────────────────────────────────────────────────
async function req(
  method: string,
  path: string,
  body?: any,
  opts: { tenantId?: string; noAuth?: boolean; db?: MockD1 } = {}
) {
  const { tenantId = "tenant-001", noAuth = false, db } = opts;
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (!noAuth) headers["Authorization"] = `Bearer ${makeJWT(tenantId)}`;

  const request = new Request(`https://test.workers.dev${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  const env = makeEnv(db);
  const res = await app.fetch(request, env);
  const text = await res.text();
  let json: any = null;
  try { json = JSON.parse(text); } catch {}
  return { status: res.status, json };
}

// =============================================================================
// HEALTH CHECK
// =============================================================================

describe("Health check", () => {
  it("GET /health returns service info without auth", async () => {
    const r = await req("GET", "/health", undefined, { noAuth: true });
    expect(r.status).toBe(200);
    expect(r.json.status).toBe("ok");
    expect(r.json.service).toBe("webwaka-cross-cutting");
    expect(r.json.modules).toContain("crm");
    expect(r.json.modules).toContain("hrm");
    expect(r.json.modules).toContain("ticketing");
    expect(r.json.modules).toContain("chat");
    expect(r.json.modules).toContain("analytics");
  });
});

// =============================================================================
// AUTH INVARIANT — tenantId MUST come from JWT claim, never from headers
// =============================================================================

describe("Auth invariant: tenantId from JWT only", () => {
  it("rejects request with no Authorization header", async () => {
    const r = await req("GET", "/api/crm/", undefined, { noAuth: true });
    expect(r.status).toBe(401);
  });

  it("rejects malformed JWT (wrong parts)", async () => {
    const request = new Request("https://test.workers.dev/api/crm/", {
      headers: { Authorization: "Bearer bad.token" },
    });
    const res = await app.fetch(request, makeEnv());
    expect(res.status).toBe(401);
  });

  it("rejects JWT payload missing tenantId claim", async () => {
    const enc = (o: any) => btoa(JSON.stringify(o)).replace(/=/g, "");
    const token = `${enc({ alg: "HS256" })}.${enc({ sub: "u", exp: 9999999999 })}.sig`;
    const request = new Request("https://test.workers.dev/api/crm/", {
      headers: { Authorization: `Bearer ${token}` },
    });
    const res = await app.fetch(request, makeEnv());
    expect(res.status).toBe(401);
  });

  it("accepts valid JWT with tenantId claim", async () => {
    const r = await req("GET", "/api/crm");
    expect(r.status).toBe(200);
  });
});

// =============================================================================
// XCT-1: CRM — CC-CRM-001 (Lead Scoring) + CC-CRM-002 (Marketing Automation)
// =============================================================================

describe("XCT-1: CRM — module metadata", () => {
  it("GET /api/crm/ returns tasks CC-CRM-001 and CC-CRM-002", async () => {
    const r = await req("GET", "/api/crm");
    expect(r.status).toBe(200);
    expect(r.json.module).toBe("crm");
    expect(r.json.tasks).toContain("CC-CRM-001");
    expect(r.json.tasks).toContain("CC-CRM-002");
  });
});

describe("XCT-1: CRM — Contacts", () => {
  it("GET /api/crm/contacts returns { contacts, pagination }", async () => {
    const r = await req("GET", "/api/crm/contacts");
    expect(r.status).toBe(200);
    expect(r.json).toHaveProperty("contacts");
    expect(r.json).toHaveProperty("pagination");
    expect(Array.isArray(r.json.contacts)).toBe(true);
  });

  it("POST /api/crm/contacts creates contact and returns lead_score (CC-CRM-001)", async () => {
    const r = await req("POST", "/api/crm/contacts", {
      full_name: "Amaka Okonkwo",
      email: "amaka@company.ng",
      phone: "08012345678",
      stage: "lead",
    });
    expect(r.status).toBe(201);
    expect(r.json.success).toBe(true);
    expect(r.json).toHaveProperty("id");
    expect(r.json).toHaveProperty("lead_score"); // CC-CRM-001
  });

  it("POST /api/crm/contacts rejects invalid email", async () => {
    const r = await req("POST", "/api/crm/contacts", {
      full_name: "Test",
      email: "not-an-email",
    });
    expect(r.status).toBe(400);
  });

  it("POST /api/crm/contacts rejects missing full_name", async () => {
    const r = await req("POST", "/api/crm/contacts", { email: "a@b.com" });
    expect(r.status).toBe(400);
  });
});

describe("CC-CRM-001: Lead Scoring Rules", () => {
  it("GET /api/crm/scoring-rules returns { rules }", async () => {
    const r = await req("GET", "/api/crm/scoring-rules");
    expect(r.status).toBe(200);
    expect(r.json).toHaveProperty("rules");
    expect(Array.isArray(r.json.rules)).toBe(true);
  });

  it("POST /api/crm/scoring-rules creates rule and returns { success, id }", async () => {
    const r = await req("POST", "/api/crm/scoring-rules", {
      name: "Has company",
      attribute: "company",
      operator: "neq",
      value: "",
      score_delta: 15,
    });
    expect(r.status).toBe(201);
    expect(r.json.success).toBe(true);
    expect(r.json).toHaveProperty("id");
  });

  it("POST /api/crm/scoring-rules rejects invalid operator", async () => {
    const r = await req("POST", "/api/crm/scoring-rules", {
      name: "Bad", attribute: "stage", operator: "invalid_op", value: "x", score_delta: 10,
    });
    expect(r.status).toBe(400);
  });
});

describe("CC-CRM-002: Marketing Automation Workflows", () => {
  it("GET /api/crm/automation/workflows returns { workflows }", async () => {
    const r = await req("GET", "/api/crm/automation/workflows");
    expect(r.status).toBe(200);
    expect(r.json).toHaveProperty("workflows");
    expect(Array.isArray(r.json.workflows)).toBe(true);
  });

  it("POST /api/crm/automation/workflows creates workflow and returns { success, id }", async () => {
    const r = await req("POST", "/api/crm/automation/workflows", {
      name: "Welcome Series",
      trigger_event: "contact_created",
      trigger_config: {},
      is_active: true,
    });
    expect(r.status).toBe(201);
    expect(r.json.success).toBe(true);
    expect(r.json).toHaveProperty("id");
  });

  it("POST /api/crm/automation/workflows rejects invalid trigger_event", async () => {
    const r = await req("POST", "/api/crm/automation/workflows", {
      name: "Bad", trigger_event: "unknown_event",
    });
    expect(r.status).toBe(400);
  });
});

// =============================================================================
// XCT-2: HRM — CC-HRM-001 (Payroll) + CC-HRM-002 (Performance)
// =============================================================================

describe("XCT-2: HRM — module metadata", () => {
  it("GET /api/hrm/ returns tasks CC-HRM-001 and CC-HRM-002", async () => {
    const r = await req("GET", "/api/hrm");
    expect(r.status).toBe(200);
    expect(r.json.module).toBe("hrm");
    expect(r.json.tasks).toContain("CC-HRM-001");
    expect(r.json.tasks).toContain("CC-HRM-002");
  });
});

describe("XCT-2: HRM — Employees", () => {
  it("GET /api/hrm/employees returns { employees, pagination }", async () => {
    const r = await req("GET", "/api/hrm/employees");
    expect(r.status).toBe(200);
    expect(r.json).toHaveProperty("employees");
    expect(r.json).toHaveProperty("pagination");
    expect(Array.isArray(r.json.employees)).toBe(true);
  });

  it("POST /api/hrm/employees creates employee with kobo salary (Nigeria First)", async () => {
    const r = await req("POST", "/api/hrm/employees", {
      full_name: "Emeka Eze",
      email: "emeka@company.ng",
      phone: "09012345678",
      department: "Engineering",
      role: "Backend Engineer",
      employment_type: "full_time",
      salary_kobo: 50000000, // ₦500,000 in kobo
    });
    expect(r.status).toBe(201);
    expect(r.json.success).toBe(true);
    expect(r.json).toHaveProperty("id");
  });

  it("POST /api/hrm/employees rejects invalid employment_type", async () => {
    const r = await req("POST", "/api/hrm/employees", {
      full_name: "Test", phone: "09012345678", employment_type: "alien",
    });
    expect(r.status).toBe(400);
  });
});

describe("CC-HRM-001: Payroll Processing", () => {
  it("GET /api/hrm/payroll/config returns defaults (Nigerian deduction rates)", async () => {
    const r = await req("GET", "/api/hrm/payroll/config");
    expect(r.status).toBe(200);
    expect(r.json).toHaveProperty("pension_rate_pct");
    expect(r.json).toHaveProperty("pay_frequency");
    expect(r.json).toHaveProperty("paye_enabled");
    // Default: 8% pension (800 basis points)
    expect(r.json.pension_rate_pct).toBe(800);
  });

  it("PUT /api/hrm/payroll/config saves Nigerian PAYE + pension config", async () => {
    const r = await req("PUT", "/api/hrm/payroll/config", {
      pension_rate_pct: 800,
      nhf_rate_pct: 250,
      employer_pension_pct: 1000,
      pay_frequency: "monthly",
      paye_enabled: true,
    });
    expect(r.status).toBe(200);
    expect(r.json.success).toBe(true);
  });

  it("GET /api/hrm/payroll returns { runs }", async () => {
    const r = await req("GET", "/api/hrm/payroll");
    expect(r.status).toBe(200);
    expect(r.json).toHaveProperty("runs");
    expect(Array.isArray(r.json.runs)).toBe(true);
  });
});

describe("CC-HRM-002: Performance Management", () => {
  it("GET /api/hrm/goals returns { goals }", async () => {
    const r = await req("GET", "/api/hrm/goals");
    expect(r.status).toBe(200);
    expect(r.json).toHaveProperty("goals");
    expect(Array.isArray(r.json.goals)).toBe(true);
  });

  it("POST /api/hrm/goals creates goal and returns { success, id }", async () => {
    const r = await req("POST", "/api/hrm/goals", {
      employee_id: "emp-001",
      title: "Ship v2 API by Q3",
      due_date: "2026-09-30",
    });
    expect(r.status).toBe(201);
    expect(r.json.success).toBe(true);
    expect(r.json).toHaveProperty("id");
  });

  it("GET /api/hrm/reviews/cycles returns { cycles }", async () => {
    const r = await req("GET", "/api/hrm/reviews/cycles");
    expect(r.status).toBe(200);
    expect(r.json).toHaveProperty("cycles");
    expect(Array.isArray(r.json.cycles)).toBe(true);
  });

  it("POST /api/hrm/reviews/cycles creates review cycle and returns { success, id }", async () => {
    const r = await req("POST", "/api/hrm/reviews/cycles", {
      name: "Q2 2026 Performance Review",
      period_type: "quarterly",
      start_date: "2026-04-01",
      end_date: "2026-06-30",
    });
    expect(r.status).toBe(201);
    expect(r.json.success).toBe(true);
    expect(r.json).toHaveProperty("id");
  });
});

// =============================================================================
// XCT-3: Ticketing — CC-TKT-001 (SLA) + CC-TKT-002 (Routing)
// =============================================================================

describe("XCT-3: Ticketing — module metadata", () => {
  it("GET /api/ticketing/ returns tasks CC-TKT-001 and CC-TKT-002", async () => {
    const r = await req("GET", "/api/ticketing");
    expect(r.status).toBe(200);
    expect(r.json.module).toBe("ticketing");
    expect(r.json.tasks).toContain("CC-TKT-001");
    expect(r.json.tasks).toContain("CC-TKT-002");
  });
});

describe("XCT-3: Ticketing — Tickets", () => {
  it("GET /api/ticketing/tickets returns { tickets, pagination }", async () => {
    const r = await req("GET", "/api/ticketing/tickets");
    expect(r.status).toBe(200);
    expect(r.json).toHaveProperty("tickets");
    expect(r.json).toHaveProperty("pagination");
    expect(Array.isArray(r.json.tickets)).toBe(true);
  });

  it("POST /api/ticketing/tickets creates ticket with routing result (CC-TKT-002)", async () => {
    const r = await req("POST", "/api/ticketing/tickets", {
      subject: "Cannot login to dashboard",
      body: "I get an error when I try to login.",
      priority: "high",
      source: "web",
    });
    expect(r.status).toBe(201);
    expect(r.json.success).toBe(true);
    expect(r.json).toHaveProperty("id");
    expect(r.json).toHaveProperty("routing"); // CC-TKT-002: routing applied on create
  });

  it("POST /api/ticketing/tickets rejects missing subject", async () => {
    const r = await req("POST", "/api/ticketing/tickets", { body: "No subject" });
    expect(r.status).toBe(400);
  });
});

describe("CC-TKT-001: SLA Management", () => {
  it("GET /api/ticketing/sla-policies returns { policies }", async () => {
    const r = await req("GET", "/api/ticketing/sla-policies");
    expect(r.status).toBe(200);
    expect(r.json).toHaveProperty("policies");
    expect(Array.isArray(r.json.policies)).toBe(true);
  });

  it("POST /api/ticketing/sla-policies creates SLA policy and returns { success, id }", async () => {
    const r = await req("POST", "/api/ticketing/sla-policies", {
      name: "Critical SLA",
      priority: "critical",
      response_time_minutes: 15,
      resolution_time_minutes: 120,
    });
    expect(r.status).toBe(201);
    expect(r.json.success).toBe(true);
    expect(r.json).toHaveProperty("id");
  });

  it("POST /api/ticketing/sla-policies rejects invalid priority", async () => {
    const r = await req("POST", "/api/ticketing/sla-policies", {
      name: "Bad", priority: "extreme",
      response_time_minutes: 15, resolution_time_minutes: 120,
    });
    expect(r.status).toBe(400);
  });
});

describe("CC-TKT-002: Automated Ticket Routing", () => {
  it("GET /api/ticketing/routing-rules returns { rules }", async () => {
    const r = await req("GET", "/api/ticketing/routing-rules");
    expect(r.status).toBe(200);
    expect(r.json).toHaveProperty("rules");
    expect(Array.isArray(r.json.rules)).toBe(true);
  });

  it("POST /api/ticketing/routing-rules creates rule and returns { success, id }", async () => {
    const r = await req("POST", "/api/ticketing/routing-rules", {
      name: "Payment Issues",
      keyword_patterns: ["payment", "billing", "invoice"],
      urgency_keywords: ["urgent", "critical"],
      assign_to: "agent-finance",
      set_priority: "high",
      is_active: true,
    });
    expect(r.status).toBe(201);
    expect(r.json.success).toBe(true);
    expect(r.json).toHaveProperty("id");
  });
});

// =============================================================================
// XCT-4: Chat — CC-CHAT-001 (File Sharing) + CC-CHAT-002 (Rich Media)
// =============================================================================

describe("XCT-4: Chat — module metadata", () => {
  it("GET /api/chat/ returns tasks CC-CHAT-001 and CC-CHAT-002", async () => {
    const r = await req("GET", "/api/chat");
    expect(r.status).toBe(200);
    expect(r.json.module).toBe("chat");
    expect(r.json.tasks).toContain("CC-CHAT-001");
    expect(r.json.tasks).toContain("CC-CHAT-002");
  });
});

describe("XCT-4: Chat — Conversations", () => {
  it("GET /api/chat/conversations returns { conversations }", async () => {
    const r = await req("GET", "/api/chat/conversations");
    expect(r.status).toBe(200);
    expect(r.json).toHaveProperty("conversations");
    expect(Array.isArray(r.json.conversations)).toBe(true);
  });

  it("POST /api/chat/conversations creates conversation and returns { success, id }", async () => {
    const r = await req("POST", "/api/chat/conversations", {
      channel: "internal",
      participants: ["user-001", "user-002"],
      title: "Engineering Discussion",
    });
    expect(r.status).toBe(201);
    expect(r.json.success).toBe(true);
    expect(r.json).toHaveProperty("id");
  });

  it("POST /api/chat/conversations rejects empty participants array", async () => {
    const r = await req("POST", "/api/chat/conversations", {
      channel: "internal",
      participants: [],
    });
    expect(r.status).toBe(400);
  });
});

describe("CC-CHAT-001: File Sharing", () => {
  it("POST /api/chat/files/register registers PDF and returns { success, id, media_type }", async () => {
    const r = await req("POST", "/api/chat/files/register", {
      conversation_id: "conv-001",
      filename: "report-q1.pdf",
      original_name: "Q1 Financial Report.pdf",
      mimetype: "application/pdf",
      size_bytes: 204800,
      storage_url: "https://r2.webwaka.dev/files/report-q1.pdf",
    });
    expect(r.status).toBe(201);
    expect(r.json.success).toBe(true);
    expect(r.json).toHaveProperty("id");
    expect(r.json.media_type).toBe("file");
  });

  it("POST /api/chat/files/register rejects invalid storage_url", async () => {
    const r = await req("POST", "/api/chat/files/register", {
      conversation_id: "conv-001",
      filename: "test.pdf",
      original_name: "test.pdf",
      mimetype: "application/pdf",
      size_bytes: 100,
      storage_url: "not-a-url",
    });
    expect(r.status).toBe(400);
  });
});

describe("CC-CHAT-002: Rich Media Support", () => {
  it("PNG upload returns can_inline=true, render_tag=img, display_hint=inline_image", async () => {
    const r = await req("POST", "/api/chat/files/register", {
      conversation_id: "conv-001",
      filename: "screenshot.png",
      original_name: "screenshot.png",
      mimetype: "image/png",
      size_bytes: 51200,
      storage_url: "https://r2.webwaka.dev/files/screenshot.png",
      width: 1920,
      height: 1080,
    });
    expect(r.status).toBe(201);
    expect(r.json.media_type).toBe("image");
    expect(r.json.rich_media.can_inline).toBe(true);
    expect(r.json.rich_media.render_tag).toBe("img");
    expect(r.json.rich_media.display_hint).toBe("inline_image");
  });

  it("MP4 upload returns render_tag=video, media_type=video", async () => {
    const r = await req("POST", "/api/chat/files/register", {
      conversation_id: "conv-001",
      filename: "demo.mp4",
      original_name: "demo.mp4",
      mimetype: "video/mp4",
      size_bytes: 5242880,
      storage_url: "https://r2.webwaka.dev/files/demo.mp4",
      duration_seconds: 120,
    });
    expect(r.status).toBe(201);
    expect(r.json.media_type).toBe("video");
    expect(r.json.rich_media.render_tag).toBe("video");
    expect(r.json.rich_media.can_inline).toBe(true);
  });

  it("MP3 upload returns media_type=audio", async () => {
    const r = await req("POST", "/api/chat/files/register", {
      conversation_id: "conv-001",
      filename: "voice.mp3",
      original_name: "voice.mp3",
      mimetype: "audio/mpeg",
      size_bytes: 102400,
      storage_url: "https://r2.webwaka.dev/files/voice.mp3",
    });
    expect(r.status).toBe(201);
    expect(r.json.media_type).toBe("audio");
  });
});

// =============================================================================
// XCT-5: Analytics — CC-ANL-001 (Report Builder) + CC-ANL-002 (Predictive)
// =============================================================================

describe("XCT-5: Analytics — module metadata", () => {
  it("GET /api/analytics/ returns tasks CC-ANL-001 and CC-ANL-002", async () => {
    const r = await req("GET", "/api/analytics");
    expect(r.status).toBe(200);
    expect(r.json.module).toBe("analytics");
    expect(r.json.tasks).toContain("CC-ANL-001");
    expect(r.json.tasks).toContain("CC-ANL-002");
  });
});

describe("XCT-5: Analytics — Events + Summary", () => {
  it("POST /api/analytics/events ingests a cross-vertical event", async () => {
    const r = await req("POST", "/api/analytics/events", {
      event_type: "order.created",
      vertical: "commerce",
      event_data: { order_id: "ord-001", amount_kobo: 5000000 },
    });
    expect(r.status).toBe(201);
    expect(r.json.success).toBe(true);
  });

  it("GET /api/analytics/summary returns { period, verticals, totals }", async () => {
    const r = await req("GET", "/api/analytics/summary?period=30d");
    expect(r.status).toBe(200);
    expect(r.json).toHaveProperty("period");
    expect(r.json).toHaveProperty("verticals");
    expect(r.json).toHaveProperty("totals");
    expect(r.json.period).toBe("30d");
    expect(Array.isArray(r.json.verticals)).toBe(true);
  });

  it("GET /api/analytics/summary rejects unknown period", async () => {
    const r = await req("GET", "/api/analytics/summary?period=999d");
    expect(r.status).toBe(400);
  });
});

describe("CC-ANL-001: Custom Report Builder", () => {
  it("GET /api/analytics/reports returns { reports }", async () => {
    const r = await req("GET", "/api/analytics/reports");
    expect(r.status).toBe(200);
    expect(r.json).toHaveProperty("reports");
    expect(Array.isArray(r.json.reports)).toBe(true);
  });

  it("POST /api/analytics/reports creates report definition and returns { success, id }", async () => {
    const r = await req("POST", "/api/analytics/reports", {
      name: "Avg Lead Score by Stage",
      data_source: "crm_contacts",
      metrics: [{ field: "lead_score", aggregation: "avg", alias: "avg_score" }],
      dimensions: [{ field: "stage" }],
      filters: [],
      visualization_type: "bar",
    });
    expect(r.status).toBe(201);
    expect(r.json.success).toBe(true);
    expect(r.json).toHaveProperty("id");
  });

  it("POST /api/analytics/reports rejects invalid data_source", async () => {
    const r = await req("POST", "/api/analytics/reports", {
      name: "Bad",
      data_source: "unknown_table",
      metrics: [{ field: "id", aggregation: "count" }],
    });
    expect(r.status).toBe(400);
  });

  it("GET /api/analytics/reports/schema/sources returns available data sources", async () => {
    const r = await req("GET", "/api/analytics/reports/schema/sources");
    expect(r.status).toBe(200);
    expect(r.json).toHaveProperty("data_sources");
    const sourceNames = r.json.data_sources.map((s: any) => s.name);
    expect(sourceNames).toContain("crm_contacts");
    expect(sourceNames).toContain("analytics_daily_metrics");
  });
});

describe("CC-ANL-002: Predictive Analytics", () => {
  it("GET /api/analytics/predictions returns { predictions }", async () => {
    const r = await req("GET", "/api/analytics/predictions");
    expect(r.status).toBe(200);
    expect(r.json).toHaveProperty("predictions");
    expect(Array.isArray(r.json.predictions)).toBe(true);
  });

  it("GET /api/analytics/predictions/metrics returns available_metrics including lead_conversion_rate", async () => {
    const r = await req("GET", "/api/analytics/predictions/metrics");
    expect(r.status).toBe(200);
    expect(r.json).toHaveProperty("available_metrics");
    const names = r.json.available_metrics.map((m: any) => m.name);
    expect(names).toContain("lead_conversion_rate");
    expect(names).toContain("revenue_forecast");
  });
});
