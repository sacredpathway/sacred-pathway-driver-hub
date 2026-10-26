// =============================================================================
//  Settlement workflow — web twin of iOS SettlementWorkflowService,
//  RecurringDeductionService, SettlementNumberService, SettlementValidator
//  and SettlementAuditService (Driver Hub 2.3.5).
// -----------------------------------------------------------------------------
//  Pure functions only. The server actions load rows, call these, and write
//  the result; the editor calls the same `recalculate` for its live preview,
//  so what the carrier sees while typing is what gets saved.
// =============================================================================

import { D, Money } from "@/lib/money/money";
import { settlementEligibility } from "@/lib/loads/status";
import {
  DEFAULT_DRIVER_RESPONSIBILITIES, DEDUCTION_CATEGORY_LABEL, NO_FEES, RESPONSIBILITY_LABEL,
  STATUS_LABEL, ALLOWED_TRANSITIONS,
  dec, deductionDriverAmount, effectivePayRule, isIosLocked, isPerLoadKind, lineGross, money,
  normaliseDeductionCategory, normaliseResponsibility, normaliseSettlementType, percentComponent,
  type CompanyFeeTerms, type Deduction, type DeductionCategory, type LoadLine, type PayRule,
  type RecurringDeductionRule, type Responsibility, type SettlementBundle, type SettlementHeader,
  type SettlementStatus, type SettlementType,
} from "./model";
import { calculate, reconciles, type CalcResult } from "./engine";
import { parsePayRule, ruleSummary, sameTerms, cryptoId } from "./payrule";
import { percentString } from "./format";

// ---------------------------------------------------------------------------
//  Driver pay settings (iOS Driver.paySettings + DriverPaySettings)
// ---------------------------------------------------------------------------

export interface ResponsibilityRule {
  category: DeductionCategory;
  responsibility: Responsibility;
  driverSharePercent: string;
}

export interface DriverPaySettings {
  settlementType: SettlementType;
  payRule: PayRule;
  payOnGrossRevenue: boolean;
  leaseRules: ResponsibilityRule[];
  defaultTruckNumber: string | null;
}

export interface DriverPayRow {
  pay_rule?: unknown;
  pay_type?: string | null;
  flat_rate?: number | null;
  pay_percentage?: number | null;
  settlement_type?: string | null;
  pay_on_gross_revenue?: boolean | null;
  lease_config?: unknown;
  truck_number?: string | null;
}

export function paySettingsForDriver(d: DriverPayRow, legacyPayOnGrossRevenue: boolean): DriverPaySettings {
  let rule: PayRule;
  const stored = parsePayRule(d.pay_rule);
  if (stored && stored.components.length > 0) {
    rule = stored;
  } else if ((d.pay_type ?? "percent") === "flat" && (d.flat_rate ?? 0) > 0) {
    rule = {
      components: [{
        id: cryptoId(), kind: "manual", label: "Flat Settlement Pay",
        percent: null, rate: null, mileBasis: "loaded",
        fixedAmount: Money.fromNumber(d.flat_rate).amount.toFixed(), hours: null,
      }],
      feeTerms: null,
    };
  } else if ((d.pay_percentage ?? 0) > 0) {
    rule = { components: [percentComponent(Money.fromNumber(d.pay_percentage).amount.toFixed(), cryptoId())], feeTerms: null };
  } else {
    rule = { components: [], feeTerms: null };
  }
  const leaseRules: ResponsibilityRule[] = [];
  const lc = d.lease_config;
  const lcObj = typeof lc === "string" ? safeJson(lc) : lc;
  if (lcObj && typeof lcObj === "object" && Array.isArray((lcObj as { rules?: unknown }).rules)) {
    for (const r of (lcObj as { rules: Array<Record<string, unknown>> }).rules) {
      leaseRules.push({
        category: normaliseDeductionCategory(r.category),
        responsibility: normaliseResponsibility(r.responsibility),
        driverSharePercent: r.driver_share_percent === undefined || r.driver_share_percent === null
          ? "100" : String(r.driver_share_percent),
      });
    }
  }
  return {
    settlementType: normaliseSettlementType(d.settlement_type),
    payRule: rule,
    payOnGrossRevenue: d.pay_on_gross_revenue ?? legacyPayOnGrossRevenue,
    leaseRules,
    defaultTruckNumber: d.truck_number ?? null,
  };
}

function safeJson(s: string): unknown {
  try { return JSON.parse(s); } catch { return null; }
}

/** iOS DriverPaySettings.responsibility(for:). */
export function responsibilityFor(
  category: DeductionCategory, s: Pick<DriverPaySettings, "leaseRules" | "settlementType">,
): { responsibility: Responsibility; driverSharePercent: string } {
  const explicit = s.leaseRules.find((r) => r.category === category);
  if (explicit) return { responsibility: explicit.responsibility, driverSharePercent: explicit.driverSharePercent };
  if (DEFAULT_DRIVER_RESPONSIBILITIES[s.settlementType].includes(category)) {
    return { responsibility: "driver", driverSharePercent: "100" };
  }
  return { responsibility: "company", driverSharePercent: "0" };
}

export interface ProfileFeeRow {
  dispatcher_fee_percentage?: number | null;
  factoring_fee_percentage?: number | null;
  authority_fee?: number | null;
  maintenance_reserve?: number | null;
  pay_basis?: string | null;
}

/** iOS SettlementWorkflowService.companyFees(from:). */
export function companyFeesFromProfile(p: ProfileFeeRow | null): CompanyFeeTerms {
  if (!p) return NO_FEES;
  return {
    ...NO_FEES,
    dispatcherFeePercent: Money.fromNumber(p.dispatcher_fee_percentage).amount.toFixed(),
    factoringFeePercent: Money.fromNumber(p.factoring_fee_percentage).amount.toFixed(),
    authorityFee: Money.fromNumber(p.authority_fee).amount.toFixed(),
    maintenanceReserve: Money.fromNumber(p.maintenance_reserve).amount.toFixed(),
  };
}

export function legacyPayOnGross(p: ProfileFeeRow | null): boolean {
  return (p?.pay_basis ?? "").toLowerCase() !== "profit";
}

/** iOS feeTerms(company:paySettings:) — split reads as company for a fee. */
export function feeTermsFor(company: CompanyFeeTerms, s: DriverPaySettings): CompanyFeeTerms {
  const who = (c: DeductionCategory): Responsibility =>
    responsibilityFor(c, s).responsibility === "driver" ? "driver" : "company";
  return {
    ...company,
    dispatcherFeeResponsibility: who("dispatcher_fee"),
    factoringFeeResponsibility: who("factoring_fee"),
    authorityFeeResponsibility: who("authority_fee"),
    maintenanceReserveResponsibility: who("maintenance_reserve"),
  };
}

// ---------------------------------------------------------------------------
//  Loads → lines (iOS SettlementLoadAdapter.line) and eligibility
// ---------------------------------------------------------------------------

export interface LoadRow {
  id: string;
  driver_id: string | null;
  load_number: string | null;
  broker_name: string | null;
  broker_mc_number: string | null;
  pickup_date: string | null;
  delivery_date: string | null;
  origin: string | null;
  destination: string | null;
  total_miles: number | null;
  empty_miles?: number | null;
  line_haul_rate: number | null;
  fuel_surcharge: number | null;
  accessorial_charges: number | null;
  total_revenue: number | null;
  status: string | null;
}

export function lineFromLoad(load: LoadRow, sortOrder: number): LoadLine {
  const linehaul = Money.fromNumber(load.line_haul_rate);
  const fsc = Money.fromNumber(load.fuel_surcharge);
  const acc = Money.fromNumber(load.accessorial_charges);
  const componentSum = linehaul.plus(fsc).plus(acc).rounded();
  let override: string | null = null;
  if (load.total_revenue !== null && load.total_revenue !== undefined) {
    const t = Money.fromNumber(load.total_revenue).rounded();
    if (!t.equals(componentSum)) override = t.toFixed2();
  }
  return {
    id: cryptoId(),
    loadId: load.id,
    loadNumber: load.load_number,
    brokerName: load.broker_name,
    brokerMcNumber: load.broker_mc_number,
    pickupDate: ymd(load.pickup_date),
    deliveryDate: ymd(load.delivery_date),
    origin: load.origin,
    destination: load.destination,
    loadedMiles: Money.fromNumber(load.total_miles).amount.toFixed(),
    deadheadMiles: Money.fromNumber(load.empty_miles ?? 0).amount.toFixed(),
    linehaul: linehaul.amount.toFixed(),
    fuelSurcharge: fsc.amount.toFixed(),
    accessorials: acc.amount.toFixed(),
    detention: "0", layover: "0", tonu: "0", lumperReimbursement: "0",
    grossRateOverride: override,
    payRuleOverride: null,
    hoursWorked: null,
    driverEarnings: "0",
    payBasisDescription: "",
    notes: null,
    isAdjustment: false,
    correctsSettlementId: null,
    sortOrder,
    rateConfirmationDocumentId: null,
    proofOfDeliveryDocumentId: null,
    createdAt: null,
  };
}

export function ymd(v: string | null | undefined): string | null {
  if (!v) return null;
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(v);
  return m ? m[1] : null;
}

/** iOS Load.periodDate: delivery ?? pickup. */
export function periodDateOf(load: Pick<LoadRow, "delivery_date" | "pickup_date">): string | null {
  return ymd(load.delivery_date) ?? ymd(load.pickup_date);
}

/** iOS SettlementWorkflowService.isCompleted. `today` is YYYY-MM-DD. */
export function isLoadCompleted(load: Pick<LoadRow, "status" | "delivery_date">, today: string): boolean {
  const e = settlementEligibility(load.status);
  if (e === "never") return false;
  if (e === "completed") return true;
  const d = ymd(load.delivery_date);
  return d !== null && d <= today;
}

export interface EligibleLoad {
  load: LoadRow;
  /** settlement id that already pays this load (approved / paid). */
  alreadyPaidOn: string | null;
  legacySettled: boolean;
  isCompleted: boolean;
}

export function eligibleLoads(
  loads: LoadRow[], driverId: string, periodStart: string, periodEnd: string,
  alreadyPaid: Map<string, string>, today: string,
  opts: { includeUnassigned?: boolean; includeInProgress?: boolean } = {},
): EligibleLoad[] {
  const seen = new Set<string>();
  const out: EligibleLoad[] = [];
  for (const load of loads) {
    if (seen.has(load.id)) continue;
    seen.add(load.id);
    if (settlementEligibility(load.status) === "never") continue;
    const driverMatches = load.driver_id === driverId || (!!opts.includeUnassigned && load.driver_id === null);
    const pd = periodDateOf(load);
    if (!driverMatches || pd === null || pd < periodStart || pd > periodEnd) continue;
    const c: EligibleLoad = {
      load,
      alreadyPaidOn: alreadyPaid.get(load.id) ?? null,
      legacySettled: (load.status ?? "").trim().toLowerCase() === "settled",
      isCompleted: isLoadCompleted(load, today),
    };
    if (!opts.includeInProgress && !c.isCompleted && !c.legacySettled) continue;
    out.push(c);
  }
  out.sort((a, b) => (periodDateOf(a.load) ?? "").localeCompare(periodDateOf(b.load) ?? ""));
  return out;
}

// ---------------------------------------------------------------------------
//  Settlement numbers (iOS SettlementNumberService)
// ---------------------------------------------------------------------------

export const DEFAULT_PREFIX = "SP";

export function sanitisePrefix(prefix: string): string {
  const cleaned = prefix.toUpperCase().replace(/[^A-Z0-9]/g, "");
  return cleaned ? cleaned.slice(0, 6) : DEFAULT_PREFIX;
}

export function parseNumber(n: string): { prefix: string; year: number; sequence: number } | null {
  const parts = n.trim().toUpperCase().split("-");
  if (parts.length !== 3 || !parts[0]) return null;
  if (!/^[+-]?\d+$/.test(parts[1]) || !/^[+-]?\d+$/.test(parts[2])) return null;
  return { prefix: parts[0], year: Number(parts[1]), sequence: Number(parts[2]) };
}

export function formatNumber(prefix: string, year: number, sequence: number): string {
  return `${sanitisePrefix(prefix)}-${String(year).padStart(4, "0")}-${String(Math.max(1, sequence)).padStart(4, "0")}`;
}

export function nextSettlementNumber(existing: string[], periodEnd: string, prefix = DEFAULT_PREFIX): string {
  const clean = sanitisePrefix(prefix);
  const year = Number(periodEnd.slice(0, 4));
  let highest = 0;
  for (const e of existing) {
    const p = parseNumber(e);
    if (p && p.prefix === clean && p.year === year) highest = Math.max(highest, p.sequence);
  }
  return formatNumber(clean, year, highest + 1);
}

/** The prefix most used on this account (the iPhone keeps it per device). */
export function inferPrefix(existing: string[]): string {
  const counts = new Map<string, number>();
  for (const e of existing) {
    const p = parseNumber(e);
    if (p) counts.set(p.prefix, (counts.get(p.prefix) ?? 0) + 1);
  }
  let best = DEFAULT_PREFIX;
  let n = 0;
  for (const [k, v] of counts) if (v > n) { best = k; n = v; }
  return best;
}

export function normaliseNumber(v: string): string {
  return v.trim().toUpperCase().replace(/ /g, "");
}

export function isDuplicateNumber(candidate: string, others: string[]): boolean {
  const n = normaliseNumber(candidate);
  if (!n) return false;
  return others.some((o) => normaliseNumber(o) === n);
}

// ---------------------------------------------------------------------------
//  Recurring deductions (iOS RecurringDeductionService)
// ---------------------------------------------------------------------------

const FREQ_DAYS: Record<RecurringDeductionRule["frequency"], number> = {
  every_settlement: 0, weekly: 7, biweekly: 14, monthly: 30, quarterly: 91,
};
const FREQ_LABEL: Record<RecurringDeductionRule["frequency"], string> = {
  every_settlement: "Every Settlement", weekly: "Weekly", biweekly: "Every Other Week",
  monthly: "Monthly", quarterly: "Quarterly",
};

function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(b + "T00:00:00Z") - Date.parse(a + "T00:00:00Z")) / 86_400_000);
}

export function recurringInEffect(r: RecurringDeductionRule, start: string, end: string): boolean {
  if (!r.isActive) return false;
  if (r.effectiveStartDate > end) return false;
  if (r.effectiveEndDate && r.effectiveEndDate < start) return false;
  return true;
}

export function recurringIsDue(r: RecurringDeductionRule, start: string, end: string, lastApplied: string | null): boolean {
  if (!recurringInEffect(r, start, end)) return false;
  if (r.frequency === "every_settlement") return true;
  if (!lastApplied) return true;
  return daysBetween(lastApplied, start) >= FREQ_DAYS[r.frequency] - 2;
}

export function recurringAmount(r: Pick<RecurringDeductionRule, "percentOfGross" | "amount">, gross: Money): Money {
  if (r.percentOfGross !== null) return gross.percentage(dec(r.percentOfGross)).rounded();
  return money(r.amount).rounded();
}

export function materialiseRecurring(
  rules: RecurringDeductionRule[], driverId: string, start: string, end: string,
  gross: Money, lastApplied: Map<string, string>, already: Set<string> = new Set(),
): Deduction[] {
  const applicable = rules
    .filter((r) => r.driverId === driverId && !already.has(r.id))
    .filter((r) => recurringIsDue(r, start, end, lastApplied.get(r.id) ?? null))
    .sort((a, b) => (a.category !== b.category ? (a.category < b.category ? -1 : 1) : a.description < b.description ? -1 : a.description > b.description ? 1 : 0));
  const out: Deduction[] = [];
  applicable.forEach((r, index) => {
    const amount = recurringAmount(r, gross);
    if (!amount.isPositive()) return;
    out.push({
      id: cryptoId(),
      category: r.category,
      customCategoryId: null,
      description: r.description === "" ? DEDUCTION_CATEGORY_LABEL[r.category] : r.description,
      amount: amount.toFixed2(),
      date: end,
      relatedLoadId: null, relatedExpenseId: null, documentId: null,
      notes: r.percentOfGross !== null
        ? `Recurring · ${percentString(dec(r.percentOfGross))} of gross`
        : `Recurring · ${FREQ_LABEL[r.frequency].toLowerCase()}`,
      responsibility: r.responsibility,
      driverSharePercent: r.driverSharePercent,
      recurringDeductionId: r.id,
      advanceId: null,
      sortOrder: 1000 + index,
      createdAt: null,
    });
  });
  return out;
}

// ---------------------------------------------------------------------------
//  Recalculate (iOS SettlementWorkflowService.recalculate)
// ---------------------------------------------------------------------------

export function calcInputFor(b: SettlementBundle, frozen = false) {
  const rule = effectivePayRule(b.header);
  return {
    profileId: b.header.profileId,
    settlementType: b.header.settlementType ?? "company_driver",
    payRule: rule,
    payOnGrossRevenue: b.header.payOnGrossRevenue ?? true,
    loadLines: b.loadLines,
    additions: b.additions,
    deductions: b.deductions,
    hoursWorked: b.header.hoursWorked,
    companyFees: rule.feeTerms ?? NO_FEES,
    isEstimate: b.header.isEstimate,
    frozenLoadEarnings: frozen && !b.header.isEstimate,
  } as const;
}

/** Display math: paid/voided history shows the frozen load earnings. */
export function displayCalculation(b: SettlementBundle): CalcResult {
  return calculate({ ...calcInputFor(b, isIosLocked(b.header.status)) });
}

export interface HeaderTotals {
  gross_load_revenue: string;
  total_driver_earnings: string;
  total_additions: string;
  total_deductions: string;
  company_retained: string;
  company_expenses: string;
  loaded_miles: string;
  deadhead_miles: string;
  total_miles: string;
  total_revenue: string;
  total_expenses: string;
  gross_profit: string;
  driver_pay_amount: string;
  net_pay: string;
  engine_version: string;
  driver_pay_percentage?: string;
  dispatcher_fee_percentage?: string;
  factoring_fee_percentage?: string;
  dispatcher_fee_amount?: string;
  factoring_fee_amount?: string;
  authority_fee?: string;
  maintenance_reserve?: string;
}

/**
 * Runs the engine and freezes its output onto the lines and header, exactly
 * like iOS: percent-of-gross recurring lines are re-priced from their rule,
 * each line gets its driver_earnings + pay_basis_description, and the header
 * gets the new decimal columns AND the legacy columns.
 */
export function recalculate(b: SettlementBundle, rules: RecurringDeductionRule[] = []): {
  bundle: SettlementBundle; result: CalcResult; totals: HeaderTotals;
} {
  const gross = Money.sum(b.loadLines.map((l) => lineGross(l).rounded()));
  const deductions = b.deductions.map((d) => {
    if (!d.recurringDeductionId) return d;
    const rule = rules.find((r) => r.id === d.recurringDeductionId);
    if (!rule || rule.percentOfGross === null) return d;
    return { ...d, amount: recurringAmount(rule, gross).toFixed2() };
  });
  const work: SettlementBundle = { ...b, deductions };
  const result = calculate({ ...calcInputFor(work) });
  const loadLines = work.loadLines.map((l) => ({
    ...l,
    driverEarnings: (result.loadEarnings.get(l.id) ?? Money.zero).toFixed2(),
    payBasisDescription: result.loadPayBasis.get(l.id) ?? "",
  }));
  const rule = effectivePayRule(work.header);
  // iOS Settlement.apply(result, payRule: effectivePayRule, ...) stores the
  // EFFECTIVE rule, type and basis on every recalculation; so does the web.
  const header = {
    ...work.header,
    payRule: rule,
    settlementType: work.header.settlementType ?? "company_driver",
    payOnGrossRevenue: work.header.payOnGrossRevenue ?? true,
  };
  const totals: HeaderTotals = {
    gross_load_revenue: result.grossLoadRevenue.toFixed2(),
    total_driver_earnings: result.driverBaseEarnings.toFixed2(),
    total_additions: result.totalAdditions.toFixed2(),
    total_deductions: result.totalDriverDeductions.toFixed2(),
    company_retained: result.companyRetained.toFixed2(),
    company_expenses: result.companyExpenses.toFixed2(),
    loaded_miles: result.loadedMiles.toDecimalPlaces(2, D.ROUND_HALF_UP).toFixed(2),
    deadhead_miles: result.deadheadMiles.toDecimalPlaces(2, D.ROUND_HALF_UP).toFixed(2),
    total_miles: result.totalMiles.toDecimalPlaces(2, D.ROUND_HALF_UP).toFixed(2),
    total_revenue: result.grossLoadRevenue.toFixed2(),
    total_expenses: result.companyExpenses.toFixed2(),
    gross_profit: result.grossLoadRevenue.minus(result.companyExpenses).toFixed2(),
    driver_pay_amount: result.driverBaseEarnings.toFixed2(),
    net_pay: result.netDriverPay.toFixed2(),
    engine_version: result.engineVersion,
  };
  const pc = rule.components.find((c) => c.kind === "percent_of_gross");
  if (pc && pc.percent !== null) totals.driver_pay_percentage = dec(pc.percent).toFixed();
  if (rule.feeTerms) {
    const t = rule.feeTerms;
    totals.dispatcher_fee_percentage = dec(t.dispatcherFeePercent).toFixed();
    totals.factoring_fee_percentage = dec(t.factoringFeePercent).toFixed();
    totals.dispatcher_fee_amount = result.grossLoadRevenue.percentage(dec(t.dispatcherFeePercent)).toFixed2();
    totals.factoring_fee_amount = result.grossLoadRevenue.percentage(dec(t.factoringFeePercent)).toFixed2();
    totals.authority_fee = money(t.authorityFee).toFixed2();
    totals.maintenance_reserve = money(t.maintenanceReserve).toFixed2();
  }
  return { bundle: { ...work, header, loadLines }, result, totals };
}

// ---------------------------------------------------------------------------
//  Validation (iOS SettlementValidator — the checks the web can evaluate)
// ---------------------------------------------------------------------------

export interface Issue { severity: "error" | "warning"; code: string; message: string; }

export interface ValidationContext {
  otherSettlementNumbers: string[];
  /** load id → settlement number (or id) of another APPROVED/PAID settlement. */
  alreadyPaidLoads: Map<string, string>;
  maximumDriverPercent?: number | null;
  /** advance id → amount still owed, excluding this settlement's repayments. */
  advanceOutstanding?: Map<string, string>;
  /** expense id → number of another live settlement already deducting it. */
  linkedExpenses?: Map<string, string>;
}

export function validate(b: SettlementBundle, ctx: ValidationContext, result?: CalcResult): Issue[] {
  const issues: Issue[] = [];
  const err = (code: string, message: string) => issues.push({ severity: "error", code, message });
  const warn = (code: string, message: string) => issues.push({ severity: "warning", code, message });
  const h = b.header;

  if (!h.driverId) err("no_driver", "Select a driver before approving this settlement.");
  if (!h.periodStart || !h.periodEnd) {
    err("no_period", "Set a settlement period start and end date.");
  } else {
    if (h.periodEnd < h.periodStart) err("period_reversed", "The settlement period ends before it starts.");
    const span = daysBetween(h.periodStart, h.periodEnd);
    if (span > 45) warn("period_long", `This settlement covers ${span} days. Check the period is right.`);
  }

  if (!h.settlementNumber || !h.settlementNumber.trim()) {
    warn("no_number", "No settlement number yet — one is assigned on approval.");
  } else if (isDuplicateNumber(h.settlementNumber, ctx.otherSettlementNumbers)) {
    err("duplicate_number", `Settlement number ${h.settlementNumber} is already used on another settlement.`);
  }

  const rule = effectivePayRule(h);
  if (rule.components.length === 0 && b.loadLines.some((l) => l.payRuleOverride === null)) {
    err("no_pay_rule", "This driver has no pay method set. Choose a pay method before approving.");
  }
  const cap = ctx.maximumDriverPercent === undefined ? 100 : ctx.maximumDriverPercent;
  for (const c of rule.components) {
    if (c.kind === "percent_of_gross") {
      const p = dec(c.percent);
      if (p.lt(0)) err("negative_percent", "Driver percentage cannot be negative.");
      if (cap !== null && p.gt(cap)) err("percent_above_cap", `Driver percentage of ${percentString(p)} exceeds the allowed maximum of ${percentString(new D(cap))}.`);
    } else if (c.kind !== "manual") {
      if (c.rate !== null && dec(c.rate).lt(0)) err("negative_rate", `${c.label} rate cannot be negative.`);
    }
    if (c.kind === "hourly") {
      const hours = c.hours !== null ? dec(c.hours) : h.hoursWorked !== null ? dec(h.hoursWorked) : new D(0);
      if (hours.lte(0)) err("no_hours", "Hourly pay needs the hours worked for this period.");
    }
  }

  if (b.loadLines.length === 0) {
    const nonLoad = rule.components.some((c) => !isPerLoadKind(c.kind));
    if (!nonLoad && b.additions.length === 0) warn("no_loads", "This settlement has no loads.");
  }
  const seenLoads = new Set<string>();
  for (const l of b.loadLines) {
    const label = l.loadNumber ?? "—";
    if (l.loadId === null) warn("line_no_load", `Load ${label} is not linked to a load record.`);
    if (l.loadId !== null && !l.isAdjustment) {
      if (seenLoads.has(l.loadId)) err("duplicate_load_line", `Load ${label} appears twice on this settlement.`);
      seenLoads.add(l.loadId);
      const prior = ctx.alreadyPaidLoads.get(l.loadId);
      if (prior) err("load_already_paid", `Load ${label} was already paid on ${prior}. Mark it as an adjustment if you intend to pay it again.`);
    }
    if (l.isAdjustment && !l.correctsSettlementId) {
      err("adjustment_no_origin", `Load ${label} is marked as an adjustment but does not say which settlement it corrects.`);
    }
    const g = lineGross(l);
    if (g.isNegative() && !l.isAdjustment) err("negative_gross", `Load ${label} has a negative gross rate of ${g.format()}. Mark it as an adjustment if this is a chargeback.`);
    if (g.rounded().isZero()) warn("zero_gross", `Load ${label} has a gross rate of $0.00.`);
    if (dec(l.loadedMiles).lt(0) || dec(l.deadheadMiles).lt(0)) err("negative_miles", `Load ${label} has negative mileage.`);
    if (l.pickupDate && l.deliveryDate && l.deliveryDate < l.pickupDate) warn("load_dates_reversed", `Load ${label} is delivered before it is picked up.`);
  }

  for (const a of b.additions) {
    if (!a.description.trim()) err("addition_no_description", "Every addition needs a description.");
    if (money(a.amount).rounded().isZero()) warn("addition_zero", `Addition “${a.description}” is $0.00.`);
    if (money(a.amount).isNegative()) warn("addition_negative", `Addition “${a.description}” is negative — it will reduce the driver's pay.`);
  }
  const seenRecurring = new Set<string>();
  for (const d of b.deductions) {
    if (!d.description.trim()) err("deduction_no_description", "Every deduction needs a description.");
    if (money(d.amount).isNegative()) warn("deduction_negative", `Deduction “${d.description}” is negative — it will increase the driver's pay.`);
    if (d.responsibility === "split") {
      const s = dec(d.driverSharePercent);
      if (s.lte(0) || s.gte(100)) err("bad_split", `Deduction “${d.description}” is split but the driver share is ${percentString(s)}. Use a share between 1% and 99%.`);
    }
    if (d.recurringDeductionId) {
      if (seenRecurring.has(d.recurringDeductionId)) err("duplicate_recurring", `Recurring deduction “${d.description}” has been applied twice to this settlement.`);
      seenRecurring.add(d.recurringDeductionId);
    }
  }

  // Advances: total recovered on this settlement may not exceed what is owed.
  const byAdvance = new Map<string, Money>();
  for (const d of b.deductions) {
    if (!d.advanceId) continue;
    byAdvance.set(d.advanceId, (byAdvance.get(d.advanceId) ?? Money.zero).plus(money(d.amount).rounded()));
  }
  for (const [advanceId, requested] of byAdvance) {
    const owed = ctx.advanceOutstanding?.get(advanceId);
    if (owed === undefined) {
      if (ctx.advanceOutstanding) warn("advance_missing", "A deduction references an advance that no longer exists.");
      continue;
    }
    if (requested.gt(money(owed))) {
      err("advance_over_recovery", `Advance recovery of ${requested.format()} is more than the ${money(owed).format()} still owed on that advance. Lower the deduction.`);
    }
    if (requested.isNegative()) err("advance_over_recovery", "An advance recovery can't be negative.");
  }
  for (const d of b.deductions) {
    if (!d.relatedExpenseId) continue;
    const other = ctx.linkedExpenses?.get(d.relatedExpenseId);
    if (other) err("expense_already_linked", `The expense on “${d.description}” is already deducted on ${other}.`);
  }

  const r = result ?? calculate({ ...calcInputFor(b) });
  if (!reconciles(r)) err("does_not_reconcile", "The settlement lines do not add up to the net pay. Recalculate before approving.");
  if (r.netDriverPay.isNegative()) warn("negative_net", `Net pay is ${r.netDriverPay.format()}. The driver owes the company for this period.`);
  if (h.isEstimate) warn("is_estimate", "This is an estimate. Estimates cannot be approved or paid.");
  return issues;
}

export function errorsOf(issues: Issue[]): Issue[] {
  return issues.filter((i) => i.severity === "error");
}

/**
 * iOS SettlementValidator.validateTransition, plus the web rule that ANY move
 * out of approved/paid/voided (an explicit reopen) needs a stated reason.
 */
export function transitionBlocker(
  from: SettlementStatus, to: SettlementStatus, issues: Issue[], reason: string | null,
): string | null {
  if (from === to) return `This settlement is already ${STATUS_LABEL[to].toLowerCase()}.`;
  if (!ALLOWED_TRANSITIONS[from].includes(to)) {
    return `A ${STATUS_LABEL[from].toLowerCase()} settlement cannot move straight to ${STATUS_LABEL[to].toLowerCase()}.`;
  }
  const reopening = (from === "approved" && (to === "draft"))
    || (from === "paid" && to === "approved")
    || from === "voided"
    || (to === "voided" && (from === "approved" || from === "paid"));
  if (reopening && !(reason ?? "").trim()) {
    return `Give a reason for ${to === "voided" ? "voiding" : "reopening"} this ${STATUS_LABEL[from].toLowerCase()} settlement — it is recorded in the audit trail.`;
  }
  if (to === "approved" || to === "paid") {
    const first = errorsOf(issues)[0];
    if (first) return first.message;
  }
  if (to === "paid" && from !== "approved") return "Approve the settlement before marking it paid.";
  return null;
}

// ---------------------------------------------------------------------------
//  Audit (iOS SettlementAuditService — same action vocabulary & wording)
// ---------------------------------------------------------------------------

/** EXACT iOS SettlementAuditAction raw values. Never add one here: the iPhone
 *  decodes the whole audit table and an unknown action breaks the ledger. */
export type AuditAction =
  | "created" | "load_added" | "load_removed" | "pay_rate_changed"
  | "addition_added" | "addition_removed" | "deduction_added" | "deduction_removed"
  | "recurring_applied" | "advance_repayment_applied" | "status_changed"
  | "approved" | "marked_paid" | "reopened" | "voided" | "manual_adjustment" | "recalculated";

export interface AuditEvent {
  action: AuditAction;
  summary: string;
  field_name: string | null;
  previous_value: string | null;
  new_value: string | null;
}

const ev = (action: AuditAction, summary: string, field: string | null = null, prev: string | null = null, next: string | null = null): AuditEvent =>
  ({ action, summary, field_name: field, previous_value: prev, new_value: next });

export const audit = {
  created: (driverName: string, period: string) => ev("created", `Settlement created for ${driverName}, ${period}`),
  loadAdded: (n: string | null, gross: Money, earn: Money) =>
    ev("load_added", `Load ${n ?? "—"} added · gross ${gross.format()} · driver ${earn.format()}`, "load", null, n),
  loadRemoved: (n: string | null, gross: Money) =>
    ev("load_removed", `Load ${n ?? "—"} removed · gross ${gross.format()}`, "load", n, null),
  payRuleChanged: (from: PayRule | null, to: PayRule | null) =>
    ev("pay_rate_changed", `Pay rule changed from “${ruleSummary(from)}” to “${ruleSummary(to)}”`, "pay_rule", ruleSummary(from), ruleSummary(to)),
  additionAdded: (desc: string, amount: Money) =>
    ev("addition_added", `Addition “${desc}” ${amount.format()} added`, "addition", null, amount.format()),
  additionRemoved: (desc: string, amount: Money) =>
    ev("addition_removed", `Addition “${desc}” ${amount.format()} removed`, "addition", amount.format(), null),
  deductionAdded: (desc: string, amount: Money, r: Responsibility) =>
    ev("deduction_added", `Deduction “${desc}” ${amount.format()} added (${RESPONSIBILITY_LABEL[r]})`, "deduction", null, amount.format()),
  deductionRemoved: (desc: string, amount: Money) =>
    ev("deduction_removed", `Deduction “${desc}” ${amount.format()} removed`, "deduction", amount.format(), null),
  recurringApplied: (count: number, total: Money) =>
    ev("recurring_applied", `${count} recurring deduction${count === 1 ? "" : "s"} applied · ${total.format()}`, "recurring", null, total.format()),
  manual: (description: string, prev: string | null, next: string | null) =>
    ev("manual_adjustment", description, "manual", prev, next),
  recalculated: (prevNet: Money | null, newNet: Money, version: string): AuditEvent | null => {
    if (prevNet && prevNet.rounded().equals(newNet.rounded())) return null;
    return ev("recalculated", `Recalculated · net ${prevNet ? prevNet.format() : "—"} → ${newNet.format()} (${version})`, "net_pay", prevNet ? prevNet.format() : null, newNet.format());
  },
  statusChanged: (from: SettlementStatus, to: SettlementStatus, net: Money | null, reason: string | null): AuditEvent => {
    let action: AuditAction;
    if (to === "approved") action = "approved";
    else if (to === "paid") action = "marked_paid";
    else if (to === "voided") action = "voided";
    else if (to === "draft") action = isIosLocked(from) ? "reopened" : "status_changed";
    else action = "status_changed";
    let summary = `${STATUS_LABEL[from]} → ${STATUS_LABEL[to]}`;
    if (net) summary += ` · net ${net.format()}`;
    if (reason && reason.trim()) summary += ` · ${reason.trim()}`;
    return ev(action, summary, "status", from, to);
  },
  reopened: (from: SettlementStatus, reason: string) =>
    ev("reopened", `Reopened from ${STATUS_LABEL[from]} · ${reason}`, "status", from, "draft"),
};

/** Category-aware label used in audit text (custom names beat "Other"). */
export type NameLookup = (customCategoryId: string | null) => string | null;

/**
 * iOS diffEvents — one audit row per line added / removed / changed and per
 * pay-rule change — extended with the extra fields the web lets you edit
 * (period, hours, notes, load details, categories, fee terms), all recorded as
 * `manual_adjustment` so the iPhone renders them.
 */
export function diffEvents(prev: SettlementBundle, cur: SettlementBundle, customName: NameLookup = () => null): AuditEvent[] {
  const out: AuditEvent[] = [];
  const oldLines = new Map(prev.loadLines.map((l) => [l.id, l]));
  const newLineIds = new Set(cur.loadLines.map((l) => l.id));
  for (const l of cur.loadLines) {
    if (!oldLines.has(l.id)) out.push(audit.loadAdded(l.loadNumber, lineGross(l).rounded(), money(l.driverEarnings)));
  }
  for (const l of prev.loadLines) {
    if (!newLineIds.has(l.id)) out.push(audit.loadRemoved(l.loadNumber, lineGross(l).rounded()));
  }

  const oldAdds = new Map(prev.additions.map((a) => [a.id, a]));
  const newAddIds = new Set(cur.additions.map((a) => a.id));
  for (const a of cur.additions) {
    const before = oldAdds.get(a.id);
    if (!before) { out.push(audit.additionAdded(a.description, money(a.amount))); continue; }
    if (!money(before.amount).rounded().equals(money(a.amount).rounded()) || before.description !== a.description) {
      out.push(audit.manual(`Addition “${a.description}” changed`, money(before.amount).format(), money(a.amount).format()));
    }
    if (before.category !== a.category || before.customCategoryId !== a.customCategoryId) {
      out.push(audit.manual(`Addition “${a.description}” category changed`,
        customName(before.customCategoryId) ?? before.category, customName(a.customCategoryId) ?? a.category));
    }
  }
  for (const a of prev.additions) if (!newAddIds.has(a.id)) out.push(audit.additionRemoved(a.description, money(a.amount)));

  const oldDeds = new Map(prev.deductions.map((d) => [d.id, d]));
  const newDedIds = new Set(cur.deductions.map((d) => d.id));
  for (const d of cur.deductions) {
    const before = oldDeds.get(d.id);
    if (!before) { out.push(audit.deductionAdded(d.description, money(d.amount), d.responsibility)); continue; }
    if (!money(before.amount).rounded().equals(money(d.amount).rounded())
      || before.responsibility !== d.responsibility
      || !dec(before.driverSharePercent).eq(dec(d.driverSharePercent))
      || before.description !== d.description) {
      out.push(audit.manual(`Deduction “${d.description}” changed`,
        `${money(before.amount).format()} · ${RESPONSIBILITY_LABEL[before.responsibility]}`,
        `${money(d.amount).format()} · ${RESPONSIBILITY_LABEL[d.responsibility]}`));
    }
    if (before.category !== d.category || before.customCategoryId !== d.customCategoryId) {
      out.push(audit.manual(`Deduction “${d.description}” category changed`,
        customName(before.customCategoryId) ?? before.category, customName(d.customCategoryId) ?? d.category));
    }
  }
  for (const d of prev.deductions) if (!newDedIds.has(d.id)) out.push(audit.deductionRemoved(d.description, money(d.amount)));

  const oldRule = effectivePayRule(prev.header);
  const newRule = effectivePayRule(cur.header);
  if (!sameTerms(oldRule, newRule) || (prev.header.payOnGrossRevenue ?? true) !== (cur.header.payOnGrossRevenue ?? true)) {
    out.push(audit.payRuleChanged(oldRule, newRule));
  }

  for (const l of cur.loadLines) {
    const before = oldLines.get(l.id);
    if (!before) continue;
    if (!lineGross(before).rounded().equals(lineGross(l).rounded())
      || !sameTerms(before.payRuleOverride, l.payRuleOverride)) {
      out.push(audit.manual(`Load ${l.loadNumber ?? "—"} changed`, lineGross(before).format(), lineGross(l).format()));
    }
    const det = (x: LoadLine) => [x.loadNumber, x.pickupDate, x.deliveryDate, x.origin, x.destination, x.brokerName,
      dec(x.loadedMiles).toFixed(), dec(x.deadheadMiles).toFixed(), x.notes ?? ""].join("|");
    if (det(before) !== det(l)) {
      out.push(audit.manual(`Load ${l.loadNumber ?? "—"} details changed`, null, null));
    }
  }

  const ph = prev.header;
  const ch = cur.header;
  if ((ph.settlementNumber ?? null) !== (ch.settlementNumber ?? null)) {
    out.push(audit.manual("Settlement number changed", ph.settlementNumber, ch.settlementNumber));
  }
  if (ph.periodStart !== ch.periodStart || ph.periodEnd !== ch.periodEnd) {
    out.push(audit.manual("Settlement period changed", `${ph.periodStart ?? "—"} → ${ph.periodEnd ?? "—"}`, `${ch.periodStart ?? "—"} → ${ch.periodEnd ?? "—"}`));
  }
  if (!sameDec(ph.hoursWorked, ch.hoursWorked)) out.push(audit.manual("Hours worked changed", ph.hoursWorked, ch.hoursWorked));
  if ((ph.notes ?? "") !== (ch.notes ?? "")) out.push(audit.manual("Notes changed", null, null));
  if ((ph.truckNumber ?? "") !== (ch.truckNumber ?? "")) out.push(audit.manual("Truck number changed", ph.truckNumber, ch.truckNumber));
  if ((ph.settlementType ?? "company_driver") !== (ch.settlementType ?? "company_driver")) {
    out.push(audit.manual("Settlement type changed", ph.settlementType, ch.settlementType));
  }
  return out;
}

function sameDec(a: string | null, b: string | null): boolean {
  if (a === null || a === "") return b === null || b === "";
  if (b === null || b === "") return false;
  return dec(a).eq(dec(b));
}

// ---------------------------------------------------------------------------
//  Advance repayment (iOS transition → approved): one repayment per advance
//  recovery deduction, for the DRIVER share, dated the period end.
// ---------------------------------------------------------------------------

export function plannedRepayments(b: SettlementBundle): Array<{ advanceId: string; deductionId: string; amount: Money }> {
  const out: Array<{ advanceId: string; deductionId: string; amount: Money }> = [];
  for (const d of b.deductions) {
    if (!d.advanceId) continue;
    const amt = deductionDriverAmount(d);
    if (amt.isPositive()) out.push({ advanceId: d.advanceId, deductionId: d.id, amount: amt });
  }
  return out;
}

export function periodDescription(start: string | null, end: string | null): string {
  if (!start || !end) return "—";
  const m = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const s = (v: string) => `${m[Number(v.slice(5, 7)) - 1]} ${Number(v.slice(8, 10))}`;
  return `${s(start)} – ${s(end)}, ${end.slice(0, 4)}`;
}

export type { SettlementHeader };

/**
 * The iPhone decides "delivered by today" with the DEVICE calendar day. The
 * web uses the browser's local day the same way, but only when it is within
 * one day of the server clock (a wrong/forged clock can't pull future loads
 * into payroll); otherwise America/Chicago (company HQ).
 */
export function resolveToday(clientToday: string | null, now: Date): string {
  const hq = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Chicago", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
  if (!clientToday || !/^\d{4}-\d{2}-\d{2}$/.test(clientToday)) return hq;
  const t = Date.parse(clientToday + "T12:00:00Z");
  if (Number.isNaN(t)) return hq;
  const utcNoonToday = Date.parse(now.toISOString().slice(0, 10) + "T12:00:00Z");
  return Math.abs(t - utcNoonToday) <= 86_400_000 ? clientToday : hq;
}
