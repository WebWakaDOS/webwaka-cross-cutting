/**
 * Tenant middleware — extracts and validates x-tenant-id header.
 */
import type { MiddlewareHandler } from "hono";

export const tenantMiddleware: MiddlewareHandler = async (c, next) => {
  const tenantId = c.req.header("x-tenant-id");
  if (c.req.path.startsWith("/api/") && !tenantId) {
    return c.json({ error: "Missing x-tenant-id header" }, 400);
  }
  c.set("tenantId", tenantId ?? "");
  await next();
};