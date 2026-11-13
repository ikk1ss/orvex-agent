"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { createHmac } = require("node:crypto");
const handler = require("../api/balance");

const botToken = "987654:test-balance-token";
const now = Date.now();
const secret = createHmac("sha256", "WebAppData").update(botToken).digest();
const values = {
  auth_date: String(Math.floor(now / 1000)),
  query_id: "balance-test",
  user: JSON.stringify({ id: 7654321, first_name: "Balance" })
};
const dataCheckString = Object.entries(values)
  .sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
  .map(([key, value]) => key + "=" + value)
  .join("\n");
const hash = createHmac("sha256", secret).update(dataCheckString).digest("hex");
const initData = new URLSearchParams({ ...values, hash }).toString();

process.env.TELEGRAM_BOT_TOKEN = botToken;
process.env.SUPABASE_URL = "https://example.supabase.co";
process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role-key";

function makeResponse() {
  return {
    statusCode: 200,
    headers: {},
    payload: null,
    setHeader(name, value) { this.headers[name] = value; },
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.payload = payload; return this; }
  };
}

function makeRequest(method, options = {}) {
  return {
    method,
    headers: options.headers || { authorization: "tma " + initData },
    body: options.body,
    query: options.query || {}
  };
}


function mockFetch(handlers) {
  const original = global.fetch;
  const calls = [];
  global.fetch = async (url, init) => {
    const u = String(url);
    calls.push(u);
    for (const [prefix, fn] of handlers) if (u.startsWith(prefix)) return fn(u, init);
    throw new Error("unexpected fetch " + u);
  };
  return { calls, restore() { global.fetch = original; } };
}

const cbr = (value = 80, nominal = 1) => ({ ok: true, json: async () => ({ Date: "2026-11-13T11:30:00+03:00", Valute: { USD: { Value: value, Nominal: nominal } } }) });
const db = (rows) => ({ ok: true, json: async () => rows });

test("rejects balance access without Telegram authorization", async () => {
  const res = makeResponse();
  await handler(makeRequest("GET", { headers: {} }), res);
  assert.equal(res.statusCode, 401);
});

test("rejects non-GET methods", async () => {
  const res = makeResponse();
  await handler(makeRequest("POST"), res);
  assert.equal(res.statusCode, 405);
  assert.equal(res.headers.Allow, "GET");
});

test("returns rubles and dollars for the authenticated user only", async () => {
  handler._resetRateCache();
  const m = mockFetch([["https://example.supabase.co", () => db([{ balance_kopecks: 123450 }])], ["https://www.cbr-xml-daily.ru", () => cbr(80)]]);
  try {
    const res = makeResponse();
    await handler(makeRequest("GET"), res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.payload.balance.rub, 1234.5);
    assert.equal(res.payload.balance.usd, 15.43);
    assert.equal(res.payload.balance.rate.source, "cbr");
    assert.equal(res.payload.balance.rate.date, "2026-11-13");
    const q = new URL(m.calls.find((c) => c.includes("orvex_balances"))).searchParams;
    assert.equal(q.get("telegram_id"), "eq.7654321");
  } finally { m.restore(); }
});

test("a user without a balance row has zero", async () => {
  handler._resetRateCache();
  const m = mockFetch([["https://example.supabase.co", () => db([])], ["https://www.cbr-xml-daily.ru", () => cbr(90)]]);
  try {
    const res = makeResponse();
    await handler(makeRequest("GET"), res);
    assert.equal(res.payload.balance.rub, 0);
    assert.equal(res.payload.balance.usd, 0);
  } finally { m.restore(); }
});

test("rate nominal is respected", async () => {
  handler._resetRateCache();
  const m = mockFetch([["https://example.supabase.co", () => db([{ balance_kopecks: 10000 }])], ["https://www.cbr-xml-daily.ru", () => cbr(800, 10)]]);
  try {
    const res = makeResponse();
    await handler(makeRequest("GET"), res);
    assert.equal(res.payload.balance.usd, 1.25);
  } finally { m.restore(); }
});

test("dollar amount is null when the exchange rate is unavailable, rubles still returned", async () => {
  handler._resetRateCache();
  const m = mockFetch([["https://example.supabase.co", () => db([{ balance_kopecks: 5000 }])], ["https://www.cbr-xml-daily.ru", () => { throw new Error("down"); }]]);
  try {
    const res = makeResponse();
    await handler(makeRequest("GET"), res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.payload.balance.rub, 50);
    assert.equal(res.payload.balance.usd, null);
    assert.equal(res.payload.balance.rate, null);
  } finally { m.restore(); }
});

test("rejects corrupted balance values and storage failures", async () => {
  handler._resetRateCache();
  for (const rows of [[{ balance_kopecks: -5 }], [{ balance_kopecks: "abc" }], { oops: 1 }]) {
    const m = mockFetch([["https://example.supabase.co", () => db(rows)], ["https://www.cbr-xml-daily.ru", () => cbr(80)]]);
    try {
      const res = makeResponse();
      await handler(makeRequest("GET"), res);
      assert.equal(res.statusCode, 502);
    } finally { m.restore(); }
  }
  const m = mockFetch([["https://example.supabase.co", () => ({ ok: false })], ["https://www.cbr-xml-daily.ru", () => cbr(80)]]);
  try {
    const res = makeResponse();
    await handler(makeRequest("GET"), res);
    assert.equal(res.statusCode, 502);
    assert.ok(!JSON.stringify(res.payload).includes("test-service-role-key"));
  } finally { m.restore(); }
});
