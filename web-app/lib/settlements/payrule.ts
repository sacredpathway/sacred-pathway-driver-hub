// =============================================================================
//  PayRule JSON codec + statement text — twin of iOS PayRule / PayComponent
// -----------------------------------------------------------------------------
//  Wire shape (settlements.pay_rule, drivers.pay_rule, settlement_loads.
//  pay_rule_override) exactly as the iPhone encodes it:
//
//   { "components": [ { "id", "kind", "label", "percent", "rate",
//                       "mile_basis", "fixed_amount", "hours" } ],
//     "fee_terms": { "dispatcher_fee_percent", "factoring_fee_percent",
//                    "authority_fee", "maintenance_reserve",
//                    "<fee>_responsibility" ×4 } }            // optional
//
//  The iPhone decodes `kind` and every fee_terms key as REQUIRED, so the
//  encoder below always writes a valid kind and all eight fee keys.
// =============================================================================

import { D, Money, type Dec } from "@/lib/money/money";
import {
  MILE_BASES, MILE_BASIS_LABEL, PAY_KINDS, PAY_KIND_LABEL, RESPONSIBILITIES,
  dec, money,
  type CompanyFeeTerms, type MileBasis, type PayComponent, type PayKind, type PayRule,
  type Responsibility,
} from "./model";
import { percentString } from "./format";

function numToStr(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  if (typeof v === "number") {
    if (!Number.isFinite(v)) return null;
    return new D(v).toFixed();
  }
  if (typeof v === "string") {
    const s = v.trim();
    if (!s) return null;
    try { return new D(s).toFixed(); } catch { return null; }
  }
  return null;
}

function strToNum(s: string | null, scale?: number): number | undefined {
  if (s === null || s === undefined || s === "") return undefined;
  let d = dec(s);
  if (scale !== undefined) d = d.toDecimalPlaces(scale, D.ROUND_HALF_UP);
  return Number(d.toFixed());
}

function resp(v: unknown, fallback: Responsibility): Responsibility {
  return (RESPONSIBILITIES as readonly string[]).includes(v as string) ? (v as Responsibility) : fallback;
}

/** Parse a stored rule. Components with an unknown kind are dropped. */
export function parsePayRule(raw: unknown): PayRule | null {
  if (raw === null || raw === undefined) return null;
  let obj: unknown = raw;
  if (typeof raw === "string") {
    try { obj = JSON.parse(raw); } catch { return null; }
  }
  if (typeof obj !== "object" || obj === null) return null;
  const o = obj as Record<string, unknown>;
  const comps = Array.isArray(o.components) ? o.components : [];
  const components: PayComponent[] = [];
  for (const c of comps) {
    if (typeof c !== "object" || c === null) continue;
    const r = c as Record<string, unknown>;
    if (!(PAY_KINDS as readonly string[]).includes(r.kind as string)) continue;
    const kind = r.kind as PayKind;
    const mb = (MILE_BASES as readonly string[]).includes(r.mile_basis as string)
      ? (r.mile_basis as MileBasis) : "loaded";
    components.push({
      id: typeof r.id === "string" && r.id ? r.id : cryptoId(),
      kind,
      label: typeof r.label === "string" && r.label ? r.label : PAY_KIND_LABEL[kind],
      percent: numToStr(r.percent),
      rate: numToStr(r.rate),
      mileBasis: mb,
      fixedAmount: numToStr(r.fixed_amount),
      hours: numToStr(r.hours),
    });
  }
  let feeTerms: CompanyFeeTerms | null = null;
  const ft = o.fee_terms;
  if (ft && typeof ft === "object") {
    const f = ft as Record<string, unknown>;
    feeTerms = {
      dispatcherFeePercent: numToStr(f.dispatcher_fee_percent) ?? "0",
      factoringFeePercent: numToStr(f.factoring_fee_percent) ?? "0",
      authorityFee: numToStr(f.authority_fee) ?? "0",
      maintenanceReserve: numToStr(f.maintenance_reserve) ?? "0",
      dispatcherFeeResponsibility: resp(f.dispatcher_fee_responsibility, "company"),
      factoringFeeResponsibility: resp(f.factoring_fee_responsibility, "company"),
      authorityFeeResponsibility: resp(f.authority_fee_responsibility, "company"),
      maintenanceReserveResponsibility: resp(f.maintenance_reserve_responsibility, "company"),
    };
  }
  return { components, feeTerms };
}

/** Encode for storage, iPhone Codable shape. */
export function encodePayRule(rule: PayRule): Record<string, unknown> {
  const out: Record<string, unknown> = {
    components: rule.components.map((c) => {
      const o: Record<string, unknown> = {
        id: c.id.toUpperCase(),
        kind: c.kind,
        label: c.label || PAY_KIND_LABEL[c.kind],
        mile_basis: c.mileBasis,
      };
      const p = strToNum(c.percent);
      if (p !== undefined) o.percent = p;
      // A RATE is stored at full precision (6dp), like iOS 2026-09-16.
      const r = strToNum(c.rate, 6);
      if (r !== undefined) o.rate = r;
      // fixed_amount is Money → encoded rounded to cents.
      const fa = strToNum(c.fixedAmount, 2);
      if (fa !== undefined) o.fixed_amount = fa;
      const h = strToNum(c.hours);
      if (h !== undefined) o.hours = h;
      return o;
    }),
  };
  if (rule.feeTerms) {
    const f = rule.feeTerms;
    out.fee_terms = {
      dispatcher_fee_percent: strToNum(f.dispatcherFeePercent) ?? 0,
      factoring_fee_percent: strToNum(f.factoringFeePercent) ?? 0,
      authority_fee: strToNum(f.authorityFee, 2) ?? 0,
      maintenance_reserve: strToNum(f.maintenanceReserve, 2) ?? 0,
      dispatcher_fee_responsibility: f.dispatcherFeeResponsibility,
      factoring_fee_responsibility: f.factoringFeeResponsibility,
      authority_fee_responsibility: f.authorityFeeResponsibility,
      maintenance_reserve_responsibility: f.maintenanceReserveResponsibility,
    };
  }
  return out;
}

/** iPhone PayComponent.basisDescription. */
export function componentBasis(c: PayComponent): string {
  const rate = money(c.rate);
  switch (c.kind) {
    case "percent_of_gross":
      return `${percentString(dec(c.percent))} of gross`;
    case "flat_per_load":
      return `${rate.format()} per load`;
    case "per_mile":
      // iOS: rate.rounded(scale: 3).formatted — `formatted` prints cents.
      return `${rate.roundedTo(3).format()}/mi ${MILE_BASIS_LABEL[c.mileBasis].toLowerCase()}`;
    case "weekly_salary":
      return `${rate.format()} salary`;
    case "hourly":
      return `${rate.format()}/hr`;
    case "manual":
      return "Manual entry";
  }
}

/** iPhone PayRule.summary. */
export function ruleSummary(rule: PayRule | null): string {
  if (!rule || rule.components.length === 0) return "No pay rule set";
  return rule.components.map(componentBasis).join(" + ");
}

/** iPhone PayRule.hasSameTerms (ids and labels ignored). */
export function sameTerms(a: PayRule | null, b: PayRule | null): boolean {
  const terms = (r: PayRule | null) =>
    (r?.components ?? []).map((c) =>
      [
        c.kind,
        c.percent === null ? "-" : dec(c.percent).toFixed(),
        c.rate === null ? "-" : dec(c.rate).toFixed(),
        c.mileBasis,
        c.fixedAmount === null ? "-" : money(c.fixedAmount).toFixed2(),
        c.hours === null ? "-" : dec(c.hours).toFixed(),
      ].join("|"),
    );
  const ta = terms(a);
  const tb = terms(b);
  if (ta.length !== tb.length || ta.some((t, i) => t !== tb[i])) return false;
  return feeKey(a?.feeTerms ?? null) === feeKey(b?.feeTerms ?? null);
}

function feeKey(f: CompanyFeeTerms | null): string {
  if (!f) return "none";
  return [
    dec(f.dispatcherFeePercent).toFixed(), dec(f.factoringFeePercent).toFixed(),
    money(f.authorityFee).toFixed2(), money(f.maintenanceReserve).toFixed2(),
    f.dispatcherFeeResponsibility, f.factoringFeeResponsibility,
    f.authorityFeeResponsibility, f.maintenanceReserveResponsibility,
  ].join("|");
}

export function cryptoId(): string {
  const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  if (c?.randomUUID) return c.randomUUID();
  // RFC4122 v4 fallback (tests / very old runtimes).
  const hex = "0123456789abcdef";
  let s = "";
  for (let i = 0; i < 36; i++) {
    if (i === 8 || i === 13 || i === 18 || i === 23) s += "-";
    else if (i === 14) s += "4";
    else if (i === 19) s += hex[(Math.random() * 4) | 8];
    else s += hex[(Math.random() * 16) | 0];
  }
  return s;
}

export function blankComponent(kind: PayKind): PayComponent {
  return {
    id: cryptoId(), kind, label: PAY_KIND_LABEL[kind],
    percent: kind === "percent_of_gross" ? "0" : null,
    rate: kind === "flat_per_load" || kind === "per_mile" || kind === "weekly_salary" || kind === "hourly" ? "0" : null,
    mileBasis: "loaded",
    fixedAmount: kind === "manual" ? "0" : null,
    hours: null,
  };
}

export type { Dec };
export { Money };
