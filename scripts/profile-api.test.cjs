"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { createHmac } = require("node:crypto");
const handler = require("../api/profile");

const botToken = "246810:test-profile-token";
const values = {
  auth_date: String(Math.floor(Date.now() / 1000)),
  query_id: "profile-test",
  user: JSON.stringify({ id: 24681012, first_name: "Profile" })
};
const dataCheckString = Object.entries(values)
  .sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
  .map(([key, value]) => key + "=" + value)
  .join("\n");
const secret = createHmac("sha256", "WebAppData").update(botToken).digest();
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

test("rejects profile requests without Telegram authorization", async () => {
  const res = makeResponse();
  await handler(makeRequest("GET", { headers: {} }), res);
  assert.equal(res.statusCode, 401);
  assert.equal(res.payload.error, "telegram_auth_required");
});

test("loads only the authenticated Telegram user's profile", async () => {
  const originalFetch = global.fetch;
  let requestedUrl = "";
  global.fetch = async url => {
    requestedUrl = String(url);
    return { ok: true, json: async () => [{ display_name: "Test", email: "", interest: "Все возможности" }] };
  };
  try {
    const res = makeResponse();
    await handler(makeRequest("GET"), res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.payload.profile.display_name, "Test");
    assert.equal(new URL(requestedUrl).searchParams.get("telegram_id"), "eq.24681012");
  } finally {
    global.fetch = originalFetch;
  }
});

test("saves a validated profile under the authenticated Telegram ID", async () => {
  const originalFetch = global.fetch;
  let requestUrl = "";
  let requestOptions;
  global.fetch = async (url, options) => {
    requestUrl = String(url);
    requestOptions = options;
    return {
      ok: true,
      json: async () => [{
        display_name: "Test User",
        email: "test@example.com",
        interest: "Автоматизация задач"
      }]
    };
  };
  try {
    const res = makeResponse();
    await handler(makeRequest("PUT", {
      body: { name: " Test User ", email: "test@example.com", interest: "Автоматизация задач" }
    }), res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.payload.profile.name, "Test User");
    assert.equal(requestOptions.method, "POST");
    assert.equal(JSON.parse(requestOptions.body).telegram_id, "24681012");
    assert.equal(new URL(requestUrl).searchParams.get("on_conflict"), "telegram_id");
  } finally {
    global.fetch = originalFetch;
  }
});

test("rejects invalid profile values without writing to storage", async () => {
  const originalFetch = global.fetch;
  let called = false;
  global.fetch = async () => { called = true; throw new Error("must not write"); };
  try {
    const res = makeResponse();
    await handler(makeRequest("PUT", {
      body: { name: "", email: "not-an-email", interest: "unknown" }
    }), res);
    assert.equal(res.statusCode, 400);
    assert.equal(res.payload.error, "invalid_profile");
    assert.equal(called, false);
  } finally {
    global.fetch = originalFetch;
  }
});

test("rejects unsupported profile methods", async () => {
  const res = makeResponse();
  await handler(makeRequest("POST"), res);
  assert.equal(res.statusCode, 405);
  assert.equal(res.headers.Allow, "GET, PUT, DELETE");
});

test("uses sb_secret API keys only in the apikey header", async () => {
  const originalFetch = global.fetch;
  const originalKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  let requestOptions;
  process.env.SUPABASE_SERVICE_ROLE_KEY = "sb_secret_test-key";
  global.fetch = async (_url, options) => {
    requestOptions = options;
    return { ok: true, json: async () => [] };
  };
  try {
    const res = makeResponse();
    await handler(makeRequest("GET"), res);
    assert.equal(res.statusCode, 200);
    assert.equal(requestOptions.headers.apikey, "sb_secret_test-key");
    assert.equal("Authorization" in requestOptions.headers, false);
  } finally {
    process.env.SUPABASE_SERVICE_ROLE_KEY = originalKey;
    global.fetch = originalFetch;
  }
});


test("returns safe diagnostics when Supabase rejects a profile upsert", async () => {
  const originalFetch = global.fetch;
  global.fetch = async () => ({
    ok: false,
    status: 401,
    json: async () => ({ code: "PGRST301", message: "Sensitive response details are not returned" })
  });
  try {
    const res = makeResponse();
    await handler(makeRequest("PUT", {
      body: { name: "Test User", email: "", interest: "Все возможности" }
    }), res);
    assert.equal(res.statusCode, 502);
    assert.equal(res.payload.error, "profile_storage_unavailable");
    assert.equal(res.payload.stage, "profile_upsert");
    assert.equal(res.payload.storageStatus, 401);
    assert.equal(res.payload.storageCode, "PGRST301");
    assert.equal("message" in res.payload, false);
  } finally {
    global.fetch = originalFetch;
  }
});
