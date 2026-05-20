// Auth callback for Supabase magic links + OAuth flows.
//
// Supabase sends magic-link emails with EITHER:
//   • `?token_hash=...&type=email|magiclink` — email OTP verification flow (current default)
//   • `?code=...`                            — PKCE / OAuth flow
//
// We handle both. The previous version only handled `code`, which made
// magic-link sign-in silently fail (no session was created, middleware
// bounced the user back to /signin → infinite loop).

import { NextResponse, type NextRequest } from "next/server";
import { createServerClient, type CookieOptions } from "@supabase/ssr";

export const runtime = "edge";

export async function GET(request: NextRequest) {
  const url        = new URL(request.url);
  const code       = url.searchParams.get("code");
  const tokenHash  = url.searchParams.get("token_hash");
  const otpType    = url.searchParams.get("type"); // email | magiclink | recovery | invite | signup
  const next       = url.searchParams.get("next") ?? "/dashboard";
  const errorParam = url.searchParams.get("error_description") ?? url.searchParams.get("error");

  // Supabase puts auth errors in the URL if its own verify step failed
  // upstream. Surface them so the user sees the real reason on /signin.
  if (errorParam) {
    return NextResponse.redirect(
      new URL(
        `/auth/signin?error=${encodeURIComponent(errorParam)}`,
        request.url
      )
    );
  }

  if (!code && !tokenHash) {
    return NextResponse.redirect(
      new URL(
        "/auth/signin?error=Sign-in+link+is+missing+a+verification+token.+Try+requesting+a+new+one.",
        request.url
      )
    );
  }

  // Build the success response FIRST so the Supabase client's cookie
  // callbacks can write the session cookies onto it.
  let response = NextResponse.redirect(new URL(next, request.url));

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        get(name: string) {
          return request.cookies.get(name)?.value;
        },
        set(name: string, value: string, options: CookieOptions) {
          response.cookies.set({ name, value, ...options });
        },
        remove(name: string, options: CookieOptions) {
          response.cookies.set({ name, value: "", ...options });
        },
      },
    }
  );

  // 1) PKCE / OAuth: code → session
  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) {
      return NextResponse.redirect(
        new URL(
          `/auth/signin?error=${encodeURIComponent(error.message)}`,
          request.url
        )
      );
    }
    return response;
  }

  // 2) Email OTP: token_hash + type → session
  if (tokenHash) {
    // `type` defaults to "email" so legacy templates that omit `&type=` still work.
    const verifyType =
      (otpType as "email" | "magiclink" | "recovery" | "invite" | "signup" | null)
      ?? "email";
    const { error } = await supabase.auth.verifyOtp({
      token_hash: tokenHash,
      type: verifyType,
    });
    if (error) {
      return NextResponse.redirect(
        new URL(
          `/auth/signin?error=${encodeURIComponent(error.message)}`,
          request.url
        )
      );
    }
    return response;
  }

  // Defensive fallback — unreachable given the guard above.
  return NextResponse.redirect(
    new URL("/auth/signin?error=Unknown+sign-in+state", request.url)
  );
}
