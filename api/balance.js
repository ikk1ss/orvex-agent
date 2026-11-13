"use strict";

const { verifyTelegramInitData } = require("../lib/telegram-auth");

const RATE_URL = "https://www.cbr-xml-daily.ru/daily_json.js";
const RATE_TTL_MS = 60 * 60 * 1000;
const RATE_TIMEOUT_MS = 4000;

let rateCache = null; // { rubPerUsd, date, fetchedAt }

function reply(res, status, payload) {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  return res.status(status).json(payload);
}

function getSupabaseHeaders(serviceKey) {
  const headers = { apikey: serviceKey, "Content-Type": "application/json" };
  // sb_secret keys are opaque API keys, not JWTs: send them only as apikey.
  if (!serviceKey.startsWith("sb_secret_")) headers.Authorization = "Bearer " + serviceKey;
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

// Returns the Central Bank of Russia rate (RUB per 1 USD) or null.
// A stale cached value is preferred over no value when the CBR is unreachable.
async function getUsdRate() {
  const now = Date.now();
  if (rateCache && now - rateCache.fetchedAt < RATE_TTL_MS) return rateCache;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), RATE_TIMEOUT_MS);
    let response;
    try {
      response = await fetch(RATE_URL, { signal: controller.signal });
    } finally {
      clearTimeout(timer);
    }
    if (!response.ok) throw new Error("rate_unavailable");
    const data = await response.json();
    const usd = data && data.Valute && data.Valute.USD;
    const value = usd && Number(usd.Value) / Number(usd.Nominal || 1);
    if (!Number.isFinite(value) || value <= 0) throw new Error("rate_invalid");
    rateCache = {
      rubPerUsd: value,
      date: typeof data.Date === "string" ? data.Date.slice(0, 10) : null,
      fetchedAt: now
    };
    return rateCache;
  } catch {
    return rateCache;
  }
}

function resetRateCache() {
  rateCache = null;
}

function toBalance(kopecks, rate) {
  const rub = kopecks / 100;
  return {
    rub,
    usd: rate ? Math.round((kopecks / rate.rubPerUsd)) / 100 : null,
    rate: rate ? { rubPerUsd: Math.round(rate.rubPerUsd * 10000) / 10000, date: rate.date, source: "cbr" } : null
  };
}

async function balanceHandler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return reply(res, 405, { error: "method_not_allowed" });
  }

  const config = getConfig();
  if (!config) return reply(res, 503, { error: "balance_service_not_configured" });

  const authorization = req.headers.authorization || "";
  if (!authorization.startsWith("tma ")) return reply(res, 401, { error: "telegram_auth_required" });
  const auth = verifyTelegramInitData(authorization.slice(4), config.botToken);
  if (!auth.ok) return reply(res, 401, { error: "invalid_telegram_auth" });

  const query = new URLSearchParams({
    select: "balance_kopecks",
    telegram_id: "eq." + String(auth.user.id),
    limit: "1"
  });
  try {
    const [response, rate] = await Promise.all([
      fetch(config.supabaseUrl + "/rest/v1/orvex_balances?" + query.toString(), {
        headers: getSupabaseHeaders(config.serviceKey)
      }),
      getUsdRate()
    ]);
    if (!response.ok) return reply(res, 502, { error: "balance_storage_unavailable" });
    const rows = await response.json();
    if (!Array.isArray(rows)) return reply(res, 502, { error: "balance_storage_unavailable" });
    const raw = rows[0] ? Number(rows[0].balance_kopecks) : 0;
    if (!Number.isSafeInteger(raw) || raw < 0) return reply(res, 502, { error: "balance_storage_unavailable" });
    return reply(res, 200, { balance: toBalance(raw, rate) });
  } catch {
    return reply(res, 502, { error: "balance_storage_unavailable" });
  }
}

module.exports = balanceHandler;
module.exports._resetRateCache = resetRateCache;
