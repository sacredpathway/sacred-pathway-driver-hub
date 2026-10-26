// ============================================================================
// Sacred Pathway — canonical document taxonomy (SINGLE SOURCE OF TRUTH)
// ----------------------------------------------------------------------------
// Two byte-identical copies exist because the Edge Function bundle (Deno) and
// the web app (Next.js) cannot import across each other's project roots:
//
//   supabase/functions/_shared/document-taxonomy.ts   <- canonical
//   web-app/lib/documents/taxonomy.ts                 <- copy
//
// web-app/lib/documents/taxonomy.test.ts fails the build if they ever differ.
// Edit the canonical file, then copy it over the web file.
//
// Pure TypeScript only: no Deno, Node or browser APIs.
// ============================================================================

/** Types the extractor classifies and the router understands. */
export const CANONICAL_DOCUMENT_TYPES = [
  "rate_confirmation",
  "bol",
  "pod",
  "fuel_receipt",
  "lumper_fee",
  "toll",
  "repair",
  "scale_ticket",
  "accessorial",
  "cdl",
  "medical_card",
  "mvr",
  "other",
] as const;

export type CanonicalDocumentType = (typeof CANONICAL_DOCUMENT_TYPES)[number];

/**
 * Historical values already stored in `documents.document_type` that are NOT
 * routable. They stay valid forever (no destructive rename); they display
 * with their own label and are never auto-routed.
 */
export const LEGACY_DOCUMENT_TYPES = [
  "paystub",
  "invoice",
  "receipt",
  "settlement",
] as const;

export type LegacyDocumentType = (typeof LEGACY_DOCUMENT_TYPES)[number];

export type KnownDocumentType = CanonicalDocumentType | LegacyDocumentType;

/** Spelling variants seen in old rows / model output -> canonical type. */
export const DOCUMENT_TYPE_ALIASES: Readonly<
  Record<string, CanonicalDocumentType>
> = {
  lumper: "lumper_fee",
  lumper_receipt: "lumper_fee",
  fuel: "fuel_receipt",
  toll_receipt: "toll",
  tolls: "toll",
  maintenance: "repair",
  repair_bill: "repair",
  repair_receipt: "repair",
  scale: "scale_ticket",
  cat_scale: "scale_ticket",
  weight_ticket: "scale_ticket",
  scale_receipt: "scale_ticket",
  detention: "accessorial",
  detention_receipt: "accessorial",
  layover: "accessorial",
  tonu: "accessorial",
  accessorial_receipt: "accessorial",
  rate_con: "rate_confirmation",
  ratecon: "rate_confirmation",
  load_sheet: "rate_confirmation",
  bill_of_lading: "bol",
  proof_of_delivery: "pod",
  delivery_receipt: "pod",
  cdl_license: "cdl",
  drivers_license: "cdl",
  med_card: "medical_card",
  dot_medical_card: "medical_card",
  medical_certificate: "medical_card",
  motor_vehicle_record: "mvr",
  unknown: "other",
};

export const DOCUMENT_TYPE_LABELS: Readonly<Record<KnownDocumentType, string>> =
  {
    rate_confirmation: "Rate confirmation",
    bol: "Bill of lading (BOL)",
    pod: "Proof of delivery (POD)",
    fuel_receipt: "Fuel receipt",
    lumper_fee: "Lumper receipt",
    toll: "Toll receipt",
    repair: "Repair / maintenance",
    scale_ticket: "Scale ticket",
    accessorial: "Detention / accessorial proof",
    cdl: "CDL",
    medical_card: "Medical card",
    mvr: "MVR",
    other: "Other / unknown",
    paystub: "Paystub",
    invoice: "Invoice",
    receipt: "Receipt",
    settlement: "Settlement",
  };

export type DocumentGroup =
  | "load"
  | "load_paperwork"
  | "expense"
  | "driver"
  | "other";

export const DOCUMENT_TYPE_GROUP: Readonly<
  Record<CanonicalDocumentType, DocumentGroup>
> = {
  rate_confirmation: "load",
  bol: "load_paperwork",
  pod: "load_paperwork",
  fuel_receipt: "expense",
  lumper_fee: "expense",
  toll: "expense",
  repair: "expense",
  scale_ticket: "expense",
  accessorial: "load_paperwork",
  cdl: "driver",
  medical_card: "driver",
  mvr: "driver",
  other: "other",
};

/** Expense category written to `expenses.category` for receipt types. */
export const EXPENSE_CATEGORY_FOR_TYPE: Readonly<
  Partial<Record<CanonicalDocumentType, string>>
> = {
  fuel_receipt: "fuel",
  lumper_fee: "lumper",
  toll: "toll",
  repair: "maintenance",
  scale_ticket: "scale",
};

/**
 * Fields that must be present (after sanitising) for a classification to be
 * considered complete. `oneOf` groups need at least one member present.
 */
export const REQUIRED_FIELDS: Readonly<
  Record<
    CanonicalDocumentType,
    { all: readonly string[]; oneOf?: readonly string[] }
  >
> = {
  rate_confirmation: { all: ["load_number", "broker_name", "total_revenue"] },
  bol: { all: [], oneOf: ["load_number", "bol_number"] },
  pod: { all: [], oneOf: ["load_number", "bol_number"] },
  fuel_receipt: { all: ["vendor_name", "expense_amount", "receipt_date"] },
  lumper_fee: { all: ["vendor_name", "expense_amount", "receipt_date"] },
  toll: { all: ["vendor_name", "expense_amount", "receipt_date"] },
  repair: { all: ["vendor_name", "expense_amount", "receipt_date"] },
  scale_ticket: { all: ["vendor_name", "expense_amount", "receipt_date"] },
  accessorial: { all: [], oneOf: ["load_number", "bol_number"] },
  cdl: { all: ["person_name", "expiration_date"] },
  medical_card: { all: ["person_name", "expiration_date"] },
  mvr: { all: ["person_name", "report_date"] },
  other: { all: [] },
};

export function isCanonicalDocumentType(
  v: unknown,
): v is CanonicalDocumentType {
  return typeof v === "string" &&
    (CANONICAL_DOCUMENT_TYPES as readonly string[]).includes(v);
}

export function isLegacyDocumentType(v: unknown): v is LegacyDocumentType {
  return typeof v === "string" &&
    (LEGACY_DOCUMENT_TYPES as readonly string[]).includes(v);
}

/**
 * Normalise any stored or model-produced value. Never throws.
 *   canonical  -> itself
 *   alias      -> canonical
 *   legacy     -> itself (displayable, not routable)
 *   anything else / empty -> "other"
 */
export function normalizeDocumentType(raw: unknown): KnownDocumentType {
  if (typeof raw !== "string") return "other";
  const key = raw.trim().toLowerCase().replace(/[\s-]+/g, "_");
  if (key === "") return "other";
  if (isCanonicalDocumentType(key)) return key;
  if (isLegacyDocumentType(key)) return key;
  const alias = DOCUMENT_TYPE_ALIASES[key];
  return alias ?? "other";
}

/** Canonical type for routing; legacy values route nowhere ("other"). */
export function routableDocumentType(raw: unknown): CanonicalDocumentType {
  const t = normalizeDocumentType(raw);
  return isCanonicalDocumentType(t) ? t : "other";
}

export function documentTypeLabel(raw: unknown): string {
  return DOCUMENT_TYPE_LABELS[normalizeDocumentType(raw)];
}

/**
 * Every stored spelling that means `type` (for list filters): the value
 * itself plus its historical aliases, e.g. lumper_fee -> [lumper_fee, lumper,
 * lumper_receipt]. Lets filters find old rows without renaming them.
 */
export function storedValuesForType(type: string): string[] {
  const t = normalizeDocumentType(type);
  const aliases = Object.entries(DOCUMENT_TYPE_ALIASES)
    .filter(([, canonical]) => canonical === t)
    .map(([alias]) => alias);
  return [t, ...aliases];
}
