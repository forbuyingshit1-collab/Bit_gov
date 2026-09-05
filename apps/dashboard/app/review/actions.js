"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { SESSION_COOKIE, verifySessionToken } from "../../lib/session.mjs";

export async function reviewAction(formData) {
  const cookieStore = await cookies();
  if (!verifySessionToken(cookieStore.get(SESSION_COOKIE)?.value)) return;
  if (!process.env.BIT_GOV_API_URL || !process.env.BIT_GOV_REVIEW_TOKEN) return;
  const projectId = String(formData.get("projectId") ?? "");
  const decision = String(formData.get("decision") ?? "");
  if (!projectId.startsWith("project:") || !["approve", "reject"].includes(decision)) return;
  const response = await fetch(new URL("/v1/review-decision", process.env.BIT_GOV_API_URL), {
    method: "POST",
    headers: { authorization: `Bearer ${process.env.BIT_GOV_REVIEW_TOKEN}`, "content-type": "application/json" },
    body: JSON.stringify({ projectId, decision }),
    cache: "no-store",
  });
  if (!response.ok) throw new Error("Review decision could not be saved");
  revalidatePath("/");
}
