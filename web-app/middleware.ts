// =============================================================================
//  Edge middleware — session refresh + route protection.
// -----------------------------------------------------------------------------
//  Runs on every request. Two jobs:
//   1. Refresh the Supabase access token from the refresh-token cookie so
//      server components downstream see a fresh session.
//   2. Block unauthenticated visits to /(app) routes; redirect to /signin.
//
//  Cloudflare Pages requires middleware to use the Edge runtime — which
//  @supabase/ssr supports out of the box. No Node-only APIs here.
//
//  Cookie-propagation fix (post-W9):
//  -----------------------------------
//  When auth.getUser() triggers a refresh, the supabase client invokes our
//  `set()` cookie callback (twice for the chunked token). That callback
//  reassigns the closure-scoped `response` to a fresh NextResponse.next() and
//  stamps the new cookie on it. The previous version then returned a brand-
//  new `NextResponse.redirect(url)` on the protected-route guard path —
//  THAT response had no cookies on it, so the refreshed tokens were
//  silently discarded. Outcome: users would render the dashboard once,
//  then get bounced to /signin on every subsequent click because the
//  access token "kept expiring" with no successful refresh ever persisted
//  on a redirect response.
//
//  Fix: every return path copies the cookies from the working `response`
//  onto the actual outbound response. We use a single helper
//  (`propagateCookies`) so the three return sites (success, protected
//  redirect, signed-in-on-signin redirect) all behave identically.
// =============================================================================

import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

const PROTECTED_PREFIXES = [
  "/dashboard",
  "/loads",
  "/drivers",
  "/payroll",
  "/settlements",
  "/fleet",
  "/brokers",
  "/broker-contacts",
  "/expenses",
  "/documents",
  "/reports",
  "/settings",
];

/**
 * Copy every cookie set on `from` onto `to`. Use for any response we hand
 * back from middleware that wasn't the one Supabase wrote into directly
 * (i.e. any redirect). Cheap — typically 0-2 cookies, and Set-Cookie is
 * just header writes.
 */
function propagateCookies(from: NextResponse, to: NextResponse): NextResponse {
  for (const cookie of from.cookies.getAll()) {
    to.cookies.set(cookie);
  }
  return to;
}

export async function middleware(request: NextRequest) {
  let response = NextResponse.next({ request: { headers: request.headers } });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        get(name: string) {
          return request.cookies.get(name)?.value;
        },
        set(name: string, value: string, options: CookieOptions) {
          // Mirror onto the request so any downstream server components
          // that fall through (not redirected) see the fresh cookie.
          request.cookies.set({ name, value, ...options });
          // Rebuild the working response with the updated request headers
          // so the request cookies and response cookies stay in lockstep.
          response = NextResponse.next({ request: { headers: request.headers } });
          response.cookies.set({ name, value, ...options });
        },
        remove(name: string, options: CookieOptions) {
          request.cookies.set({ name, value: "", ...options });
          response = NextResponse.next({ request: { headers: request.headers } });
          response.cookies.set({ name, value: "", ...options });
        },
      },
    }
  );

  // Refresh the session so downstream server components don't see a stale
  // token. The supabase client's set/remove callbacks update `response`
  // in place when a refresh succeeds.
  const { data: { user } } = await supabase.auth.getUser();

  const pathname = request.nextUrl.pathname;
  const isProtected = PROTECTED_PREFIXES.some(
    (p) => pathname === p || pathname.startsWith(p + "/")
  );

  if (isProtected && !user) {
    const url = request.nextUrl.clone();
    url.pathname = "/auth/signin";
    url.searchParams.set("next", pathname);
    // Carry the refreshed (or cleared) Supabase cookies onto the redirect
    // so the very next request sees the right session state.
    return propagateCookies(response, NextResponse.redirect(url));
  }

  // Signed-in users on /auth/signin → bump them straight to dashboard.
  if (pathname === "/auth/signin" && user) {
    const url = request.nextUrl.clone();
    url.pathname = "/dashboard";
    url.search = "";
    return propagateCookies(response, NextResponse.redirect(url));
  }

  return response;
}

export const config = {
  matcher: [
    // Match everything except the next-static asset paths and the
    // logo/icon under /public.
    "/((?!_next/static|_next/image|favicon.ico|.*\\.png$|.*\\.jpg$|.*\\.svg$|.*\\.webp$).*)",
  ],
};
