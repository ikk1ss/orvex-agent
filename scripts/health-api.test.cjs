"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const handler = require("../api/health");

function response() {
  return {
    statusCode: 200,
    headers: {},
    payload: null,
    setHeader(name, value) { this.headers[name] = value; },
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.payload = payload; return this; }
  };
}

test("reports setup required without exposing environment values", async () => {
  const names = ["TELEGRAM_BOT_TOKEN", "SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"];
  const previous = Object.fromEntries(names.map(name => [name, process.env[name]]));
  names.forEach(name => delete process.env[name]);
  try {
    const res = response();
    await handler({ method: "GET" }, res);
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.payload, {
      status: "ok",
      telegramAuth: "setup_required",
      profileService: "setup_required",
      profileStorageAccess: "setup_required"
    });
    assert.equal(JSON.stringify(res.payload).includes("SERVICE_ROLE"), false);
    assert.equal(res.headers["Cache-Control"], "no-store");
  } finally {
    names.forEach(name => {
      if (previous[name] === undefined) delete process.env[name];
      else process.env[name] = previous[name];
    });
  }
});

test("reports configured services only when all server settings are present", async () => {
  const names = ["TELEGRAM_BOT_TOKEN", "SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"];
  const previous = Object.fromEntries(names.map(name => [name, process.env[name]]));
  process.env.TELEGRAM_BOT_TOKEN = "test-token";
  process.env.SUPABASE_URL = "https://example.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role";
  try {
    const res = response();
    const originalFetch = global.fetch;
    global.fetch = async () => ({ ok: true, status: 200 });
    await handler({ method: "GET" }, res);
    assert.deepEqual(res.payload, {
      status: "ok",
      telegramAuth: "configured",
      profileService: "configured",
      profileStorageAccess: "elevated"
    });
    global.fetch = originalFetch;
  } finally {
    names.forEach(name => {
      if (previous[name] === undefined) delete process.env[name];
      else process.env[name] = previous[name];
    });
  }
});

test("rejects non-HTTPS Supabase URLs as unconfigured", async () => {
  const names = ["TELEGRAM_BOT_TOKEN", "SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"];
  const previous = Object.fromEntries(names.map(name => [name, process.env[name]]));
  process.env.TELEGRAM_BOT_TOKEN = "test-token";
  process.env.SUPABASE_URL = "http://example.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role";
  try {
    const res = response();
    await handler({ method: "GET" }, res);
    assert.equal(res.payload.profileService, "setup_required");
  } finally {
    names.forEach(name => {
      if (previous[name] === undefined) delete process.env[name];
      else process.env[name] = previous[name];
    });
  }
});

test("rejects unsupported methods", async () => {
  const res = response();
  await handler({ method: "POST" }, res);
  assert.equal(res.statusCode, 405);
  assert.equal(res.headers.Allow, "GET");
});
