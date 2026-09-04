import { createHmac, scryptSync, timingSafeEqual } from "node:crypto";

export const SESSION_COOKIE = "bit_gov_session";
export const SESSION_MAX_AGE = 60 * 60 * 24 * 30;

function configuredSecret() {
  const value = process.env.SESSION_SECRET;
  if (value) return value;
  if (process.env.NODE_ENV === "production") throw new Error("SESSION_SECRET is required");
  return "development-only-secret-change-before-deploy";
}

function constantTimeEqual(left, right) {
  const leftValue = Buffer.from(left);
  const rightValue = Buffer.from(right);
  return leftValue.length === rightValue.length && timingSafeEqual(leftValue, rightValue);
}

function sign(payload) {
  return createHmac("sha256", configuredSecret()).update(payload).digest("base64url");
}

export function createSessionToken(now = Date.now()) {
  const payload = Buffer.from(
    JSON.stringify({ exp: Math.floor(now / 1000) + SESSION_MAX_AGE }),
  ).toString("base64url");
  return `${payload}.${sign(payload)}`;
}

export function verifySessionToken(token, now = Date.now()) {
  if (!token) return false;
  const [payload, signature, extra] = token.split(".");
  if (!payload || !signature || extra) return false;

  try {
    if (!constantTimeEqual(sign(payload), signature)) return false;
    const decoded = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    return typeof decoded?.exp === "number" && decoded.exp > Math.floor(now / 1000);
  } catch {
    return false;
  }
}

export function verifyPin(pin) {
  if (!/^\d{6}$/.test(pin)) return false;
  if (process.env.NODE_ENV !== "production") {
    return constantTimeEqual(process.env.DASHBOARD_DEV_PIN || "123456", pin);
  }

  const salt = process.env.DASHBOARD_PIN_SALT;
  const storedHex = process.env.DASHBOARD_PIN_HASH;
  if (!salt || !storedHex || !/^[a-f0-9]+$/i.test(storedHex) || storedHex.length % 2 !== 0) return false;

  const stored = Buffer.from(storedHex, "hex");
  const candidate = scryptSync(pin, salt, stored.length);
  return constantTimeEqual(stored, candidate);
}
