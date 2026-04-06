/**
 * WebWaka Cross-Cutting Worker
 * Cloudflare Worker entry point for all XCT modules.
 *
 * Invariants:
 *   1. Build Once Use Infinitely — auth/JWT from @webwaka/core
 *   2. tenantId ALWAYS sourced from JWT payload (never from headers)
 *   3. Nigeria First — monetary values in kobo integers
 */

import { Hono } from "hono";
import { crmRouter } from "./modules/crm/api";
import { hrmRouter } from "./modules/hrm/api";
import { ticketingRouter } from "./modules/ticketing/api";
import { chatRouter } from "./modules/chat/api";
import { analyticsRouter } from "./modules/analytics/api";
import { tenantMiddleware } from "./middleware/tenant";

export type Env = {
  DB: D1Database;
  SESSIONS_KV: KVNamespace;
  TENANT_CONFIG_KV: KVNamespace;
  JWT_SECRET: string;
  AI_PLATFORM_URL: string;
  AI_PLATFORM_TOKEN: string;
  INTER_SERVICE_SECRET: string;
  ENVIRONMENT: string;
};

export type Variables = {
  tenantId: string;
  jwtPayload?: any;
};

const app = new Hono<{ Bindings: Env; Variables: Variables }>();

// Global middleware — JWT + tenant extraction for all /api/* routes
app.use("/api/*", tenantMiddleware);

// Health check (unauthenticated)
app.get("/health", (c) =>
  c.json({
    status: "ok",
    service: "webwaka-cross-cutting",
    version: "1.0.0",
    env: c.env.ENVIRONMENT,
    modules: ["crm", "hrm", "ticketing", "chat", "analytics"],
  })
);

// Mount module routers
app.route("/api/crm", crmRouter);
app.route("/api/hrm", hrmRouter);
app.route("/api/ticketing", ticketingRouter);
app.route("/api/chat", chatRouter);
app.route("/api/analytics", analyticsRouter);

export default app;
