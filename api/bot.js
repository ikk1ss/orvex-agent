"use strict";

const { timingSafeEqual } = require("node:crypto");
const { buildPersonalizationContext } = require("../lib/personalization-context");

const MAX_HISTORY_MESSAGES = 12;
const MAX_STORED_MESSAGES = 100;
const ALLOWED_CATEGORIES = new Set(["preference", "fact", "goal", "instruction", "note"]);

function reply(res, status, payload) {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  return res.status(status).json(payload);
}

function getConfig() {
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const botSecret = process.env.ORVEX_BOT_API_SECRET;
  if (!supabaseUrl || !serviceKey || typeof botSecret !== "string" || botSecret.length < 32) {
    return null;
  }
  try {
    const parsed = new URL(supabaseUrl);
    if (parsed.protocol !== "https:" || parsed.username || parsed.password) return null;
    return { supabaseUrl: parsed.origin, serviceKey, botSecret };
  } catch {
    return null;
  }
}

function isAuthorized(req, expectedSecret) {
  const authorization = req.headers.authorization || "";
  if (!authorization.startsWith("Bearer ")) return false;
  const supplied = Buffer.from(authorization.slice(7));
  const expected = Buffer.from(expectedSecret);
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}

function getSupabaseHeaders(serviceKey, extra = {}) {
  const headers = {
    apikey: serviceKey,
    "Content-Type": "application/json",
    ...extra
  };
  if (!serviceKey.startsWith("sb_secret_")) {
    headers.Authorization = "Bearer " + serviceKey;
  }
  return headers;
}

function validTelegramId(value) {
  return typeof value === "string" && /^[1-9]\d{0,19}$/.test(value);
}

async function readRows(response) {
  if (!response.ok) throw new Error("storage_request_failed");
  const rows = await response.json();
  if (!Array.isArray(rows)) throw new Error("invalid_storage_response");
  return rows;
}

module.exports = async function botApiHandler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return reply(res, 405, { error: "method_not_allowed" });
  }

  const config = getConfig();
  if (!config) return reply(res, 503, { error: "bot_api_not_configured" });
  if (!isAuthorized(req, config.botSecret)) {
    return reply(res, 401, { error: "bot_auth_required" });
  }

  const body = req.body && typeof req.body === "object" && !Array.isArray(req.body) ? req.body : {};
  const action = typeof body.action === "string" ? body.action : "";
  const telegramId = typeof body.telegramId === "string" ? body.telegramId : String(body.telegramId || "");
  if (!validTelegramId(telegramId)) return reply(res, 400, { error: "invalid_telegram_id" });

  const root = config.supabaseUrl + "/rest/v1";
  const headers = getSupabaseHeaders(config.serviceKey);
  const requestOptions = { headers, signal: AbortSignal.timeout(8000) };

  try {
    if (action === "context") {
      const profileQuery = new URLSearchParams({
        select: "display_name,interest,preferences",
        telegram_id: "eq." + telegramId,
        limit: "1"
      });
      const memoryQuery = new URLSearchParams({
        select: "id,content,category,created_at",
        telegram_id: "eq." + telegramId,
        order: "created_at.desc,id.desc",
        limit: "50"
      });
      const historyQuery = new URLSearchParams({
        select: "role,content,created_at",
        telegram_id: "eq." + telegramId,
        order: "created_at.desc,id.desc",
        limit: String(MAX_HISTORY_MESSAGES)
      });
      const [profileResponse, memoryResponse, historyResponse] = await Promise.all([
        fetch(root + "/orvex_profiles?" + profileQuery.toString(), requestOptions),
        fetch(root + "/orvex_memories?" + memoryQuery.toString(), requestOptions),
        fetch(root + "/orvex_chat_messages?" + historyQuery.toString(), requestOptions)
      ]);
      const [profiles, memories, newestMessages] = await Promise.all([
        readRows(profileResponse), readRows(memoryResponse), readRows(historyResponse)
      ]);
      const userMessage = typeof body.userMessage === "string" ? body.userMessage.slice(0, 2000) : "";
      const personalization = buildPersonalizationContext({
        profile: profiles[0] || null,
        memories,
        userMessage
      });
      return reply(res, 200, {
        messages: newestMessages.reverse().map(item => ({
          role: item.role,
          content: item.content
        })),
        personalizationContext: personalization.contextText
      });
    }

    if (action === "append_exchange") {
      const userMessage = typeof body.userMessage === "string" ? body.userMessage.trim() : "";
      const assistantMessage = typeof body.assistantMessage === "string" ? body.assistantMessage.trim() : "";
      if (!userMessage || !assistantMessage || userMessage.length > 8000 || assistantMessage.length > 16000) {
        return reply(res, 400, { error: "invalid_exchange" });
      }
      const insertResponse = await fetch(root + "/orvex_chat_messages", {
        method: "POST",
        headers: getSupabaseHeaders(config.serviceKey, { Prefer: "return=minimal" }),
        body: JSON.stringify([
          { telegram_id: telegramId, role: "user", content: userMessage },
          { telegram_id: telegramId, role: "assistant", content: assistantMessage }
        ]),
        signal: AbortSignal.timeout(8000)
      });
      if (!insertResponse.ok) return reply(res, 502, { error: "conversation_storage_unavailable" });

      // Keep a bounded history. A cleanup failure does not invalidate the saved exchange.
      try {
        const keepQuery = new URLSearchParams({
          select: "id",
          telegram_id: "eq." + telegramId,
          order: "created_at.desc,id.desc",
          limit: String(MAX_STORED_MESSAGES)
        });
        const keepRows = await readRows(await fetch(root + "/orvex_chat_messages?" + keepQuery.toString(), requestOptions));
        if (keepRows.length === MAX_STORED_MESSAGES) {
          const keepIds = keepRows.map(row => row.id).filter(id =>
            typeof id === "string" && /^[0-9a-f-]{36}$/i.test(id)
          );
          if (keepIds.length === MAX_STORED_MESSAGES) {
            const pruneQuery = new URLSearchParams({
              telegram_id: "eq." + telegramId,
              id: "not.in.(" + keepIds.join(",") + ")"
            });
            const pruneResponse = await fetch(root + "/orvex_chat_messages?" + pruneQuery.toString(), {
              method: "DELETE",
              headers,
              signal: AbortSignal.timeout(8000)
            });
            if (!pruneResponse.ok) console.error("[ORVEX bot API] Conversation cleanup failed", pruneResponse.status);
          }
        }
      } catch (error) {
        console.error("[ORVEX bot API] Conversation cleanup failed", error && error.name ? error.name : "UnknownError");
      }
      return reply(res, 200, { saved: true });
    }

    if (action === "clear_conversation") {
      const query = new URLSearchParams({ telegram_id: "eq." + telegramId });
      const response = await fetch(root + "/orvex_chat_messages?" + query.toString(), {
        method: "DELETE",
        headers,
        signal: AbortSignal.timeout(8000)
      });
      if (!response.ok) return reply(res, 502, { error: "conversation_storage_unavailable" });
      return reply(res, 200, { cleared: true });
    }

    if (action === "save_memory") {
      const content = typeof body.content === "string" ? body.content.trim() : "";
      const category = typeof body.category === "string" ? body.category : "note";
      if (!content || content.length > 1000 || !ALLOWED_CATEGORIES.has(category)) {
        return reply(res, 400, { error: "invalid_memory" });
      }
      const response = await fetch(root + "/orvex_memories", {
        method: "POST",
        headers: getSupabaseHeaders(config.serviceKey, { Prefer: "return=representation" }),
        body: JSON.stringify({ telegram_id: telegramId, content, category }),
        signal: AbortSignal.timeout(8000)
      });
      if (!response.ok) return reply(res, 502, { error: "memory_storage_unavailable" });
      const rows = await readRows(response);
      return reply(res, 201, { memory: rows[0] || null });
    }

    return reply(res, 400, { error: "unknown_bot_action" });
  } catch (error) {
    console.error("[ORVEX bot API] Request failed", {
      action,
      errorName: error && typeof error.name === "string" ? error.name : "UnknownError"
    });
    return reply(res, 502, {
      error: action === "context" ? "bot_context_unavailable" : "bot_storage_unavailable"
    });
  }
};
