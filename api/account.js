"use strict";

const { verifyTelegramInitData } = require("../lib/telegram-auth");

function reply(res, status, payload) {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  return res.status(status).json(payload);
}

function getSupabaseHeaders(serviceKey) {
  const headers = {
    apikey: serviceKey,
    "Content-Type": "application/json"
  };
  // Supabase sb_secret keys are opaque API keys, not JWTs. Do not send
  // them as Bearer tokens; the Supabase API gateway handles them via apikey.
  if (!serviceKey.startsWith("sb_secret_")) {
    headers.Authorization = "Bearer " + serviceKey;
  }
  return headers;
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
  const headers = getSupabaseHeaders(config.serviceKey);

  try {
    if (req.method === "GET") {
      const profileQuery = new URLSearchParams({
        select: "display_name,email,interest,preferences,updated_at",
        telegram_id: "eq." + telegramId,
        limit: "1"
      });
      const [profileResponse] = await Promise.all([
        fetch(root + "/orvex_profiles?" + profileQuery.toString(), { headers })
      ]);
      if (!profileResponse.ok) {
        return reply(res, 502, { error: "account_export_unavailable" });
      }

      const profiles = await profileResponse.json();
      const memories = [];
      const pageSize = 500;
      const maxMemories = 10000;

      // PostgREST may apply a default row limit. Fetch deterministic pages so
      // an export never silently omits older memory records.
      for (let offset = 0; offset <= maxMemories; offset += pageSize) {
        const memoryQuery = new URLSearchParams({
          select: "id,content,category,created_at",
          telegram_id: "eq." + telegramId,
          order: "created_at.desc,id.desc"
        });
        const memoryResponse = await fetch(root + "/orvex_memories?" + memoryQuery.toString(), {
          headers: {
            ...headers,
            "Range-Unit": "items",
            Range: offset + "-" + (offset + pageSize - 1)
          }
        });
        if (!memoryResponse.ok) {
          return reply(res, 502, { error: "account_export_unavailable" });
        }

        const page = await memoryResponse.json();
        if (!Array.isArray(page)) {
          return reply(res, 502, { error: "account_export_unavailable" });
        }
        if (offset === maxMemories && page.length > 0) {
          return reply(res, 413, { error: "account_export_too_large", maxMemories });
        }

        memories.push(...page);
        if (page.length < pageSize) break;
      }
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
