// ============================================================================
// Sacred Pathway — extract-document Edge Function
// ----------------------------------------------------------------------------
// Response contract (strict):
//
//   Success 200:
//     { "success": true, "document_id": "...", "status": "processed" | "pending_manual_review",
//       "extracted": {...}, "raw_text": "...", "model": "...",
//       "confidence": "high" | "medium" | "low" }
//
//   Error (non-2xx):
//     { "success": false,
//       "code": "SCAN_TEMPORARILY_UNAVAILABLE" | "RATE_LIMITED" |
//               "TIMEOUT" | "AUTH_EXPIRED" | "UNKNOWN_SCAN_ERROR",
//       "message": "<user-friendly text>",
//       "details": "<stage:code — safe technical hint, ≤200 chars>" }
//
// No raw provider errors, JSON fragments, stack traces, or API keys are
// ever returned to the client's `message` field. `details` is a short,
// stage-prefixed hint that is safe to surface under a "Show details"
// disclosure in the UI.
// ============================================================================

// deno-lint-ignore-file no-explicit-any
// Pin to a supabase-js release that supports the new JWT Signing Keys
// (asymmetric ES256/RS256) via JWKS, so `auth.getUser()` verifies tokens
// signed with either the legacy HS256 secret OR the new signing keys.
// Shipped in supabase-js ≥ 2.49.4.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.58.0";
import { jsonResponse, withCors } from "../_shared/cors.ts";
import {
  buildV2UserContent,
  checkV2File,
  estimatePdfPageCount,
  EXTRACTION_VERSION,
  looksLikePdf,
  type OpenAIContentPart,
  sanitizeExtraction,
  SYSTEM_PROMPT_V2,
  V2_MAX_PDF_PAGES,
} from "../_shared/document-extraction.ts";
import { routableDocumentType } from "../_shared/document-taxonomy.ts";
import {
  PAYROLL_EXTRACTION_VERSION,
  sanitizePayrollExtraction,
  SYSTEM_PROMPT_V3,
} from "../_shared/payroll-extraction.ts";

// ---------- Config ----------
const OPENAI_URL = "https://api.openai.com/v1/chat/completions";
const DEFAULT_MODEL = Deno.env.get("OPENAI_VISION_MODEL") ?? "gpt-4o";
const OPENAI_TIMEOUT_MS = 45_000;

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

// ---------- Error envelope ----------
type ErrorCode =
  | "SCAN_TEMPORARILY_UNAVAILABLE"
  | "RATE_LIMITED"
  | "TIMEOUT"
  | "AUTH_EXPIRED"
  | "UNKNOWN_SCAN_ERROR";

const USER_MESSAGE: Record<ErrorCode, string> = {
  SCAN_TEMPORARILY_UNAVAILABLE:
    "Document scanning is temporarily unavailable. Tap Enter Manually to add this one by hand.",
  RATE_LIMITED: "Too many scans at once. Wait a few seconds and tap Try Again.",
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

function clip(s: string, max = 200): string {
  if (!s) return "";
  return s.length > max ? s.slice(0, max) : s;
}

function errorResponse(
  traceId: string,
  code: ErrorCode,
  stage: string,
  logDetail?: string,
): Response {
  const line = `[${traceId}][${code}][${stage}] ${logDetail ?? ""}`;
  console.error(line);
  return jsonResponse(
    {
      success: false,
      code,
      message: USER_MESSAGE[code],
      details: clip(`${stage}: ${logDetail ?? code}`),
    },
    HTTP_STATUS[code],
  );
}

function log(traceId: string, stage: string, info?: unknown): void {
  if (info === undefined) {
    console.log(`[${traceId}][${stage}]`);
  } else {
    console.log(`[${traceId}][${stage}]`, info);
  }
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

Return ONLY a valid JSON object matching this schema. No markdown fences.
No prose. No explanation. The very first character of your response must
be "{" and the last character must be "}".
`.trim();

// ---------- Handler ----------
Deno.serve(withCors(async (req) => {
  const traceId = crypto.randomUUID().slice(0, 8);
  const t0 = Date.now();

  try {
    if (req.method !== "POST") {
      return errorResponse(
        traceId,
        "UNKNOWN_SCAN_ERROR",
        "method",
        `method=${req.method}`,
      );
    }

    // ---- 1. Authenticate ----
    const authHeader = req.headers.get("authorization") ?? "";
    const jwt = authHeader.toLowerCase().startsWith("bearer ")
      ? authHeader.slice(7).trim()
      : "";
    if (!jwt) {
      return errorResponse(
        traceId,
        "AUTH_EXPIRED",
        "auth",
        "missing bearer token",
      );
    }

    const userClient = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
      auth: { persistSession: false },
    });
    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData?.user) {
      return errorResponse(
        traceId,
        "AUTH_EXPIRED",
        "auth",
        `getUser: ${clip(userErr?.message ?? "nil user")}`,
      );
    }
    const userId = userData.user.id;
    log(traceId, "auth_ok", { userId });

    // ---- 2. Parse input ----
    let body: {
      document_id?: string;
      extraction_version?: string;
      type_hint?: string;
      persist?: boolean;
    };
    try {
      body = await req.json();
    } catch (err) {
      return errorResponse(
        traceId,
        "UNKNOWN_SCAN_ERROR",
        "bad_json",
        clip((err as Error).message),
      );
    }
    const documentId = body.document_id;
    if (!documentId || typeof documentId !== "string") {
      return errorResponse(
        traceId,
        "UNKNOWN_SCAN_ERROR",
        "missing_document_id",
        "",
      );
    }
    log(traceId, "input_ok", { documentId });

    // ---- 3. Load row (RLS enforced via userClient) ----
    const { data: docRow, error: rowErr } = await userClient
      .from("documents")
      .select("id, profile_id, storage_path, retry_count, status")
      .eq("id", documentId)
      .single();

    if (rowErr || !docRow) {
      return errorResponse(
        traceId,
        "UNKNOWN_SCAN_ERROR",
        "row_lookup",
        clip(rowErr?.message ?? "not found"),
      );
    }
    if (docRow.profile_id !== userId) {
      return errorResponse(traceId, "AUTH_EXPIRED", "profile_mismatch", "");
    }
    log(traceId, "row_loaded", {
      storage_path: docRow.storage_path,
      status: docRow.status,
    });

    // ---- v2 (web app, opt-in). The iPhone never sends extraction_version,
    // so everything below this branch is the unchanged v1 contract.
    // ---- v3 = payroll profile (Smart Payroll Upload, opt-in). Same pipeline
    // as v2 with a different prompt + sanitiser; v1 and v2 are unchanged.
    if (
      body.extraction_version === EXTRACTION_VERSION ||
      body.extraction_version === PAYROLL_EXTRACTION_VERSION
    ) {
      return await runV2(traceId, t0, docRow, {
        profile: body.extraction_version === PAYROLL_EXTRACTION_VERSION
          ? "v3"
          : "v2",
        typeHint: typeof body.type_hint === "string" ? body.type_hint : null,
        // persist:false = dry-run preview (pending-document backfill plan):
        // extract and return, write NOTHING to the database.
        persist: body.persist !== false,
      });
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
      await markFailed(
        adminClient,
        documentId,
        `storage_download: ${dlErr?.message}`,
      );
      return errorResponse(
        traceId,
        "UNKNOWN_SCAN_ERROR",
        "storage_download",
        clip(dlErr?.message ?? "nil blob"),
      );
    }

    const contentType = fileBlob.type || guessContentType(docRow.storage_path);
    const fileSize = fileBlob.size ?? 0;
    log(traceId, "file_downloaded", { contentType, fileSize });

    // ---- 4b. Validate file type and size BEFORE the provider call ----
    const validation = validateFileType(
      contentType,
      docRow.storage_path,
      fileSize,
    );
    if (!validation.ok) {
      await markFailed(
        adminClient,
        documentId,
        `unsupported_file_type: ${validation.reason}`,
      );
      return errorResponse(
        traceId,
        "UNKNOWN_SCAN_ERROR",
        "validate",
        clip(validation.reason ?? ""),
      );
    }

    const imageDataUrl = await toDataUrl(fileBlob, contentType);

    // ---- 5. Call OpenAI ----
    const openaiKey = Deno.env.get("OPENAI_API_KEY");
    if (!openaiKey) {
      await markFailed(adminClient, documentId, "missing OPENAI_API_KEY");
      return errorResponse(
        traceId,
        "SCAN_TEMPORARILY_UNAVAILABLE",
        "missing_key",
        "OPENAI_API_KEY not set",
      );
    }

    let raw: string;
    let modelUsed: string;
    let finishReason: string | null = null;
    try {
      const result = await callOpenAI(openaiKey, {
        model: DEFAULT_MODEL,
        imageDataUrl,
      });
      raw = stripJsonFences(result.content);
      modelUsed = result.model;
      finishReason = result.finishReason;
      log(traceId, "openai_ok", {
        model: modelUsed,
        finishReason,
        contentLen: result.content.length,
        strippedLen: raw.length,
      });
    } catch (err) {
      const mapped = classifyProviderError(err);
      const anyErr = err as any;
      const technical = clip(
        `${anyErr?.status ?? ""} ${anyErr?.message ?? String(err)}`,
      );
      await markFailed(adminClient, documentId, `provider: ${technical}`);
      return errorResponse(traceId, mapped, "openai", technical);
    }

    // ---- 6. Parse JSON (resilient) ----
    // Strategy:
    //   a) strict JSON.parse
    //   b) if that fails, try to locate the first balanced {...} object
    //      in the raw text and parse that
    //   c) if that also fails, DO NOT error out — persist raw_text with
    //      status=pending_manual_review so the iOS app shows a blank
    //      review form with the raw text as reference
    let extracted: Record<string, unknown> | null = null;
    let parseStage: "strict" | "salvage" | "fallback" = "strict";
    try {
      const parsed = JSON.parse(raw);
      if (typeof parsed !== "object" || parsed === null) {
        throw new Error("top-level not object");
      }
      extracted = parsed;
    } catch (_) {
      // Try to salvage: find the first '{' and last '}' and parse that
      const first = raw.indexOf("{");
      const last = raw.lastIndexOf("}");
      if (first >= 0 && last > first) {
        try {
          const salvaged = JSON.parse(raw.slice(first, last + 1));
          if (typeof salvaged === "object" && salvaged !== null) {
            extracted = salvaged;
            parseStage = "salvage";
          }
        } catch (_) { /* fall through */ }
      }
      if (!extracted) {
        parseStage = "fallback";
        log(traceId, "parse_fallback", { rawLen: raw.length, finishReason });
      }
    }

    const terminalStatus = parseStage === "fallback"
      ? "pending_manual_review"
      : "processed";
    const confidence = parseStage === "fallback"
      ? "low"
      : ((extracted?.confidence as string | undefined) ?? "medium");
    const documentType = parseStage === "fallback"
      ? "other"
      : ((extracted?.document_type as string | undefined) ?? "other");

    // ---- 7. Persist ----
    const { error: updateErr } = await adminClient
      .from("documents")
      .update({
        status: terminalStatus === "processed" ? "processed" : "pending",
        processed: terminalStatus === "processed",
        extracted_data: extracted ?? {},
        raw_text: raw,
        confidence,
        document_type: documentType,
        provider: "openai",
        model: modelUsed,
        retry_count: (docRow.retry_count ?? 0) +
          (docRow.status === "failed" ? 1 : 0),
        error_message: null,
      })
      .eq("id", documentId);

    if (updateErr) {
      await markFailed(
        adminClient,
        documentId,
        `db_update: ${updateErr.message}`,
      );
      return errorResponse(
        traceId,
        "UNKNOWN_SCAN_ERROR",
        "db_update",
        clip(updateErr.message),
      );
    }

    const elapsed = Date.now() - t0;
    log(traceId, "done", { parseStage, terminalStatus, elapsed });

    return jsonResponse({
      success: true,
      document_id: documentId,
      status: terminalStatus,
      extracted: extracted ?? {},
      raw_text: raw,
      model: modelUsed,
      confidence,
      parse_stage: parseStage,
    });
  } catch (err) {
    return errorResponse(
      traceId,
      "UNKNOWN_SCAN_ERROR",
      "top_level",
      clip((err as Error).message),
    );
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
  finishReason: string | null;
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
            text:
              "Extract all data from this trucking document and return only valid JSON " +
              "matching the system prompt schema. Do not include any explanation.",
          },
          {
            type: "image_url",
            image_url: { url: opts.imageDataUrl, detail: "high" },
          },
        ],
      },
    ],
    // 2048 gives the model room to return the full structured JSON for
    // complex rate confirmations. 1200 was occasionally truncating.
    max_tokens: 2048,
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
    if (
      !content || typeof content !== "string" || content.trim().length === 0
    ) {
      const err = new Error("empty response from provider");
      (err as any).status = res.status;
      throw err;
    }
    return {
      content,
      model: json.model ?? opts.model,
      finishReason: choice?.finish_reason ?? null,
    };
  } finally {
    clearTimeout(timer);
  }
}

function classifyProviderError(err: unknown): ErrorCode {
  const anyErr = err as any;
  const status: number | undefined = anyErr?.status;
  const raw: string = (anyErr?.rawBody ?? anyErr?.message ?? "").toString()
    .toLowerCase();
  const name: string = (anyErr?.name ?? "").toString();

  if (
    name === "AbortError" || raw.includes("aborted") ||
    raw.includes("timed out")
  ) {
    return "TIMEOUT";
  }
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
  if (
    status === 429 || raw.includes("rate limit") || raw.includes("rate_limited")
  ) {
    return "RATE_LIMITED";
  }
  if (status === 401 || status === 403 || raw.includes("invalid_api_key")) {
    return "SCAN_TEMPORARILY_UNAVAILABLE";
  }
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
  const safeMime = contentType.toLowerCase();
  const b64 = encodeBase64(buf);
  return `data:${safeMime};base64,${b64}`;
}

// ----------------------------------------------------------------------------
// File validation — enforced BEFORE any provider call.
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
  "jpg",
  "jpeg",
  "png",
  "webp",
  "gif",
  "heic",
  "heif",
]);

const MIN_FILE_BYTES = 1024; // 1 KB floor — anything smaller is garbage
const MAX_FILE_BYTES = 20 * 1024 * 1024; // 20 MB ceiling — OpenAI's hard limit

interface FileValidationResult {
  ok: boolean;
  reason?: string;
}

function validateFileType(
  contentType: string,
  storagePath: string,
  size: number,
): FileValidationResult {
  if (size <= 0) return { ok: false, reason: "empty_file" };
  if (size < MIN_FILE_BYTES) return { ok: false, reason: `too_small:${size}` };
  if (size > MAX_FILE_BYTES) return { ok: false, reason: `too_large:${size}` };

  const mime = (contentType ?? "").toLowerCase().split(";")[0].trim();
  const ext = extensionOf(storagePath);

  if (mime === "application/pdf" || ext === "pdf") {
    return { ok: false, reason: "pdf_not_supported_provider" };
  }

  const mimeAllowed = ALLOWED_MIMES.has(mime);
  const extAllowed = ALLOWED_EXTENSIONS.has(ext);

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

// ============================================================================
// v2 — canonical taxonomy, PDF input, sanitised output (web app only)
// ----------------------------------------------------------------------------
// Extraction ONLY. This function never creates loads, expenses or links; the
// web app routes the sanitised result under the signed-in user's RLS.
// ============================================================================

const RAW_TEXT_MAX = 20_000;

interface V2Options {
  typeHint: string | null;
  persist: boolean;
  /** "v3" = payroll profile. Defaults to v2 behaviour. */
  profile?: "v2" | "v3";
}

interface V2DocRow {
  id: string;
  profile_id: string;
  storage_path: string;
  retry_count: number | null;
  status: string | null;
}

async function runV2(
  traceId: string,
  t0: number,
  docRow: V2DocRow,
  opts: V2Options,
): Promise<Response> {
  const documentId = docRow.id;
  const adminClient = createClient(SUPABASE_URL, SERVICE_ROLE, {
    auth: { persistSession: false },
  });
  const fail = async (code: ErrorCode, stage: string, detail: string) => {
    if (opts.persist) {
      await markFailed(adminClient, documentId, `${stage}: ${detail}`);
    }
    return errorResponse(traceId, code, stage, clip(detail));
  };

  if (opts.persist) {
    await adminClient.from("documents").update({
      status: "processing",
      error_message: null,
    })
      .eq("id", documentId);
  }

  const { data: fileBlob, error: dlErr } = await adminClient.storage
    .from("documents")
    .download(docRow.storage_path);
  if (dlErr || !fileBlob) {
    return await fail(
      "UNKNOWN_SCAN_ERROR",
      "v2_storage_download",
      dlErr?.message ?? "nil blob",
    );
  }

  const bytes = new Uint8Array(await fileBlob.arrayBuffer());
  const check = checkV2File(
    fileBlob.type ?? "",
    docRow.storage_path,
    bytes.length,
  );
  if (!check.ok) {
    return await fail("UNKNOWN_SCAN_ERROR", "v2_validate", check.reason);
  }
  if (check.kind === "pdf") {
    if (!looksLikePdf(bytes)) {
      return await fail("UNKNOWN_SCAN_ERROR", "v2_validate", "not_a_pdf");
    }
    const pages = estimatePdfPageCount(bytes);
    if (pages !== null && pages > V2_MAX_PDF_PAGES) {
      return await fail(
        "UNKNOWN_SCAN_ERROR",
        "v2_validate",
        `pdf_too_many_pages:${pages}`,
      );
    }
  }
  log(traceId, "v2_file_ok", { kind: check.kind, size: bytes.length });

  const openaiKey = Deno.env.get("OPENAI_API_KEY");
  if (!openaiKey) {
    return await fail(
      "SCAN_TEMPORARILY_UNAVAILABLE",
      "v2_missing_key",
      "OPENAI_API_KEY not set",
    );
  }

  const hint = opts.typeHint ? routableDocumentType(opts.typeHint) : null;
  const content = buildV2UserContent(
    check.kind,
    check.mime,
    encodeBase64(bytes),
    hint,
  );

  let raw: string;
  let modelUsed: string;
  try {
    const result = opts.profile === "v3"
      ? await callOpenAIV2(openaiKey, content, SYSTEM_PROMPT_V3, 4096)
      : await callOpenAIV2(openaiKey, content);
    raw = stripJsonFences(result.content);
    modelUsed = result.model;
  } catch (err) {
    const anyErr = err as any;
    const technical = clip(
      `${anyErr?.status ?? ""} ${anyErr?.message ?? String(err)}`,
    );
    return await fail(classifyProviderError(err), "v2_openai", technical);
  }

  let parsed: unknown = null;
  let parseStage: "strict" | "salvage" | "fallback" = "strict";
  try {
    parsed = JSON.parse(raw);
  } catch (_) {
    const first = raw.indexOf("{");
    const last = raw.lastIndexOf("}");
    if (first >= 0 && last > first) {
      try {
        parsed = JSON.parse(raw.slice(first, last + 1));
        parseStage = "salvage";
      } catch (_) { /* fall through */ }
    }
    if (parsed === null) parseStage = "fallback";
  }

  // Untrusted model output -> whitelisted, validated fields only.
  if (opts.profile === "v3") {
    return await finishV3(traceId, t0, adminClient, docRow, opts, {
      parsed: parseStage === "fallback" ? {} : parsed,
      parseStage,
      hint,
      raw,
      modelUsed,
      mime: check.mime,
      size: bytes.length,
      fail,
    });
  }
  const sanitized = sanitizeExtraction(parseStage === "fallback" ? {} : parsed);
  const extracted = {
    ...sanitized,
    parse_stage: parseStage,
    // Upload-time type chosen by the user, kept so routing can flag a
    // disagreement even when the document is re-routed later.
    type_hint: hint,
    // A failed parse is never high confidence, whatever the model claimed.
    model_confidence: parseStage === "fallback"
      ? null
      : sanitized.model_confidence,
  };

  if (opts.persist) {
    const { error: updateErr } = await adminClient
      .from("documents")
      .update({
        status: "processed",
        processed: true,
        extracted_data: extracted,
        raw_text: raw.slice(0, RAW_TEXT_MAX),
        confidence: extracted.model_confidence ?? "low",
        document_type: extracted.document_type,
        provider: "openai",
        model: modelUsed,
        file_mime_type: check.mime,
        file_size: bytes.length,
        extraction_version: EXTRACTION_VERSION,
        retry_count: (docRow.retry_count ?? 0) +
          (docRow.status === "failed" ? 1 : 0),
        error_message: null,
      })
      .eq("id", documentId);
    if (updateErr) {
      return await fail(
        "UNKNOWN_SCAN_ERROR",
        "v2_db_update",
        updateErr.message,
      );
    }
  }

  log(traceId, "v2_done", {
    parseStage,
    type: extracted.document_type,
    persist: opts.persist,
    elapsed: Date.now() - t0,
  });
  return jsonResponse({
    success: true,
    document_id: documentId,
    status: "processed",
    extraction_version: EXTRACTION_VERSION,
    persisted: opts.persist,
    extracted,
    model: modelUsed,
  });
}

async function callOpenAIV2(
  apiKey: string,
  content: OpenAIContentPart[],
  systemPrompt: string = SYSTEM_PROMPT_V2,
  maxTokens = 2048,
): Promise<{ content: string; model: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), OPENAI_TIMEOUT_MS);
  try {
    const res = await fetch(OPENAI_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: DEFAULT_MODEL,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content },
        ],
        max_tokens: maxTokens,
        temperature: 0,
        response_format: { type: "json_object" },
      }),
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
    const out = json.choices?.[0]?.message?.content;
    if (!out || typeof out !== "string" || out.trim().length === 0) {
      const err = new Error("empty response from provider");
      (err as any).status = res.status;
      throw err;
    }
    return { content: out, model: json.model ?? DEFAULT_MODEL };
  } finally {
    clearTimeout(timer);
  }
}

// ============================================================================
// v3 — payroll profile (Smart Payroll Upload). Extraction ONLY: like v2 it
// never creates loads, settlements, lines or links. Writes only the
// document row's extraction columns (when persist is true).
// ============================================================================

async function finishV3(
  traceId: string,
  t0: number,
  adminClient: any,
  docRow: V2DocRow,
  opts: V2Options,
  r: {
    parsed: unknown;
    parseStage: "strict" | "salvage" | "fallback";
    hint: string | null;
    raw: string;
    modelUsed: string;
    mime: string;
    size: number;
    fail: (code: ErrorCode, stage: string, detail: string) => Promise<Response>;
  },
): Promise<Response> {
  const sanitized = sanitizePayrollExtraction(r.parsed);
  const extracted = {
    ...sanitized,
    parse_stage: r.parseStage,
    type_hint: r.hint,
    // A failed parse is never high confidence, whatever the model claimed.
    model_confidence: r.parseStage === "fallback"
      ? null
      : sanitized.model_confidence,
  };
  if (opts.persist) {
    const { error: updateErr } = await adminClient
      .from("documents")
      .update({
        status: "processed",
        processed: true,
        extracted_data: extracted,
        raw_text: r.raw.slice(0, RAW_TEXT_MAX),
        confidence: extracted.model_confidence ?? "low",
        document_type: sanitized.stored_document_type,
        provider: "openai",
        model: r.modelUsed,
        file_mime_type: r.mime,
        file_size: r.size,
        extraction_version: PAYROLL_EXTRACTION_VERSION,
        retry_count: (docRow.retry_count ?? 0) +
          (docRow.status === "failed" ? 1 : 0),
        error_message: null,
      })
      .eq("id", docRow.id);
    if (updateErr) {
      return await r.fail(
        "UNKNOWN_SCAN_ERROR",
        "v3_db_update",
        updateErr.message,
      );
    }
  }
  log(traceId, "v3_done", {
    parseStage: r.parseStage,
    type: extracted.document_type,
    lines: extracted.line_items.length,
    persist: opts.persist,
    elapsed: Date.now() - t0,
  });
  return jsonResponse({
    success: true,
    document_id: docRow.id,
    status: "processed",
    extraction_version: PAYROLL_EXTRACTION_VERSION,
    persisted: opts.persist,
    extracted,
    model: r.modelUsed,
  });
}
