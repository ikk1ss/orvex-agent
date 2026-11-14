"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const handler = require("../api/user-data");

const userId = "123e4567-e89b-42d3-a456-426614174000";
const token = "test-access-token";
function response() {
  return { statusCode: 200, headers: {}, payload: null,
    setHeader(name, value) { this.headers[name] = value; },
    status(code) { this.statusCode = code; return this; },
    json(value) { this.payload = value; return this; } };
}
async function withEnv(run) {
  const names = ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "SUPABASE_PUBLISHABLE_KEY"];
  const old = Object.fromEntries(names.map(name => [name, process.env[name]]));
  process.env.SUPABASE_URL = "https://example.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role-key";
  process.env.SUPABASE_PUBLISHABLE_KEY = "sb_publishable_test_key_12345678901234567890";
  try { await run(); } finally {
    for (const name of names) old[name] === undefined ? delete process.env[name] : process.env[name] = old[name];
  }
}
function mockFetch(routes) {
  const original = global.fetch, calls = [];
  global.fetch = async (url, init = {}) => {
    calls.push({ url: String(url), init });
    const route = routes.find(item => String(url).startsWith(item[0]));
    if (!route) throw new Error("unexpected fetch " + url);
    return route[1](String(url), init);
  };
  return { calls, restore() { global.fetch = original; } };
}
const ok = value => ({ ok: true, status: 200, json: async () => value });

test("requires a verified Supabase bearer session", async () => withEnv(async () => {
  const res = response();
  await handler({ method: "GET", headers: {} }, res);
  assert.equal(res.statusCode, 401);
}));
test("loads only the authenticated user's profile and latest 100 messages", async () => withEnv(async () => {
  const mock = mockFetch([
    ["https://example.supabase.co/auth/v1/user", () => ok({ id: userId, is_anonymous: true })],
    ["https://example.supabase.co/rest/v1/orvex_auth_profiles", url => {
      assert.equal(new URL(url).searchParams.get("user_id"), "eq." + userId);
      return ok([{ display_name: "Guest", email: "", interest: "Все возможности", preferences: { language: "ru" } }]);
    }],
    ["https://example.supabase.co/rest/v1/orvex_auth_chat_messages", url => {
      const query = new URL(url).searchParams;
      assert.equal(query.get("user_id"), "eq." + userId);
      assert.equal(query.get("limit"), "100");
      return ok([{ role: "assistant", content: "Hello" }, { role: "user", content: "Hi" }]);
    }]
  ]);
  try {
    const res = response();
    await handler({ method: "GET", headers: { authorization: "Bearer " + token } }, res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.payload.accountType, "guest");
    assert.equal(res.payload.profile.name, "Guest");
    assert.deepEqual(res.payload.messages.map(item => item.content), ["Hi", "Hello"]);
  } finally { mock.restore(); }
}));
test("saves profile using the authenticated UUID, not a client-supplied owner", async () => withEnv(async () => {
  let saved;
  const mock = mockFetch([
    ["https://example.supabase.co/auth/v1/user", () => ok({ id: userId, is_anonymous: false, email: "google@example.com" })],
    ["https://example.supabase.co/rest/v1/orvex_auth_profiles", (_url, init) => {
      saved = JSON.parse(init.body);
      assert.equal(init.method, "POST");
      return ok([{ display_name: "Google User", email: "google@example.com", interest: "Все возможности", preferences: saved.preferences }]);
    }]
  ]);
  try {
    const res = response();
    await handler({ method: "PUT", headers: { authorization: "Bearer " + token }, body: {
      user_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      name: " Google User ", email: "", interest: "Все возможности",
      preferences: { language: "ru", ignored: "no" }
    } }, res);
    assert.equal(res.statusCode, 200);
    assert.equal(saved.user_id, userId);
    assert.equal(saved.email, "google@example.com");
    assert.equal("ignored" in saved.preferences, false);
  } finally { mock.restore(); }
}));
test("rejects invalid profile data without writing", async () => withEnv(async () => {
  let writes = 0;
  const mock = mockFetch([
    ["https://example.supabase.co/auth/v1/user", () => ok({ id: userId, is_anonymous: false })],
    ["https://example.supabase.co/rest/v1/orvex_auth_profiles", () => { writes++; throw new Error("must not write"); }]
  ]);
  try {
    const res = response();
    await handler({ method: "PUT", headers: { authorization: "Bearer " + token }, body: {
      name: "", email: "bad", interest: "invalid"
    } }, res);
    assert.equal(res.statusCode, 400);
    assert.equal(writes, 0);
  } finally { mock.restore(); }
}));
test("rejects unsupported methods", async () => {
  const res = response();
  await handler({ method: "DELETE", headers: {} }, res);
  assert.equal(res.statusCode, 405);
  assert.equal(res.headers.Allow, "GET, PUT");
});
