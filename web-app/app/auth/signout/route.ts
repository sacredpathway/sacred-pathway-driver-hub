// Sign-out handler. POST-only so a stray GET (e.g. a page prefetch) can't
// log the user out unintentionally.

import { NextResponse, type NextRequest } from "next/server";
import { createServerClient, type CookieOptions } from "@supabase/ssr";

type CookieToSet = { name: string; value: string; options: CookieOptions };

export async function POST(request: NextRequest) {
  const response = NextResponse.redirect(new URL("/", request.url));

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        // All cookies of one auth write (chunked session + removals) arrive
        // together and land on the same response.
        setAll(cookiesToSet: CookieToSet[]) {
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options),
          );
        },
      },
    }
  );

  // Local scope: end only THIS browser session. The supabase-js default
  // ("global") revokes every session of the user, including other browsers
  // and the iPhone app.
  await supabase.auth.signOut({ scope: "local" });
  return response;
}
