"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const handler = require("../api/auth-config");

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

function withEnv(values, run) {
  const names = ["SUPABASE_URL", "SUPABASE_PUBLISHABLE_KEY", "SUPABASE_ANON_KEY", "ORVEX_TELEGRAM_BOT_URL"];
  const previous = Object.fromEntries(names.map(name => [name, process.env[name]]));
  for (const name of names) {
    if (Object.prototype.hasOwnProperty.call(values, name)) process.env[name] = values[name];
    else delete process.env[name];
  }
  try { return run(); }
  finally {
    for (const name of names) {
      if (previous[name] === undefined) delete process.env[name];
      else process.env[name] = previous[name];
    }
  }
}

test("returns only public Supabase auth configuration", () => {
  withEnv({
    SUPABASE_URL: "https://example.supabase.co",
    SUPABASE_PUBLISHABLE_KEY: "sb_publishable_123456789012345678901234",
    ORVEX_TELEGRAM_BOT_URL: "https://t.me/orvex_agent"
  }, () => {
    const res = makeResponse();
    handler({ method: "GET" }, res);
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.payload, {
      supabaseUrl: "https://example.supabase.co",
      publishableKey: "sb_publishable_123456789012345678901234",
      telegramBotUrl: "https://t.me/orvex_agent"
    });
    assert.equal(res.headers["Cache-Control"], "no-store");
    assert.equal(JSON.stringify(res.payload).includes("SERVICE_ROLE"), false);
  });
});

test("supports the legacy anon key environment variable", () => {
  withEnv({
    SUPABASE_URL: "https://example.supabase.co",
    SUPABASE_ANON_KEY: "eyJabcdefghijklmnopqrstuvwxyz.eyJabcdefghijklmnopqrstuvwxyz.signature"
  }, () => {
    const res = makeResponse();
    handler({ method: "GET" }, res);
    assert.equal(res.statusCode, 200);
    assert.ok(res.payload.publishableKey.startsWith("eyJ"));
  });
});

test("fails closed when public auth configuration is missing or invalid", () => {
  for (const values of [
    {},
    { SUPABASE_URL: "http://example.supabase.co", SUPABASE_PUBLISHABLE_KEY: "sb_publishable_123456789012345678901234" },
    { SUPABASE_URL: "https://example.supabase.co", SUPABASE_PUBLISHABLE_KEY: "service_role_secret" }
  ]) {
    withEnv(values, () => {
      const res = makeResponse();
      handler({ method: "GET" }, res);
      assert.equal(res.statusCode, 503);
      assert.deepEqual(res.payload, { error: "auth_service_not_configured" });
    });
  }
});

test("rejects non-GET methods", () => {
  withEnv({}, () => {
    const res = makeResponse();
    handler({ method: "POST" }, res);
    assert.equal(res.statusCode, 405);
    assert.equal(res.headers.Allow, "GET");
  });
});

test("does not return an unsafe Telegram deep link", () => {
  withEnv({
    SUPABASE_URL: "https://example.supabase.co",
    SUPABASE_PUBLISHABLE_KEY: "sb_publishable_123456789012345678901234",
    ORVEX_TELEGRAM_BOT_URL: "https://evil.example/path"
  }, () => {
    const res = makeResponse();
    handler({ method: "GET" }, res);
    assert.equal(res.payload.telegramBotUrl, "");
  });
});
