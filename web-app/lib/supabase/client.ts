// =============================================================================
//  Browser-side Supabase client.
// -----------------------------------------------------------------------------
//  Use this inside any client component that needs to call Supabase
//  directly (sign-in form, magic-link request, etc). Sessions are written
//  to HTTP-only cookies by the auth-helpers middleware; the browser
//  client just reads/writes through the same cookie-bridge so server
//  components see the same session.
// =============================================================================

"use client";

import { createBrowserClient } from "@supabase/ssr";

export function createClient() {
  const url     = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
  return createBrowserClient(url, anonKey);
}
