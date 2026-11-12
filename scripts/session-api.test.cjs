"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { createHmac } = require("node:crypto");
const handler = require("../api/session");

const botToken = "246810:test-session-token";
const values = {
  auth_date: String(Math.floor(Date.now() / 1000)),
  query_id: "session-test",
  user: JSON.stringify({ id: 24681012, first_name: "Test", username: "test_user" })
};
const dataCheckString = Object.entries(values)
  .sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
  .map(([key, value]) => key + "=" + value)
  .join("\n");
const secret = createHmac("sha256", "WebAppData").update(botToken).digest();
const hash = createHmac("sha256", secret).update(dataCheckString).digest("hex");
const initData = new URLSearchParams({ ...values, hash }).toString();

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

test("returns a minimal identity for a valid signed Telegram session", () => {
  const previous = process.env.TELEGRAM_BOT_TOKEN;
  process.env.TELEGRAM_BOT_TOKEN = botToken;
  try {
    const res = response();
    handler({ method: "GET", headers: { authorization: "tma " + initData } }, res);
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.payload, {
      authenticated: true,
      user: { id: "24681012", firstName: "Test", username: "test_user", photoUrl: "" }
    });
    assert.equal(res.headers["Cache-Control"], "no-store");
  } finally {
    if (previous === undefined) delete process.env.TELEGRAM_BOT_TOKEN;
    else process.env.TELEGRAM_BOT_TOKEN = previous;
  }
});

test("rejects missing Telegram authorization", () => {
  const previous = process.env.TELEGRAM_BOT_TOKEN;
  process.env.TELEGRAM_BOT_TOKEN = botToken;
  try {
    const res = response();
    handler({ method: "GET", headers: {} }, res);
    assert.equal(res.statusCode, 401);
    assert.equal(res.payload.error, "telegram_auth_required");
  } finally {
    if (previous === undefined) delete process.env.TELEGRAM_BOT_TOKEN;
    else process.env.TELEGRAM_BOT_TOKEN = previous;
  }
});

test("rejects tampered Telegram initData", () => {
  const previous = process.env.TELEGRAM_BOT_TOKEN;
  process.env.TELEGRAM_BOT_TOKEN = botToken;
  try {
    const res = response();
    handler({ method: "GET", headers: { authorization: "tma " + initData.replace("Test", "Tampered") } }, res);
    assert.equal(res.statusCode, 401);
    assert.equal(res.payload.error, "invalid_telegram_auth");
  } finally {
    if (previous === undefined) delete process.env.TELEGRAM_BOT_TOKEN;
    else process.env.TELEGRAM_BOT_TOKEN = previous;
  }
});

test("rejects unsupported methods", () => {
  const res = response();
  handler({ method: "POST", headers: {} }, res);
  assert.equal(res.statusCode, 405);
  assert.equal(res.headers.Allow, "GET");
});
