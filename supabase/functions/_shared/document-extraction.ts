// ============================================================================
// Sacred Pathway — document extraction v2 (pure helpers)
// ----------------------------------------------------------------------------
// Used by extract-document when the caller opts in with
// `{ "extraction_version": "v2" }` (the web app). The iPhone keeps calling
// the unchanged v1 path, so its contract does not move.
//
// v2 adds:
//   * the canonical taxonomy (BOL, POD, CDL, medical card, MVR, ...)
//   * PDF input via Chat Completions `file` content parts (server-side only;
//     no Files API upload, nothing to clean up)
//   * a strict sanitiser: model output is UNTRUSTED. Only whitelisted keys
//     survive, every value is type- and range-checked, nothing is invented.
//
// Pure TypeScript: no Deno / Node / browser APIs, so the web test suite can
// import this file directly.
// ============================================================================

import {
  CANONICAL_DOCUMENT_TYPES,
  type CanonicalDocumentType,
  REQUIRED_FIELDS,
  routableDocumentType,
} from "./document-taxonomy.ts";

export const EXTRACTION_VERSION = "v2";

// ---------------------------------------------------------------------------
// File limits (enforced BEFORE any provider call)
// ---------------------------------------------------------------------------

/** Matches the web upload cap and the `documents` bucket file_size_limit. */
export const V2_MAX_FILE_BYTES = 20 * 1024 * 1024;
export const V2_MIN_FILE_BYTES = 1024;
/**
 * Hard page cap for PDFs. Rate cons / BOLs / receipts are 1-6 pages; a
 * 40-page scan is almost certainly not a single routable document and would
 * cost ~40 page images of tokens. Larger PDFs go to manual review instead.
 */
export const V2_MAX_PDF_PAGES = 15;

/** OpenAI vision accepts these image types; HEIC/HEIF are NOT accepted. */
export const V2_IMAGE_MIMES: ReadonlySet<string> = new Set([
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
  "image/gif",
]);

export type V2FileKind = "image" | "pdf";

export type V2FileCheck =
  | { ok: true; kind: V2FileKind; mime: string }
  | { ok: false; reason: string };

export function checkV2File(
  contentType: string,
  storagePath: string,
  size: number,
): V2FileCheck {
  if (!Number.isFinite(size) || size <= 0) {
    return { ok: false, reason: "empty_file" };
  }
  if (size < V2_MIN_FILE_BYTES) {
    return { ok: false, reason: `too_small:${size}` };
  }
  if (size > V2_MAX_FILE_BYTES) {
    return { ok: false, reason: `too_large:${size}` };
  }
  const mime = (contentType ?? "").toLowerCase().split(";")[0].trim();
  const ext = extensionOf(storagePath);
  if (mime === "application/pdf" || ext === "pdf") {
    return { ok: true, kind: "pdf", mime: "application/pdf" };
  }
  if (
    mime === "image/heic" || mime === "image/heif" || ext === "heic" ||
    ext === "heif"
  ) {
    return { ok: false, reason: "heic_not_supported" };
  }
  if (V2_IMAGE_MIMES.has(mime)) return { ok: true, kind: "image", mime };
  const byExt: Record<string, string> = {
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    png: "image/png",
    webp: "image/webp",
    gif: "image/gif",
  };
  if (byExt[ext]) return { ok: true, kind: "image", mime: byExt[ext] };
  return {
    ok: false,
    reason: `unsupported mime=${mime || "?"} ext=${ext || "?"}`,
  };
}

export function extensionOf(path: string): string {
  const p = (path ?? "").toLowerCase();
  const idx = p.lastIndexOf(".");
  if (idx < 0 || idx === p.length - 1) return "";
  return p.slice(idx + 1);
}

/** True when the bytes start with the PDF magic number. */
export function looksLikePdf(bytes: Uint8Array): boolean {
  return bytes.length >= 5 && bytes[0] === 0x25 && bytes[1] === 0x50 &&
    bytes[2] === 0x44 && bytes[3] === 0x46 && bytes[4] === 0x2d; // "%PDF-"
}

/**
 * Best-effort page count without a PDF parser: counts `/Type /Page` objects
 * (not `/Pages`). Returns null when nothing is found (e.g. pages stored in
 * compressed object streams) — callers then rely on the byte cap alone.
 */
export function estimatePdfPageCount(bytes: Uint8Array): number | null {
  // latin1 decode keeps a 1:1 byte->char mapping; fine for token scanning.
  let text = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    text += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  const matches = text.match(/\/Type\s*\/Page(?![a-zA-Z])/g);
  return matches && matches.length > 0 ? matches.length : null;
}

// ---------------------------------------------------------------------------
// Prompt + provider payload
// ---------------------------------------------------------------------------

export const SYSTEM_PROMPT_V2 = `
You read documents for a US trucking company and return structured JSON.

Step 1 — classify. Set "document_type" to EXACTLY one of:
  "rate_confirmation"  broker rate confirmation / load tender / load sheet
  "bol"                bill of lading
  "pod"                proof of delivery / signed delivery receipt
  "fuel_receipt"       fuel purchase receipt
  "lumper_fee"         lumper / unloading fee receipt
  "toll"               toll receipt or toll statement line
  "repair"             repair, maintenance, tire or service invoice/receipt
  "cdl"                commercial driver's license
  "medical_card"       DOT medical examiner's certificate
  "mvr"                motor vehicle record / driving record report
  "other"              anything else, or you are not sure
A signed BOL that shows delivery is "pod". If unsure between two types, use "other".

Step 2 — extract ONLY the fields for that type that are actually printed on the
document. OMIT any field you cannot read. Never guess, never infer from context,
never fill a field from another field.

rate_confirmation: load_number, broker_name, broker_mc_number, shipper_name,
  receiver_name, origin ("City, ST"), destination ("City, ST"), pickup_date,
  delivery_date, total_miles, line_haul_rate, fuel_surcharge,
  accessorial_charges, total_revenue (total carrier pay), reference_numbers
  (array of other printed reference/PO numbers)
bol / pod: load_number, bol_number, carrier_name, shipper_name, receiver_name,
  origin, destination, pickup_date, delivery_date, signature_present (true only
  if a receiver signature is visible), delivery_exceptions (short text, e.g.
  shortage/damage notes), reference_numbers
fuel_receipt / lumper_fee / toll / repair: vendor_name, expense_amount (total
  paid), receipt_date, receipt_number, unit_number (truck/unit #), load_number
  (only if printed), gallons, price_per_gallon, description (repair work)
cdl / medical_card / mvr: person_name (as printed), license_number,
  license_state (2-letter), license_class, issue_date, expiration_date,
  exam_date (medical card), report_date (mvr)

Always include:
  "confidence": "high" | "medium" | "low" — your certainty about BOTH the type
    and the extracted values. Use "high" only when the document is clear and
    every value you returned is plainly legible.
  "notes": short description (may be "").

Formats: dates YYYY-MM-DD. Numbers are plain JSON numbers (no "$", no commas).
Return ONLY one JSON object. First character "{", last character "}".
`.trim();

export type OpenAIContentPart =
  | { type: "text"; text: string }
  | {
    type: "image_url";
    image_url: { url: string; detail?: "auto" | "low" | "high" };
  }
  | { type: "file"; file: { filename: string; file_data: string } };

export function buildV2UserContent(
  kind: V2FileKind,
  mime: string,
  base64: string,
  typeHint: CanonicalDocumentType | null,
): OpenAIContentPart[] {
  const hint = typeHint && typeHint !== "other"
    ? ` The uploader labelled it "${typeHint}" — verify that independently; it may be wrong.`
    : "";
  const text: OpenAIContentPart = {
    type: "text",
    text:
      "Classify this trucking document and extract its fields as JSON per the system " +
      "prompt. Do not include any explanation." + hint,
  };
  if (kind === "pdf") {
    return [
      text,
      {
        type: "file",
        file: {
          filename: "document.pdf",
          file_data: `data:${mime};base64,${base64}`,
        },
      },
    ];
  }
  return [
    text,
    {
      type: "image_url",
      image_url: { url: `data:${mime};base64,${base64}`, detail: "high" },
    },
  ];
}

// ---------------------------------------------------------------------------
// Sanitiser — the ONLY way model output reaches the database / router
// ---------------------------------------------------------------------------

export type FieldKind =
  | "string"
  | "date"
  | "money"
  | "count"
  | "bool"
  | "id"
  | "state"
  | "string[]";

export const FIELD_SPECS: Readonly<
  Record<string, { kind: FieldKind; max?: number }>
> = {
  load_number: { kind: "id" },
  bol_number: { kind: "id" },
  receipt_number: { kind: "id" },
  unit_number: { kind: "id" },
  license_number: { kind: "id" },
  broker_mc_number: { kind: "id" },
  broker_name: { kind: "string" },
  shipper_name: { kind: "string" },
  receiver_name: { kind: "string" },
  carrier_name: { kind: "string" },
  vendor_name: { kind: "string" },
  person_name: { kind: "string" },
  origin: { kind: "string" },
  destination: { kind: "string" },
  description: { kind: "string", max: 500 },
  delivery_exceptions: { kind: "string", max: 500 },
  license_class: { kind: "string", max: 8 },
  license_state: { kind: "state" },
  pickup_date: { kind: "date" },
  delivery_date: { kind: "date" },
  receipt_date: { kind: "date" },
  issue_date: { kind: "date" },
  expiration_date: { kind: "date" },
  exam_date: { kind: "date" },
  report_date: { kind: "date" },
  total_miles: { kind: "count", max: 20000 },
  gallons: { kind: "count", max: 2000 },
  line_haul_rate: { kind: "money", max: 1_000_000 },
  fuel_surcharge: { kind: "money", max: 1_000_000 },
  accessorial_charges: { kind: "money", max: 1_000_000 },
  total_revenue: { kind: "money", max: 1_000_000 },
  expense_amount: { kind: "money", max: 1_000_000 },
  price_per_gallon: { kind: "money", max: 100 },
  signature_present: { kind: "bool" },
  reference_numbers: { kind: "string[]" },
};

const COMMON = ["notes"] as const;
const LOAD_DOC = [
  "load_number",
  "shipper_name",
  "receiver_name",
  "origin",
  "destination",
  "pickup_date",
  "delivery_date",
  "reference_numbers",
];
const RECEIPT = [
  "vendor_name",
  "expense_amount",
  "receipt_date",
  "receipt_number",
  "unit_number",
  "load_number",
  "description",
];
const PERSON = [
  "person_name",
  "license_number",
  "license_state",
  "license_class",
  "issue_date",
  "expiration_date",
];

export const FIELDS_BY_TYPE: Readonly<
  Record<CanonicalDocumentType, readonly string[]>
> = {
  rate_confirmation: [
    ...LOAD_DOC,
    "broker_name",
    "broker_mc_number",
    "total_miles",
    "line_haul_rate",
    "fuel_surcharge",
    "accessorial_charges",
    "total_revenue",
  ],
  bol: [
    ...LOAD_DOC,
    "bol_number",
    "carrier_name",
    "signature_present",
    "delivery_exceptions",
  ],
  pod: [
    ...LOAD_DOC,
    "bol_number",
    "carrier_name",
    "signature_present",
    "delivery_exceptions",
  ],
  fuel_receipt: [...RECEIPT, "gallons", "price_per_gallon"],
  lumper_fee: RECEIPT,
  toll: RECEIPT,
  repair: RECEIPT,
  cdl: PERSON,
  medical_card: [...PERSON, "exam_date"],
  mvr: [...PERSON, "report_date"],
  other: [],
};

export type ConfidenceLabel = "high" | "medium" | "low";

export interface SanitizedExtraction {
  extraction_version: typeof EXTRACTION_VERSION;
  document_type: CanonicalDocumentType;
  /** Model's self-reported label; NEVER used alone for routing. */
  model_confidence: ConfidenceLabel | null;
  fields: Record<string, string | number | boolean | string[]>;
  notes: string;
  /** Keys the model returned that were dropped (unknown, wrong type, out of range). */
  rejected_keys: string[];
  /** Required fields (per taxonomy) that are missing after sanitising. */
  missing_required: string[];
}

// Intentional: strip C0/C1 control chars and bidi/zero-width overrides.
// deno-lint-ignore no-control-regex
const CONTROL_CHARS = new RegExp(
  "[\\u0000-\\u001f\\u007f-\\u009f\\u200b-\\u200f\\u2028\\u2029\\u202a-\\u202e]",
  "g",
);

export function cleanString(v: unknown, max = 200): string | null {
  if (typeof v !== "string") return null;
  const s = v.replace(CONTROL_CHARS, " ").replace(/\s+/g, " ").trim();
  if (s === "" || s.length > max) return null;
  return s;
}

/** Identifiers: letters, digits and a few separators only; 1-40 chars. */
export function cleanIdentifier(v: unknown): string | null {
  const raw = typeof v === "number" && Number.isFinite(v) ? String(v) : v;
  const s = cleanString(raw, 40);
  if (!s) return null;
  return /^[A-Za-z0-9][A-Za-z0-9 #./_-]{0,39}$/.test(s) ? s : null;
}

export function cleanDate(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v.trim());
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (y < 1990 || y > 2100) return null;
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (
    dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 ||
    dt.getUTCDate() !== d
  ) {
    return null;
  }
  return m[0];
}

export function cleanNumber(v: unknown, max: number): number | null {
  let n: number;
  if (typeof v === "number") n = v;
  else if (
    typeof v === "string" && /^\s*\$?\s*[0-9][0-9,]*(\.[0-9]+)?\s*$/.test(v)
  ) {
    n = Number(v.replace(/[$,\s]/g, ""));
  } else return null;
  if (!Number.isFinite(n) || n < 0 || n > max) return null;
  return Math.round(n * 1000) / 1000;
}

function cleanField(kind: FieldKind, v: unknown, max?: number): unknown {
  switch (kind) {
    case "string":
      return cleanString(v, max ?? 200);
    case "id":
      return cleanIdentifier(v);
    case "state": {
      const s = cleanString(v, 2);
      return s && /^[A-Za-z]{2}$/.test(s) ? s.toUpperCase() : null;
    }
    case "date":
      return cleanDate(v);
    case "money": {
      const n = cleanNumber(v, max ?? 1_000_000);
      return n === null ? null : Math.round(n * 100) / 100;
    }
    case "count":
      return cleanNumber(v, max ?? 1_000_000);
    case "bool":
      return typeof v === "boolean" ? v : null;
    case "string[]": {
      if (!Array.isArray(v)) return null;
      const out = v.map((x) => cleanIdentifier(x)).filter((x): x is string =>
        !!x
      ).slice(0, 10);
      return out.length ? out : null;
    }
  }
}

export function sanitizeExtraction(raw: unknown): SanitizedExtraction {
  const obj = raw && typeof raw === "object" && !Array.isArray(raw)
    ? raw as Record<string, unknown>
    : {};
  const type = routableDocumentType(obj.document_type);
  const label = typeof obj.confidence === "string"
    ? obj.confidence.trim().toLowerCase()
    : "";
  const model_confidence: ConfidenceLabel | null =
    label === "high" || label === "medium" ||
      label === "low"
      ? label
      : null;
  const allowed = new Set<string>(FIELDS_BY_TYPE[type]);
  const fields: SanitizedExtraction["fields"] = {};
  const rejected: string[] = [];
  for (const [k, v] of Object.entries(obj)) {
    if (
      k === "document_type" || k === "confidence" ||
      (COMMON as readonly string[]).includes(k)
    ) {
      continue;
    }
    if (v === null || v === undefined || v === "") continue;
    const spec = FIELD_SPECS[k];
    if (!spec || !allowed.has(k)) {
      rejected.push(k);
      continue;
    }
    const cleaned = cleanField(spec.kind, v, spec.max);
    if (cleaned === null || cleaned === undefined) {
      rejected.push(k);
      continue;
    }
    fields[k] = cleaned as string | number | boolean | string[];
  }
  const req = REQUIRED_FIELDS[type];
  const missing = req.all.filter((f) => !(f in fields));
  if (req.oneOf && req.oneOf.length && !req.oneOf.some((f) => f in fields)) {
    missing.push(req.oneOf.join("|"));
  }
  return {
    extraction_version: EXTRACTION_VERSION,
    document_type: type,
    model_confidence,
    fields,
    notes: cleanString(obj.notes, 500) ?? "",
    rejected_keys: rejected.slice(0, 50),
    missing_required: missing,
  };
}

/** Exposed for tests / docs. */
export const V2_TYPES = CANONICAL_DOCUMENT_TYPES;
