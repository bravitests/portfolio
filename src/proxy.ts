import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

// dn.bravian.site (and dn.localhost in dev) serves the media tools that live
// under /dn. Everything else on the main domain is untouched.
const DN_HOST = /^dn\./i;

export function proxy(request: NextRequest) {
  const host = request.headers.get("host") ?? "";
  const { pathname } = request.nextUrl;

  if (DN_HOST.test(host)) {
    if (pathname.startsWith("/dn")) return NextResponse.next();
    const url = request.nextUrl.clone();
    url.pathname = `/dn${pathname === "/" ? "" : pathname}`;
    return NextResponse.rewrite(url);
  }

  // On the main domain, send /dn visitors to the subdomain in production.
  if (pathname === "/dn" || pathname.startsWith("/dn/")) {
    if (host.endsWith("bravian.site")) {
      const url = new URL(request.url);
      url.host = "dn.bravian.site";
      url.pathname = pathname.replace(/^\/dn/, "") || "/";
      return NextResponse.redirect(url, 308);
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!api|dn-wasm|_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|jpeg|svg|webp|gif|ico|txt|xml)$).*)"],
};
