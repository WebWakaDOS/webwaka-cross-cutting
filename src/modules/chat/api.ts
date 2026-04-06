/**
 * XCT-4: Internal Chat & Live Chat Widget
 * Blueprint: Part 10.12 — Communication
 * Tasks: CC-CHAT-001 (File Sharing), CC-CHAT-002 (Rich Media Support)
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
  body: z.string().max(10000).default(""),
  message_type: z.enum(["text", "image", "video", "audio", "file", "system"]).default("text"),
  file_id: z.string().optional(),
  metadata: z.record(z.any()).optional(),
});

// CC-CHAT-001: File upload registration
const FileRegisterSchema = z.object({
  conversation_id: z.string(),
  filename: z.string().min(1).max(500),
  original_name: z.string().min(1).max(500),
  mimetype: z.string().min(1).max(200),
  size_bytes: z.number().int().min(0),
  storage_url: z.string().url(),
  thumbnail_url: z.string().url().optional(),
  width: z.number().int().optional(),
  height: z.number().int().optional(),
  duration_seconds: z.number().int().optional(),
});

// ============================================================================
// Helper Functions
// ============================================================================

function generateId(prefix: string): string {
  const bytes = new Uint8Array(6);
  crypto.getRandomValues(bytes);
  const suffix = Array.from(bytes)
    .map(b => b.toString(16).padStart(2, "0"))
    .join("");
  return `${prefix}-${suffix}`;
}

// CC-CHAT-002: Detect media type from MIME type
function detectMediaType(mimetype: string): "image" | "video" | "audio" | "file" {
  const type = mimetype.toLowerCase();
  if (type.startsWith("image/")) return "image";
  if (type.startsWith("video/")) return "video";
  if (type.startsWith("audio/")) return "audio";
  return "file";
}

// CC-CHAT-002: Determine inline render capability
function getRichMediaMeta(mimetype: string): {
  can_inline: boolean;
  render_tag: string | null;
  display_hint: string;
} {
  const type = mimetype.toLowerCase();

  if (type.startsWith("image/")) {
    const supported = ["image/jpeg", "image/png", "image/gif", "image/webp", "image/svg+xml"];
    return {
      can_inline: supported.includes(type),
      render_tag: "img",
      display_hint: "inline_image",
    };
  }

  if (type.startsWith("video/")) {
    const supported = ["video/mp4", "video/webm", "video/ogg"];
    return {
      can_inline: supported.includes(type),
      render_tag: "video",
      display_hint: "inline_video",
    };
  }

  if (type.startsWith("audio/")) {
    return { can_inline: true, render_tag: "audio", display_hint: "inline_audio" };
  }

  if (type === "application/pdf") {
    return { can_inline: false, render_tag: null, display_hint: "download_pdf" };
  }

  return { can_inline: false, render_tag: null, display_hint: "download_file" };
}

// CC-CHAT-001: Verify that a user is a participant in a conversation
async function isParticipant(
  db: D1Database,
  conversationId: string,
  tenantId: string,
  userId: string
): Promise<boolean> {
  const conv = await db.prepare(
    `SELECT participants FROM chat_conversations WHERE id = ? AND tenant_id = ?`
  ).bind(conversationId, tenantId).first() as any;

  if (!conv) return false;

  const participants: string[] = JSON.parse(conv.participants || "[]");
  return participants.includes(userId) || userId === "system";
}

// ============================================================================
// Router
// ============================================================================

const chatRouter = new Hono<{ Bindings: Env; Variables: Variables }>();

chatRouter.get("/", (c) =>
  c.json({
    module: "chat",
    version: "2.0.0",
    epic: "XCT-4",
    status: "operational",
    tasks: ["CC-CHAT-001", "CC-CHAT-002"],
    description: "Internal chat with file sharing and rich media support",
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

    if (channel) { query += ` AND channel = ?`; params.push(channel); }
    if (status) { query += ` AND status = ?`; params.push(status); }

    query += ` ORDER BY updated_at DESC LIMIT ?`;
    params.push(limit);

    const result = await c.env.DB.prepare(query).bind(...params).all();

    const conversations = (result.results as any[]).map((conv: any) => ({
      id: conv.id, channel: conv.channel, status: conv.status,
      participants: conv.participants ? JSON.parse(conv.participants) : [],
      title: conv.title, created_at: conv.created_at, updated_at: conv.updated_at,
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
    `).bind(
      conversationId, tenantId, data.channel, "open",
      JSON.stringify(data.participants), (data as any).title || null, now, now
    ).run();

    return c.json({ success: true, id: conversationId }, 201);
  } catch (error: any) {
    console.error("Create conversation error:", error);
    if (error instanceof z.ZodError) return c.json({ error: "Validation failed", details: error.errors }, 400);
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

    if (body.status !== undefined) { updates.push("status = ?"); params.push(body.status); }
    if (body.title !== undefined) { updates.push("title = ?"); params.push(body.title || null); }

    if (updates.length === 0) return c.json({ error: "No fields to update" }, 400);

    updates.push("updated_at = ?");
    params.push(now, id, tenantId);

    await c.env.DB.prepare(
      `UPDATE chat_conversations SET ${updates.join(", ")} WHERE id = ? AND tenant_id = ?`
    ).bind(...params).run();

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
    const before = c.req.query("before");

    let query = `
      SELECT m.*, f.filename, f.original_name, f.mimetype, f.size_bytes,
             f.storage_url, f.thumbnail_url, f.media_type as file_media_type,
             f.width, f.height, f.duration_seconds
      FROM chat_messages m
      LEFT JOIN chat_files f ON m.file_id = f.id
      WHERE m.conversation_id = ?
    `;
    const params: any[] = [conversationId];

    if (before) { query += ` AND m.created_at < ?`; params.push(parseInt(before)); }
    query += ` ORDER BY m.created_at DESC LIMIT ?`;
    params.push(limit);

    const result = await c.env.DB.prepare(query).bind(...params).all();

    const messages = (result.results as any[]).reverse().map((msg: any) => {
      const base = {
        id: msg.id, conversation_id: msg.conversation_id,
        sender_id: msg.sender_id, body: msg.body,
        message_type: msg.message_type,
        read_by: msg.read_by ? JSON.parse(msg.read_by) : [],
        metadata: msg.metadata ? JSON.parse(msg.metadata) : null,
        created_at: msg.created_at,
      };

      // CC-CHAT-001 + CC-CHAT-002: Attach file & rich media data if present
      if (msg.file_id) {
        const richMeta = getRichMediaMeta(msg.mimetype || "application/octet-stream");
        return {
          ...base,
          file: {
            id: msg.file_id,
            filename: msg.filename,
            original_name: msg.original_name,
            mimetype: msg.mimetype,
            size_bytes: msg.size_bytes,
            storage_url: msg.storage_url,
            thumbnail_url: msg.thumbnail_url,
            media_type: msg.file_media_type,
            width: msg.width, height: msg.height,
            duration_seconds: msg.duration_seconds,
            // CC-CHAT-002: Rich media rendering hints for client
            rich_media: richMeta,
          },
        };
      }

      return base;
    });

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
    const senderId = (c.get("jwtPayload") as any)?.userId || "system";

    // CC-CHAT-001: Determine message_type from file if file_id provided
    let messageType = data.message_type;
    let fileId = data.file_id || null;

    if (fileId) {
      const file = await c.env.DB.prepare(
        `SELECT * FROM chat_files WHERE id = ? AND conversation_id = ? AND tenant_id = ?`
      ).bind(fileId, conversationId, tenantId).first() as any;

      if (!file) return c.json({ error: "File not found or not accessible" }, 404);
      messageType = file.media_type as any;
    }

    await c.env.DB.prepare(`
      INSERT INTO chat_messages (id, conversation_id, sender_id, body, message_type, file_id, metadata, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      messageId, conversationId, senderId, data.body || "",
      messageType, fileId,
      data.metadata ? JSON.stringify(data.metadata) : null, now
    ).run();

    await c.env.DB.prepare(
      `UPDATE chat_conversations SET updated_at = ? WHERE id = ?`
    ).bind(now, conversationId).run();

    return c.json({ success: true, id: messageId, message_type: messageType }, 201);
  } catch (error: any) {
    console.error("Create message error:", error);
    if (error instanceof z.ZodError) return c.json({ error: "Validation failed", details: error.errors }, 400);
    return c.json({ error: error.message || "Internal server error" }, 500);
  }
});

chatRouter.patch("/messages/:id/read", async (c) => {
  try {
    const tenantId = c.get("tenantId") as string;
    if (!tenantId) return c.json({ error: "Unauthorized" }, 401);

    const id = c.req.param("id");
    const body = await c.req.json();
    const readerId = body.reader_id || (c.get("jwtPayload") as any)?.userId;

    if (!readerId) return c.json({ error: "reader_id required" }, 400);

    const result = await c.env.DB.prepare(
      `SELECT read_by FROM chat_messages WHERE id = ?`
    ).bind(id).first();

    if (!result) return c.json({ error: "Message not found" }, 404);

    const readBy = result.read_by ? JSON.parse(result.read_by as string) : [];
    if (!readBy.includes(readerId)) {
      readBy.push(readerId);
      await c.env.DB.prepare(
        `UPDATE chat_messages SET read_by = ? WHERE id = ?`
      ).bind(JSON.stringify(readBy), id).run();
    }

    return c.json({ success: true });
  } catch (error: any) {
    console.error("Mark message read error:", error);
    return c.json({ error: error.message || "Internal server error" }, 500);
  }
});

// ============================================================================
// CC-CHAT-001: File Management
// ============================================================================

// Register a file that has already been uploaded to R2/CDN
chatRouter.post("/files/register", async (c) => {
  try {
    const tenantId = c.get("tenantId") as string;
    if (!tenantId) return c.json({ error: "Unauthorized" }, 401);

    const body = await c.req.json();
    const data = FileRegisterSchema.parse(body);

    const uploadedBy = (c.get("jwtPayload") as any)?.userId || "system";
    const mediaType = detectMediaType(data.mimetype);
    const fileId = generateId("file");
    const now = Date.now();

    await c.env.DB.prepare(`
      INSERT INTO chat_files (id, tenant_id, conversation_id, uploaded_by, filename, original_name, mimetype, size_bytes, storage_url, thumbnail_url, media_type, width, height, duration_seconds, is_accessible, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)
    `).bind(
      fileId, tenantId, data.conversation_id, uploadedBy,
      data.filename, data.original_name, data.mimetype, data.size_bytes,
      data.storage_url, data.thumbnail_url || null, mediaType,
      data.width || null, data.height || null, data.duration_seconds || null, now
    ).run();

    // CC-CHAT-002: Compute rich media rendering info
    const richMeta = getRichMediaMeta(data.mimetype);

    return c.json({
      success: true,
      id: fileId,
      media_type: mediaType,
      rich_media: richMeta,
    }, 201);
  } catch (error: any) {
    console.error("Register file error:", error);
    if (error instanceof z.ZodError) return c.json({ error: "Validation failed", details: error.errors }, 400);
    return c.json({ error: error.message || "Internal server error" }, 500);
  }
});

// Get all files in a conversation (CC-CHAT-001: participants-only access)
chatRouter.get("/conversations/:id/files", async (c) => {
  try {
    const tenantId = c.get("tenantId") as string;
    if (!tenantId) return c.json({ error: "Unauthorized" }, 401);

    const conversationId = c.req.param("id");
    const userId = (c.get("jwtPayload") as any)?.userId || "system";
    const media_type = c.req.query("media_type");

    // CC-CHAT-001: Verify participant access
    const hasAccess = await isParticipant(c.env.DB, conversationId, tenantId, userId);
    if (!hasAccess) return c.json({ error: "Not a participant in this conversation" }, 403);

    let query = `SELECT * FROM chat_files WHERE conversation_id = ? AND tenant_id = ? AND is_accessible = 1`;
    const params: any[] = [conversationId, tenantId];

    if (media_type) { query += ` AND media_type = ?`; params.push(media_type); }
    query += ` ORDER BY created_at DESC`;

    const result = await c.env.DB.prepare(query).bind(...params).all();

    const files = (result.results as any[]).map((f: any) => {
      const richMeta = getRichMediaMeta(f.mimetype);
      return {
        id: f.id, filename: f.filename, original_name: f.original_name,
        mimetype: f.mimetype, size_bytes: f.size_bytes, storage_url: f.storage_url,
        thumbnail_url: f.thumbnail_url, media_type: f.media_type,
        width: f.width, height: f.height, duration_seconds: f.duration_seconds,
        uploaded_by: f.uploaded_by, created_at: f.created_at,
        rich_media: richMeta,
      };
    });

    return c.json({ files, total: files.length });
  } catch (error: any) {
    console.error("Get conversation files error:", error);
    return c.json({ error: error.message || "Internal server error" }, 500);
  }
});

// Get file metadata by ID (with participant check)
chatRouter.get("/files/:id", async (c) => {
  try {
    const tenantId = c.get("tenantId") as string;
    if (!tenantId) return c.json({ error: "Unauthorized" }, 401);

    const fileId = c.req.param("id");
    const userId = (c.get("jwtPayload") as any)?.userId || "system";

    const file = await c.env.DB.prepare(
      `SELECT * FROM chat_files WHERE id = ? AND tenant_id = ? AND is_accessible = 1`
    ).bind(fileId, tenantId).first() as any;

    if (!file) return c.json({ error: "File not found" }, 404);

    // CC-CHAT-001: Verify participant access
    const hasAccess = await isParticipant(c.env.DB, file.conversation_id, tenantId, userId);
    if (!hasAccess) return c.json({ error: "Access denied" }, 403);

    const richMeta = getRichMediaMeta(file.mimetype);

    return c.json({
      id: file.id, conversation_id: file.conversation_id,
      filename: file.filename, original_name: file.original_name,
      mimetype: file.mimetype, size_bytes: file.size_bytes,
      storage_url: file.storage_url, thumbnail_url: file.thumbnail_url,
      media_type: file.media_type, width: file.width, height: file.height,
      duration_seconds: file.duration_seconds, uploaded_by: file.uploaded_by,
      created_at: file.created_at,
      rich_media: richMeta,
    });
  } catch (error: any) {
    console.error("Get file error:", error);
    return c.json({ error: error.message || "Internal server error" }, 500);
  }
});

// Soft-delete a file (revoke access)
chatRouter.delete("/files/:id", async (c) => {
  try {
    const tenantId = c.get("tenantId") as string;
    if (!tenantId) return c.json({ error: "Unauthorized" }, 401);

    const fileId = c.req.param("id");
    const userId = (c.get("jwtPayload") as any)?.userId || "system";

    const file = await c.env.DB.prepare(
      `SELECT * FROM chat_files WHERE id = ? AND tenant_id = ?`
    ).bind(fileId, tenantId).first() as any;

    if (!file) return c.json({ error: "File not found" }, 404);
    if (file.uploaded_by !== userId && userId !== "system") {
      return c.json({ error: "Only the uploader can delete this file" }, 403);
    }

    await c.env.DB.prepare(
      `UPDATE chat_files SET is_accessible = 0 WHERE id = ? AND tenant_id = ?`
    ).bind(fileId, tenantId).run();

    return c.json({ success: true });
  } catch (error: any) {
    console.error("Delete file error:", error);
    return c.json({ error: error.message || "Internal server error" }, 500);
  }
});

// CC-CHAT-002: Rich media info endpoint — useful for clients to check rendering capability
chatRouter.get("/media-info", (c) => {
  return c.json({
    supported_image_types: ["image/jpeg", "image/png", "image/gif", "image/webp", "image/svg+xml"],
    supported_video_types: ["video/mp4", "video/webm", "video/ogg"],
    supported_audio_types: ["audio/mpeg", "audio/ogg", "audio/wav"],
    inline_renderable: ["image/*", "video/mp4", "video/webm", "audio/*"],
    max_file_size_bytes: 104857600,  // 100 MB
    thumbnail_supported: true,
    accessibility_features: ["alt_text", "video_caption", "aria_label"],
  });
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
    tasks_implemented: ["CC-CHAT-001", "CC-CHAT-002"],
    timestamp: Date.now(),
  });
});

export { chatRouter };
