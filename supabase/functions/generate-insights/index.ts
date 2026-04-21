// ============================================================================
// Sacred Pathway — generate-insights Edge Function
// ----------------------------------------------------------------------------
// Replaces ClaudeAIService.generateText. SmartInsightsView sends a prompt
// assembled from the carrier's weekly numbers; we call OpenAI with a cheap
// text model and return the string response.
//
// The OpenAI key lives only here.
// ============================================================================
//
// Request (POST, Authorization: Bearer <user-jwt>):
//   { "prompt": "<assembled weekly summary prompt>" }
//
// Response 200:
//   { "ok": true, "text": "<summary>" }
// ============================================================================

// supabase-js 2.49.4+ verifies JWTs via JWKS — required after the JWT
// Signing Keys migration that issues ES256 tokens.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.58.0";
import { jsonResponse, withCors } from "../_shared/cors.ts";
import { ChatError, chatCompletion } from "../_shared/openai.ts";

const MODEL = Deno.env.get("OPENAI_TEXT_MODEL") ?? "gpt-4o-mini";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

const MAX_PROMPT_LEN = 8000;

Deno.serve(withCors(async (req) => {
  if (req.method !== "POST") {
    return jsonResponse({ ok: false, code: "method_not_allowed" }, 405);
  }

  const authHeader = req.headers.get("authorization") ?? "";
  if (!authHeader.toLowerCase().startsWith("bearer ")) {
    return jsonResponse({ ok: false, code: "missing_auth" }, 401);
  }
  const userClient = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false },
  });
  const { data: userData, error: userErr } = await userClient.auth.getUser();
  if (userErr || !userData?.user) {
    return jsonResponse({ ok: false, code: "invalid_jwt" }, 401);
  }

  let payload: { prompt?: string };
  try {
    payload = await req.json();
  } catch {
    return jsonResponse({ ok: false, code: "bad_request" }, 400);
  }
  const prompt = (payload.prompt ?? "").trim();
  if (!prompt) {
    return jsonResponse({ ok: false, code: "bad_request", message: "prompt required" }, 400);
  }
  if (prompt.length > MAX_PROMPT_LEN) {
    return jsonResponse({ ok: false, code: "prompt_too_long" }, 413);
  }

  try {
    const result = await chatCompletion({
      model: MODEL,
      messages: [{ role: "user", content: prompt }],
      maxTokens: 512,
      temperature: 0.4,
    });
    return jsonResponse({ ok: true, text: result.content, model: result.model });
  } catch (err) {
    const e = err as ChatError;
    return jsonResponse(
      { ok: false, code: e.code ?? "openai_error", message: e.message },
      502,
    );
  }
}));
