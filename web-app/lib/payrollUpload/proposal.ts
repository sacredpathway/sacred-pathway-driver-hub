// =============================================================================
//  Smart Payroll Upload — payroll PROPOSAL generator (pure, read-only)
// -----------------------------------------------------------------------------
//  Turns one reviewed document (v3 payroll extraction) plus the carrier's own
//  records into a proposal for ONE settlement draft line. It writes nothing,
//  calls nothing, and never decides money: the draft line is always built
//  later by the existing settlement workflow from the STORED load record
//  (lineFromLoad + the shared engine). Extracted numbers are evidence to
//  compare against, never values to save.
//
//  Hard rules
//    * carrier isolation: every row of another account is dropped before use;
//      a document of another account is refused outright;
//    * settlement statements and paystubs are reference-only (all issuers);
//    * exact identifiers only: a load is matched by its printed load number
//      (or a printed reference number) to exactly one of the carrier's loads;
//      several hits = the owner chooses among them; none = blocked (a load is
//      never created from a document);
//    * a load that is cancelled, settled, on an issued paystub, on an
//      approved/paid settlement, or already on a draft is blocked;
//    * every conflict, warning and missing input must be resolved by a human;
//    * nothing here can approve, finalize or pay anything — the only plan it
//      can return is "create a DRAFT" or "add to an editable DRAFT".
// =============================================================================

import { cityOf, companiesCorroborate, matchDriver, matchLoad, normalizeIdentifier } from "../documents/matching";
import type { DriverCandidate, LoadCandidate, MatchResult } from "../documents/types";
import {
  PAYROLL_FIELD_SPECS,
  sanitizePayrollExtraction,
  type FieldEvidence,
  type SanitizedPayrollExtraction,
} from "../documents/payrollExtraction";
import { isWebEditLocked, lineGross, normaliseStatus } from "../settlements/model";
import { isLoadCompleted, lineFromLoad, periodDateOf, type LoadRow } from "../settlements/workflow";
import { isYmd } from "../settlements/input";
import { mcKey, payrollUseOf, type PolicyResult } from "./policy";
import { validatePayrollExtraction, type ValidationResult } from "./validation";
import { detectDuplicates, documentIdentity, type DuplicateReport, type ExistingDocument } from "./duplicates";
import type { CarrierIdentity } from "./carrierIdentity";

// ---------------------------------------------------------------------------
//  Inputs
// ---------------------------------------------------------------------------

export interface ProposalDocument {
  id: string;
  profile_id: string;
  status: string | null;
  document_type: string | null;
  extraction_version: string | null;
  extracted_data: unknown;
  content_sha256: string | null;
  review_status: string | null;
  duplicate_of: string | null;
  settlement_id: string | null;
  routing: unknown;
}

/** A carrier load with the columns the comparison and the draft line need. */
export type ProposalLoad = LoadCandidate & LoadRow;

export interface DraftSettlementRef {
  id: string;
  profile_id: string;
  driver_id: string | null;
  period_start: string | null;
  period_end: string | null;
  status: string | null;
  updated_at: string | null;
  settlement_number: string | null;
  is_estimate: boolean | null;
}

export interface SettlementLineRef {
  settlement_id: string;
  load_id: string | null;
  is_adjustment: boolean;
  settlement_status: string | null;
  is_estimate: boolean | null;
}

/** Codes from public.sph_loads_payment_conflicts (the database is authoritative). */
export type PaymentConflict = "load_cancelled" | "load_settled" | "load_on_issued_paystub" | "load_on_settlement" | "load_not_found" | string;

export interface ProposalDecisions {
  /** Owner's pick when several loads carry the printed number. */
  loadId?: string | null;
  target?:
    | { kind: "new_draft"; periodStart: string; periodEnd: string; applyRecurring: boolean }
    | { kind: "existing_draft"; settlementId: string }
    | null;
  /** Owner's fixes to MISREAD extracted values (never touches stored records). */
  corrections?: Readonly<Record<string, { value: unknown; note?: string }>>;
  /** Warning / conflict keys the owner explicitly accepted. */
  acknowledged?: readonly string[];
}

export interface ProposalInput {
  ownerId: string;
  today: string;
  document: ProposalDocument;
  identity: CarrierIdentity | null;
  loads: readonly ProposalLoad[];
  drivers: readonly DriverCandidate[];
  settlementLines: readonly SettlementLineRef[];
  drafts: readonly DraftSettlementRef[];
  /** load id -> conflict code, from sph_loads_payment_conflicts (selected/candidate loads). */
  paymentConflicts: ReadonlyMap<string, PaymentConflict>;
  /** Other documents of this carrier (sha + identity) for duplicate checks. */
  otherDocuments: readonly ExistingDocument[];
  decisions?: ProposalDecisions;
}

// ---------------------------------------------------------------------------
//  Output
// ---------------------------------------------------------------------------

export type ProposalStatus =
  | "ready" // every check passed and every decision made: may be confirmed
  | "needs_input" // the owner still has choices / acknowledgements to make
  | "blocked" // cannot become payroll as things stand (reason given)
  | "reference_only" // statements / paystubs / another carrier's paperwork
  | "supporting_document" // BOL / POD: attach to a load, not a pay line
  | "not_payroll"; // receipts (expense flow), licences, unknown

export interface Blocker { code: string; message: string; fields?: string[] }
export interface Warning { key: string; code: string; message: string; acknowledged: boolean }

export type CompareState = "match" | "conflict" | "document_only" | "record_only" | "not_compared";

export interface FieldRow {
  field: string;
  label: string;
  kind: string;
  /** Value after the owner's corrections (what the review is based on). */
  extracted: unknown;
  /** The value the model read, when the owner corrected it. */
  readAs?: unknown;
  correctedNote?: string;
  page: number | null;
  sourceText: string | null;
  /** The model's own label; null when it gave none. Never computed. */
  modelConfidence: FieldEvidence["model_confidence"];
  evidence: FieldEvidence["evidence_check"] | "corrected_by_owner" | "missing";
  stored: unknown;
  compare: CompareState;
}

export type DraftPlan =
  | {
      kind: "create";
      documentId: string;
      driverId: string;
      periodStart: string;
      periodEnd: string;
      loadId: string;
      applyRecurring: boolean;
    }
  | {
      kind: "add_to_draft";
      documentId: string;
      settlementId: string;
      expectedUpdatedAt: string | null;
      loadId: string;
    };

export interface PayrollProposal {
  documentId: string;
  status: ProposalStatus;
  policy: PolicyResult | null;
  extraction: SanitizedPayrollExtraction | null;
  validation: ValidationResult | null;
  duplicates: DuplicateReport | null;
  identity: { verified: boolean; displayName: string | null; reasons: string[] } | null;
  fields: FieldRow[];
  missingFields: string[];
  load: {
    match: MatchResult | null;
    candidates: ProposalLoad[];
    selected: ProposalLoad | null;
    /** Gross the DRAFT line will carry, from the stored load (engine rule). */
    draftLineGross: string | null;
    paymentConflict: PaymentConflict | null;
  };
  driver: {
    selected: DriverCandidate | null;
    documentNameMatch: MatchResult | null;
  };
  target: {
    options: DraftSettlementRef[];
    selected: ProposalDecisions["target"] | null;
  };
  blockers: Blocker[];
  warnings: Warning[];
  needs: string[];
  canConfirm: boolean;
  plan: DraftPlan | null;
}

export const FIELD_LABEL: Readonly<Record<string, string>> = {
  load_number: "Load number", bol_number: "BOL number", broker_name: "Broker", broker_mc_number: "Broker MC",
  carrier_name: "Carrier", carrier_mc_number: "Carrier MC", shipper_name: "Shipper", receiver_name: "Receiver",
  origin: "Origin", destination: "Destination", pickup_date: "Pickup date", delivery_date: "Delivery date",
  total_miles: "Miles", line_haul_rate: "Line haul", fuel_surcharge: "Fuel surcharge",
  accessorial_charges: "Accessorials", total_revenue: "Total carrier pay", driver_name: "Driver",
  truck_number: "Truck", trailer_number: "Trailer", reference_numbers: "Reference numbers",
  statement_number: "Statement number", payee_name: "Payee", period_start: "Period start", period_end: "Period end",
  pay_date: "Pay date", gross_amount: "Gross", total_additions: "Additions", total_deductions: "Deductions",
  net_amount: "Net", employer_name: "Employer", employee_name: "Employee", check_date: "Check date",
  gross_pay: "Gross pay", net_pay: "Net pay", ytd_gross: "YTD gross", ytd_net: "YTD net",
};

/** extracted field -> stored load column, and how to compare. */
const LOAD_COMPARE: ReadonlyArray<[string, keyof ProposalLoad, "id" | "company" | "date" | "city" | "money"]> = [
  ["load_number", "load_number", "id"],
  ["broker_name", "broker_name", "company"],
  ["pickup_date", "pickup_date", "date"],
  ["delivery_date", "delivery_date", "date"],
  ["origin", "origin", "city"],
  ["destination", "destination", "city"],
  ["line_haul_rate", "line_haul_rate", "money"],
  ["fuel_surcharge", "fuel_surcharge", "money"],
  ["accessorial_charges", "accessorial_charges", "money"],
  ["total_revenue", "total_revenue", "money"],
];

const cents = (v: unknown): number | null => {
  const n = typeof v === "number" ? v : typeof v === "string" && /^-?\d+(\.\d+)?$/.test(v.trim()) ? Number(v) : NaN;
  return Number.isFinite(n) ? Math.round(n * 100) : null;
};
const ymd = (v: unknown) => (typeof v === "string" ? v.slice(0, 10) : null);

function compareOne(how: "id" | "company" | "date" | "city" | "money", a: unknown, b: unknown): boolean {
  switch (how) {
    case "id": return normalizeIdentifier(a) !== null && normalizeIdentifier(a) === normalizeIdentifier(b);
    case "company": return companiesCorroborate(a, b);
    case "date": return ymd(a) !== null && ymd(a) === ymd(b);
    case "city": return cityOf(a) !== null && cityOf(a) === cityOf(b);
    case "money": return cents(a) !== null && cents(a) === cents(b);
  }
}

const empty = (v: unknown) => v === null || v === undefined || v === "";

// ---------------------------------------------------------------------------
//  Corrections: rebuild the raw v3 object with the owner's values and run the
//  SAME sanitizer, so a correction gets exactly the same type checks.
// ---------------------------------------------------------------------------

function toRaw(x: SanitizedPayrollExtraction): Record<string, unknown> {
  const fields: Record<string, unknown> = {};
  for (const [k, ev] of Object.entries(x.fields)) {
    fields[k] = { value: ev.value, page: ev.page, source_text: ev.source_text, confidence: ev.model_confidence };
  }
  return {
    document_type: x.document_type, confidence: x.model_confidence, page_count: x.page_count, fields,
    line_items: x.line_items.map((l) => ({ ...l, confidence: l.model_confidence })),
    issuer: x.issuer, notes: x.notes,
  };
}

export function applyCorrections(
  x: SanitizedPayrollExtraction,
  corrections: ProposalDecisions["corrections"],
): { extraction: SanitizedPayrollExtraction; invalid: string[]; corrected: Map<string, { readAs: unknown; note?: string }> } {
  const corrected = new Map<string, { readAs: unknown; note?: string }>();
  if (!corrections || Object.keys(corrections).length === 0) return { extraction: x, invalid: [], corrected };
  const raw = toRaw(x);
  const fields = raw.fields as Record<string, unknown>;
  const invalid: string[] = [];
  for (const [k, c] of Object.entries(corrections)) {
    if (!PAYROLL_FIELD_SPECS[k]) { invalid.push(k); continue; }
    const prev = (fields[k] as { value?: unknown; page?: unknown; source_text?: unknown } | undefined) ?? {};
    fields[k] = { value: c.value, page: prev.page ?? null, source_text: prev.source_text ?? null, confidence: null };
    corrected.set(k, { readAs: x.values[k] ?? null, note: typeof c.note === "string" ? c.note.slice(0, 200) : undefined });
  }
  const out = sanitizePayrollExtraction(raw);
  for (const k of corrected.keys()) {
    if (!(k in out.values)) invalid.push(k);
  }
  return { extraction: out, invalid: [...new Set(invalid)], corrected };
}

// ---------------------------------------------------------------------------
//  Main
// ---------------------------------------------------------------------------

export class ForeignDocumentError extends Error {
  constructor() { super("document_not_owned"); }
}

export function buildPayrollProposal(input: ProposalInput): PayrollProposal {
  const { ownerId, document: doc } = input;
  if (doc.profile_id !== ownerId) throw new ForeignDocumentError();
  const d = input.decisions ?? {};
  const acks = new Set(d.acknowledged ?? []);

  // Carrier isolation, defence in depth (RLS already scopes every query).
  const loads = input.loads.filter((l) => l.profile_id === ownerId);
  const drivers = input.drivers.filter((x) => x.profile_id === ownerId);
  const drafts = input.drafts.filter((x) => x.profile_id === ownerId);

  const blockers: Blocker[] = [];
  const warnings: Warning[] = [];
  const needs: string[] = [];
  const block = (code: string, message: string, fields?: string[]) => blockers.push({ code, message, fields });
  const warn = (key: string, code: string, message: string) => warnings.push({ key, code, message, acknowledged: acks.has(key) });

  const base: PayrollProposal = {
    documentId: doc.id, status: "blocked", policy: null, extraction: null, validation: null, duplicates: null,
    identity: input.identity ? { verified: input.identity.verified, displayName: input.identity.displayName, reasons: [...input.identity.reasons] } : null,
    fields: [], missingFields: [],
    load: { match: null, candidates: [], selected: null, draftLineGross: null, paymentConflict: null },
    driver: { selected: null, documentNameMatch: null },
    target: { options: [], selected: null },
    blockers, warnings, needs, canConfirm: false, plan: null,
  };

  // ---- the document itself ------------------------------------------------
  const data = doc.extracted_data as { extraction_version?: unknown; profile?: unknown } | null;
  if (doc.extraction_version !== "v3" || !data || data.extraction_version !== "v3" || data.profile !== "payroll") {
    block("needs_payroll_extraction", "This document hasn't been read with payroll extraction yet.");
    return base;
  }
  if (doc.status !== "processed") {
    block("not_processed", "This document hasn't finished processing.");
    return base;
  }
  if (doc.review_status === "dismissed") {
    block("dismissed", "This document was dismissed. Restore it in the review queue first.");
    return base;
  }
  const confirmedAlready = doc.settlement_id !== null || payrollConfirmationOf(doc.routing) !== null;
  if (confirmedAlready) {
    block("already_confirmed", "This document is already on a settlement draft. Open that settlement to change it.");
  }
  if (doc.duplicate_of) {
    block("document_is_duplicate", "This upload is a copy of an earlier document. Review the original instead.");
  }

  // Re-sanitise what is stored (never trust stored JSON shape), then corrections.
  const stored = sanitizePayrollExtraction(doc.extracted_data);
  const { extraction, invalid, corrected } = applyCorrections(stored, d.corrections);
  base.extraction = extraction;
  for (const k of invalid) block("correction_invalid", `The corrected ${FIELD_LABEL[k] ?? k} isn't a valid value.`, [k]);

  // ---- policy (reference-only rules) ----------------------------------------
  const identity = input.identity ?? { names: [], mcNumbers: [] };
  const policy = payrollUseOf(extraction, identity);
  base.policy = policy;

  // ---- validation (cent-exact), with corrected fields' evidence waived -----
  const validation = validatePayrollExtraction(extraction, { today: input.today });
  base.validation = validation;
  for (const iss of validation.issues) {
    const isEvidence = iss.code === "evidence_mismatch" || iss.code === "unverified_amount";
    if (isEvidence && iss.fields.every((f) => corrected.has(f))) continue;
    if (iss.severity === "error") block(`validation:${iss.code}`, iss.message, iss.fields);
    else if (iss.severity === "warning") warn(`validation:${iss.code}:${iss.fields.join(",")}`, iss.code, iss.message);
  }

  // ---- duplicates -------------------------------------------------------------
  const identityKey = documentIdentity(extraction.document_type, extraction.values, extraction.issuer?.name ?? null);
  const dups = detectDuplicates(
    { profileId: ownerId, sha256: doc.content_sha256, identity: identityKey, excludeId: doc.id },
    input.otherDocuments,
  );
  base.duplicates = dups;
  if (dups.verdict === "exact_duplicate") block("duplicate_file", "The same file was uploaded before. Review the earlier document instead.");
  else if (dups.verdict === "possible_duplicate") warn("duplicate:possible", "possible_duplicate", "Another document has the same printed identifiers. Make sure this isn't the same paperwork scanned twice.");
  if (!doc.content_sha256) warn("duplicate:no_fingerprint", "no_fingerprint", "This upload has no file fingerprint (older iPhone upload), so a same-file duplicate can't be ruled out automatically.");

  // ---- identity -----------------------------------------------------------------
  if (!input.identity || !input.identity.verified) {
    warn("identity:unverified", "carrier_identity_unverified", "Your company name / MC number isn't on your profile, so the carrier printed on this document can't be checked automatically. Confirm it is your load.");
  }

  // ---- field rows (evidence) — filled before the policy exits -----------------
  const fieldRows = (selected: ProposalLoad | null): FieldRow[] => {
    const rows: FieldRow[] = [];
    const compareFor = new Map(LOAD_COMPARE.map(([e, s, how]) => [e, { s, how }]));
    const names = new Set([...Object.keys(extraction.fields), ...extraction.missing_required.flatMap((m) => m.split("|"))]);
    if (selected) for (const [e] of LOAD_COMPARE) names.add(e);
    for (const k of names) {
      const ev = extraction.fields[k];
      const cmp = compareFor.get(k);
      const storedVal = selected && cmp ? selected[cmp.s] ?? null : null;
      let state: CompareState = "not_compared";
      if (selected && cmp) {
        const e = ev?.value;
        state = empty(e) && empty(storedVal) ? "not_compared"
          : empty(e) ? "record_only"
          : empty(storedVal) ? "document_only"
          : compareOne(cmp.how, e, storedVal) ? "match" : "conflict";
      }
      const c = corrected.get(k);
      rows.push({
        field: k, label: FIELD_LABEL[k] ?? k, kind: PAYROLL_FIELD_SPECS[k]?.kind ?? "string",
        extracted: ev?.value ?? null,
        ...(c ? { readAs: c.readAs, correctedNote: c.note } : {}),
        page: ev?.page ?? null, sourceText: ev?.source_text ?? null, modelConfidence: ev?.model_confidence ?? null,
        evidence: !ev ? "missing" : c ? "corrected_by_owner" : ev.evidence_check,
        stored: storedVal, compare: state,
      });
    }
    return rows.sort((a, b) => a.label.localeCompare(b.label));
  };
  base.missingFields = extraction.missing_required;

  // ---- documents that never become pay lines -------------------------------------
  if (policy.use !== "draft_candidate") {
    base.fields = fieldRows(null);
    base.status = policy.use === "reference_only" ? "reference_only"
      : policy.use === "supporting_document" ? "supporting_document" : "not_payroll";
    return base;
  }
  if (policy.reasons.includes("carrier_unconfirmed")) {
    warn("policy:carrier_unconfirmed", "carrier_unconfirmed", "No carrier name or MC is printed on this rate confirmation. Confirm it is addressed to your company.");
  }

  // ---- pilot review flags (2026-10-26 extraction check) -----------------------------
  // Each one is a warning: a person must acknowledge it, and automatic drafting holds.
  const printedMc = mcKey(extraction.values.carrier_mc_number);
  const ownMcs = (input.identity?.mcNumbers ?? []).map((m) => mcKey(m)).filter((m): m is string => !!m);
  if (printedMc && ownMcs.length && !ownMcs.includes(printedMc)) {
    warn("identity:mc_mismatch", "carrier_mc_mismatch", `The carrier MC read from this document (${printedMc}) isn't your MC (${ownMcs.join(", ")}). It may be a DOT number or a misread. Check the paperwork before drafting.`);
  }
  const printedDriver = typeof extraction.values.driver_name === "string" ? extraction.values.driver_name.trim() : "";
  if (printedDriver && printedDriver.split(/[\s,]+/).filter((t) => /[A-Za-z]/.test(t)).length < 2) {
    warn("driver:ambiguous", "driver_ambiguous", `The document only gives a partial driver name (${printedDriver}). Confirm which driver hauled this load.`);
  }
  const total = extraction.values.total_revenue;
  if (total === undefined || total === null || extraction.missing_required.some((m) => m.split("|").includes("total_revenue"))) {
    warn("money:total_missing", "total_missing", "No total carrier pay was read from this document. The draft will use your load record's revenue; compare it with the paperwork.");
  }

  // ---- load: exact identifiers only --------------------------------------------
  const ids = [extraction.values.load_number, ...((extraction.values.reference_numbers as string[] | undefined) ?? [])]
    .map((v) => normalizeIdentifier(v));
  const match = matchLoad(ownerId, loads, {
    identifiers: ids,
    broker_name: extraction.values.broker_name,
    dates: [extraction.values.pickup_date, extraction.values.delivery_date],
    cities: [extraction.values.origin, extraction.values.destination],
  });
  base.load.match = match;
  const byId = new Map(loads.map((l) => [l.id, l]));
  base.load.candidates = match.candidate_ids.map((x) => byId.get(x)).filter((x): x is ProposalLoad => !!x);

  let selected: ProposalLoad | null = null;
  if (match.evidence.includes("not_found") || match.evidence.includes("no_identifier")) {
    block("load_not_found", "No load of yours carries this load number. Enter the load first; a document never creates a load.");
  } else if (match.evidence.includes("ambiguous")) {
    if (d.loadId && match.candidate_ids.includes(d.loadId)) selected = byId.get(d.loadId) ?? null;
    else if (d.loadId) block("load_choice_invalid", "That load isn't one of the loads with this number.");
    else needs.push("choose_load");
  } else if (match.target_id) {
    if (d.loadId && d.loadId !== match.target_id) block("load_choice_invalid", "Only the load with the printed number can be used.");
    selected = byId.get(match.target_id) ?? null;
  }
  base.load.selected = selected;
  base.fields = fieldRows(selected);

  if (selected) {
    // Conflicts between the paperwork and the stored load: the DRAFT always
    // uses the stored load; the owner must confirm that, or fix the load first.
    for (const r of base.fields) {
      if (r.compare === "conflict") {
        warn(`conflict:${r.field}`, "conflict", `${r.label}: the document shows ${fmt(r.kind, r.extracted)}, your load record has ${fmt(r.kind, r.stored)}. The draft will use your load record. If the document is right, edit the load first.`);
      }
    }

    // Database is authoritative for "paid elsewhere / cancelled / settled".
    const conflict = input.paymentConflicts.get(selected.id) ?? null;
    base.load.paymentConflict = conflict;
    if (conflict) block(`payment:${conflict}`, PAYMENT_MESSAGE[conflict] ?? "This load can't be paid again.");

    // On any live (non-voided, non-estimate) settlement already = duplicate pay line.
    const live = input.settlementLines.filter((l) => l.load_id === selected!.id && !l.is_adjustment && !l.is_estimate && normaliseStatus(l.settlement_status) !== "voided");
    if (live.length) block("load_on_settlement", "This load is already on a settlement draft or settlement. Open that settlement instead of adding it twice.");

    const status = (selected.status ?? "").trim().toLowerCase();
    if (status === "cancelled" || status === "canceled") block("load_cancelled", "This load is cancelled and can't be paid.");
    if (!isLoadCompleted(selected, input.today)) block("load_not_delivered", "This load isn't delivered yet (delivery date is in the future or missing).");

    const line = lineFromLoad(selected, 0);
    const gross = lineGross(line).rounded();
    base.load.draftLineGross = gross.toFixed2();
    if (gross.isZero()) block("stored_load_no_revenue", "Your load record has no revenue, so the draft line would be $0.00. Enter the load's rate first.");

    // ---- driver: from the stored load (the settlement workflow requires it) ---
    const driver = selected.driver_id ? drivers.find((x) => x.id === selected!.driver_id) ?? null : null;
    base.driver.selected = driver;
    if (!selected.driver_id) block("load_has_no_driver", "This load has no driver assigned. Assign the driver on the load first.");
    else if (!driver) block("driver_not_found", "The load's driver isn't one of your drivers.");

    if (extraction.values.driver_name) {
      const dm = matchDriver(ownerId, drivers, { person_name: extraction.values.driver_name });
      base.driver.documentNameMatch = dm;
      if (driver && dm.target_id && dm.target_id !== driver.id) {
        warn("driver:mismatch", "driver_mismatch", `The document names ${String(extraction.values.driver_name)}, but the load is assigned to ${driver.name}. The draft will be for ${driver.name}.`);
      } else if (driver && !dm.target_id) {
        warn("driver:unmatched", "driver_unmatched", `The driver printed on the document (${String(extraction.values.driver_name)}) doesn't match a driver on file. The draft will be for ${driver.name}.`);
      }
    }

    // ---- target settlement ------------------------------------------------------
    const pd = periodDateOf(selected);
    if (driver && pd) {
      base.target.options = drafts.filter((s) =>
        s.driver_id === driver.id && s.is_estimate !== true && !isWebEditLocked(normaliseStatus(s.status))
        && !!s.period_start && !!s.period_end && s.period_start.slice(0, 10) <= pd && pd <= s.period_end.slice(0, 10));
    }
    const t = d.target ?? null;
    base.target.selected = t;
    if (!t) {
      needs.push("choose_target");
    } else if (t.kind === "existing_draft") {
      const s = base.target.options.find((o) => o.id === t.settlementId);
      if (!s) block("target_invalid", "That settlement isn't an editable draft for this driver covering the load's date.");
    } else {
      if (!isYmd(t.periodStart) || !isYmd(t.periodEnd)) needs.push("enter_period");
      else if (t.periodEnd < t.periodStart) block("period_invalid", "The pay period ends before it starts.");
      else if (pd && (pd < t.periodStart || pd > t.periodEnd)) block("period_excludes_load", `The pay period must include the load's date (${pd}).`);
    }
  }

  // ---- outcome ----------------------------------------------------------------------
  for (const w of warnings) if (!w.acknowledged) needs.push(`acknowledge:${w.key}`);
  base.status = blockers.length ? "blocked" : needs.length ? "needs_input" : "ready";
  base.canConfirm = base.status === "ready";
  if (base.canConfirm && selected && base.driver.selected && d.target) {
    base.plan = d.target.kind === "new_draft"
      ? { kind: "create", documentId: doc.id, driverId: base.driver.selected.id, periodStart: d.target.periodStart, periodEnd: d.target.periodEnd, loadId: selected.id, applyRecurring: d.target.applyRecurring === true }
      : { kind: "add_to_draft", documentId: doc.id, settlementId: d.target.settlementId, expectedUpdatedAt: base.target.options.find((o) => o.id === (d.target as { settlementId: string }).settlementId)?.updated_at ?? null, loadId: selected.id };
  } else {
    base.canConfirm = false;
  }
  return base;
}

const PAYMENT_MESSAGE: Record<string, string> = {
  load_cancelled: "This load is cancelled and can't be paid.",
  load_settled: "This load is already settled.",
  load_on_issued_paystub: "This load is already paid on an issued paystub.",
  load_on_settlement: "This load is already on an approved or paid settlement.",
  load_not_found: "This load can't be found.",
};

function fmt(kind: string, v: unknown): string {
  if (v === null || v === undefined || v === "") return "nothing";
  if (kind === "money") { const c = cents(v); return c === null ? String(v) : `$${(c / 100).toFixed(2)}`; }
  return String(v);
}

/** The confirmation record written to documents.routing.payroll (or null). */
export function payrollConfirmationOf(routing: unknown): { settlement_id: string; confirmed_at: string } | null {
  if (!routing || typeof routing !== "object") return null;
  const p = (routing as { payroll?: unknown }).payroll;
  if (!p || typeof p !== "object") return null;
  const r = p as { settlement_id?: unknown; confirmed_at?: unknown };
  return typeof r.settlement_id === "string" && typeof r.confirmed_at === "string" ? { settlement_id: r.settlement_id, confirmed_at: r.confirmed_at } : null;
}
