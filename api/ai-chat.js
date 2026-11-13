"use strict";

const { verifyTelegramInitData } = require("../lib/telegram-auth");

const DAILY_GUEST_LIMIT = 20;
const MAX_MESSAGE_LENGTH = 4000;
const MAX_HISTORY_MESSAGES = 12;
const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";

function reply(res, status, payload) {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  return res.status(status).json(payload);
}

function getConfig() {
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const publishableKey = process.env.SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_ANON_KEY;
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  const openRouterKey = process.env.OPENROUTER_API_KEY;
  if (!supabaseUrl || !serviceKey || !openRouterKey) return null;
  try {
    const parsed = new URL(supabaseUrl);
    if (parsed.protocol !== "https:" || parsed.username || parsed.password) return null;
    return { supabaseUrl: parsed.origin, serviceKey, publishableKey, botToken, openRouterKey };
  } catch {
    return null;
  }
}

function getSupabaseHeaders(serviceKey, extra = {}) {
  const headers = { apikey: serviceKey, "Content-Type": "application/json", ...extra };
  if (!serviceKey.startsWith("sb_secret_")) headers.Authorization = "Bearer " + serviceKey;
  return headers;
}

function normalizeMessages(value) {
  if (!Array.isArray(value) || value.length < 1 || value.length > MAX_HISTORY_MESSAGES) return null;
  const messages = [];
  for (const item of value) {
    if (!item || typeof item !== "object" || !["user", "assistant"].includes(item.role) ||
        typeof item.content !== "string") return null;
    const content = item.content.trim();
    if (!content || content.length > MAX_MESSAGE_LENGTH) return null;
    messages.push({ role: item.role, content });
  }
  if (messages[messages.length - 1].role !== "user") return null;
  return messages;
}

async function authenticate(req, config) {
  const authorization = req.headers.authorization || "";
  if (authorization.startsWith("tma ") && config.botToken) {
    const result = verifyTelegramInitData(authorization.slice(4), config.botToken);
    if (!result.ok) return null;
    return { kind: "telegram", telegramId: String(result.user.id) };
  }
  if (!authorization.startsWith("Bearer ") || !config.publishableKey) return null;
  const token = authorization.slice(7).trim();
  if (!token || token.length > 8192) return null;
  const response = await fetch(config.supabaseUrl + "/auth/v1/user", {
    headers: { apikey: config.publishableKey, Authorization: "Bearer " + token },
    signal: AbortSignal.timeout(8000)
  });
  if (!response.ok) return null;
  const user = await response.json();
  if (!user || typeof user.id !== "string" ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(user.id)) return null;
  return { kind: user.is_anonymous === true ? "guest" : "account", userId: user.id };
}

async function consumeGuestQuota(config, userId) {
  const response = await fetch(config.supabaseUrl + "/rest/v1/rpc/orvex_guest_quota", {
    method: "POST",
    headers: getSupabaseHeaders(config.serviceKey),
    body: JSON.stringify({ p_user_id: userId, p_consume: true }),
    signal: AbortSignal.timeout(8000)
  });
  if (!response.ok) throw new Error("guest_quota_unavailable");
  const rows = await response.json();
  if (!Array.isArray(rows) || !rows[0] ||
      typeof rows[0].allowed !== "boolean" ||
      !Number.isInteger(rows[0].used) ||
      !Number.isInteger(rows[0].remaining) ||
      typeof rows[0].resets_at !== "string") throw new Error("guest_quota_invalid");
  return {
    allowed: rows[0].allowed,
    used: rows[0].used,
    remaining: rows[0].remaining,
    dailyLimit: DAILY_GUEST_LIMIT,
    resetsAt: rows[0].resets_at
  };
}

module.exports = async function aiChatHandler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return reply(res, 405, { error: "method_not_allowed" });
  }

  const config = getConfig();
  if (!config) return reply(res, 503, { error: "ai_service_not_configured" });

  const body = req.body && typeof req.body === "object" && !Array.isArray(req.body) ? req.body : {};
  if (body.model !== "openrouter/free") {
    return reply(res, 403, { error: "model_not_allowed" });
  }
  const messages = normalizeMessages(body.messages);
  if (!messages) return reply(res, 400, { error: "invalid_messages" });

  try {
    const identity = await authenticate(req, config);
    if (!identity) return reply(res, 401, { error: "authentication_required" });

    let quota = null;
    if (identity.kind === "guest") {
      quota = await consumeGuestQuota(config, identity.userId);
      if (!quota.allowed) {
        return reply(res, 429, { error: "guest_daily_limit_reached", quota });
      }
    }

    const systemMessage = {
      role: "system",
      content: "You are ORVEX Agent, a helpful AI assistant. Reply in the user's language. Be accurate, concise and honest about uncertainty."
    };
    const response = await fetch(OPENROUTER_URL, {
      method: "POST",
      headers: {
        Authorization: "Bearer " + config.openRouterKey,
        "Content-Type": "application/json",
        "HTTP-Referer": "https://orvex-agent.vercel.app",
        "X-Title": "ORVEX Agent"
      },
      body: JSON.stringify({
        model: "openrouter/free",
        messages: [systemMessage, ...messages],
        max_tokens: 700,
        temperature: 0.7
      }),
      signal: AbortSignal.timeout(30000)
    });
    if (!response.ok) {
      return reply(res, response.status === 429 ? 503 : 502, {
        error: response.status === 429 ? "free_model_temporarily_limited" : "ai_provider_unavailable",
        quota
      });
    }
    const data = await response.json();
    const content = data && data.choices && data.choices[0] &&
      data.choices[0].message && data.choices[0].message.content;
    if (typeof content !== "string" || !content.trim()) {
      return reply(res, 502, { error: "ai_provider_empty_response", quota });
    }
    return reply(res, 200, {
      message: content.trim(),
      model: typeof data.model === "string" ? data.model : "openrouter/free",
      quota
    });
  } catch (error) {
    console.error("[ORVEX AI] Request failed", {
      errorName: error && typeof error.name === "string" ? error.name : "UnknownError"
    });
    return reply(res, 502, { error: error && error.message === "guest_quota_unavailable"
      ? "guest_quota_unavailable"
      : "ai_request_failed" });
  }
};
