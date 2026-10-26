// =============================================================================
//  Editor payload → trusted bundle (server-side gate)
// -----------------------------------------------------------------------------
//  The browser sends the whole edited settlement. Nothing it sends is trusted:
//    • every number is re-parsed with the exact-precision parsers;
//    • category / responsibility / pay kind must be a known iPhone raw value;
//    • links the web never creates (recurring rule, advance, expense, document,
//      adjustment origin) are copied from the STORED row, never from the
//      client — a new line can't claim to recover an advance, for example;
//    • a new load line may only point at a load the server approved
//      (`allowedNewLoadIds`); existing lines keep their stored load link;
//    • totals are never accepted — the engine recomputes them.
// =============================================================================

import {
  ADDITION_CATEGORIES, DEDUCTION_CATEGORIES, MILE_BASES, PAY_KINDS, PAY_KIND_LABEL,
  RESPONSIBILITIES, SETTLEMENT_TYPES,
  type Addition, type CompanyFeeTerms, type Deduction, type LoadLine, type PayComponent,
  type PayRule, type SettlementBundle, effectivePayRule,
} from "./model";
import {
  UUID_RE, isYmd, parseHours, parseMiles, parseMoney, parsePercent, parseRate, parseShare,
  type Parsed,
} from "./input";
import { cryptoId } from "./payrule";

export interface EditPayload {
  header: {
    periodStart: string;
    periodEnd: string;
    settlementNumber: string;
    settlementType: string;
    truckNumber: string;
    payRule: PayRule | null;
    payOnGrossRevenue: boolean;
    hoursWorked: string;
    notes: string;
  };
  loadLines: LoadLine[];
  additions: Addition[];
  deductions: Deduction[];
}

export interface SanitizeContext {
  existing: SettlementBundle;
  allowedNewLoadIds: Set<string>;
  customCategoryIds: Set<string>;
}

const MAX_LINES = 400;

export function sanitizePayload(p: EditPayload, ctx: SanitizeContext): { bundle: SettlementBundle; errors: string[] } {
  const errors: string[] = [];
  const take = (r: Parsed, where: string): string => {
    if (r.ok) return r.value;
    errors.push(`${where}: ${r.error}`);
    return "0";
  };
  const text = (v: unknown, max = 500): string => (typeof v === "string" ? v.slice(0, max) : "");
  const nullableText = (v: unknown, max = 500): string | null => {
    const t = text(v, max).trim();
    return t ? t : null;
  };
  const date = (v: unknown, where: string, required = false): string | null => {
    if (v === null || v === undefined || v === "") {
      if (required) errors.push(`${where}: date is required.`);
      return null;
    }
    if (typeof v !== "string" || !isYmd(v)) { errors.push(`${where}: invalid date.`); return null; }
    return v;
  };

  const ex = ctx.existing;
  const h = p.header ?? ({} as EditPayload["header"]);

  // ---- header ----
  const periodStart = date(h.periodStart, "Period start", true);
  const periodEnd = date(h.periodEnd, "Period end", true);
  const settlementType = (SETTLEMENT_TYPES as readonly string[]).includes(h.settlementType)
    ? (h.settlementType as SettlementBundle["header"]["settlementType"]) : (ex.header.settlementType ?? "company_driver");
  const hours = take(parseHours(h.hoursWorked, "Hours worked", { allowEmpty: true }), "Header");
  const stored = storedPercents(ex);
  const payRule = h.payRule === null || h.payRule === undefined ? null : sanitizeRule(h.payRule, "Pay rule", take, errors, stored);
  const settlementNumber = nullableText(h.settlementNumber, 40);
  if (settlementNumber && !/^[A-Za-z0-9 _-]+$/.test(settlementNumber)) {
    errors.push("Settlement number may only use letters, numbers, spaces, - and _.");
  }

  const header = {
    ...ex.header,
    periodStart, periodEnd, settlementType,
    settlementNumber,
    truckNumber: nullableText(h.truckNumber, 40),
    payRule,
    payOnGrossRevenue: h.payOnGrossRevenue !== false,
    hoursWorked: hours === "" ? null : hours,
    notes: nullableText(h.notes, 4000),
  };

  // ---- load lines ----
  const exLines = new Map(ex.loadLines.map((l) => [l.id, l]));
  const lines: LoadLine[] = [];
  const seen = new Set<string>();
  for (const [i, raw] of (Array.isArray(p.loadLines) ? p.loadLines : []).slice(0, MAX_LINES).entries()) {
    const where = `Load line ${i + 1}`;
    if (!raw || typeof raw.id !== "string" || !UUID_RE.test(raw.id) || seen.has(raw.id)) { errors.push(`${where}: invalid id.`); continue; }
    seen.add(raw.id);
    const prev = exLines.get(raw.id);
    let loadId: string | null = prev ? prev.loadId : null;
    if (!prev && raw.loadId) {
      if (ctx.allowedNewLoadIds.has(raw.loadId)) loadId = raw.loadId;
      else errors.push(`${where}: that load can't be added to this settlement.`);
    }
    lines.push({
      id: raw.id,
      loadId,
      loadNumber: nullableText(raw.loadNumber, 60),
      brokerName: nullableText(raw.brokerName, 200),
      brokerMcNumber: nullableText(raw.brokerMcNumber, 40),
      pickupDate: date(raw.pickupDate, where),
      deliveryDate: date(raw.deliveryDate, where),
      origin: nullableText(raw.origin, 200),
      destination: nullableText(raw.destination, 200),
      loadedMiles: take(parseMiles(raw.loadedMiles, "Loaded miles"), where),
      deadheadMiles: take(parseMiles(raw.deadheadMiles, "Deadhead miles"), where),
      linehaul: take(parseMoney(raw.linehaul, "Linehaul", { allowNegative: !!prev?.isAdjustment }), where),
      fuelSurcharge: take(parseMoney(raw.fuelSurcharge, "Fuel surcharge"), where),
      accessorials: take(parseMoney(raw.accessorials, "Accessorials"), where),
      detention: take(parseMoney(raw.detention, "Detention"), where),
      layover: take(parseMoney(raw.layover, "Layover"), where),
      tonu: take(parseMoney(raw.tonu, "TONU"), where),
      lumperReimbursement: take(parseMoney(raw.lumperReimbursement, "Lumper"), where),
      grossRateOverride: (() => {
        const r = take(parseMoney(raw.grossRateOverride, "Gross override", { allowEmpty: true, allowNegative: !!prev?.isAdjustment }), where);
        return r === "" ? null : r;
      })(),
      payRuleOverride: raw.payRuleOverride ? sanitizeRule(raw.payRuleOverride, `${where} pay rule`, take, errors, stored) : null,
      hoursWorked: prev?.hoursWorked ?? null,
      driverEarnings: prev?.driverEarnings ?? "0",
      payBasisDescription: prev?.payBasisDescription ?? "",
      notes: nullableText(raw.notes, 2000),
      // Never set by the web — preserved from the stored row.
      isAdjustment: prev?.isAdjustment ?? false,
      correctsSettlementId: prev?.correctsSettlementId ?? null,
      rateConfirmationDocumentId: prev?.rateConfirmationDocumentId ?? null,
      proofOfDeliveryDocumentId: prev?.proofOfDeliveryDocumentId ?? null,
      createdAt: prev?.createdAt ?? null,
      sortOrder: i,
    });
  }

  // ---- additions ----
  const exAdds = new Map(ex.additions.map((a) => [a.id, a]));
  let nextAdd = Math.max(-1, ...ex.additions.map((a) => a.sortOrder)) + 1;
  const additions: Addition[] = [];
  for (const [i, raw] of (Array.isArray(p.additions) ? p.additions : []).slice(0, MAX_LINES).entries()) {
    const where = `Addition ${i + 1}`;
    if (!raw || typeof raw.id !== "string" || !UUID_RE.test(raw.id) || seen.has(raw.id)) { errors.push(`${where}: invalid id.`); continue; }
    seen.add(raw.id);
    const prev = exAdds.get(raw.id);
    if (!(ADDITION_CATEGORIES as readonly string[]).includes(raw.category)) { errors.push(`${where}: unknown category.`); continue; }
    const custom = raw.customCategoryId && ctx.customCategoryIds.has(raw.customCategoryId) ? raw.customCategoryId : null;
    additions.push({
      id: raw.id,
      category: raw.category,
      customCategoryId: custom,
      description: text(raw.description, 200).trim(),
      amount: take(parseMoney(raw.amount, "Amount", { allowNegative: true }), where),
      date: date(raw.date, where),
      relatedLoadId: prev?.relatedLoadId ?? null,
      documentId: prev?.documentId ?? null,
      notes: nullableText(raw.notes, 2000),
      sortOrder: prev ? prev.sortOrder : nextAdd++,
      createdAt: prev?.createdAt ?? null,
    });
  }

  // ---- deductions ----
  const exDeds = new Map(ex.deductions.map((d) => [d.id, d]));
  let nextDed = Math.max(1999, ...ex.deductions.map((d) => d.sortOrder).filter((o) => o < 8000)) + 1;
  const deductions: Deduction[] = [];
  for (const [i, raw] of (Array.isArray(p.deductions) ? p.deductions : []).slice(0, MAX_LINES).entries()) {
    const where = `Deduction ${i + 1}`;
    if (!raw || typeof raw.id !== "string" || !UUID_RE.test(raw.id) || seen.has(raw.id)) { errors.push(`${where}: invalid id.`); continue; }
    seen.add(raw.id);
    const prev = exDeds.get(raw.id);
    if (!(DEDUCTION_CATEGORIES as readonly string[]).includes(raw.category)) { errors.push(`${where}: unknown category.`); continue; }
    if (!(RESPONSIBILITIES as readonly string[]).includes(raw.responsibility)) { errors.push(`${where}: unknown responsibility.`); continue; }
    const custom = raw.customCategoryId && ctx.customCategoryIds.has(raw.customCategoryId) ? raw.customCategoryId : null;
    const share = raw.responsibility === "split" ? take(parseShare(raw.driverSharePercent), where)
      : raw.responsibility === "driver" ? "100" : "0";
    // Existing rows keep their stored order; new rows go after them (below
    // the 9000 band the engine uses for company fees).
    const sortOrder = prev ? prev.sortOrder : Math.min(8999, nextDed++);
    deductions.push({
      id: raw.id,
      category: raw.category,
      customCategoryId: custom,
      description: text(raw.description, 200).trim(),
      amount: take(parseMoney(raw.amount, "Amount", { allowNegative: true }), where),
      date: date(raw.date, where),
      relatedLoadId: prev?.relatedLoadId ?? null,
      relatedExpenseId: prev?.relatedExpenseId ?? null,
      documentId: prev?.documentId ?? null,
      notes: nullableText(raw.notes, 2000),
      responsibility: raw.responsibility,
      driverSharePercent: share,
      recurringDeductionId: prev?.recurringDeductionId ?? null,
      advanceId: prev?.advanceId ?? null,
      sortOrder,
      createdAt: prev?.createdAt ?? null,
    });
  }

  return { bundle: { header, loadLines: lines, additions, deductions }, errors };
}

/**
 * Percent values already stored on this settlement (or produced by the
 * iPhone's legacy fallback) are accepted unchanged even past 4 decimals —
 * e.g. 33.32999999999999488 — so saving on the web never alters an
 * iPhone-computed rate. Typed values are still limited to 4 decimals.
 */
export function storedPercents(ex: SettlementBundle): Set<string> {
  const out = new Set<string>();
  const add = (r: PayRule | null) => r?.components.forEach((c) => { if (c.percent) out.add(c.percent); });
  add(ex.header.payRule);
  add(effectivePayRule(ex.header));
  ex.loadLines.forEach((l) => add(l.payRuleOverride));
  return out;
}

function sanitizeRule(
  r: PayRule, where: string, take: (p: Parsed, w: string) => string, errors: string[], stored: Set<string> = new Set(),
): PayRule {
  const components: PayComponent[] = [];
  for (const [i, c] of (Array.isArray(r.components) ? r.components : []).slice(0, 10).entries()) {
    const w = `${where} part ${i + 1}`;
    if (!c || !(PAY_KINDS as readonly string[]).includes(c.kind)) { errors.push(`${w}: unknown pay method.`); continue; }
    const id = typeof c.id === "string" && UUID_RE.test(c.id) ? c.id : null;
    if (!id) { errors.push(`${w}: invalid id.`); continue; }
    const kind = c.kind;
    components.push({
      id,
      kind,
      label: (typeof c.label === "string" && c.label.trim() ? c.label.trim() : PAY_KIND_LABEL[kind]).slice(0, 80),
      percent: kind === "percent_of_gross"
        ? (c.percent && stored.has(c.percent) ? c.percent : take(parsePercent(c.percent, "Percentage"), w))
        : null,
      rate: kind === "flat_per_load" || kind === "per_mile" || kind === "weekly_salary" || kind === "hourly"
        ? take(parseRate(c.rate, "Rate"), w) : null,
      mileBasis: (MILE_BASES as readonly string[]).includes(c.mileBasis) ? c.mileBasis : "loaded",
      fixedAmount: kind === "manual" ? take(parseMoney(c.fixedAmount, "Fixed amount"), w) : null,
      hours: kind === "hourly" && c.hours !== null && c.hours !== undefined && c.hours !== ""
        ? take(parseHours(c.hours, "Hours"), w) : null,
    });
  }
  let feeTerms: CompanyFeeTerms | null = null;
  if (r.feeTerms) {
    const f = r.feeTerms;
    // "split" is kept as stored (iPhone treats a split fee as company-borne);
    // rewriting it would log a false pay-rule change.
    const rr = (v: string) => ((RESPONSIBILITIES as readonly string[]).includes(v) ? (v as "driver" | "company" | "split") : "company");
    feeTerms = {
      dispatcherFeePercent: take(parsePercent(f.dispatcherFeePercent, "Dispatcher fee %"), where),
      factoringFeePercent: take(parsePercent(f.factoringFeePercent, "Factoring fee %"), where),
      authorityFee: take(parseMoney(f.authorityFee, "Authority fee"), where),
      maintenanceReserve: take(parseMoney(f.maintenanceReserve, "Maintenance reserve"), where),
      dispatcherFeeResponsibility: rr(f.dispatcherFeeResponsibility),
      factoringFeeResponsibility: rr(f.factoringFeeResponsibility),
      authorityFeeResponsibility: rr(f.authorityFeeResponsibility),
      maintenanceReserveResponsibility: rr(f.maintenanceReserveResponsibility),
    };
  }
  return { components, feeTerms };
}

/**
 * Row ids for NEW lines are minted on the server, never taken from the
 * browser: a client-chosen id could match a row on another (e.g. paid)
 * settlement, and the upsert would move that row. Rows already on this
 * settlement keep their (proven) ids. Mutates and returns `cleaned`.
 */
export function mintNewRowIds(prev: SettlementBundle, cleaned: SettlementBundle): SettlementBundle {
  const l = new Set(prev.loadLines.map((x) => x.id));
  const a = new Set(prev.additions.map((x) => x.id));
  const d = new Set(prev.deductions.map((x) => x.id));
  cleaned.loadLines = cleaned.loadLines.map((x) => (l.has(x.id) ? x : { ...x, id: cryptoId() }));
  cleaned.additions = cleaned.additions.map((x) => (a.has(x.id) ? x : { ...x, id: cryptoId() }));
  cleaned.deductions = cleaned.deductions.map((x) => (d.has(x.id) ? x : { ...x, id: cryptoId() }));
  return cleaned;
}
