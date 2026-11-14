"use strict";

const DAILY_GUEST_LIMIT = 20;

function reply(res, status, payload) {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  return res.status(status).json(payload);
}

function getConfig() {
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const publishableKey = process.env.SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_ANON_KEY;
  if (!supabaseUrl || !serviceKey || !publishableKey) return null;
  try {
    const parsed = new URL(supabaseUrl);
    if (parsed.protocol !== "https:" || parsed.username || parsed.password) return null;
    return { supabaseUrl: parsed.origin, serviceKey, publishableKey };
  } catch {
    return null;
  }
}

function serviceHeaders(serviceKey) {
  const headers = { apikey: serviceKey, "Content-Type": "application/json" };
  if (!serviceKey.startsWith("sb_secret_")) headers.Authorization = "Bearer " + serviceKey;
  return headers;
}

module.exports = async function guestQuotaHandler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return reply(res, 405, { error: "method_not_allowed" });
  }

  const config = getConfig();
  if (!config) return reply(res, 503, { error: "auth_service_not_configured" });

  const authorization = req.headers.authorization || "";
  if (!authorization.startsWith("Bearer ")) return reply(res, 401, { error: "authentication_required" });
  const token = authorization.slice(7).trim();
  if (!token || token.length > 8192) return reply(res, 401, { error: "authentication_required" });

  try {
    const userResponse = await fetch(config.supabaseUrl + "/auth/v1/user", {
      headers: { apikey: config.publishableKey, Authorization: "Bearer " + token },
      signal: AbortSignal.timeout(8000)
    });
    if (!userResponse.ok) return reply(res, 401, { error: "invalid_session" });
    const user = await userResponse.json();
    if (!user || user.is_anonymous !== true || typeof user.id !== "string" ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(user.id)) {
      return reply(res, 403, { error: "guest_session_required" });
    }

    const quotaResponse = await fetch(config.supabaseUrl + "/rest/v1/rpc/orvex_guest_quota", {
      method: "POST",
      headers: serviceHeaders(config.serviceKey),
      body: JSON.stringify({ p_user_id: user.id, p_consume: false }),
      signal: AbortSignal.timeout(8000)
    });
    if (!quotaResponse.ok) return reply(res, 503, { error: "guest_quota_unavailable" });
    const rows = await quotaResponse.json();
    if (!Array.isArray(rows) || !rows[0] ||
        typeof rows[0].allowed !== "boolean" ||
        !Number.isInteger(rows[0].used) || rows[0].used < 0 || rows[0].used > DAILY_GUEST_LIMIT ||
        !Number.isInteger(rows[0].remaining) || rows[0].remaining < 0 || rows[0].remaining > DAILY_GUEST_LIMIT ||
        rows[0].used + rows[0].remaining !== DAILY_GUEST_LIMIT ||
        rows[0].allowed !== (rows[0].remaining > 0) ||
        typeof rows[0].resets_at !== "string" || !Number.isFinite(Date.parse(rows[0].resets_at))) {
      return reply(res, 502, { error: "guest_quota_invalid" });
    }
    return reply(res, 200, {
      quota: {
        used: rows[0].used,
        remaining: rows[0].remaining,
        dailyLimit: DAILY_GUEST_LIMIT,
        resetsAt: rows[0].resets_at
      }
    });
  } catch {
    return reply(res, 502, { error: "guest_quota_unavailable" });
  }
};
