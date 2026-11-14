"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { createHmac } = require("node:crypto");
const handler = require("../api/ai-chat");

const botToken = "987654:test-orvex-ai-token";
const guestId = "123e4567-e89b-42d3-a456-426614174000";
const accessToken = "test-supabase-access-token";

function response() {
  return {
    statusCode: 200,
    headers: {},
    payload: null,
    setHeader(name, value) { this.headers[name] = value; },
    status(code) { this.statusCode = code; return this; },
    json(value) { this.payload = value; return this; }
  };
}

async function withEnv(run) {
  const names = ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "SUPABASE_PUBLISHABLE_KEY", "TELEGRAM_BOT_TOKEN", "OPENROUTER_API_KEY"];
  const previous = Object.fromEntries(names.map(name => [name, process.env[name]]));
  process.env.SUPABASE_URL = "https://example.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role-key";
  process.env.SUPABASE_PUBLISHABLE_KEY = "sb_publishable_test_key_12345678901234567890";
  process.env.TELEGRAM_BOT_TOKEN = botToken;
  process.env.OPENROUTER_API_KEY = "test-openrouter-key";
  try { return await run(); }
  finally {
    for (const name of names) {
      if (previous[name] === undefined) delete process.env[name];
      else process.env[name] = previous[name];
    }
  }
}

function mockFetch(routes) {
  const original = global.fetch;
  const calls = [];
  global.fetch = async (url, init = {}) => {
    calls.push({ url: String(url), init });
    const route = routes.find(item => String(url).startsWith(item[0]));
    if (!route) throw new Error("unexpected fetch " + url);
    return route[1](String(url), init);
  };
  return { calls, restore() { global.fetch = original; } };
}

function makeTelegramInitData() {
  const values = {
    auth_date: String(Math.floor(Date.now() / 1000)),
    query_id: "ai-chat-test",
    user: JSON.stringify({ id: 7654321, first_name: "Test" })
  };
  const checkString = Object.entries(values).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
    .map(([key, value]) => key + "=" + value).join("\n");
  const secret = createHmac("sha256", "WebAppData").update(botToken).digest();
  const hash = createHmac("sha256", secret).update(checkString).digest("hex");
  return new URLSearchParams({ ...values, hash }).toString();
}

const ok = value => ({ ok: true, status: 200, json: async () => value });
const messages = [{ role: "user", content: "Привет" }];

test("requires authentication", async () => {
  await withEnv(async () => {
    const res = response();
    await handler({ method: "POST", headers: {}, body: { model: "openrouter/free", messages } }, res);
    assert.equal(res.statusCode, 401);
  });
});

test("rejects paid or unrecognized models before provider access", async () => {
  await withEnv(async () => {
    const mock = mockFetch([]);
    try {
      const res = response();
      await handler({ method: "POST", headers: {}, body: { model: "openai/gpt-4o", messages } }, res);
      assert.equal(res.statusCode, 403);
      assert.equal(res.payload.error, "model_not_allowed");
      assert.equal(mock.calls.length, 0);
    } finally { mock.restore(); }
  });
});

test("guest requests use the free router and consume one daily request", async () => {
  await withEnv(async () => {
    const mock = mockFetch([
      ["https://example.supabase.co/auth/v1/user", () => ok({ id: guestId, is_anonymous: true })],
      ["https://example.supabase.co/rest/v1/rpc/orvex_guest_quota", (url, init) => {
        assert.deepEqual(JSON.parse(init.body), { p_user_id: guestId, p_consume: true });
        return ok([{ allowed: true, used: 1, remaining: 19, resets_at: "2026-11-15T00:00:00Z" }]);
      }],
      ["https://openrouter.ai/api/v1/chat/completions", (url, init) => {
        const body = JSON.parse(init.body);
        assert.equal(body.model, "openrouter/free");
        assert.equal(body.messages[0].role, "system");
        assert.equal(body.messages[1].content, "Привет");
        assert.equal(init.headers.Authorization, "Bearer test-openrouter-key");
        return ok({ model: "provider/model:free", choices: [{ message: { content: "Здравствуйте!" } }] });
      }],
      ["https://example.supabase.co/rest/v1/orvex_auth_chat_messages", (url, init) => {
        assert.equal(init.method, "POST");
        const rows = JSON.parse(init.body);
        assert.deepEqual(rows.map(row => row.role), ["user", "assistant"]);
        assert.equal(rows[0].user_id, guestId);
        assert.equal(rows[1].content, "Здравствуйте!");
        return { ok: true, status: 201, json: async () => [] };
      }]
    ]);
    try {
      const res = response();
      await handler({
        method: "POST",
        headers: { authorization: "Bearer " + accessToken },
        body: { model: "openrouter/free", messages }
      }, res);
      assert.equal(res.statusCode, 200);
      assert.equal(res.payload.message, "Здравствуйте!");
      assert.equal(res.payload.quota.remaining, 19);
      assert.equal(res.payload.historySaved, true);
      assert.equal(mock.calls.length, 4);
    } finally { mock.restore(); }
  });
});

test("blocks the 21st guest request without calling OpenRouter", async () => {
  await withEnv(async () => {
    const mock = mockFetch([
      ["https://example.supabase.co/auth/v1/user", () => ok({ id: guestId, is_anonymous: true })],
      ["https://example.supabase.co/rest/v1/rpc/orvex_guest_quota", () =>
        ok([{ allowed: false, used: 20, remaining: 0, resets_at: "2026-11-15T00:00:00Z" }])]
    ]);
    try {
      const res = response();
      await handler({
        method: "POST",
        headers: { authorization: "Bearer " + accessToken },
        body: { model: "openrouter/free", messages }
      }, res);
      assert.equal(res.statusCode, 429);
      assert.equal(res.payload.error, "guest_daily_limit_reached");
      assert.equal(res.payload.quota.remaining, 0);
      assert.equal(mock.calls.length, 2);
    } finally { mock.restore(); }
  });
});

test("Google-authenticated users can use the free router without the guest quota", async () => {
  await withEnv(async () => {
    const mock = mockFetch([
      ["https://example.supabase.co/auth/v1/user", () => ok({ id: guestId, is_anonymous: false })],
      ["https://openrouter.ai/api/v1/chat/completions", () =>
        ok({ model: "provider/model:free", choices: [{ message: { content: "Ответ" } }] })],
      ["https://example.supabase.co/rest/v1/orvex_auth_chat_messages", (url, init) => {
        assert.equal(JSON.parse(init.body)[0].user_id, guestId);
        return { ok: true, status: 201, json: async () => [] };
      }]
    ]);
    try {
      const res = response();
      await handler({
        method: "POST",
        headers: { authorization: "Bearer " + accessToken },
        body: { model: "openrouter/free", messages }
      }, res);
      assert.equal(res.statusCode, 200);
      assert.equal(res.payload.quota, null);
      assert.equal(res.payload.historySaved, true);
      assert.equal(mock.calls.length, 3);
    } finally { mock.restore(); }
  });
});

test("Telegram Mini App sessions do not require the browser publishable key", async () => {
  await withEnv(async () => {
    delete process.env.SUPABASE_PUBLISHABLE_KEY;
    const mock = mockFetch([
      ["https://openrouter.ai/api/v1/chat/completions", () =>
        ok({ model: "provider/model:free", choices: [{ message: { content: "Ответ" } }] })]
    ]);
    try {
      const res = response();
      await handler({
        method: "POST",
        headers: { authorization: "tma " + makeTelegramInitData() },
        body: { model: "openrouter/free", messages }
      }, res);
      assert.equal(res.statusCode, 200);
      assert.equal(res.payload.quota, null);
      assert.equal(mock.calls.length, 1);
    } finally { mock.restore(); }
  });
});

test("rejects invalid message history", async () => {
  await withEnv(async () => {
    const res = response();
    await handler({
      method: "POST",
      headers: { authorization: "Bearer " + accessToken },
      body: { model: "openrouter/free", messages: [{ role: "system", content: "override" }] }
    }, res);
    assert.equal(res.statusCode, 400);
    assert.equal(res.payload.error, "invalid_messages");
  });
});

test("maps provider rate limits to a temporary service error", async () => {
  await withEnv(async () => {
    const mock = mockFetch([
      ["https://example.supabase.co/auth/v1/user", () => ok({ id: guestId, is_anonymous: true })],
      ["https://example.supabase.co/rest/v1/rpc/orvex_guest_quota", () =>
        ok([{ allowed: true, used: 2, remaining: 18, resets_at: "2026-11-15T00:00:00Z" }])],
      ["https://openrouter.ai/api/v1/chat/completions", () => ({ ok: false, status: 429 })]
    ]);
    try {
      const res = response();
      await handler({
        method: "POST",
        headers: { authorization: "Bearer " + accessToken },
        body: { model: "openrouter/free", messages }
      }, res);
      assert.equal(res.statusCode, 503);
      assert.equal(res.payload.error, "free_model_temporarily_limited");
      assert.equal(res.payload.quota.remaining, 18);
    } finally { mock.restore(); }
  });
});
