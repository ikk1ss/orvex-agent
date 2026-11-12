"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { createHmac } = require("node:crypto");
const handler = require("../api/account");

const botToken = "246810:test-account-token";
const now = Date.now();
const values = {
  auth_date: String(Math.floor(now / 1000)),
  query_id: "account-test",
  user: JSON.stringify({ id: 24681012, first_name: "Account" })
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
    body: options.body
  };
}

test("rejects account export without Telegram authorization", async () => {
  const res = makeResponse();
  await handler(makeRequest("GET", { headers: {} }), res);
  assert.equal(res.statusCode, 401);
  assert.equal(res.payload.error, "telegram_auth_required");
});

test("exports only the authenticated Telegram user's profile and memories", async () => {
  const originalFetch = global.fetch;
  const requestedUrls = [];
  global.fetch = async (url) => {
    requestedUrls.push(String(url));
    return {
      ok: true,
      json: async () => String(url).includes("orvex_profiles")
        ? [{ display_name: "Test", email: "", interest: "note" }]
        : [{ id: "memory-1", content: "A private note" }]
    };
  };
  try {
    const res = makeResponse();
    await handler(makeRequest("GET"), res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.payload.telegramUserId, "24681012");
    assert.equal(res.payload.profile.display_name, "Test");
    assert.equal(res.payload.memories.length, 1);
    assert.equal(requestedUrls.length, 2);
    for (const url of requestedUrls) {
      assert.equal(new URL(url).searchParams.get("telegram_id"), "eq.24681012");
    }
  } finally {
    global.fetch = originalFetch;
  }
});

test("paginates account memory export beyond the PostgREST default row limit", async () => {
  const originalFetch = global.fetch;
  const ranges = [];
  const exported = [];
  global.fetch = async (url, options = {}) => {
    const value = String(url);
    if (value.includes("orvex_profiles")) {
      return { ok: true, json: async () => [] };
    }
    const range = options.headers && options.headers.Range;
    ranges.push(range);
    const start = Number(range.split("-")[0]);
    const page = Array.from({ length: start === 1000 ? 17 : 500 }, (_, index) => ({
      id: "memory-" + (start + index),
      content: "Memory " + (start + index)
    }));
    exported.push(...page);
    return { ok: true, json: async () => page };
  };

  try {
    const res = makeResponse();
    await handler(makeRequest("GET"), res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.payload.memories.length, 1017);
    assert.deepEqual(ranges, ["0-499", "500-999", "1000-1499"]);
    assert.equal(exported.length, res.payload.memories.length);
  } finally {
    global.fetch = originalFetch;
  }
});

test("refuses to return a silently truncated export above the safety limit", async () => {
  const originalFetch = global.fetch;
  global.fetch = async (url) => ({
    ok: true,
    json: async () => String(url).includes("orvex_profiles")
      ? []
      : Array.from({ length: 500 }, (_, index) => ({ id: "memory-" + index }))
  });

  try {
    const res = makeResponse();
    await handler(makeRequest("GET"), res);
    assert.equal(res.statusCode, 413);
    assert.equal(res.payload.error, "account_export_too_large");
    assert.equal(res.payload.maxMemories, 10000);
  } finally {
    global.fetch = originalFetch;
  }
});

test("requires an explicit confirmation before deleting an account", async () => {
  const originalFetch = global.fetch;
  let called = false;
  global.fetch = async () => { called = true; throw new Error("must not delete"); };
  try {
    const res = makeResponse();
    await handler(makeRequest("DELETE"), res);
    assert.equal(res.statusCode, 400);
    assert.equal(res.payload.error, "account_deletion_confirmation_required");
    assert.equal(called, false);
  } finally {
    global.fetch = originalFetch;
  }
});

test("deletes the authenticated user's account through the atomic database function", async () => {
  const originalFetch = global.fetch;
  let requestUrl = "";
  let requestOptions;
  global.fetch = async (url, options) => {
    requestUrl = String(url);
    requestOptions = options;
    return { ok: true, text: async () => "" };
  };
  try {
    const res = makeResponse();
    await handler(makeRequest("DELETE", { body: { confirmation: "DELETE" } }), res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.payload.deleted, true);
    assert.equal(requestUrl, "https://example.supabase.co/rest/v1/rpc/delete_orvex_account");
    assert.equal(JSON.parse(requestOptions.body).p_telegram_id, "24681012");
    assert.equal(requestOptions.method, "POST");
  } finally {
    global.fetch = originalFetch;
  }
});

test("rejects unsupported account methods", async () => {
  const res = makeResponse();
  await handler(makeRequest("PUT"), res);
  assert.equal(res.statusCode, 405);
  assert.equal(res.headers.Allow, "GET, DELETE");
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
