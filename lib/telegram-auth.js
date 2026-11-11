"use strict";

const { createHmac, timingSafeEqual } = require("node:crypto");

function verifyTelegramInitData(initData, botToken, options = {}) {
  if (typeof initData !== "string" || !initData || typeof botToken !== "string" || !botToken) {
    return { ok: false, error: "missing_credentials" };
  }

  const params = new URLSearchParams(initData);
  const receivedHash = params.get("hash");
  const authDateValue = params.get("auth_date");
  const userValue = params.get("user");

  if (!receivedHash || !/^[a-f0-9]{64}$/i.test(receivedHash) || !authDateValue || !userValue) {
    return { ok: false, error: "malformed_init_data" };
  }

  const authDate = Number(authDateValue);
  if (!Number.isInteger(authDate) || authDate <= 0) {
    return { ok: false, error: "invalid_auth_date" };
  }

  const nowSeconds = Math.floor((options.now ?? Date.now()) / 1000);
  const maxAgeSeconds = options.maxAgeSeconds ?? 86400;
  if (authDate > nowSeconds + 60 || nowSeconds - authDate > maxAgeSeconds) {
    return { ok: false, error: "expired_init_data" };
  }

  const dataCheckString = [...params.entries()]
    .filter(([key]) => key !== "hash")
    .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
    .map(([key, value]) => key + "=" + value)
    .join("\n");

  const secretKey = createHmac("sha256", "WebAppData").update(botToken).digest();
  const calculatedHash = createHmac("sha256", secretKey).update(dataCheckString).digest();
  const suppliedHash = Buffer.from(receivedHash, "hex");

  if (suppliedHash.length !== calculatedHash.length || !timingSafeEqual(suppliedHash, calculatedHash)) {
    return { ok: false, error: "invalid_signature" };
  }

  let user;
  try {
    user = JSON.parse(userValue);
  } catch {
    return { ok: false, error: "invalid_user" };
  }

  if (!user || (typeof user.id !== "number" && typeof user.id !== "string") || !String(user.id)) {
    return { ok: false, error: "invalid_user" };
  }

  return { ok: true, user, authDate };
}

module.exports = { verifyTelegramInitData };
