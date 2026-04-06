/**
 * Tenant middleware — extracts tenantId from the verified JWT payload.
 *
 * Invariant: tenantId is ALWAYS sourced from the JWT payload.
 * NEVER accept tenantId from request headers, body, or query params.
 * Auth middleware must run first (or be combined) to set jwtPayload.
 */
import type { MiddlewareHandler } from "hono";
import { verifyJWT } from "@webwaka/core";

export const tenantMiddleware: MiddlewareHandler = async (c, next) => {
  // Only enforce on /api/* routes
  if (!c.req.path.startsWith("/api/")) {
    await next();
    return;
  }

  const authorization = c.req.header("Authorization");
  if (!authorization?.startsWith("Bearer ")) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  const token = authorization.slice(7);
  const payload = await verifyJWT(token, c.env.JWT_SECRET || "");
  if (!payload) {
    return c.json({ error: "Invalid token" }, 401);
  }

  const tenantId: string = payload.tenantId;
  if (!tenantId) {
    return c.json({ error: "Token missing tenantId claim" }, 401);
  }

  c.set("tenantId", tenantId);
  c.set("jwtPayload", payload);
  await next();
};
