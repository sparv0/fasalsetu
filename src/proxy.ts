import { NextResponse, type NextRequest } from "next/server";
import { ACCESS_COOKIE, accessCode, accessToken } from "@/lib/access";

// Reachable without the access code: the gate itself, health checks, and the device API
// (which authenticates each device with its own key).
const OPEN_PATHS = ["/access", "/api/health", "/api/iot/readings"];

export async function proxy(request: NextRequest) {
  const code = accessCode();
  if (!code) return NextResponse.next();

  const { pathname, search } = request.nextUrl;
  if (OPEN_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`))) return NextResponse.next();

  const cookie = request.cookies.get(ACCESS_COOKIE)?.value;
  if (cookie && cookie === (await accessToken(code))) return NextResponse.next();

  if (pathname.startsWith("/api/") || pathname.startsWith("/media/") || request.method !== "GET") {
    return NextResponse.json({ error: "Access code required." }, { status: 401 });
  }
  const url = request.nextUrl.clone();
  url.pathname = "/access";
  url.search = `?next=${encodeURIComponent(pathname + search)}`;
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
