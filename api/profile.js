"use strict";

const { verifyTelegramInitData } = require("../lib/telegram-auth");

const ALLOWED_INTERESTS = new Set([
  "Личный ИИ-помощник",
  "Мультиагентная система",
  "Автоматизация задач",
  "Все возможности"
]);

function reply(res, status, payload) {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  return res.status(status).json(payload);
}

async function storageFailure(res, response, stage) {
  let storageCode = null;
  try {
    const payload = await response.json();
    if (payload && typeof payload.code === "string") {
      storageCode = payload.code.slice(0, 40);
    }
  } catch {}

  // Log only the failing stage, HTTP status and database error code.
  // Never log credentials, Telegram IDs, profile fields or response bodies.
  console.error("[ORVEX profile] Supabase request failed", {
    stage,
    status: response.status,
    code: storageCode
  });

  return reply(res, 502, {
    error: "profile_storage_unavailable",
    stage,
    storageStatus: response.status,
    storageCode
  });
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

module.exports = async function profileHandler(req, res) {
  if (req.method !== "GET" && req.method !== "PUT" && req.method !== "DELETE") {
    res.setHeader("Allow", "GET, PUT, DELETE");
    return reply(res, 405, { error: "method_not_allowed" });
  }

  const config = getConfig();
  if (!config) return reply(res, 503, { error: "profile_service_not_configured" });

  const authorization = req.headers.authorization || "";
  if (!authorization.startsWith("tma ")) {
    return reply(res, 401, { error: "telegram_auth_required" });
  }

  const auth = verifyTelegramInitData(authorization.slice(4), config.botToken);
  if (!auth.ok) return reply(res, 401, { error: "invalid_telegram_auth" });

  const telegramId = String(auth.user.id);
  const endpoint = config.supabaseUrl + "/rest/v1/orvex_profiles";
  const headers = getSupabaseHeaders(config.serviceKey);
  let stage = "profile_read";

  try {
    if (req.method === "GET") {
      const query = new URLSearchParams({
        select: "display_name,email,interest",
        telegram_id: "eq." + telegramId,
        limit: "1"
      });
      const response = await fetch(endpoint + "?" + query.toString(), { headers });
      if (!response.ok) return await storageFailure(res, response, stage);
      const rows = await response.json();
      return reply(res, 200, { profile: rows[0] || null });
    }

    if (req.method === "DELETE") {
      stage = "profile_delete";
      const query = new URLSearchParams({ telegram_id: "eq." + telegramId });
      const response = await fetch(endpoint + "?" + query.toString(), {
        method: "DELETE",
        headers: { ...headers, Prefer: "return=minimal" }
      });
      if (!response.ok) return await storageFailure(res, response, stage);
      return reply(res, 200, { deleted: true });
    }

    const body = req.body && typeof req.body === "object" ? req.body : {};
    const displayName = typeof body.name === "string" ? body.name.trim() : "";
    const email = typeof body.email === "string" ? body.email.trim() : "";
    const interest = typeof body.interest === "string" ? body.interest : "";

    if (!displayName || displayName.length > 60 || email.length > 120 ||
        (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) ||
        !ALLOWED_INTERESTS.has(interest)) {
      return reply(res, 400, { error: "invalid_profile" });
    }

    stage = "profile_upsert";
    const response = await fetch(endpoint + "?on_conflict=telegram_id", {
      method: "POST",
      headers: { ...headers, Prefer: "resolution=merge-duplicates,return=representation" },
      body: JSON.stringify({
        telegram_id: telegramId,
        display_name: displayName,
        email,
        interest,
        updated_at: new Date().toISOString()
      })
    });
    if (!response.ok) return await storageFailure(res, response, stage);
    const rows = await response.json();
    const row = rows[0];
    return reply(res, 200, {
      profile: row ? { name: row.display_name, email: row.email, interest: row.interest } : {
        name: displayName, email, interest
      }
    });
  } catch (error) {
    console.error("[ORVEX profile] Request failed", {
      stage,
      errorName: error && typeof error.name === "string" ? error.name : "UnknownError"
    });
    return reply(res, 502, { error: "profile_storage_unavailable", stage });
  }
};
