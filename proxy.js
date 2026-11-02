import { NextResponse } from "next/server";
import { SESSION_COOKIE, SESSION_VALUE } from "./lib/auth.js";

export function proxy(request) {
  if (request.cookies.get(SESSION_COOKIE)?.value === SESSION_VALUE) return NextResponse.next();
  if (request.nextUrl.pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "Sign in first" }, { status: 401 });
  }
  return NextResponse.redirect(new URL("/login", request.url));
}

export const config = {
  matcher: ["/((?!login|api/health|_next/static|_next/image|favicon.ico|sample-slip.png).*)"],
};
