"use strict";

const { verifyTelegramInitData } = require("../lib/telegram-auth");

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

module.exports = async function accountHandler(req, res) {
  if (req.method !== "GET" && req.method !== "DELETE") {
    res.setHeader("Allow", "GET, DELETE");
    return reply(res, 405, { error: "method_not_allowed" });
  }

  const config = getConfig();
  if (!config) return reply(res, 503, { error: "account_service_not_configured" });

  const authorization = req.headers.authorization || "";
  if (!authorization.startsWith("tma ")) {
    return reply(res, 401, { error: "telegram_auth_required" });
  }

  const auth = verifyTelegramInitData(authorization.slice(4), config.botToken);
  if (!auth.ok) return reply(res, 401, { error: "invalid_telegram_auth" });

  const telegramId = String(auth.user.id);
  const root = config.supabaseUrl + "/rest/v1";
  const headers = {
    apikey: config.serviceKey,
    Authorization: "Bearer " + config.serviceKey,
    "Content-Type": "application/json"
  };

  try {
    if (req.method === "GET") {
      const profileQuery = new URLSearchParams({
        select: "display_name,email,interest,updated_at",
        telegram_id: "eq." + telegramId,
        limit: "1"
      });
      const memoryQuery = new URLSearchParams({
        select: "id,content,category,created_at",
        telegram_id: "eq." + telegramId,
        order: "created_at.desc"
      });
      const [profileResponse, memoryResponse] = await Promise.all([
        fetch(root + "/orvex_profiles?" + profileQuery.toString(), { headers }),
        fetch(root + "/orvex_memories?" + memoryQuery.toString(), { headers })
      ]);
      if (!profileResponse.ok || !memoryResponse.ok) {
        return reply(res, 502, { error: "account_export_unavailable" });
      }
      const [profiles, memories] = await Promise.all([
        profileResponse.json(),
        memoryResponse.json()
      ]);
      return reply(res, 200, {
        schemaVersion: 1,
        exportedAt: new Date().toISOString(),
        telegramUserId: telegramId,
        profile: profiles[0] || null,
        memories
      });
    }

    const response = await fetch(root + "/rpc/delete_orvex_account", {
      method: "POST",
      headers,
      body: JSON.stringify({ p_telegram_id: telegramId })
    });
    if (!response.ok) return reply(res, 502, { error: "account_deletion_unavailable" });
    return reply(res, 200, { deleted: true });
  } catch {
    return reply(res, 502, {
      error: req.method === "GET" ? "account_export_unavailable" : "account_deletion_unavailable"
    });
  }
};
