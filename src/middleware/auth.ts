/**
 * Auth middleware — validates JWT issued by webwaka-core.
 * Reuses the same pattern as other verticals.
 */
import type { MiddlewareHandler } from "hono";
import { verifyJWT } from "@webwaka/core";

export const authMiddleware: MiddlewareHandler = async (c, next) => {
  const authorization = c.req.header("Authorization");
  if (!authorization?.startsWith("Bearer ")) {
    return c.json({ error: "Unauthorized" }, 401);
  }
  const token = authorization.slice(7);
  const payload = await verifyJWT(token, c.env.JWT_SECRET || "");
  if (!payload) return c.json({ error: "Invalid token" }, 401);
  c.set("jwtPayload", payload);
  await next();
};