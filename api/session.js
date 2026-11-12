"use strict";

const { verifyTelegramInitData } = require("../lib/telegram-auth");

function reply(res, status, payload) {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  return res.status(status).json(payload);
}

module.exports = function sessionHandler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return reply(res, 405, { error: "method_not_allowed" });
  }

  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  if (!botToken) return reply(res, 503, { error: "telegram_auth_not_configured" });

  const authorization = req.headers.authorization || "";
  if (!authorization.startsWith("tma ")) {
    return reply(res, 401, { error: "telegram_auth_required" });
  }

  const auth = verifyTelegramInitData(authorization.slice(4), botToken);
  if (!auth.ok) return reply(res, 401, { error: "invalid_telegram_auth" });

  const user = {
    id: String(auth.user.id),
    firstName: typeof auth.user.first_name === "string" ? auth.user.first_name.slice(0, 64) : "",
    username: typeof auth.user.username === "string" ? auth.user.username.slice(0, 32) : "",
    photoUrl: typeof auth.user.photo_url === "string" && auth.user.photo_url.startsWith("https://") ? auth.user.photo_url.slice(0, 2048) : ""
  };
  return reply(res, 200, { authenticated: true, user });
};
