"use strict";

const { verifyTelegramInitData } = require("../lib/telegram-auth");

const ALLOWED_CATEGORIES = new Set(["preference", "fact", "goal", "instruction", "note"]);

function reply(res, status, payload) {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  return res.status(status).json(payload);
}

function getConfig() {
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  if (!botToken || !supabaseUrl || !serviceKey) return null;
  try {
    const parsed = new URL(supabaseUrl);
    if (parsed.protocol !== "https:") return null;
    return { supabaseUrl: parsed.origin, serviceKey, botToken };
  } catch {
    return null;
  }
}

module.exports = async function memoryHandler(req, res) {
  if (!["GET", "POST", "DELETE"].includes(req.method)) {
    res.setHeader("Allow", "GET, POST, DELETE");
    return reply(res, 405, { error: "method_not_allowed" });
  }

  const config = getConfig();
  if (!config) return reply(res, 503, { error: "memory_service_not_configured" });

  const authorization = req.headers.authorization || "";
  if (!authorization.startsWith("tma ")) {
    return reply(res, 401, { error: "telegram_auth_required" });
  }

  const auth = verifyTelegramInitData(authorization.slice(4), config.botToken);
  if (!auth.ok) return reply(res, 401, { error: "invalid_telegram_auth" });

  const telegramId = String(auth.user.id);
  const endpoint = config.supabaseUrl + "/rest/v1/orvex_memories";
  const headers = {
    apikey: config.serviceKey,
    Authorization: "Bearer " + config.serviceKey,
    "Content-Type": "application/json"
  };

  try {
    if (req.method === "GET") {
      const query = new URLSearchParams({
        select: "id,content,category,created_at",
        telegram_id: "eq." + telegramId,
        order: "created_at.desc",
        limit: "50"
      });
      const response = await fetch(endpoint + "?" + query.toString(), { headers });
      if (!response.ok) return reply(res, 502, { error: "memory_storage_unavailable" });
      return reply(res, 200, { memories: await response.json() });
    }

    if (req.method === "POST") {
      const body = req.body && typeof req.body === "object" ? req.body : {};
      const content = typeof body.content === "string" ? body.content.trim() : "";
      const category = typeof body.category === "string" ? body.category : "note";
      if (!content || content.length > 1000 || !ALLOWED_CATEGORIES.has(category)) {
        return reply(res, 400, { error: "invalid_memory" });
      }

      const response = await fetch(endpoint, {
        method: "POST",
        headers: { ...headers, Prefer: "return=representation" },
        body: JSON.stringify({ telegram_id: telegramId, content, category })
      });
      if (!response.ok) return reply(res, 502, { error: "memory_storage_unavailable" });
      const rows = await response.json();
      return reply(res, 201, { memory: rows[0] || null });
    }

    const memoryId = typeof req.query?.id === "string" ? req.query.id : "";
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(memoryId)) {
      return reply(res, 400, { error: "invalid_memory_id" });
    }
    const query = new URLSearchParams({
      id: "eq." + memoryId,
      telegram_id: "eq." + telegramId
    });
    const response = await fetch(endpoint + "?" + query.toString(), {
      method: "DELETE",
      headers: { ...headers, Prefer: "return=representation" }
    });
    if (!response.ok) return reply(res, 502, { error: "memory_storage_unavailable" });
    const rows = await response.json();
    return reply(res, 200, { deleted: rows.length > 0 });
  } catch {
    return reply(res, 502, { error: "memory_storage_unavailable" });
  }
};
