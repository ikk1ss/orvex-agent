"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const handler = require("../api/guest-quota");

const userId = "123e4567-e89b-42d3-a456-426614174000";
const token = "test-access-token";

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
  const names = ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "SUPABASE_PUBLISHABLE_KEY"];
  const previous = Object.fromEntries(names.map(name => [name, process.env[name]]));
  process.env.SUPABASE_URL = "https://example.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role-key";
  process.env.SUPABASE_PUBLISHABLE_KEY = "sb_publishable_test_key_12345678901234567890";
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

const json = value => ({ ok: true, status: 200, json: async () => value });

test("requires a guest bearer session", async () => {
  await withEnv(async () => {
    const res = response();
    await handler({ method: "GET", headers: {} }, res);
    assert.equal(res.statusCode, 401);
  });
});

test("rejects non-GET methods", async () => {
  await withEnv(async () => {
    const res = response();
    await handler({ method: "POST", headers: {} }, res);
    assert.equal(res.statusCode, 405);
    assert.equal(res.headers.Allow, "GET");
  });
});

test("returns the authenticated guest's remaining daily quota", async () => {
  await withEnv(async () => {
    const mock = mockFetch([
      ["https://example.supabase.co/auth/v1/user", () => json({ id: userId, is_anonymous: true })],
      ["https://example.supabase.co/rest/v1/rpc/orvex_guest_quota", (url, init) => {
        assert.equal(init.method, "POST");
        assert.deepEqual(JSON.parse(init.body), { p_user_id: userId, p_consume: false });
        return json([{ allowed: true, used: 4, remaining: 16, resets_at: "2026-11-15T00:00:00Z" }]);
      }]
    ]);
    try {
      const res = response();
      await handler({ method: "GET", headers: { authorization: "Bearer " + token } }, res);
      assert.equal(res.statusCode, 200);
      assert.deepEqual(res.payload.quota, {
        used: 4, remaining: 16, dailyLimit: 20, resetsAt: "2026-11-15T00:00:00Z"
      });
      assert.equal(mock.calls.length, 2);
    } finally { mock.restore(); }
  });
});

test("rejects a permanent account on the guest quota endpoint", async () => {
  await withEnv(async () => {
    const mock = mockFetch([["https://example.supabase.co/auth/v1/user", () => json({ id: userId, is_anonymous: false })]]);
    try {
      const res = response();
      await handler({ method: "GET", headers: { authorization: "Bearer " + token } }, res);
      assert.equal(res.statusCode, 403);
      assert.equal(res.payload.error, "guest_session_required");
      assert.equal(mock.calls.length, 1);
    } finally { mock.restore(); }
  });
});

test("fails closed when the quota RPC is unavailable", async () => {
  await withEnv(async () => {
    const mock = mockFetch([
      ["https://example.supabase.co/auth/v1/user", () => json({ id: userId, is_anonymous: true })],
      ["https://example.supabase.co/rest/v1/rpc/orvex_guest_quota", () => ({ ok: false, status: 404 })]
    ]);
    try {
      const res = response();
      await handler({ method: "GET", headers: { authorization: "Bearer " + token } }, res);
      assert.equal(res.statusCode, 503);
      assert.equal(res.payload.error, "guest_quota_unavailable");
    } finally { mock.restore(); }
  });
});

test("rejects inconsistent quota data from the database", async () => {
  await withEnv(async () => {
    const mock = mockFetch([
      ["https://example.supabase.co/auth/v1/user", () => json({ id: userId, is_anonymous: true })],
      ["https://example.supabase.co/rest/v1/rpc/orvex_guest_quota", () =>
        json([{ allowed: true, used: 20, remaining: 1, resets_at: "2026-11-15T00:00:00Z" }])]
    ]);
    try {
      const res = response();
      await handler({ method: "GET", headers: { authorization: "Bearer " + token } }, res);
      assert.equal(res.statusCode, 502);
      assert.equal(res.payload.error, "guest_quota_invalid");
    } finally { mock.restore(); }
  });
});
