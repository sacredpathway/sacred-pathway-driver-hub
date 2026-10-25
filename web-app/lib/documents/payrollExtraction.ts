// ============================================================================
// Sacred Pathway — payroll extraction profile (extraction v3) — CANONICAL
// ----------------------------------------------------------------------------
// Opt-in profile for Smart Payroll Upload. v1 (iPhone) and v2 (web) are NOT
// changed by this file; a caller must send extraction_version "v3".
//
// Two copies, like the taxonomy:
//   supabase/functions/_shared/payroll-extraction.ts   <- canonical (Deno)
//   web-app/lib/documents/payrollExtraction.ts         <- copy (imports differ)
// web-app/lib/documents/payrollExtraction.test.ts fails if they drift.
//
// Rules (same spirit as v2):
//   * Untrusted model output -> whitelisted, type-checked fields only.
//   * A field the model did not read is ABSENT. Nothing is inferred, defaulted
//     or copied from another field.
//   * Confidence is ONLY what the model reported (high/medium/low) or null.
//     No numeric score is invented here.
//   * Every value may carry evidence: page number + the printed text it came
//     from. The sanitiser checks that the value actually appears in that
//     text and records the result; it never repairs a value to fit.
//
// Pure TypeScript only: no Deno, Node or browser APIs.
// ============================================================================

import {
  cleanDate,
  cleanIdentifier,
  cleanNumber,
  cleanString,
  type ConfidenceLabel,
  FIELD_SPECS,
  type FieldKind,
  FIELDS_BY_TYPE,
  type SanitizedExtraction,
} from "./extraction";
import {
  CANONICAL_DOCUMENT_TYPES,
  type CanonicalDocumentType,
  isCanonicalDocumentType,
  REQUIRED_FIELDS,
} from "./taxonomy";

export const PAYROLL_EXTRACTION_VERSION = "v3";

/** v2 canonical types + the two payroll record types. */
export const PAYROLL_DOCUMENT_TYPES = [
  ...CANONICAL_DOCUMENT_TYPES,
  "settlement_statement",
  "paystub",
] as const;
export type PayrollDocumentType = (typeof PAYROLL_DOCUMENT_TYPES)[number];

/**
 * Value written to documents.document_type. The two payroll types use the
 * EXISTING legacy values ("settlement", "paystub"), which the web taxonomy
 * already displays and never routes, so no DB enum/check changes are needed.
 */
export function storedDocumentType(t: PayrollDocumentType): string {
  if (t === "settlement_statement") return "settlement";
  return t;
}

export function isPayrollDocumentType(v: unknown): v is PayrollDocumentType {
  return typeof v === "string" &&
    (PAYROLL_DOCUMENT_TYPES as readonly string[]).includes(v);
}

const V3_ALIASES: Readonly<Record<string, PayrollDocumentType>> = {
  settlement: "settlement_statement",
  settlement_sheet: "settlement_statement",
  driver_settlement: "settlement_statement",
  factoring_statement: "settlement_statement",
  remittance: "settlement_statement",
  pay_stub: "paystub",
  pay_statement: "paystub",
  earnings_statement: "paystub",
  rate_con: "rate_confirmation",
  ratecon: "rate_confirmation",
  bill_of_lading: "bol",
  proof_of_delivery: "pod",
};

export function normalizePayrollType(raw: unknown): PayrollDocumentType {
  if (typeof raw !== "string") return "other";
  const k = raw.trim().toLowerCase().replace(/[\s-]+/g, "_");
  if (isPayrollDocumentType(k)) return k;
  return V3_ALIASES[k] ?? "other";
}

// ---------------------------------------------------------------------------
// Field catalogue (v2 fields + payroll fields)
// ---------------------------------------------------------------------------

export const PAYROLL_FIELD_SPECS: Readonly<
  Record<string, { kind: FieldKind; max?: number }>
> = {
  ...FIELD_SPECS,
  driver_name: { kind: "string" },
  truck_number: { kind: "id" },
  trailer_number: { kind: "id" },
  carrier_mc_number: { kind: "id" },
  statement_number: { kind: "id" },
  payee_name: { kind: "string" },
  employer_name: { kind: "string" },
  employee_name: { kind: "string" },
  period_start: { kind: "date" },
  period_end: { kind: "date" },
  pay_date: { kind: "date" },
  check_date: { kind: "date" },
  gross_amount: { kind: "money", max: 1_000_000 },
  total_additions: { kind: "money", max: 1_000_000 },
  total_deductions: { kind: "money", max: 1_000_000 },
  net_amount: { kind: "money", max: 1_000_000 },
  gross_pay: { kind: "money", max: 1_000_000 },
  net_pay: { kind: "money", max: 1_000_000 },
  ytd_gross: { kind: "money", max: 10_000_000 },
  ytd_net: { kind: "money", max: 10_000_000 },
};

const DRIVER_EQUIPMENT = ["driver_name", "truck_number", "trailer_number"];

export const PAYROLL_FIELDS_BY_TYPE: Readonly<
  Record<PayrollDocumentType, readonly string[]>
> = {
  ...FIELDS_BY_TYPE,
  rate_confirmation: [
    ...FIELDS_BY_TYPE.rate_confirmation,
    ...DRIVER_EQUIPMENT,
    "carrier_name",
    "carrier_mc_number",
  ],
  bol: [...FIELDS_BY_TYPE.bol, ...DRIVER_EQUIPMENT],
  pod: [...FIELDS_BY_TYPE.pod, ...DRIVER_EQUIPMENT],
  settlement_statement: [
    "statement_number",
    "payee_name",
    "driver_name",
    "truck_number",
    "period_start",
    "period_end",
    "pay_date",
    "gross_amount",
    "total_additions",
    "total_deductions",
    "net_amount",
    "carrier_mc_number",
  ],
  paystub: [
    "employer_name",
    "employee_name",
    "period_start",
    "period_end",
    "check_date",
    "gross_pay",
    "total_deductions",
    "net_pay",
    "ytd_gross",
    "ytd_net",
  ],
};

export const PAYROLL_REQUIRED_FIELDS: Readonly<
  Record<
    PayrollDocumentType,
    { all: readonly string[]; oneOf?: readonly string[] }
  >
> = {
  ...REQUIRED_FIELDS,
  settlement_statement: {
    all: ["net_amount"],
    oneOf: ["statement_number", "period_end"],
  },
  paystub: {
    all: ["employee_name", "net_pay"],
    oneOf: ["period_end", "check_date"],
  },
};

export const LINE_ITEM_KINDS = [
  "load", // a load / trip line on a statement
  "earning", // other earnings (hourly, bonus) on a paystub/statement
  "addition", // reimbursement / addition to pay
  "deduction", // deduction from pay (positive amount)
  "tax", // tax withholding (paystubs)
] as const;
export type LineItemKind = (typeof LINE_ITEM_KINDS)[number];

export const ISSUER_ROLES = [
  "our_company",
  "factoring_company",
  "external_carrier",
  "broker",
  "payroll_provider",
  "unknown",
] as const;
export type IssuerRole = (typeof ISSUER_ROLES)[number];

/** Types whose statements can carry line items. */
const LINE_ITEM_TYPES: ReadonlySet<PayrollDocumentType> = new Set([
  "settlement_statement",
  "paystub",
]);

export const MAX_LINE_ITEMS = 200;
export const MAX_SOURCE_TEXT = 200;

// ---------------------------------------------------------------------------
// Evidence
// ---------------------------------------------------------------------------

export type EvidenceCheck =
  | "value_in_source" // the printed text contains this value
  | "value_not_in_source" // text given, value not found in it -> human check
  | "no_source"; // the model gave no source text

export interface FieldEvidence {
  value: string | number | boolean | string[];
  /** 1-based page, only when the model gave one inside the document. */
  page: number | null;
  /** Printed text the value was read from (≤200 chars), as returned. */
  source_text: string | null;
  /** The model's own label for this field, or null. Never computed here. */
  model_confidence: ConfidenceLabel | null;
  evidence_check: EvidenceCheck;
}

export interface LineItem {
  kind: LineItemKind;
  description: string | null;
  load_number: string | null;
  date: string | null;
  /** Always a non-negative amount; `kind` says which way it counts. */
  amount: number;
  page: number | null;
  source_text: string | null;
  model_confidence: ConfidenceLabel | null;
  evidence_check: EvidenceCheck;
}

export interface IssuerInfo {
  name: string | null;
  role: IssuerRole;
  mc_number: string | null;
  page: number | null;
  source_text: string | null;
}

export interface SanitizedPayrollExtraction {
  extraction_version: typeof PAYROLL_EXTRACTION_VERSION;
  profile: "payroll";
  document_type: PayrollDocumentType;
  stored_document_type: string;
  model_confidence: ConfidenceLabel | null;
  /** Pages the model reported seeing (null when not reported/invalid). */
  page_count: number | null;
  fields: Record<string, FieldEvidence>;
  /** Flat values (same shape as v2 `fields`) for existing routing code. */
  values: Record<string, string | number | boolean | string[]>;
  line_items: LineItem[];
  issuer: IssuerInfo | null;
  notes: string;
  rejected_keys: string[];
  missing_required: string[];
}

function cleanLabel(v: unknown): ConfidenceLabel | null {
  if (typeof v !== "string") return null;
  const s = v.trim().toLowerCase();
  return s === "high" || s === "medium" || s === "low" ? s : null;
}

function cleanPage(v: unknown, pageCount: number | null): number | null {
  if (typeof v !== "number" || !Number.isInteger(v) || v < 1) return null;
  if (pageCount !== null && v > pageCount) return null;
  if (v > 500) return null;
  return v;
}

function cleanFieldValue(kind: FieldKind, v: unknown, max?: number): unknown {
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

const squash = (s: string) => s.toLowerCase().replace(/[^a-z0-9.]/g, "");

/** Printed spellings of a money amount: 1234.5 -> 1234.50, 1,234.50 */
export function moneySpellings(n: number): string[] {
  const fixed = n.toFixed(2);
  const [int, frac] = fixed.split(".");
  const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const out = new Set([fixed, `${grouped}.${frac}`]);
  if (frac === "00") {
    out.add(int);
    out.add(grouped);
  }
  return [...out];
}

/** Printed spellings of a YYYY-MM-DD date (US forms + ISO). */
export function dateSpellings(ymd: string): string[] {
  const [y, m, d] = ymd.split("-");
  const mi = String(Number(m));
  const di = String(Number(d));
  const yy = y.slice(2);
  const months = [
    "jan",
    "feb",
    "mar",
    "apr",
    "may",
    "jun",
    "jul",
    "aug",
    "sep",
    "oct",
    "nov",
    "dec",
  ];
  const mon = months[Number(m) - 1];
  return [
    ymd,
    `${m}/${d}/${y}`,
    `${mi}/${di}/${y}`,
    `${m}/${d}/${yy}`,
    `${mi}/${di}/${yy}`,
    `${m}-${d}-${y}`,
    `${mi}-${di}-${y}`,
    `${mon} ${di}, ${y}`,
    `${mon} ${di} ${y}`,
    `${di} ${mon} ${y}`,
  ];
}

/**
 * Does `text` visibly contain `value`? Conservative and text-only: a
 * "no" means a human should look, not that the value is wrong.
 */
export function valueAppearsIn(
  kind: FieldKind,
  value: unknown,
  text: string,
): boolean {
  const t = text.toLowerCase();
  if (kind === "money" || kind === "count") {
    if (typeof value !== "number") return false;
    const spellings = kind === "money"
      ? moneySpellings(value)
      : [String(value), value.toLocaleString("en-US")];
    const plain = t.replace(/[$\s]/g, "");
    return spellings.some((s) => plain.includes(s.toLowerCase()));
  }
  if (kind === "date") {
    if (typeof value !== "string") return false;
    const compact = t.replace(/\s+/g, " ");
    return dateSpellings(value).some((s) => compact.includes(s.toLowerCase()));
  }
  if (kind === "bool") return true; // a signature/checkbox has no "text"
  if (Array.isArray(value)) {
    return value.every((v) => squash(t).includes(squash(String(v))));
  }
  if (typeof value !== "string" && typeof value !== "number") return false;
  const needle = squash(String(value));
  return needle.length > 0 && squash(t).includes(needle);
}

function evidenceFor(
  kind: FieldKind,
  value: unknown,
  sourceText: string | null,
): EvidenceCheck {
  if (!sourceText) return "no_source";
  return valueAppearsIn(kind, value, sourceText)
    ? "value_in_source"
    : "value_not_in_source";
}

/**
 * Accepts either `{ "field": { "value": .., "page": .., "source_text": ..,
 * "confidence": .. } }` (v3 shape) or a bare value (v2 shape: no evidence).
 */
function readFieldEntry(entry: unknown): {
  value: unknown;
  page: unknown;
  source: unknown;
  confidence: unknown;
} {
  if (
    entry && typeof entry === "object" && !Array.isArray(entry) &&
    "value" in (entry as Record<string, unknown>)
  ) {
    const e = entry as Record<string, unknown>;
    return {
      value: e.value,
      page: e.page,
      source: e.source_text,
      // raw model output says "confidence"; a stored (already sanitised)
      // extraction says "model_confidence". Accept both so re-reading a
      // stored row is lossless.
      confidence: e.confidence ?? e.model_confidence,
    };
  }
  return { value: entry, page: null, source: null, confidence: null };
}

function sanitizeLineItem(
  raw: unknown,
  pageCount: number | null,
): LineItem | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  const kind = typeof r.kind === "string" ? r.kind.trim().toLowerCase() : "";
  if (!(LINE_ITEM_KINDS as readonly string[]).includes(kind)) return null;
  const amount = cleanNumber(r.amount, 1_000_000);
  if (amount === null) return null;
  const money = Math.round(amount * 100) / 100;
  const source = cleanString(r.source_text, MAX_SOURCE_TEXT);
  return {
    kind: kind as LineItemKind,
    description: cleanString(r.description, 200),
    load_number: cleanIdentifier(r.load_number),
    date: cleanDate(r.date),
    amount: money,
    page: cleanPage(r.page, pageCount),
    source_text: source,
    model_confidence: cleanLabel(r.confidence ?? r.model_confidence),
    evidence_check: evidenceFor("money", money, source),
  };
}

function sanitizeIssuer(
  raw: unknown,
  pageCount: number | null,
): IssuerInfo | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  const roleRaw = typeof r.role === "string" ? r.role.trim().toLowerCase() : "";
  const role: IssuerRole = (ISSUER_ROLES as readonly string[]).includes(roleRaw)
    ? roleRaw as IssuerRole
    : "unknown";
  const name = cleanString(r.name, 200);
  const mc = cleanIdentifier(r.mc_number);
  if (!name && !mc && role === "unknown") return null;
  return {
    name,
    role,
    mc_number: mc,
    page: cleanPage(r.page, pageCount),
    source_text: cleanString(r.source_text, MAX_SOURCE_TEXT),
  };
}

const META_KEYS = [
  "document_type",
  "confidence",
  "notes",
  "page_count",
  "line_items",
  "issuer",
  "fields",
];

export function sanitizePayrollExtraction(
  raw: unknown,
): SanitizedPayrollExtraction {
  const obj = raw && typeof raw === "object" && !Array.isArray(raw)
    ? raw as Record<string, unknown>
    : {};
  const type = normalizePayrollType(obj.document_type);
  const pc = obj.page_count;
  const pageCount =
    typeof pc === "number" && Number.isInteger(pc) && pc >= 1 && pc <= 500
      ? pc
      : null;

  // Fields may arrive under "fields" (v3) or at the top level (v2 habit).
  const fieldSource: Record<string, unknown> =
    obj.fields && typeof obj.fields === "object" && !Array.isArray(obj.fields)
      ? obj.fields as Record<string, unknown>
      : Object.fromEntries(
        Object.entries(obj).filter(([k]) => !META_KEYS.includes(k)),
      );

  const allowed = new Set<string>(PAYROLL_FIELDS_BY_TYPE[type]);
  const fields: Record<string, FieldEvidence> = {};
  const values: SanitizedPayrollExtraction["values"] = {};
  const rejected: string[] = [];

  for (const [k, entry] of Object.entries(fieldSource)) {
    const e = readFieldEntry(entry);
    if (e.value === null || e.value === undefined || e.value === "") continue;
    const spec = PAYROLL_FIELD_SPECS[k];
    if (!spec || !allowed.has(k)) {
      rejected.push(k);
      continue;
    }
    const cleaned = cleanFieldValue(spec.kind, e.value, spec.max);
    if (cleaned === null || cleaned === undefined) {
      rejected.push(k);
      continue;
    }
    const value = cleaned as FieldEvidence["value"];
    const source = cleanString(e.source, MAX_SOURCE_TEXT);
    fields[k] = {
      value,
      page: cleanPage(e.page, pageCount),
      source_text: source,
      model_confidence: cleanLabel(e.confidence),
      evidence_check: evidenceFor(spec.kind, value, source),
    };
    values[k] = value;
  }

  const lineItems: LineItem[] = [];
  if (LINE_ITEM_TYPES.has(type) && Array.isArray(obj.line_items)) {
    for (const li of obj.line_items.slice(0, MAX_LINE_ITEMS)) {
      const s = sanitizeLineItem(li, pageCount);
      if (s) lineItems.push(s);
      else rejected.push("line_items[]");
    }
  } else if (obj.line_items !== undefined && obj.line_items !== null) {
    rejected.push("line_items");
  }

  const req = PAYROLL_REQUIRED_FIELDS[type];
  const missing = req.all.filter((f) => !(f in values));
  if (req.oneOf && req.oneOf.length && !req.oneOf.some((f) => f in values)) {
    missing.push(req.oneOf.join("|"));
  }

  return {
    extraction_version: PAYROLL_EXTRACTION_VERSION,
    profile: "payroll",
    document_type: type,
    stored_document_type: storedDocumentType(type),
    model_confidence: cleanLabel(obj.confidence ?? obj.model_confidence),
    page_count: pageCount,
    fields,
    values,
    line_items: lineItems,
    issuer: sanitizeIssuer(obj.issuer, pageCount),
    notes: cleanString(obj.notes, 500) ?? "",
    rejected_keys: [...new Set(rejected)].slice(0, 50),
    missing_required: missing,
  };
}

/**
 * The v2-shaped view the existing routing/matching code understands. Payroll
 * record types map to "other", so they always go to review and are never
 * auto-routed by the existing pipeline.
 */
export function toV2Compatible(
  x: SanitizedPayrollExtraction,
): SanitizedExtraction {
  const type: CanonicalDocumentType = isCanonicalDocumentType(x.document_type)
    ? x.document_type
    : "other";
  const allowed = new Set<string>(FIELDS_BY_TYPE[type]);
  const fields: SanitizedExtraction["fields"] = {};
  for (const [k, v] of Object.entries(x.values)) {
    if (allowed.has(k)) fields[k] = v;
  }
  const req = REQUIRED_FIELDS[type];
  const missing = req.all.filter((f) => !(f in fields));
  if (req.oneOf && req.oneOf.length && !req.oneOf.some((f) => f in fields)) {
    missing.push(req.oneOf.join("|"));
  }
  return {
    extraction_version: "v2",
    document_type: type,
    model_confidence: x.model_confidence,
    fields,
    notes: x.notes,
    rejected_keys: [],
    missing_required: missing,
  };
}

// ---------------------------------------------------------------------------
// Prompt
// ---------------------------------------------------------------------------

export const SYSTEM_PROMPT_V3 = `
You read documents for a US trucking company and return structured JSON with
evidence for every value.

Step 1 — classify. Set "document_type" to EXACTLY one of:
  "rate_confirmation", "bol", "pod", "fuel_receipt", "lumper_fee", "toll",
  "repair", "scale_ticket" (truck scale / weigh ticket), "accessorial"
  (detention, layover or TONU proof), "cdl", "medical_card", "mvr",
  "settlement_statement"  driver/owner-operator settlement, factoring
                          remittance or carrier pay statement listing loads,
                          additions and deductions
  "paystub"               employee pay stub / earnings statement
  "other"                 anything else, or you are not sure

Step 2 — extract ONLY values that are actually printed. OMIT anything you
cannot read. Never guess, never compute a value that is not printed, never
fill a field from another field.

Return "fields" as an object. Each entry:
  { "value": <value>, "page": <1-based page where printed>,
    "source_text": "<the exact printed text the value came from, ≤200 chars>",
    "confidence": "high" | "medium" | "low" }

Field names by type:
rate_confirmation: load_number, broker_name, broker_mc_number, carrier_name,
  carrier_mc_number (the CARRIER's MC — never put it in broker_mc_number),
  shipper_name, receiver_name, origin ("City, ST"), destination, pickup_date,
  delivery_date, total_miles, line_haul_rate, fuel_surcharge,
  accessorial_charges, total_revenue (total carrier pay), driver_name,
  truck_number, trailer_number, reference_numbers (array)
bol / pod: load_number, bol_number, carrier_name, shipper_name, receiver_name,
  origin, destination, pickup_date, delivery_date, signature_present,
  delivery_exceptions, driver_name, truck_number, trailer_number,
  reference_numbers
fuel_receipt / lumper_fee / toll / repair / scale_ticket: vendor_name, expense_amount,
  receipt_date, receipt_number, unit_number, load_number, gallons,
  price_per_gallon, description
accessorial: load_number, bol_number, origin, destination, pickup_date,
  delivery_date, accessorial_type ("detention" | "layover" | "tonu" | "other"),
  accessorial_amount (only if printed), detention_hours (only if printed),
  driver_name, reference_numbers
cdl / medical_card / mvr: person_name, license_number, license_state,
  license_class, issue_date, expiration_date, exam_date, report_date
settlement_statement: statement_number, payee_name, driver_name, truck_number,
  period_start, period_end, pay_date, gross_amount, total_additions,
  total_deductions, net_amount, carrier_mc_number
paystub: employer_name, employee_name, period_start, period_end, check_date,
  gross_pay, total_deductions, net_pay, ytd_gross, ytd_net

For settlement_statement and paystub ALSO return "line_items": one entry per
printed line: { "kind": "load" | "earning" | "addition" | "deduction" | "tax",
  "description", "load_number", "date", "amount" (positive number; the kind
  says whether it adds or subtracts), "page", "source_text", "confidence" }.
Do not invent lines and do not merge lines.

For settlement_statement and paystub ALSO return "issuer": { "name",
  "role": "our_company" | "factoring_company" | "external_carrier" | "broker" |
  "payroll_provider" | "unknown", "mc_number", "page", "source_text" } — who
  printed/issued the statement, as shown on it. Use "unknown" if unsure.

Always include:
  "confidence": "high" | "medium" | "low" for the document as a whole,
  "page_count": number of pages you saw,
  "notes": short description (may be "").

Formats: dates YYYY-MM-DD. Numbers are plain JSON numbers (no "$", no commas).
Return ONLY one JSON object. First character "{", last character "}".
`.trim();
