"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const handler = require("../api/bot");

process.env.SUPABASE_URL = "https://example.supabase.co";
process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role-key";
process.env.ORVEX_BOT_API_SECRET = "a".repeat(48);

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

function makeRequest(body, options = {}) {
  return {
    method: options.method || "POST",
    headers: options.headers || { authorization: "Bearer " + process.env.ORVEX_BOT_API_SECRET },
    body
  };
}

test("requires the private bot API secret", async () => {
  const originalFetch = global.fetch;
  let called = false;
  global.fetch = async () => { called = true; throw new Error("must not call storage"); };
  try {
    const res = makeResponse();
    await handler(makeRequest({ action: "context", telegramId: "12345" }, { headers: {} }), res);
    assert.equal(res.statusCode, 401);
    assert.equal(res.payload.error, "bot_auth_required");
    assert.equal(called, false);
  } finally {
    global.fetch = originalFetch;
  }
});

test("loads only the requested Telegram user's profile, memories and recent messages", async () => {
  const originalFetch = global.fetch;
  const urls = [];
  global.fetch = async url => {
    const value = String(url);
    urls.push(value);
    const params = new URL(value).searchParams;
    assert.equal(params.get("telegram_id"), "eq.123456");
    if (value.includes("orvex_profiles")) {
      return { ok: true, json: async () => [{
        display_name: "Test User",
        interest: "Все возможности",
        preferences: { language: "ru", responseLength: "short" }
      }] };
    }
    if (value.includes("orvex_memories")) {
      return { ok: true, json: async () => [{
        id: "memory-1", content: "Пользователь изучает виртуальные миры",
        category: "fact", created_at: "2026-11-13T10:00:00.000Z"
      }] };
    }
    return { ok: true, json: async () => [
      { role: "assistant", content: "Предыдущий ответ" },
      { role: "user", content: "Предыдущий вопрос" }
    ] };
  };
  try {
    const res = makeResponse();
    await handler(makeRequest({
      action: "context",
      telegramId: "123456",
      userMessage: "Расскажи про виртуальные миры"
    }), res);
    assert.equal(res.statusCode, 200);
    assert.equal(urls.length, 3);
    assert.deepEqual(res.payload.messages, [
      { role: "user", content: "Предыдущий вопрос" },
      { role: "assistant", content: "Предыдущий ответ" }
    ]);
    assert.match(res.payload.personalizationContext, /Test User/);
    assert.match(res.payload.personalizationContext, /виртуальные миры/);
  } finally {
    global.fetch = originalFetch;
  }
});

test("saves an exchange and prunes messages older than the retention limit", async () => {
  const originalFetch = global.fetch;
  const calls = [];
  global.fetch = async (url, options = {}) => {
    calls.push({ url: String(url), options });
    if (options.method === "POST") return { ok: true };
    if (options.method === "DELETE") return { ok: true };
    return {
      ok: true,
      json: async () => Array.from({ length: 100 }, (_, index) => ({
        id: "00000000-0000-4000-8000-" + String(index).padStart(12, "0")
      }))
    };
  };
  try {
    const res = makeResponse();
    await handler(makeRequest({
      action: "append_exchange",
      telegramId: "123456",
      userMessage: "Привет",
      assistantMessage: "Здравствуйте"
    }), res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.payload.saved, true);
    assert.equal(calls[0].options.method, "POST");
    const inserted = JSON.parse(calls[0].options.body);
    assert.equal(inserted.length, 2);
    assert.equal(inserted[0].role, "user");
    assert.equal(inserted[1].role, "assistant");
    assert.ok(Date.parse(inserted[1].created_at) > Date.parse(inserted[0].created_at));
    assert.equal(calls[2].options.method, "DELETE");
    const prune = new URL(calls[2].url);
    assert.equal(prune.searchParams.get("telegram_id"), "eq.123456");
    assert.ok(prune.searchParams.get("id").startsWith("not.in.("));
  } finally {
    global.fetch = originalFetch;
  }
});

test("clears only the requested user's conversation", async () => {
  const originalFetch = global.fetch;
  let requestUrl = "";
  let requestOptions;
  global.fetch = async (url, options) => {
    requestUrl = String(url);
    requestOptions = options;
    return { ok: true };
  };
  try {
    const res = makeResponse();
    await handler(makeRequest({ action: "clear_conversation", telegramId: "123456" }), res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.payload.cleared, true);
    assert.equal(requestOptions.method, "DELETE");
    assert.equal(new URL(requestUrl).searchParams.get("telegram_id"), "eq.123456");
  } finally {
    global.fetch = originalFetch;
  }
});

test("saves an explicit memory note with its Telegram owner", async () => {
  const originalFetch = global.fetch;
  let inserted;
  global.fetch = async (_url, options) => {
    inserted = JSON.parse(options.body);
    return { ok: true, json: async () => [{ id: "memory-1", ...inserted }] };
  };
  try {
    const res = makeResponse();
    await handler(makeRequest({
      action: "save_memory",
      telegramId: "123456",
      content: "Пользователь предпочитает короткие ответы"
    }), res);
    assert.equal(res.statusCode, 201);
    assert.equal(inserted.telegram_id, "123456");
    assert.equal(inserted.category, "note");
  } finally {
    global.fetch = originalFetch;
  }
});

test("rejects invalid Telegram IDs and oversized messages before storage access", async () => {
  const originalFetch = global.fetch;
  let called = false;
  global.fetch = async () => { called = true; throw new Error("must not call storage"); };
  try {
    const badId = makeResponse();
    await handler(makeRequest({ action: "context", telegramId: "123;select" }), badId);
    assert.equal(badId.statusCode, 400);
    const oversized = makeResponse();
    await handler(makeRequest({
      action: "append_exchange",
      telegramId: "123456",
      userMessage: "x".repeat(8001),
      assistantMessage: "answer"
    }), oversized);
    assert.equal(oversized.statusCode, 400);
    assert.equal(called, false);
  } finally {
    global.fetch = originalFetch;
  }
});
