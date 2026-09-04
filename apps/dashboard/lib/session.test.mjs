import assert from "node:assert/strict";
import { scryptSync } from "node:crypto";
import test from "node:test";
import { createSessionToken, verifyPin, verifySessionToken } from "./session.mjs";

test("accepts a valid signed session and rejects tampering or expiry", () => {
  const originalSecret = process.env.SESSION_SECRET;
  process.env.SESSION_SECRET = "test-session-secret-that-is-long-enough";
  const now = 1_700_000_000_000;
  const token = createSessionToken(now);
  assert.equal(verifySessionToken(token, now), true);
  assert.equal(verifySessionToken(`${token}x`, now), false);
  assert.equal(verifySessionToken(token, now + 31 * 24 * 60 * 60 * 1000), false);
  if (originalSecret === undefined) delete process.env.SESSION_SECRET;
  else process.env.SESSION_SECRET = originalSecret;
});

test("verifies a production PIN only against its scrypt hash", () => {
  const previous = {
    nodeEnv: process.env.NODE_ENV,
    salt: process.env.DASHBOARD_PIN_SALT,
    hash: process.env.DASHBOARD_PIN_HASH,
  };
  const salt = "test-salt";
  process.env.NODE_ENV = "production";
  process.env.DASHBOARD_PIN_SALT = salt;
  process.env.DASHBOARD_PIN_HASH = scryptSync("654321", salt, 64).toString("hex");
  assert.equal(verifyPin("654321"), true);
  assert.equal(verifyPin("000000"), false);
  assert.equal(verifyPin("65432"), false);
  if (previous.nodeEnv === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = previous.nodeEnv;
  if (previous.salt === undefined) delete process.env.DASHBOARD_PIN_SALT;
  else process.env.DASHBOARD_PIN_SALT = previous.salt;
  if (previous.hash === undefined) delete process.env.DASHBOARD_PIN_HASH;
  else process.env.DASHBOARD_PIN_HASH = previous.hash;
});
