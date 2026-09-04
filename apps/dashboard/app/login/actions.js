"use server";

import { createHash } from "node:crypto";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { createSessionToken, SESSION_COOKIE, SESSION_MAX_AGE, verifyPin } from "../../lib/session.mjs";

const WINDOW_MS = 15 * 60 * 1000;
const LOCK_MS = 30 * 60 * 1000;
const attempts = new Map();

function safeNext(value) {
  return typeof value === "string" && value.startsWith("/") && !value.startsWith("//") ? value : "/";
}

function lockKey(ip) {
  return createHash("sha256").update(`${process.env.SESSION_SECRET || "development"}|${ip}`).digest("hex");
}

function recordFailure(key, now) {
  const previous = attempts.get(key);
  const inWindow = previous && now - previous.windowStartedAt <= WINDOW_MS;
  const failureCount = inWindow ? previous.failureCount + 1 : 1;
  const state = {
    windowStartedAt: inWindow ? previous.windowStartedAt : now,
    failureCount,
    lockedUntil: failureCount >= 5 ? now + LOCK_MS : 0,
  };
  attempts.set(key, state);
  return state;
}

export async function loginAction(formData) {
  const pin = String(formData.get("pin") || "").replace(/\D/g, "").slice(0, 6);
  const next = safeNext(formData.get("next"));
  const requestHeaders = await headers();
  const ip = requestHeaders.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  const key = lockKey(ip);
  const now = Date.now();
  const prior = attempts.get(key);
  if (prior?.lockedUntil > now) redirect(`/login?error=locked&next=${encodeURIComponent(next)}`);

  if (!verifyPin(pin)) {
    const result = recordFailure(key, now);
    redirect(`/login?error=${result.lockedUntil ? "locked" : "invalid"}&next=${encodeURIComponent(next)}`);
  }

  attempts.delete(key);
  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE, createSessionToken(now), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_MAX_AGE,
  });
  redirect(next);
}

export async function logoutAction() {
  const cookieStore = await cookies();
  cookieStore.delete(SESSION_COOKIE);
  redirect("/login");
}
