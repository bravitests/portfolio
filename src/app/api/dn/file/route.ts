import { isAllowedMediaHost } from "@/lib/dn/extract";
import { decodeToken } from "@/lib/dn/token";

export const maxDuration = 300;

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36";

const PASS_THROUGH = ["content-type", "content-length", "content-range", "accept-ranges", "last-modified", "etag"];

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const token = decodeToken(params.get("t") ?? "");
  if (!token || !isAllowedMediaHost(token.u)) {
    return new Response("Not allowed", { status: 400 });
  }

  const headers: Record<string, string> = { "user-agent": UA, accept: "*/*", ...token.h };
  const range = request.headers.get("range");
  if (range) headers.range = range;

  let upstream: Response;
  try {
    upstream = await fetch(token.u, { headers, redirect: "follow", cache: "no-store", signal: request.signal });
  } catch {
    return new Response("Upstream unreachable", { status: 502 });
  }
  // Re-check after redirects so an allowed host can't bounce us somewhere else.
  if (!isAllowedMediaHost(upstream.url)) return new Response("Not allowed", { status: 400 });
  if (!upstream.ok && upstream.status !== 206) {
    return new Response("The media host refused that file. It may have expired, paste the link again.", { status: 502 });
  }

  const out = new Headers();
  for (const h of PASS_THROUGH) {
    const v = upstream.headers.get(h);
    if (v) out.set(h, v);
  }
  const name = (params.get("name") ?? "").replace(/[^\w.-]/g, "_");
  if (name) out.set("content-disposition", `attachment; filename="${name}"`);
  out.set("cache-control", "private, max-age=600");
  out.set("x-content-type-options", "nosniff");

  return new Response(upstream.body, { status: upstream.status, headers: out });
}
