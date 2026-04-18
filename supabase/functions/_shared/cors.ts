// Shared CORS headers for all edge functions invoked from the iOS app.
// Supabase functions are HTTPS endpoints — the iOS URLSession needs CORS
// for any future web client we may add (admin dashboard, etc.).
export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

/**
 * Wrap any handler so that:
 *   - OPTIONS pre-flights succeed without auth.
 *   - All responses carry CORS headers.
 *   - Unhandled exceptions become structured 500 JSON instead of HTML.
 */
export function withCors(
  handler: (req: Request) => Promise<Response>,
): (req: Request) => Promise<Response> {
  return async (req: Request) => {
    if (req.method === "OPTIONS") {
      return new Response("ok", { headers: corsHeaders });
    }
    try {
      const res = await handler(req);
      // Merge CORS headers into the handler's response.
      const merged = new Headers(res.headers);
      for (const [k, v] of Object.entries(corsHeaders)) merged.set(k, v);
      return new Response(res.body, {
        status: res.status,
        statusText: res.statusText,
        headers: merged,
      });
    } catch (err) {
      console.error("[withCors] uncaught:", err);
      return jsonResponse({ error: (err as Error).message ?? "unknown error" }, 500);
    }
  };
}

export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
