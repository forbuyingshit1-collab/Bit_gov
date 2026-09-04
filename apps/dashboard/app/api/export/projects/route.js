import { cookies } from "next/headers";
import { SESSION_COOKIE, verifySessionToken } from "../../../../lib/session.mjs";

export async function GET(request) {
  const cookieStore = await cookies();
  if (!verifySessionToken(cookieStore.get(SESSION_COOKIE)?.value)) {
    return Response.redirect(new URL("/login", request.url));
  }
  if (!process.env.BIT_GOV_API_URL) return Response.json({ error: "api_not_configured" }, { status: 503 });
  const sourceUrl = new URL(request.url);
  const target = new URL("/v1/export/projects.csv", process.env.BIT_GOV_API_URL);
  for (const [key, value] of sourceUrl.searchParams) target.searchParams.append(key, value);
  const response = await fetch(target, { cache: "no-store" });
  if (!response.ok) return Response.json({ error: "export_unavailable" }, { status: 503 });
  return new Response(response.body, { headers: {
    "content-type": "text/csv; charset=utf-8",
    "content-disposition": "attachment; filename=bit-gov-projects.csv",
    "cache-control": "no-store",
  } });
}
