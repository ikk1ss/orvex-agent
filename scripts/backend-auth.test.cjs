"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { createHmac } = require("node:crypto");
const { verifyTelegramInitData } = require("../lib/telegram-auth");

const botToken = "123456:test-token-for-unit-tests";
const now = 1794441600000;

function makeInitData(overrides = {}) {
  const values = {
    auth_date: String(Math.floor(now / 1000)),
    query_id: "AAE-test-query",
    user: JSON.stringify({ id: 123456789, first_name: "Test" }),
    ...overrides
  };
  const checkString = Object.entries(values)
    .sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
    .map(([key, value]) => key + "=" + value)
    .join("\n");
  const secret = createHmac("sha256", "WebAppData").update(botToken).digest();
  const hash = createHmac("sha256", secret).update(checkString).digest("hex");
  return new URLSearchParams({ ...values, hash }).toString();
}

test("accepts valid Telegram initData", () => {
  const result = verifyTelegramInitData(makeInitData(), botToken, { now });
  assert.equal(result.ok, true);
  assert.equal(result.user.id, 123456789);
});

test("rejects modified initData", () => {
  const data = makeInitData().replace("Test", "Other");
  assert.equal(verifyTelegramInitData(data, botToken, { now }).ok, false);
});

test("rejects expired initData", () => {
  const oldDate = String(Math.floor(now / 1000) - 90000);
  assert.equal(verifyTelegramInitData(makeInitData({ auth_date: oldDate }), botToken, { now }).error, "expired_init_data");
});

test("rejects missing credentials", () => {
  assert.equal(verifyTelegramInitData("", botToken).error, "missing_credentials");
});

test("rejects malformed user payload", () => {
  assert.equal(verifyTelegramInitData(makeInitData({ user: "not-json" }), botToken, { now }).error, "invalid_user");
});

test("rejects future-dated initData", () => {
  const futureDate = String(Math.floor(now / 1000) + 120);
  assert.equal(verifyTelegramInitData(makeInitData({ auth_date: futureDate }), botToken, { now }).error, "expired_init_data");
});

test("rejects non-positive Telegram user IDs", () => {
  assert.equal(verifyTelegramInitData(makeInitData({ user: JSON.stringify({ id: 0 }) }), botToken, { now }).error, "invalid_user");
});

test("rejects a signature made with a different bot token", () => {
  assert.equal(verifyTelegramInitData(makeInitData(), "another-test-token", { now }).error, "invalid_signature");
});
