// =============================================================================
//  Smart Payroll Upload — deterministic validation (pure, cent-exact)
// -----------------------------------------------------------------------------
//  Runs AFTER sanitising. The model's confidence never overrides a failed
//  check. All money math is in integer cents.
//
//  severity:
//    error    -> blocks "Confirm to draft" until a human corrects the value
//    warning  -> must be acknowledged on the review screen
//    info     -> shown only
// =============================================================================

import type { LineItem, SanitizedPayrollExtraction } from "../documents/payrollExtraction";
import { PAYROLL_FIELD_SPECS } from "../documents/payrollExtraction";

export type Severity = "error" | "warning" | "info";

export type IssueCode =
  | "missing_required"
  | "rate_components_mismatch"
  | "statement_totals_mismatch"
  | "line_items_gross_mismatch"
  | "line_items_deductions_mismatch"
  | "line_items_additions_mismatch"
  | "paystub_totals_mismatch"
  | "date_order"
  | "date_in_future"
  | "date_very_old"
  | "line_outside_period"
  | "conflicting_line_amounts"
  | "duplicate_line_item"
  | "evidence_mismatch"
  | "unverified_amount"
  | "zero_amount";

export interface Issue {
  code: IssueCode;
  severity: Severity;
  fields: string[];
  message: string;
  /** Cents involved, when a sum check failed. */
  expected_cents?: number;
  actual_cents?: number;
}

export interface ValidationResult {
  issues: Issue[];
  /** True when any `error` is present. */
  blocking: boolean;
}

export interface ValidationOptions {
  /** Today as YYYY-MM-DD (injected for determinism). */
  today: string;
  maxFutureDays?: number;
  maxPastDays?: number;
  /** Allowed rounding difference in cents for printed totals. Default 1. */
  toleranceCents?: number;
}

export const cents = (n: number): number => Math.round(n * 100);
const fmt = (c: number) => `$${(c / 100).toFixed(2)}`;
const label = (k: string) => k.replace(/_/g, " ");

function dayDiff(a: string, b: string): number {
  return Math.round((Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86_400_000);
}

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const str = (v: unknown): string | null => (typeof v === "string" ? v : null);

function sumKinds(items: readonly LineItem[], kinds: readonly LineItem["kind"][]): number {
  return items.filter((i) => kinds.includes(i.kind)).reduce((s, i) => s + cents(i.amount), 0);
}

export function validatePayrollExtraction(
  x: SanitizedPayrollExtraction,
  opts: ValidationOptions,
): ValidationResult {
  const issues: Issue[] = [];
  const tol = opts.toleranceCents ?? 1;
  const v = x.values;
  const push = (i: Issue) => issues.push(i);
  const close = (a: number, b: number) => Math.abs(a - b) <= tol;

  for (const m of x.missing_required) {
    push({
      code: "missing_required", severity: "error", fields: m.split("|"),
      message: `Not found on the document: ${m.split("|").map(label).join(" or ")}. Enter it from the paperwork.`,
    });
  }

  // ---- rate confirmation: line haul + fuel + accessorials = total ----------
  if (x.document_type === "rate_confirmation") {
    const total = num(v.total_revenue);
    const lh = num(v.line_haul_rate);
    if (total !== null && lh !== null) {
      const parts = cents(lh) + cents(num(v.fuel_surcharge) ?? 0) + cents(num(v.accessorial_charges) ?? 0);
      if (!close(parts, cents(total))) {
        push({
          code: "rate_components_mismatch", severity: "warning",
          fields: ["line_haul_rate", "fuel_surcharge", "accessorial_charges", "total_revenue"],
          message: `Line haul + fuel + accessorials = ${fmt(parts)}, but the total printed is ${fmt(cents(total))}. Check which one the broker pays.`,
          expected_cents: cents(total), actual_cents: parts,
        });
      }
    }
    if (total !== null && cents(total) === 0) {
      push({ code: "zero_amount", severity: "error", fields: ["total_revenue"], message: "Total carrier pay reads as $0.00." });
    }
  }

  // ---- settlement statement: gross + additions − deductions = net ----------
  if (x.document_type === "settlement_statement") {
    const gross = num(v.gross_amount), add = num(v.total_additions), ded = num(v.total_deductions), net = num(v.net_amount);
    if (gross !== null && net !== null && (ded !== null || add !== null)) {
      const calc = cents(gross) + cents(add ?? 0) - cents(ded ?? 0);
      if (!close(calc, cents(net))) {
        push({
          code: "statement_totals_mismatch", severity: "error",
          fields: ["gross_amount", "total_additions", "total_deductions", "net_amount"],
          message: `Gross + additions − deductions = ${fmt(calc)}, but net printed is ${fmt(cents(net))}.`,
          expected_cents: cents(net), actual_cents: calc,
        });
      }
    }
    lineSumChecks(x.line_items, gross, ded, add, push, close);
  }

  // ---- paystub: gross − deductions = net -----------------------------------
  if (x.document_type === "paystub") {
    const gross = num(v.gross_pay), ded = num(v.total_deductions), net = num(v.net_pay);
    if (gross !== null && ded !== null && net !== null) {
      const calc = cents(gross) - cents(ded);
      if (!close(calc, cents(net))) {
        push({
          code: "paystub_totals_mismatch", severity: "error",
          fields: ["gross_pay", "total_deductions", "net_pay"],
          message: `Gross − deductions = ${fmt(calc)}, but net printed is ${fmt(cents(net))}.`,
          expected_cents: cents(net), actual_cents: calc,
        });
      }
    }
    if (ded !== null && x.line_items.some((i) => i.kind === "deduction" || i.kind === "tax")) {
      const s = sumKinds(x.line_items, ["deduction", "tax"]);
      if (!close(s, cents(ded))) {
        push({
          code: "line_items_deductions_mismatch", severity: "error", fields: ["total_deductions", "line_items"],
          message: `Deduction and tax lines add to ${fmt(s)}, but total deductions printed is ${fmt(cents(ded))}.`,
          expected_cents: cents(ded), actual_cents: s,
        });
      }
    }
  }

  // ---- dates ---------------------------------------------------------------
  const order: Array<[string, string]> = [["pickup_date", "delivery_date"], ["period_start", "period_end"], ["issue_date", "expiration_date"]];
  for (const [a, b] of order) {
    const da = str(v[a]), db = str(v[b]);
    if (da && db && da > db) {
      push({ code: "date_order", severity: "error", fields: [a, b], message: `${label(a)} (${da}) is after ${label(b)} (${db}).` });
    }
  }
  const maxF = opts.maxFutureDays ?? 7, maxP = opts.maxPastDays ?? 730;
  for (const [k, val] of Object.entries(v)) {
    if (PAYROLL_FIELD_SPECS[k]?.kind !== "date" || typeof val !== "string") continue;
    if (k === "expiration_date") continue; // licences legitimately expire in the future
    const d = dayDiff(val, opts.today);
    if (d > maxF) push({ code: "date_in_future", severity: "warning", fields: [k], message: `${label(k)} ${val} is ${d} days in the future.` });
    else if (-d > maxP) push({ code: "date_very_old", severity: "warning", fields: [k], message: `${label(k)} ${val} is more than ${maxP} days old.` });
  }
  const ps = str(v.period_start), pe = str(v.period_end);
  if (ps && pe) {
    x.line_items.forEach((li, i) => {
      if (li.date && (li.date < ps || li.date > pe)) {
        push({ code: "line_outside_period", severity: "warning", fields: [`line_items[${i}]`], message: `Line "${li.description ?? li.load_number ?? i + 1}" is dated ${li.date}, outside ${ps} – ${pe}.` });
      }
    });
  }

  // ---- conflicting / duplicated lines --------------------------------------
  const byLoad = new Map<string, number[]>();
  x.line_items.forEach((li, i) => {
    if (li.kind !== "load" || !li.load_number) return;
    const k = li.load_number.toUpperCase().replace(/[^A-Z0-9]/g, "");
    byLoad.set(k, [...(byLoad.get(k) ?? []), i]);
  });
  for (const [load, idx] of byLoad) {
    if (idx.length < 2) continue;
    const amounts = new Set(idx.map((i) => cents(x.line_items[i].amount)));
    push(amounts.size > 1
      ? { code: "conflicting_line_amounts", severity: "error", fields: idx.map((i) => `line_items[${i}]`), message: `Load ${load} appears ${idx.length} times with different amounts.` }
      : { code: "duplicate_line_item", severity: "warning", fields: idx.map((i) => `line_items[${i}]`), message: `Load ${load} appears ${idx.length} times with the same amount. Check it is not listed twice.` });
  }

  // ---- evidence ------------------------------------------------------------
  for (const [k, ev] of Object.entries(x.fields)) {
    const kind = PAYROLL_FIELD_SPECS[k]?.kind;
    if (ev.evidence_check === "value_not_in_source") {
      push({ code: "evidence_mismatch", severity: "warning", fields: [k], message: `The text quoted for ${label(k)} does not contain the value read. Check it on the document.` });
    } else if (ev.evidence_check === "no_source" && kind === "money") {
      push({ code: "unverified_amount", severity: "warning", fields: [k], message: `No printed text was given for ${label(k)}. Check the amount on the document.` });
    }
  }
  x.line_items.forEach((li, i) => {
    if (li.evidence_check !== "value_in_source") {
      push({
        code: li.evidence_check === "no_source" ? "unverified_amount" : "evidence_mismatch", severity: "warning", fields: [`line_items[${i}]`],
        message: `Line ${i + 1} amount ${fmt(cents(li.amount))} could not be matched to its printed text.`,
      });
    }
  });

  return { issues, blocking: issues.some((i) => i.severity === "error") };
}

function lineSumChecks(
  items: readonly LineItem[],
  gross: number | null,
  ded: number | null,
  add: number | null,
  push: (i: Issue) => void,
  close: (a: number, b: number) => boolean,
) {
  if (!items.length) return;
  if (gross !== null && items.some((i) => i.kind === "load" || i.kind === "earning")) {
    const s = sumKinds(items, ["load", "earning"]);
    if (!close(s, cents(gross))) push({ code: "line_items_gross_mismatch", severity: "error", fields: ["gross_amount", "line_items"], message: `Load and earning lines add to ${fmt(s)}, but gross printed is ${fmt(cents(gross))}.`, expected_cents: cents(gross), actual_cents: s });
  }
  if (ded !== null && items.some((i) => i.kind === "deduction" || i.kind === "tax")) {
    const s = sumKinds(items, ["deduction", "tax"]);
    if (!close(s, cents(ded))) push({ code: "line_items_deductions_mismatch", severity: "error", fields: ["total_deductions", "line_items"], message: `Deduction lines add to ${fmt(s)}, but total deductions printed is ${fmt(cents(ded))}.`, expected_cents: cents(ded), actual_cents: s });
  }
  if (add !== null && items.some((i) => i.kind === "addition")) {
    const s = sumKinds(items, ["addition"]);
    if (!close(s, cents(add))) push({ code: "line_items_additions_mismatch", severity: "error", fields: ["total_additions", "line_items"], message: `Addition lines add to ${fmt(s)}, but total additions printed is ${fmt(cents(add))}.`, expected_cents: cents(add), actual_cents: s });
  }
}

// =============================================================================
//  Extracted vs stored: never overwrite silently
// =============================================================================

export type CompareStatus = "match" | "conflict" | "new" | "stored_only";
export interface FieldComparison {
  field: string;
  extracted: unknown;
  stored: unknown;
  status: CompareStatus;
}

function same(a: unknown, b: unknown): boolean {
  const asNum = (x: unknown) => (typeof x === "number" ? x : typeof x === "string" && /^-?\d+(\.\d+)?$/.test(x.trim()) ? Number(x) : null);
  const na = asNum(a), nb = asNum(b);
  if (na !== null && nb !== null && (typeof a === "number" || typeof b === "number")) return cents(na) === cents(nb);
  if (typeof a === "string" && typeof b === "string") return a.trim().toUpperCase() === b.trim().toUpperCase();
  return JSON.stringify(a) === JSON.stringify(b);
}

/** `fieldMap`: extracted field name -> stored record key. */
export function compareWithStored(
  extracted: Readonly<Record<string, unknown>>,
  stored: Readonly<Record<string, unknown>>,
  fieldMap: Readonly<Record<string, string>>,
): FieldComparison[] {
  const out: FieldComparison[] = [];
  for (const [ef, sf] of Object.entries(fieldMap)) {
    const e = extracted[ef];
    const s = stored[sf];
    const eMissing = e === undefined || e === null || e === "";
    const sMissing = s === undefined || s === null || s === "";
    if (eMissing && sMissing) continue;
    out.push({
      field: ef, extracted: eMissing ? null : e, stored: sMissing ? null : s,
      status: eMissing ? "stored_only" : sMissing ? "new" : same(e, s) ? "match" : "conflict",
    });
  }
  return out;
}

export type Resolution = "keep_stored" | "use_extracted" | "enter_manually";
export interface ResolvedField { field: string; value: unknown; source: "stored" | "extracted" | "manual" }

/**
 * Builds the values a human confirmed. Every `conflict` and every `new` value
 * needs an explicit choice; there is no default that takes the extracted
 * value. Throws listing the unresolved fields.
 */
export function applyResolutions(
  comparisons: readonly FieldComparison[],
  choices: Readonly<Record<string, { resolution: Resolution; manualValue?: unknown }>>,
): ResolvedField[] {
  const unresolved = comparisons.filter((c) => (c.status === "conflict" || c.status === "new") && !choices[c.field]).map((c) => c.field);
  if (unresolved.length) throw new Error(`unresolved_fields:${unresolved.join(",")}`);
  const out: ResolvedField[] = [];
  for (const c of comparisons) {
    const ch = choices[c.field];
    if (!ch || c.status === "match" || c.status === "stored_only") {
      if (c.stored !== null) out.push({ field: c.field, value: c.stored, source: "stored" });
      continue;
    }
    if (ch.resolution === "keep_stored") {
      if (c.stored !== null) out.push({ field: c.field, value: c.stored, source: "stored" });
    } else if (ch.resolution === "use_extracted") {
      out.push({ field: c.field, value: c.extracted, source: "extracted" });
    } else {
      if (ch.manualValue === undefined || ch.manualValue === null || ch.manualValue === "") throw new Error(`manual_value_missing:${c.field}`);
      out.push({ field: c.field, value: ch.manualValue, source: "manual" });
    }
  }
  return out;
}

/** Audit record of what changed between the extraction and what was saved. */
export interface Correction { field: string; extracted: unknown; saved: unknown; source: ResolvedField["source"] }
export function correctionsOf(comparisons: readonly FieldComparison[], resolved: readonly ResolvedField[]): Correction[] {
  const byField = new Map(resolved.map((r) => [r.field, r]));
  const out: Correction[] = [];
  for (const c of comparisons) {
    if (c.extracted === null) continue;
    const r = byField.get(c.field);
    const saved = r ? r.value : null;
    if (!r || !same(c.extracted, saved)) out.push({ field: c.field, extracted: c.extracted, saved, source: r?.source ?? "stored" });
  }
  return out;
}
