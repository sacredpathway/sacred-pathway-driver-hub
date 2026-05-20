// =============================================================================
//  Server-side Supabase client (Edge-runtime safe).
// -----------------------------------------------------------------------------
//  Uses `@supabase/ssr` with Next.js cookies(). Every server component +
//  route handler that needs an authenticated query imports `createClient`
//  from here.
//
//  We deliberately use ONLY the anon key. RLS on every `profile_id`-keyed
//  table enforces per-user isolation server-side, identical to the
//  protection the iOS app already relies on.
// =============================================================================

import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { cookies } from "next/headers";

// Next.js 15: `cookies()` returns a Promise. Callers must `await` this
// function. Every server component that pulls auth from Supabase calls
// `const supabase = await createClient()` at the top.
export async function createClient() {
  const cookieStore = await cookies();

  const url     = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    throw new Error(
      "NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY are required. " +
      "Set them in Cloudflare Pages → Settings → Environment Variables."
    );
  }

  return createServerClient(url, anonKey, {
    cookies: {
      get(name: string) {
        return cookieStore.get(name)?.value;
      },
      set(name: string, value: string, options: CookieOptions) {
        try {
          cookieStore.set({ name, value, ...options });
        } catch {
          // Cookies cannot be set during a server render of a Server
          // Component. The middleware refresh handles writes; this catch
          // silences the harmless throw.
        }
      },
      remove(name: string, options: CookieOptions) {
        try {
          cookieStore.set({ name, value: "", ...options });
        } catch {
          // Same rationale as `set` above.
        }
      },
    },
  });
}
