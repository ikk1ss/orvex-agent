"use strict";

function getSupabaseHeaders(serviceKey) {
  const headers = { apikey: serviceKey };
  if (!serviceKey.startsWith("sb_secret_")) {
    headers.Authorization = "Bearer " + serviceKey;
  }
  return headers;
}

module.exports = async function healthHandler(req, res) {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ status: "method_not_allowed" });
  }

  let supabaseUrl = "";
  try {
    const parsed = new URL(process.env.SUPABASE_URL || "");
    if (parsed.protocol === "https:") supabaseUrl = parsed.origin;
  } catch {}

  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
  const telegramAuthConfigured = Boolean(process.env.TELEGRAM_BOT_TOKEN);
  const profileServiceConfigured = Boolean(telegramAuthConfigured && supabaseUrl && serviceKey);

  let profileStorageAccess = "setup_required";
  if (profileServiceConfigured) {
    try {
      const response = await fetch(supabaseUrl + "/rest/v1/", {
        headers: getSupabaseHeaders(serviceKey)
      });
      profileStorageAccess = response.ok ? "elevated" :
        (response.status === 401 || response.status === 403 ? "restricted" : "unverified");
    } catch {
      profileStorageAccess = "unverified";
    }
  }

  return res.status(200).json({
    status: "ok",
    telegramAuth: telegramAuthConfigured ? "configured" : "setup_required",
    profileService: profileServiceConfigured ? "configured" : "setup_required",
    profileStorageAccess
  });
};
