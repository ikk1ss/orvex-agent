"use strict";

function reply(res, status, payload) {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  return res.status(status).json(payload);
}

function validPublicUrl(value) {
  try {
    const parsed = new URL(value || "");
    return parsed.protocol === "https:" && !parsed.username && !parsed.password
      ? parsed.origin
      : null;
  } catch {
    return null;
  }
}

function validTelegramBotUrl(value) {
  if (!value) return "";
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== "https:" || parsed.hostname !== "t.me" ||
        parsed.username || parsed.password || parsed.search || parsed.hash) return "";
    return parsed.href.replace(/\/$/, "");
  } catch {
    return "";
  }
}

module.exports = function authConfigHandler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return reply(res, 405, { error: "method_not_allowed" });
  }

  const supabaseUrl = validPublicUrl(process.env.SUPABASE_URL);
  const publishableKey = process.env.SUPABASE_PUBLISHABLE_KEY ||
    process.env.SUPABASE_ANON_KEY || "";
  if (!supabaseUrl || typeof publishableKey !== "string" ||
      !/^(sb_publishable_[A-Za-z0-9_-]{20,}|eyJ[A-Za-z0-9._-]{20,})$/.test(publishableKey)) {
    return reply(res, 503, { error: "auth_service_not_configured" });
  }

  return reply(res, 200, {
    supabaseUrl,
    publishableKey,
    telegramBotUrl: validTelegramBotUrl(process.env.ORVEX_TELEGRAM_BOT_URL)
  });
};
