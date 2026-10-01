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

type CookieToSet = { name: string; value: string; options: CookieOptions };

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
      "They are inlined at build time — set them in the build environment (web-app/.env.local or CI)."
    );
  }

  return createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet: CookieToSet[]) {
        try {
          cookiesToSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, options),
          );
        } catch {
          // Cookies cannot be set during a server render of a Server
          // Component. The middleware refresh handles writes; this catch
          // silences the harmless throw.
        }
      },
    },
  });
}
