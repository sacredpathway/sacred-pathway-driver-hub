// =============================================================================
//  Payroll input parsing — exact, precision-checked, shared by editor + server
// -----------------------------------------------------------------------------
//  Money is entered to the cent and stored to the cent: "1,234.5" → "1234.50",
//  "$12.345" is REJECTED (not silently rounded) so the carrier always sees the
//  exact figure that will be paid. Rates per mile keep up to 6 decimals
//  (iPhone parity), percentages up to 4 (driver split shares 3, the column).
// =============================================================================

import { D } from "@/lib/money/money";

export type Parsed = { ok: true; value: string } | { ok: false; error: string };

const NUM = /^(\d+\.?\d*|\.\d+)$/;

function clean(raw: string): { neg: boolean; body: string } {
  let s = raw.trim();
  let neg = false;
  if (s.startsWith("(") && s.endsWith(")")) { neg = true; s = s.slice(1, -1); }
  s = s.replace(/[$,\s%]/g, "");
  if (s.startsWith("-")) { neg = true; s = s.slice(1); }
  return { neg, body: s };
}

function decimals(body: string): number {
  const i = body.indexOf(".");
  return i === -1 ? 0 : body.length - i - 1;
}

interface Opts {
  maxDecimals: number;
  allowNegative?: boolean;
  min?: number;
  max?: number;
  label: string;
  /** Output scale; default = maxDecimals for money, none otherwise. */
  fixed?: number;
  allowEmpty?: boolean;
}

function parseWith(raw: string | null | undefined, o: Opts): Parsed {
  const v = (raw ?? "").trim();
  if (!v) return o.allowEmpty ? { ok: true, value: "" } : { ok: false, error: `${o.label} is required.` };
  const { neg, body } = clean(v);
  if (!body || !NUM.test(body)) return { ok: false, error: `${o.label} must be a number.` };
  if (decimals(body) > o.maxDecimals) {
    return { ok: false, error: `${o.label} can have at most ${o.maxDecimals} decimal place${o.maxDecimals === 1 ? "" : "s"}.` };
  }
  if (neg && !o.allowNegative) return { ok: false, error: `${o.label} can't be negative.` };
  let d = new D(body);
  if (neg) d = d.neg();
  if (o.min !== undefined && d.lt(o.min)) return { ok: false, error: `${o.label} must be at least ${o.min}.` };
  if (o.max !== undefined && d.gt(o.max)) return { ok: false, error: `${o.label} must be at most ${o.max}.` };
  const value = o.fixed !== undefined ? d.toFixed(o.fixed) : d.toFixed();
  return { ok: true, value: value === "-0" ? "0" : value };
}

/** Dollars and cents. */
export function parseMoney(raw: string | null | undefined, label = "Amount", o: { allowNegative?: boolean; allowEmpty?: boolean } = {}): Parsed {
  return parseWith(raw, { maxDecimals: 2, fixed: 2, label, allowNegative: o.allowNegative ?? false, allowEmpty: o.allowEmpty });
}

/** Pay percentage (70 = 70%). */
export function parsePercent(raw: string | null | undefined, label = "Percentage", o: { allowEmpty?: boolean; max?: number } = {}): Parsed {
  return parseWith(raw, { maxDecimals: 4, min: 0, max: o.max ?? 100, label, allowEmpty: o.allowEmpty });
}

/** Driver share of a split deduction — the column stores 3 decimals. */
export function parseShare(raw: string | null | undefined, label = "Driver share"): Parsed {
  return parseWith(raw, { maxDecimals: 3, min: 0, max: 100, label });
}

/** A rate per mile / per load / per hour — up to 6 decimals ($0.585/mi). */
export function parseRate(raw: string | null | undefined, label = "Rate", o: { allowEmpty?: boolean } = {}): Parsed {
  return parseWith(raw, { maxDecimals: 6, min: 0, label, allowEmpty: o.allowEmpty });
}

export function parseMiles(raw: string | null | undefined, label = "Miles"): Parsed {
  return parseWith(raw, { maxDecimals: 2, min: 0, label, fixed: undefined, allowEmpty: false });
}

export function parseHours(raw: string | null | undefined, label = "Hours", o: { allowEmpty?: boolean } = {}): Parsed {
  return parseWith(raw, { maxDecimals: 2, min: 0, max: 1000, label, allowEmpty: o.allowEmpty });
}

export function isYmd(v: string | null | undefined): boolean {
  if (!v || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const t = Date.parse(v + "T00:00:00Z");
  return !Number.isNaN(t) && new Date(t).toISOString().slice(0, 10) === v;
}

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
