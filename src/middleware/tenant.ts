/**
 * Tenant middleware — extracts and validates x-tenant-id header.
 */
import type { Context, Next } from "hono";
import type { Env } from "../worker";

export async function tenantMiddleware(c: Context<{ Bindings: Env }>, next: Next) {
  const tenantId = c.req.header("x-tenant-id");
  if (c.req.path.startsWith("/api/") && !tenantId) {
    return c.json({ error: "Missing x-tenant-id header" }, 400);
  }
  c.set("tenantId", tenantId ?? "");
  await next();
}

