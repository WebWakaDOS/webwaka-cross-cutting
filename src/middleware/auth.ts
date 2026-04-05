/**
 * Auth middleware — validates JWT issued by webwaka-core.
 * Reuses the same pattern as other verticals.
 */
import type { Context, Next } from "hono";
import type { Env } from "../worker";
import { validateJWT } from "@webwaka/core";

export async function authMiddleware(c: Context<{ Bindings: Env }>, next: Next) {
  const authorization = c.req.header("Authorization");
  if (!authorization?.startsWith("Bearer ")) {
    return c.json({ error: "Unauthorized" }, 401);
  }
  const token = authorization.slice(7);
  const payload = await validateJWT(token);
  if (!payload) return c.json({ error: "Invalid token" }, 401);
  c.set("jwtPayload", payload);
  await next();
}

