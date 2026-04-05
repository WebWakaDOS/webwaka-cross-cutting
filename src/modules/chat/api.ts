/**
 * XCT-4: Internal Chat & Live Chat Widget
 * Blueprint: Part 10.12 — Communication
 * Status: STUB — implementation pending CORE-2
 */
import { Hono } from "hono";
import type { Env } from "../../worker";

export const chatRouter = new Hono<{ Bindings: Env }>();

chatRouter.get("/", (c) => c.json({ module: "chat", status: "stub", epic: "XCT-4" }));

/** XCT-4-A: List conversations */
chatRouter.get("/conversations", async (c) => {
  return c.json({ conversations: [] });
});

/** XCT-4-B: Send message */
chatRouter.post("/conversations/:id/messages", async (c) => {
  return c.json({ success: true, messageId: "stub" }, 201);
});

/** XCT-4-C: Live chat widget config */
chatRouter.get("/widget-config", async (c) => {
  return c.json({ enabled: false, position: "bottom-right", color: "#0066cc" });
});

