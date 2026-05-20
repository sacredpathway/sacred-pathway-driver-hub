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
// =============================================================================

import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

const PROTECTED_PREFIXES = [
  "/dashboard",
  "/loads",
  "/drivers",
  "/payroll",
  "/fleet",
  "/brokers",
  "/broker-contacts",
  "/expenses",
  "/documents",
  "/reports",
  "/settings",
];

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
          request.cookies.set({ name, value, ...options });
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

  // Refresh the session so downstream server components don't see a stale token.
  const { data: { user } } = await supabase.auth.getUser();

  const pathname = request.nextUrl.pathname;
  const isProtected = PROTECTED_PREFIXES.some((p) => pathname === p || pathname.startsWith(p + "/"));

  if (isProtected && !user) {
    const url = request.nextUrl.clone();
    url.pathname = "/auth/signin";
    url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }
  // Signed-in users on /auth/signin → bump them straight to dashboard
  if (pathname === "/auth/signin" && user) {
    const url = request.nextUrl.clone();
    url.pathname = "/dashboard";
    url.search = "";
    return NextResponse.redirect(url);
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
