"use strict";

const DAILY_INTERESTS = new Set([
  "Личный ИИ-помощник",
  "Мультиагентная система",
  "Автоматизация задач",
  "Все возможности"
]);
const DEFAULT_PREFERENCES = {
  about: "", occupation: "", topics: "", language: "ru",
  responseLength: "balanced", tone: "neutral", format: "prose", instructions: ""
};
const ALLOWED = {
  language: new Set(["ru", "en", "de"]),
  responseLength: new Set(["short", "balanced", "detailed"]),
  tone: new Set(["neutral", "friendly", "formal"]),
  format: new Set(["prose", "steps", "bullets"])
};

function reply(res, status, payload) {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  return res.status(status).json(payload);
}
function normalizePreferences(value) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const text = (key, max) => typeof source[key] === "string" ? source[key].trim().slice(0, max) : DEFAULT_PREFERENCES[key];
  return {
    about: text("about", 500), occupation: text("occupation", 100), topics: text("topics", 500),
    language: ALLOWED.language.has(source.language) ? source.language : "ru",
    responseLength: ALLOWED.responseLength.has(source.responseLength) ? source.responseLength : "balanced",
    tone: ALLOWED.tone.has(source.tone) ? source.tone : "neutral",
    format: ALLOWED.format.has(source.format) ? source.format : "prose",
    instructions: text("instructions", 1000)
  };
}
function config() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const publishableKey = process.env.SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_ANON_KEY;
  if (!url || !key || !publishableKey) return null;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" || parsed.username || parsed.password) return null;
    return { url: parsed.origin, key, publishableKey };
  } catch { return null; }
}
function serviceHeaders(key, extra = {}) {
  const headers = { apikey: key, "Content-Type": "application/json", ...extra };
  if (!key.startsWith("sb_secret_")) headers.Authorization = "Bearer " + key;
  return headers;
}
async function authenticate(req, cfg) {
  const authorization = req.headers.authorization || "";
  if (!authorization.startsWith("Bearer ")) return null;
  const token = authorization.slice(7).trim();
  if (!token || token.length > 8192) return null;
  const response = await fetch(cfg.url + "/auth/v1/user", {
    headers: { apikey: cfg.publishableKey, Authorization: "Bearer " + token },
    signal: AbortSignal.timeout(8000)
  });
  if (!response.ok) return null;
  const user = await response.json();
  if (!user || typeof user.id !== "string" ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(user.id)) return null;
  return { id: user.id, isAnonymous: user.is_anonymous === true, email: typeof user.email === "string" ? user.email : "" };
}
async function readRows(url, headers) {
  const response = await fetch(url, { headers, signal: AbortSignal.timeout(8000) });
  if (!response.ok) throw new Error("storage_read_failed");
  return response.json();
}
module.exports = async function userDataHandler(req, res) {
  if (!["GET", "PUT"].includes(req.method)) {
    res.setHeader("Allow", "GET, PUT");
    return reply(res, 405, { error: "method_not_allowed" });
  }
  const cfg = config();
  if (!cfg) return reply(res, 503, { error: "user_data_service_not_configured" });
  try {
    const user = await authenticate(req, cfg);
    if (!user) return reply(res, 401, { error: "authentication_required" });
    const headers = serviceHeaders(cfg.key);
    const profileUrl = cfg.url + "/rest/v1/orvex_auth_profiles";
    const messagesUrl = cfg.url + "/rest/v1/orvex_auth_chat_messages";
    if (req.method === "GET") {
      const profileQuery = new URLSearchParams({
        select: "display_name,email,interest,preferences,updated_at",
        user_id: "eq." + user.id, limit: "1"
      });
      const messagesQuery = new URLSearchParams({
        select: "role,content,created_at",
        user_id: "eq." + user.id,
        order: "created_at.desc,id.desc",
        limit: "100"
      });
      const [profiles, messages] = await Promise.all([
        readRows(profileUrl + "?" + profileQuery, headers),
        readRows(messagesUrl + "?" + messagesQuery, headers)
      ]);
      const row = profiles[0] || null;
      return reply(res, 200, {
        profile: row ? {
          name: row.display_name, email: row.email || "", interest: row.interest,
          preferences: normalizePreferences(row.preferences), updatedAt: row.updated_at
        } : null,
        messages: Array.isArray(messages) ? messages.reverse() : [],
        accountType: user.isAnonymous ? "guest" : "google"
      });
    }
    const body = req.body && typeof req.body === "object" && !Array.isArray(req.body) ? req.body : {};
    const name = typeof body.name === "string" ? body.name.trim() : "";
    const email = typeof body.email === "string" ? body.email.trim() : "";
    const interest = typeof body.interest === "string" ? body.interest : "";
    if (!name || name.length > 60 || email.length > 120 ||
        (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) ||
        !DAILY_INTERESTS.has(interest)) return reply(res, 400, { error: "invalid_profile" });
    const query = new URLSearchParams({ on_conflict: "user_id" });
    const response = await fetch(profileUrl + "?" + query, {
      method: "POST",
      headers: serviceHeaders(cfg.key, { Prefer: "resolution=merge-duplicates,return=representation" }),
      body: JSON.stringify({
        user_id: user.id, display_name: name, email: user.email || email,
        interest, preferences: normalizePreferences(body.preferences), updated_at: new Date().toISOString()
      }),
      signal: AbortSignal.timeout(8000)
    });
    if (!response.ok) return reply(res, 502, { error: "profile_storage_unavailable" });
    const rows = await response.json();
    const row = rows[0];
    return reply(res, 200, { profile: row ? {
      name: row.display_name, email: row.email || "", interest: row.interest,
      preferences: normalizePreferences(row.preferences), updatedAt: row.updated_at
    } : { name, email: user.email || email, interest, preferences: normalizePreferences(body.preferences) } });
  } catch (error) {
    console.error("[ORVEX user data] Request failed", {
      errorName: error && typeof error.name === "string" ? error.name : "UnknownError"
    });
    return reply(res, 502, { error: "user_data_storage_unavailable" });
  }
};
