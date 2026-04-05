/**
 * WebWaka Cross-Cutting Worker
 * Cloudflare Worker entry point for all XCT modules.
 */

import { Hono } from "hono";
import { crmRouter } from "./modules/crm/api";
import { hrmRouter } from "./modules/hrm/api";
import { ticketingRouter } from "./modules/ticketing/api";
import { chatRouter } from "./modules/chat/api";
import { analyticsRouter } from "./modules/analytics/api";
import { authMiddleware } from "./middleware/auth";
import { tenantMiddleware } from "./middleware/tenant";

export interface Env {
  DB: D1Database;
  SESSIONS_KV: KVNamespace;
  TENANT_CONFIG_KV: KVNamespace;
  AI_PLATFORM_URL: string;
  AI_PLATFORM_TOKEN: string;
  INTER_SERVICE_SECRET: string;
  ENVIRONMENT: string;
}

const app = new Hono<{ Bindings: Env }>();

// Global middleware
app.use("*", tenantMiddleware);
app.use("/api/*", authMiddleware);

// Health check
app.get("/health", (c) =>
  c.json({ status: "ok", service: "webwaka-cross-cutting", env: c.env.ENVIRONMENT })
);

// Mount module routers
app.route("/api/crm", crmRouter);
app.route("/api/hrm", hrmRouter);
app.route("/api/ticketing", ticketingRouter);
app.route("/api/chat", chatRouter);
app.route("/api/analytics", analyticsRouter);

export default app;

