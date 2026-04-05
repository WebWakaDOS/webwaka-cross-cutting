/**
 * XCT-4: Internal Chat & Live Chat Widget
 * Blueprint: Part 10.12 — Communication
 * Description: Chat system for internal team and live chat for customer support
 */
import { Hono } from "hono";
import { z } from "zod";
import type { Env, Variables } from "../../worker";

// ============================================================================
// Validation Schemas
// ============================================================================

const CreateConversationSchema = z.object({
  channel: z.enum(["internal", "whatsapp", "telegram", "live_chat"]).default("internal"),
  participants: z.array(z.string()).min(1),
  title: z.string().max(200).optional(),
});

const MessageSchema = z.object({
  conversation_id: z.string(),
  body: z.string().min(1).max(10000),
  message_type: z.enum(["text", "image", "file", "system"]).default("text"),
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

// ============================================================================
// Router
// ============================================================================

const chatRouter = new Hono<{ Bindings: Env; Variables: Variables }>();

chatRouter.get("/", (c) =>
  c.json({
    module: "chat",
    version: "1.0.0",
    epic: "XCT-4",
    status: "operational",
    description: "Internal chat and live chat widget",
  })
);

// ============================================================================
// Conversations
// ============================================================================

chatRouter.get("/conversations", async (c) => {
  try {
    const tenantId = c.get("tenantId") as string;
    if (!tenantId) return c.json({ error: "Unauthorized" }, 401);

    const channel = c.req.query("channel");
    const status = c.req.query("status");
    const limit = parseInt(c.req.query("limit") || "50");

    let query = `SELECT * FROM chat_conversations WHERE tenant_id = ?`;
    const params: any[] = [tenantId];

    if (channel) {
      query += ` AND channel = ?`;
      params.push(channel);
    }
    if (status) {
      query += ` AND status = ?`;
      params.push(status);
    }

    query += ` ORDER BY updated_at DESC LIMIT ?`;
    params.push(limit);

    const result = await c.env.DB.prepare(query).bind(...params).all();

    const conversations = (result.results as any[]).map((conv: any) => ({
      id: conv.id,
      channel: conv.channel,
      status: conv.status,
      participants: conv.participants ? JSON.parse(conv.participants) : [],
      title: conv.title,
      created_at: conv.created_at,
      updated_at: conv.updated_at,
    }));

    return c.json({ conversations });
  } catch (error: any) {
    console.error("Conversations list error:", error);
    return c.json({ error: error.message || "Internal server error" }, 500);
  }
});

chatRouter.post("/conversations", async (c) => {
  try {
    const tenantId = c.get("tenantId") as string;
    if (!tenantId) return c.json({ error: "Unauthorized" }, 401);

    const body = await c.req.json();
    const data = CreateConversationSchema.parse(body);

    const conversationId = generateId("conv");
    const now = Date.now();

    await c.env.DB.prepare(`
      INSERT INTO chat_conversations (id, tenant_id, channel, status, participants, title, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(conversationId, tenantId, data.channel, "open", JSON.stringify(data.participants), data.title || null, now, now).run();

    return c.json({ success: true, id: conversationId }, 201);
  } catch (error: any) {
    console.error("Create conversation error:", error);
    if (error instanceof z.ZodError) {
      return c.json({ error: "Validation failed", details: error.errors }, 400);
    }
    return c.json({ error: error.message || "Internal server error" }, 500);
  }
});

chatRouter.patch("/conversations/:id", async (c) => {
  try {
    const tenantId = c.get("tenantId") as string;
    if (!tenantId) return c.json({ error: "Unauthorized" }, 401);

    const id = c.req.param("id");
    const body = await c.req.json();

    const now = Date.now();
    const updates: string[] = [];
    const params: any[] = [];

    if (body.status !== undefined) {
      updates.push("status = ?");
      params.push(body.status);
    }
    if (body.title !== undefined) {
      updates.push("title = ?");
      params.push(body.title || null);
    }

    if (updates.length === 0) {
      return c.json({ error: "No fields to update" }, 400);
    }

    updates.push("updated_at = ?");
    params.push(now);
    params.push(id, tenantId);

    await c.env.DB.prepare(`
      UPDATE chat_conversations SET ${updates.join(", ")} WHERE id = ? AND tenant_id = ?
    `).bind(...params).run();

    return c.json({ success: true });
  } catch (error: any) {
    console.error("Update conversation error:", error);
    return c.json({ error: error.message || "Internal server error" }, 500);
  }
});

// ============================================================================
// Messages
// ============================================================================

chatRouter.get("/conversations/:id/messages", async (c) => {
  try {
    const tenantId = c.get("tenantId") as string;
    if (!tenantId) return c.json({ error: "Unauthorized" }, 401);

    const conversationId = c.req.param("id");
    const limit = parseInt(c.req.query("limit") || "100");
    const before = c.req.query("before"); // Timestamp for pagination

    let query = `SELECT * FROM chat_messages WHERE conversation_id = ?`;
    const params: any[] = [conversationId];

    if (before) {
      query += ` AND created_at < ?`;
      params.push(parseInt(before));
    }

    query += ` ORDER BY created_at DESC LIMIT ?`;
    params.push(limit);

    const result = await c.env.DB.prepare(query).bind(...params).all();

    const messages = (result.results as any[]).reverse().map((msg: any) => ({
      id: msg.id,
      conversation_id: msg.conversation_id,
      sender_id: msg.sender_id,
      body: msg.body,
      message_type: msg.message_type,
      read_by: msg.read_by ? JSON.parse(msg.read_by) : [],
      created_at: msg.created_at,
    }));

    return c.json({ messages });
  } catch (error: any) {
    console.error("Messages list error:", error);
    return c.json({ error: error.message || "Internal server error" }, 500);
  }
});

chatRouter.post("/conversations/:id/messages", async (c) => {
  try {
    const tenantId = c.get("tenantId") as string;
    if (!tenantId) return c.json({ error: "Unauthorized" }, 401);

    const conversationId = c.req.param("id");
    const body = await c.req.json();
    const data = MessageSchema.parse(body);

    const messageId = generateId("msg");
    const now = Date.now();
    const senderId = c.get("jwtPayload")?.userId || "system";

    await c.env.DB.prepare(`
      INSERT INTO chat_messages (id, conversation_id, sender_id, body, message_type, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).bind(messageId, conversationId, senderId, data.body, data.message_type, now).run();

    await c.env.DB.prepare(`
      UPDATE chat_conversations SET updated_at = ? WHERE id = ?
    `).bind(now, conversationId).run();

    return c.json({ success: true, id: messageId }, 201);
  } catch (error: any) {
    console.error("Create message error:", error);
    if (error instanceof z.ZodError) {
      return c.json({ error: "Validation failed", details: error.errors }, 400);
    }
    return c.json({ error: error.message || "Internal server error" }, 500);
  }
});

chatRouter.patch("/messages/:id/read", async (c) => {
  try {
    const tenantId = c.get("tenantId") as string;
    if (!tenantId) return c.json({ error: "Unauthorized" }, 401);

    const id = c.req.param("id");
    const body = await c.req.json();
    const readerId = body.reader_id || c.get("jwtPayload")?.userId;

    if (!readerId) {
      return c.json({ error: "reader_id required" }, 400);
    }

    const result = await c.env.DB.prepare(`
      SELECT read_by FROM chat_messages WHERE id = ?
    `).bind(id).first();

    if (!result) {
      return c.json({ error: "Message not found" }, 404);
    }

    const readBy = result.read_by ? JSON.parse(result.read_by as string) : [];
    if (!readBy.includes(readerId)) {
      readBy.push(readerId);
      await c.env.DB.prepare(`
        UPDATE chat_messages SET read_by = ? WHERE id = ?
      `).bind(JSON.stringify(readBy), id).run();
    }

    return c.json({ success: true });
  } catch (error: any) {
    console.error("Mark message read error:", error);
    return c.json({ error: error.message || "Internal server error" }, 500);
  }
});

chatRouter.get("/health", async (c) => {
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

export { chatRouter };