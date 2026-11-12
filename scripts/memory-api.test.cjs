"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { createHmac } = require("node:crypto");
const handler = require("../api/memory");

const botToken = "987654:test-memory-token";
const now = Date.now();
const secret = createHmac("sha256", "WebAppData").update(botToken).digest();
const values = {
  auth_date: String(Math.floor(now / 1000)),
  query_id: "memory-test",
  user: JSON.stringify({ id: 7654321, first_name: "Memory" })
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

test("rejects memory access without Telegram authorization", async () => {
  const res = makeResponse();
  await handler(makeRequest("GET", { headers: {} }), res);
  assert.equal(res.statusCode, 401);
  assert.equal(res.payload.error, "telegram_auth_required");
});

test("lists only the authenticated Telegram user's memories", async () => {
  const originalFetch = global.fetch;
  let requestedUrl = "";
  global.fetch = async (url) => {
    requestedUrl = String(url);
    return { ok: true, json: async () => [{ id: "memory-1", content: "pref" }] };
  };
  try {
    const res = makeResponse();
    await handler(makeRequest("GET"), res);
    const query = new URL(requestedUrl).searchParams;
    assert.equal(res.statusCode, 200);
    assert.equal(query.get("telegram_id"), "eq.7654321");
    assert.equal(query.get("limit"), "51");
    assert.equal(query.get("offset"), "0");
    assert.equal(query.get("order"), "created_at.desc,id.desc");
    assert.equal(res.payload.memories.length, 1);
    assert.equal(res.payload.pagination.hasMore, false);
  } finally {
    global.fetch = originalFetch;
  }
});

test("loads the requested memory page with a bounded offset", async () => {
  const originalFetch = global.fetch;
  let requestedUrl = "";
  global.fetch = async (url) => {
    requestedUrl = String(url);
    return { ok: true, json: async () => Array.from({ length: 51 }, (_, index) => ({ id: "memory-" + index })) };
  };
  try {
    const res = makeResponse();
    await handler(makeRequest("GET", { query: { offset: "50" } }), res);
    const query = new URL(requestedUrl).searchParams;
    assert.equal(res.statusCode, 200);
    assert.equal(query.get("offset"), "50");
    assert.equal(res.payload.memories.length, 50);
    assert.equal(res.payload.pagination.hasMore, true);
    assert.equal(res.payload.pagination.offset, 50);
  } finally {
    global.fetch = originalFetch;
  }
});

test("rejects invalid memory pagination offsets before database access", async () => {
  const originalFetch = global.fetch;
  global.fetch = async () => { throw new Error("fetch should not be called"); };
  try {
    for (const offset of ["-1", "01", "1.5", "1000001", "not-a-number"]) {
      const res = makeResponse();
      await handler(makeRequest("GET", { query: { offset } }), res);
      assert.equal(res.statusCode, 400);
      assert.equal(res.payload.error, "invalid_memory_offset");
    }
  } finally {
    global.fetch = originalFetch;
  }
});

test("rejects invalid memory content before database access", async () => {
  const originalFetch = global.fetch;
  global.fetch = async () => { throw new Error("fetch should not be called"); };
  try {
    const res = makeResponse();
    await handler(makeRequest("POST", { body: { content: " ", category: "unknown" } }), res);
    assert.equal(res.statusCode, 400);
    assert.equal(res.payload.error, "invalid_memory");
  } finally {
    global.fetch = originalFetch;
  }
});

test("stores a validated memory under the authenticated Telegram ID", async () => {
  const originalFetch = global.fetch;
  let requestOptions;
  global.fetch = async (_url, options) => {
    requestOptions = options;
    return { ok: true, json: async () => [{ id: "memory-2", content: "Remember this", category: "note" }] };
  };
  try {
    const res = makeResponse();
    await handler(makeRequest("POST", { body: { content: "Remember this", category: "note" } }), res);
    const body = JSON.parse(requestOptions.body);
    assert.equal(res.statusCode, 201);
    assert.equal(body.telegram_id, "7654321");
    assert.equal(body.content, "Remember this");
  } finally {
    global.fetch = originalFetch;
  }
});

test("deletes only a memory ID scoped to the authenticated Telegram ID", async () => {
  const originalFetch = global.fetch;
  let requestedUrl = "";
  global.fetch = async (url) => {
    requestedUrl = String(url);
    return { ok: true, json: async () => [{ id: "123e4567-e89b-12d3-a456-426614174000" }] };
  };
  try {
    const res = makeResponse();
    await handler(makeRequest("DELETE", {
      query: { id: "123e4567-e89b-12d3-a456-426614174000" }
    }), res);
    const query = new URL(requestedUrl).searchParams;
    assert.equal(res.statusCode, 200);
    assert.equal(query.get("telegram_id"), "eq.7654321");
    assert.equal(query.get("id"), "eq.123e4567-e89b-12d3-a456-426614174000");
    assert.equal(res.payload.deleted, true);
  } finally {
    global.fetch = originalFetch;
  }
});

test("rejects malformed memory IDs before database access", async () => {
  const originalFetch = global.fetch;
  global.fetch = async () => { throw new Error("fetch should not be called"); };
  try {
    const res = makeResponse();
    await handler(makeRequest("DELETE", { query: { id: "not-a-uuid" } }), res);
    assert.equal(res.statusCode, 400);
    assert.equal(res.payload.error, "invalid_memory_id");
  } finally {
    global.fetch = originalFetch;
  }
});

test("reports an absent memory without deleting another user's row", async () => {
  const originalFetch = global.fetch;
  let requestedUrl = "";
  global.fetch = async (url) => {
    requestedUrl = String(url);
    return { ok: true, json: async () => [] };
  };
  try {
    const res = makeResponse();
    await handler(makeRequest("DELETE", {
      query: { id: "123e4567-e89b-12d3-a456-426614174000" }
    }), res);
    const query = new URL(requestedUrl).searchParams;
    assert.equal(res.statusCode, 200);
    assert.equal(query.get("telegram_id"), "eq.7654321");
    assert.equal(res.payload.deleted, false);
  } finally {
    global.fetch = originalFetch;
  }
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
