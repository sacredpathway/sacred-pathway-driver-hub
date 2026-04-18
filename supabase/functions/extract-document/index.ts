// ============================================================================
// Sacred Pathway — extract-document Edge Function
// ----------------------------------------------------------------------------
// Response contract (strict):
//
//   Success 200:
//     { "success": true, "document_id": "...", "status": "processed",
//       "extracted": {...}, "raw_text": "...", "model": "...",
//       "confidence": "high" | "medium" | "low" }
//
//   Error (non-2xx or ok=false):
//     { "success": false,
//       "code": "SCAN_TEMPORARILY_UNAVAILABLE" | "RATE_LIMITED" |
//               "TIMEOUT" | "AUTH_EXPIRED" | "UNKNOWN_SCAN_ERROR",
//       "message": "<user-friendly text>" }
//
// No raw provider errors, JSON fragments, stack traces, or API keys are
// ever returned to the client. All provider details are logged to the
// function logs only.
// ============================================================================

// deno-lint-ignore-file no-explicit-any
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { jsonResponse, withCors } from "../_shared/cors.ts";

// ---------- Config ----------
const OPENAI_URL = "https://api.openai.com/v1/chat/completions";
const DEFAULT_MODEL = Deno.env.get("OPENAI_VISION_MODEL") ?? "gpt-4o";
const OPENAI_TIMEOUT_MS = 45_000;

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

// ---------- Error helpers ----------
type ErrorCode =
  | "SCAN_TEMPORARILY_UNAVAILABLE"
  | "RATE_LIMITED"
  | "TIMEOUT"
  | "AUTH_EXPIRED"
  | "UNKNOWN_SCAN_ERROR";

const USER_MESSAGE: Record<ErrorCode, string> = {
  SCAN_TEMPORARILY_UNAVAILABLE:
    "Document scanning is temporarily unavailable. Tap Enter Manually to add this one by hand.",
  RATE_LIMITED:
    "Too many scans at once. Wait a few seconds and tap Try Again.",
  TIMEOUT: "That took too long. Tap Try Again, or enter manually.",
  AUTH_EXPIRED: "Your session expired. Sign out and sign back in.",
  UNKNOWN_SCAN_ERROR:
    "Something went wrong while scanning. Tap Try Again, or enter it manually.",
};

const HTTP_STATUS: Record<ErrorCode, number> = {
  SCAN_TEMPORARILY_UNAVAILABLE: 503,
  RATE_LIMITED: 429,
  TIMEOUT: 504,
  AUTH_EXPIRED: 401,
  UNKNOWN_SCAN_ERROR: 502,
};

function errorResponse(code: ErrorCode, logDetail?: string): Response {
  if (logDetail) {
    console.error(`[extract-document][${code}] ${logDetail.slice(0, 2000)}`);
  }
  return jsonResponse(
    { success: false, code, message: USER_MESSAGE[code] },
    HTTP_STATUS[code],
  );
}

// ---------- Prompt ----------
const SYSTEM_PROMPT = `
You are an AI assistant for a trucking company. You extract structured data
from scanned or uploaded documents (rate confirmations, fuel receipts, lumper
fees, toll receipts, repair bills, BOLs, invoices).

Determine the document type first, then extract fields accordingly.

For RATE CONFIRMATIONS / LOAD SHEETS:
  - document_type: "rate_confirmation"
  - broker_name, broker_mc_number
  - load_number
  - pickup_date (YYYY-MM-DD), delivery_date (YYYY-MM-DD)
  - origin (city, state), destination (city, state)
  - total_miles
  - line_haul_rate, fuel_surcharge, accessorial_charges, total_revenue

For FUEL RECEIPTS:
  - document_type: "fuel_receipt"
  - vendor_name
  - expense_amount (total cost)
  - gallons, price_per_gallon
  - expense_category: "fuel"

For LUMPER FEES:
  - document_type: "lumper_fee"
  - vendor_name, expense_amount
  - expense_category: "lumper"

For TOLL RECEIPTS:
  - document_type: "toll"
  - vendor_name (toll authority), expense_amount
  - expense_category: "toll"

For REPAIR / MAINTENANCE BILLS:
  - document_type: "repair"
  - vendor_name, expense_amount
  - expense_category: "maintenance"
  - notes (description of work)

For any OTHER document:
  - document_type: "other"
  - Extract whatever fields seem relevant.

Always include:
  - "confidence": "high" | "medium" | "low"
  - "notes": short free-form description (always return, even if empty string)

Omit fields you cannot see — do not guess. Dates must be ISO YYYY-MM-DD.
Numbers must be plain JSON numbers (no "$" or commas).

Return ONLY a JSON object matching this schema. No markdown. No prose.
`.trim();

// ---------- Handler ----------
Deno.serve(withCors(async (req) => {
  try {
    if (req.method !== "POST") {
      return errorResponse("UNKNOWN_SCAN_ERROR", `method=${req.method}`);
    }

    // ---- 1. Authenticate ----
    const authHeader = req.headers.get("authorization") ?? "";
    const jwt = authHeader.toLowerCase().startsWith("bearer ")
      ? authHeader.slice(7).trim()
      : "";
    if (!jwt) {
      return errorResponse("AUTH_EXPIRED", "missing bearer token");
    }

    const userClient = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
      auth: { persistSession: false },
    });
    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData?.user) {
      return errorResponse("AUTH_EXPIRED", `getUser: ${userErr?.message}`);
    }
    const userId = userData.user.id;

    // ---- 2. Parse input ----
    let body: { document_id?: string };
    try {
      body = await req.json();
    } catch (err) {
      return errorResponse("UNKNOWN_SCAN_ERROR", `bad json: ${(err as Error).message}`);
    }
    const documentId = body.document_id;
    if (!documentId || typeof documentId !== "string") {
      return errorResponse("UNKNOWN_SCAN_ERROR", "missing document_id");
    }

    // ---- 3. Load row (RLS enforced via userClient) ----
    const { data: docRow, error: rowErr } = await userClient
      .from("documents")
      .select("id, profile_id, storage_path, retry_count, status")
      .eq("id", documentId)
      .single();

    if (rowErr || !docRow) {
      return errorResponse(
        "UNKNOWN_SCAN_ERROR",
        `row lookup: ${rowErr?.message ?? "not found"}`,
      );
    }
    if (docRow.profile_id !== userId) {
      return errorResponse("AUTH_EXPIRED", "profile mismatch");
    }

    // ---- 4. Download file using service role ----
    const adminClient = createClient(SUPABASE_URL, SERVICE_ROLE, {
      auth: { persistSession: false },
    });

    await adminClient.from("documents").update({
      status: "processing",
      error_message: null,
    }).eq("id", documentId);

    const { data: fileBlob, error: dlErr } = await adminClient.storage
      .from("documents")
      .download(docRow.storage_path);

    if (dlErr || !fileBlob) {
      await markFailed(adminClient, documentId, `storage_download: ${dlErr?.message}`);
      return errorResponse("UNKNOWN_SCAN_ERROR", `storage: ${dlErr?.message}`);
    }

    const contentType = fileBlob.type || guessContentType(docRow.storage_path);

    // ---- 4b. Validate file type BEFORE calling the provider ----
    // The vision endpoint only accepts a fixed set of image MIMEs. Anything
    // else (PDF, Word doc, video, arbitrary binary) is rejected here with
    // a clean structured error. The user sees the UNKNOWN_SCAN_ERROR copy
    // which already tells them to Try Again or enter manually.
    const validation = validateFileType(contentType, docRow.storage_path, fileBlob.size);
    if (!validation.ok) {
      await markFailed(adminClient, documentId, `unsupported_file_type: ${validation.reason}`);
      return errorResponse("UNKNOWN_SCAN_ERROR", `unsupported_file_type: ${validation.reason}`);
    }

    const imageDataUrl = await toDataUrl(fileBlob, contentType);

    // ---- 5. Call OpenAI ----
    const openaiKey = Deno.env.get("OPENAI_API_KEY");
    if (!openaiKey) {
      await markFailed(adminClient, documentId, "missing OPENAI_API_KEY");
      return errorResponse("SCAN_TEMPORARILY_UNAVAILABLE", "missing api key");
    }

    let raw: string;
    let modelUsed: string;
    try {
      const result = await callOpenAI(openaiKey, {
        model: DEFAULT_MODEL,
        imageDataUrl,
      });
      raw = stripJsonFences(result.content);
      modelUsed = result.model;
    } catch (err) {
      const mapped = classifyProviderError(err);
      await markFailed(adminClient, documentId, `provider: ${(err as Error).message}`);
      return errorResponse(mapped, (err as Error).message);
    }

    // ---- 6. Parse JSON ----
    let extracted: Record<string, unknown>;
    try {
      extracted = JSON.parse(raw);
      if (typeof extracted !== "object" || extracted === null) {
        throw new Error("top-level value is not an object");
      }
    } catch (err) {
      await markFailed(
        adminClient,
        documentId,
        `json_parse: ${(err as Error).message}`,
      );
      return errorResponse("UNKNOWN_SCAN_ERROR", `parse: ${(err as Error).message}`);
    }

    // ---- 7. Persist ----
    const { error: updateErr } = await adminClient
      .from("documents")
      .update({
        status: "processed",
        processed: true,
        extracted_data: extracted,
        raw_text: raw,
        confidence: (extracted.confidence as string | undefined) ?? "medium",
        document_type: (extracted.document_type as string | undefined) ?? "other",
        provider: "openai",
        model: modelUsed,
        retry_count: (docRow.retry_count ?? 0) + (docRow.status === "failed" ? 1 : 0),
        error_message: null,
      })
      .eq("id", documentId);

    if (updateErr) {
      await markFailed(adminClient, documentId, `db_update: ${updateErr.message}`);
      return errorResponse("UNKNOWN_SCAN_ERROR", `db: ${updateErr.message}`);
    }

    return jsonResponse({
      success: true,
      document_id: documentId,
      status: "processed",
      extracted,
      raw_text: raw,
      model: modelUsed,
      confidence: extracted.confidence ?? "medium",
    });
  } catch (err) {
    // Top-level safety net. Never leak.
    return errorResponse("UNKNOWN_SCAN_ERROR", `top-level: ${(err as Error).message}`);
  }
}));

// ============================================================================
// Provider call + classification (OpenAI only; NO Anthropic usage anywhere)
// ============================================================================

interface OpenAICallOptions {
  model: string;
  imageDataUrl: string;
}

interface OpenAIResult {
  content: string;
  model: string;
}

async function callOpenAI(
  apiKey: string,
  opts: OpenAICallOptions,
): Promise<OpenAIResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), OPENAI_TIMEOUT_MS);

  const payload = {
    model: opts.model,
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      {
        role: "user",
        content: [
          {
            type: "text",
            text: "Extract all data from this trucking document and return only JSON.",
          },
          {
            type: "image_url",
            image_url: { url: opts.imageDataUrl, detail: "high" },
          },
        ],
      },
    ],
    max_tokens: 1200,
    temperature: 0,
    response_format: { type: "json_object" },
  };

  try {
    const res = await fetch(OPENAI_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`,
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    if (!res.ok) {
      const text = await res.text();
      const err = new Error(`http_${res.status}: ${text.slice(0, 400)}`);
      (err as any).status = res.status;
      (err as any).rawBody = text;
      throw err;
    }

    const json = await res.json();
    const choice = json.choices?.[0];
    const content = choice?.message?.content;
    if (!content) throw new Error("empty response from provider");
    return { content, model: json.model ?? opts.model };
  } finally {
    clearTimeout(timer);
  }
}

function classifyProviderError(err: unknown): ErrorCode {
  const anyErr = err as any;
  const status: number | undefined = anyErr?.status;
  const raw: string = (anyErr?.rawBody ?? anyErr?.message ?? "").toString().toLowerCase();
  const name: string = (anyErr?.name ?? "").toString();

  // Abort = timeout.
  if (name === "AbortError" || raw.includes("aborted") || raw.includes("timed out")) {
    return "TIMEOUT";
  }

  // Billing / quota.
  if (
    raw.includes("credit balance") ||
    raw.includes("insufficient_quota") ||
    raw.includes("billing") ||
    raw.includes("payment required") ||
    raw.includes("payment method") ||
    raw.includes("quota") ||
    status === 402
  ) {
    return "SCAN_TEMPORARILY_UNAVAILABLE";
  }

  // Rate limits.
  if (status === 429 || raw.includes("rate limit") || raw.includes("rate_limited")) {
    return "RATE_LIMITED";
  }

  // Auth (provider key invalid).
  if (status === 401 || status === 403 || raw.includes("invalid_api_key")) {
    return "SCAN_TEMPORARILY_UNAVAILABLE";
  }

  // Everything else.
  return "UNKNOWN_SCAN_ERROR";
}

// ============================================================================
// DB + file helpers
// ============================================================================

async function markFailed(client: any, id: string, msg: string): Promise<void> {
  await client.from("documents").update({
    status: "failed",
    error_message: msg.slice(0, 1000),
  }).eq("id", id);
}

async function toDataUrl(blob: Blob, contentType: string): Promise<string> {
  const buf = new Uint8Array(await blob.arrayBuffer());
  // By the time we reach toDataUrl, validateFileType has already approved
  // the MIME. Still normalize to a canonical casing for the data URL.
  const safeMime = contentType.toLowerCase();
  const b64 = encodeBase64(buf);
  return `data:${safeMime};base64,${b64}`;
}

// ----------------------------------------------------------------------------
// File type validation — enforced BEFORE any provider call.
// ----------------------------------------------------------------------------
const ALLOWED_MIMES = new Set<string>([
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
  "image/gif",
  "image/heic",
  "image/heif",
]);

const ALLOWED_EXTENSIONS = new Set<string>([
  "jpg", "jpeg", "png", "webp", "gif", "heic", "heif",
]);

const MAX_FILE_BYTES = 20 * 1024 * 1024; // 20 MB hard ceiling

interface FileValidationResult {
  ok: boolean;
  reason?: string;
}

function validateFileType(
  contentType: string,
  storagePath: string,
  size: number,
): FileValidationResult {
  if (size <= 0) {
    return { ok: false, reason: "empty file" };
  }
  if (size > MAX_FILE_BYTES) {
    return { ok: false, reason: `file too large (${size} bytes)` };
  }

  const mime = (contentType ?? "").toLowerCase().split(";")[0].trim();
  const ext = extensionOf(storagePath);

  // PDFs and non-image types are rejected explicitly.
  // The iOS client is expected to render PDFs to a JPEG before upload.
  if (mime === "application/pdf" || ext === "pdf") {
    return { ok: false, reason: "pdf not supported at provider layer" };
  }

  const mimeAllowed = ALLOWED_MIMES.has(mime);
  const extAllowed = ALLOWED_EXTENSIONS.has(ext);

  // Accept if either MIME or extension is on the allow-list. Storage can
  // store a file with an empty Content-Type, in which case the extension
  // is all we have.
  if (!mimeAllowed && !extAllowed) {
    return { ok: false, reason: `unsupported mime=${mime} ext=${ext}` };
  }

  return { ok: true };
}

function extensionOf(path: string): string {
  const p = path.toLowerCase();
  const idx = p.lastIndexOf(".");
  if (idx < 0 || idx === p.length - 1) return "";
  return p.slice(idx + 1);
}

function guessContentType(path: string): string {
  const p = path.toLowerCase();
  if (p.endsWith(".png")) return "image/png";
  if (p.endsWith(".heic") || p.endsWith(".heif")) return "image/heic";
  return "image/jpeg";
}

function encodeBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

function stripJsonFences(s: string): string {
  let out = s.trim();
  if (out.startsWith("```")) {
    out = out.replace(/^```(json)?/i, "").replace(/```$/, "");
  }
  return out.trim();
}
