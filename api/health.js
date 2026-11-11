"use strict";

module.exports = function healthHandler(req, res) {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ status: "method_not_allowed" });
  }
  let validSupabaseUrl = false;
  try {
    validSupabaseUrl = new URL(process.env.SUPABASE_URL || "").protocol === "https:";
  } catch {}
  const telegramAuthConfigured = Boolean(process.env.TELEGRAM_BOT_TOKEN);
  const profileServiceConfigured = Boolean(
    telegramAuthConfigured && validSupabaseUrl && process.env.SUPABASE_SERVICE_ROLE_KEY
  );
  return res.status(200).json({
    status: "ok",
    telegramAuth: telegramAuthConfigured ? "configured" : "setup_required",
    profileService: profileServiceConfigured ? "configured" : "setup_required"
  });
};
