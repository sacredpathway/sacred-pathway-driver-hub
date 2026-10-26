// =============================================================================
//  Settlement calculation engine — line-for-line port of iOS
//  SacredPathway/Services/SettlementCalculationEngine.swift (Driver Hub 2.3.5)
// -----------------------------------------------------------------------------
//  Same contract as the iPhone:
//   - Pure. Same input → same output. No clock, no locale, no I/O.
//   - Exact decimal throughout (decimal.js via Money); rounding to cents only
//     where a line or a total is emitted; half AWAY from zero.
//   - Every total is the sum of the ROUNDED lines above it.
//   - engineVersion is identical to iOS because the math is identical; a
//     settlement saved by either client recalculates to the same cents.
//
//    Gross Load Revenue   = Σ load gross rate
//    + Additions          = Settlement Gross
//    Driver Base Earnings = Σ per-load earnings + Σ per-settlement earnings
//    + Additions − Driver Deductions = Net Driver Pay
//    Company Expenses     = Σ company share of deductions (incl. company fees)
//    Company Retained     = Gross Load Revenue − Net Driver Pay − Company Expenses
// =============================================================================

import { D, Money, type Dec } from "@/lib/money/money";
import {
  ADDITION_CATEGORY_LABEL, DEDUCTION_CATEGORY_LABEL, EMPTY_RULE, NO_FEES,
  dec, deductionCompanyAmount, deductionDriverAmount, effectiveDriverPercent,
  feesHaveAny, isPerLoadKind, lineGross, lineMiles, money,
  type Addition, type CompanyFeeTerms, type Deduction, type DeductionCategory,
  type LoadLine, type PayRule, type Responsibility, type SettlementType,
} from "./model";
import { componentBasis, ruleSummary } from "./payrule";
import { hoursString, milesString, percentString } from "./format";

export const ENGINE_VERSION = "settlement-engine/1.0";

export type LineKind =
  | "loadEarning"
  | "settlementEarning"
  | "addition"
  | "driverDeduction"
  | "companyExpense";

export interface LineItem {
  id: string;
  kind: LineKind;
  label: string;
  basis: string;
  amount: Money;
  relatedLoadId: string | null;
  category: string | null;
  /** Source row id (deduction/addition/line/component) — UI linking. */
  sourceId: string;
}

export interface CalcInput {
  profileId: string;
  settlementType: SettlementType;
  payRule: PayRule;
  payOnGrossRevenue: boolean;
  loadLines: LoadLine[];
  additions: Addition[];
  deductions: Deduction[];
  hoursWorked: string | null;
  companyFees: CompanyFeeTerms;
  isEstimate: boolean;
  frozenLoadEarnings?: boolean;
}

export interface CalcResult {
  grossLoadRevenue: Money;
  totalAdditions: Money;
  settlementGross: Money;
  driverBaseEarnings: Money;
  totalDriverDeductions: Money;
  netDriverPay: Money;
  companyExpenses: Money;
  companyRetained: Money;
  companyMargin: Money;
  loadEarnings: Map<string, Money>;
  loadPayBasis: Map<string, string>;
  lineItems: LineItem[];
  /** Fee deductions the engine generated (not stored as rows). */
  feeDeductions: Deduction[];
  totalLoads: number;
  loadedMiles: Dec;
  deadheadMiles: Dec;
  totalMiles: Dec;
  revenuePerMile: Money;
  driverEarningsPerMile: Money;
  fuelCostPerMile: Money;
  expenseRatio: Dec;
  isEstimate: boolean;
  engineVersion: string;
  warnings: string[];
}

export function reconciles(r: CalcResult): boolean {
  const earn = Money.sum(r.lineItems.filter((l) => l.kind === "loadEarning" || l.kind === "settlementEarning").map((l) => l.amount));
  const adds = Money.sum(r.lineItems.filter((l) => l.kind === "addition").map((l) => l.amount));
  const deds = Money.sum(r.lineItems.filter((l) => l.kind === "driverDeduction").map((l) => l.amount));
  return earn.plus(adds).minus(deds).rounded().equals(r.netDriverPay.rounded());
}

function cmpStr(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export function calculate(input: CalcInput): CalcResult {
  const warnings: string[] = [];
  const lineItems: LineItem[] = [];

  // ── 1. Gross load revenue ──────────────────────────────────────────────
  const orderedLines = [...input.loadLines].sort((l, r) => {
    if (l.sortOrder !== r.sortOrder) return l.sortOrder - r.sortOrder;
    const ld = l.pickupDate ?? "";
    const rd = r.pickupDate ?? "";
    if (ld !== rd) return cmpStr(ld, rd); // '' sorts first = distantPast
    return cmpStr(l.loadNumber ?? "", r.loadNumber ?? "");
  });

  const loadGrosses = new Map<string, Money>();
  for (const line of orderedLines) loadGrosses.set(line.id, lineGross(line).rounded());
  const grossLoadRevenue = Money.sum(orderedLines.map((l) => loadGrosses.get(l.id) ?? Money.zero));

  // ── 2. Mileage ─────────────────────────────────────────────────────────
  const loadedMiles = orderedLines.reduce((acc, l) => acc.plus(D.max(0, dec(l.loadedMiles))), new D(0));
  const deadheadMiles = orderedLines.reduce((acc, l) => acc.plus(D.max(0, dec(l.deadheadMiles))), new D(0));
  const totalMiles = loadedMiles.plus(deadheadMiles);

  // ── 3. Company fee lines ───────────────────────────────────────────────
  const feeDeductions = expandCompanyFees(input.companyFees, grossLoadRevenue, input.profileId);
  const allDeductions = [...input.deductions, ...feeDeductions];

  // ── 4. Driver earnings ─────────────────────────────────────────────────
  const companyBorneForNetBasis = Money.sum(allDeductions.map(deductionCompanyAmount));
  const netBasis = grossLoadRevenue.minus(companyBorneForNetBasis).clampedToZero();

  const outcome = calculateDriverEarnings(
    orderedLines, loadGrosses, input.payRule, input.payOnGrossRevenue,
    netBasis, input.hoursWorked, warnings,
  );
  if (input.frozenLoadEarnings) {
    for (const line of orderedLines) {
      outcome.perLoad.set(line.id, money(line.driverEarnings).rounded());
      outcome.perLoadBasis.set(line.id, line.payBasisDescription);
    }
  }

  for (const line of orderedLines) {
    lineItems.push({
      id: line.id,
      kind: "loadEarning",
      label: line.loadNumber !== null ? `Load ${line.loadNumber}` : "Load",
      basis: outcome.perLoadBasis.get(line.id) ?? "",
      amount: outcome.perLoad.get(line.id) ?? Money.zero,
      relatedLoadId: line.loadId,
      category: null,
      sourceId: line.id,
    });
  }
  lineItems.push(...outcome.settlementLevelLines);

  const driverBaseEarnings = Money.sum(orderedLines.map((l) => outcome.perLoad.get(l.id) ?? Money.zero))
    .plus(Money.sum(outcome.settlementLevelLines.map((l) => l.amount)));

  // ── 5. Additions ───────────────────────────────────────────────────────
  const sortedAdditions = [...input.additions].sort((a, b) => a.sortOrder - b.sortOrder);
  for (const a of sortedAdditions) {
    const catName = ADDITION_CATEGORY_LABEL[a.category];
    lineItems.push({
      id: a.id,
      kind: "addition",
      label: a.description === "" ? catName : a.description,
      basis: catName,
      amount: money(a.amount).rounded(),
      relatedLoadId: a.relatedLoadId,
      category: a.category,
      sourceId: a.id,
    });
    if (money(a.amount).isNegative()) {
      warnings.push(`Addition “${a.description}” is negative — it will reduce the driver's pay.`);
    }
  }
  const totalAdditions = Money.sum(sortedAdditions.map((a) => money(a.amount).rounded()));
  const settlementGross = grossLoadRevenue.plus(totalAdditions);

  // ── 6. Deductions ──────────────────────────────────────────────────────
  const sortedDeductions = [...allDeductions].sort((l, r) => {
    if (l.sortOrder !== r.sortOrder) return l.sortOrder - r.sortOrder;
    return cmpStr(l.description, r.description);
  });

  let totalDriverDeductions = Money.zero;
  let companyExpenses = Money.zero;
  for (const d of sortedDeductions) {
    const driverPart = deductionDriverAmount(d);
    const companyPart = deductionCompanyAmount(d);
    const catName = DEDUCTION_CATEGORY_LABEL[d.category];
    const label = d.description === "" ? catName : d.description;
    if (!driverPart.isZero()) {
      totalDriverDeductions = totalDriverDeductions.plus(driverPart);
      lineItems.push({
        id: d.id,
        kind: "driverDeduction",
        label,
        basis: d.responsibility === "split"
          ? `${catName} · driver ${percentString(effectiveDriverPercent(d))}`
          : catName,
        amount: driverPart,
        relatedLoadId: d.relatedLoadId,
        category: d.category,
        sourceId: d.id,
      });
    }
    if (!companyPart.isZero()) {
      companyExpenses = companyExpenses.plus(companyPart);
      lineItems.push({
        id: companySideId(d.id),
        kind: "companyExpense",
        label,
        basis: catName,
        amount: companyPart,
        relatedLoadId: d.relatedLoadId,
        category: d.category,
        sourceId: d.id,
      });
    }
    if (money(d.amount).isNegative()) {
      warnings.push(`Deduction “${d.description}” is negative — it will increase the driver's pay.`);
    }
  }

  // ── 7. Net driver pay ──────────────────────────────────────────────────
  const netDriverPay = driverBaseEarnings.plus(totalAdditions).minus(totalDriverDeductions).rounded();
  if (netDriverPay.isNegative()) {
    warnings.push("Net pay is negative — deductions exceed earnings for this period.");
  }

  // ── 8. Company side ────────────────────────────────────────────────────
  const companyRetained = grossLoadRevenue.minus(netDriverPay).minus(companyExpenses).rounded();

  // ── 9. Metrics ─────────────────────────────────────────────────────────
  const tm = totalMiles;
  const revenuePerMile = tm.gt(0) ? grossLoadRevenue.dividedBy(tm).roundedTo(3) : Money.zero;
  const driverEarningsPerMile = tm.gt(0) ? driverBaseEarnings.dividedBy(tm).roundedTo(3) : Money.zero;
  const fuelTotal = Money.sum(sortedDeductions.filter((d) => d.category === "fuel").map((d) => money(d.amount).rounded()));
  const fuelCostPerMile = tm.gt(0) ? fuelTotal.dividedBy(tm).roundedTo(3) : Money.zero;
  const expenseRatio = grossLoadRevenue.amount.gt(0)
    ? netDriverPay.amount.plus(companyExpenses.amount).div(grossLoadRevenue.amount).toDecimalPlaces(4, D.ROUND_HALF_UP)
    : new D(0);

  if (grossLoadRevenue.isZero() && orderedLines.length > 0) {
    warnings.push("Every load on this settlement has a gross rate of $0.00.");
  }
  if (tm.isZero() && orderedLines.length > 0) {
    warnings.push("No mileage recorded — per-mile metrics are unavailable.");
  }

  return {
    grossLoadRevenue,
    totalAdditions,
    settlementGross,
    driverBaseEarnings,
    totalDriverDeductions,
    netDriverPay,
    companyExpenses,
    companyRetained,
    companyMargin: companyRetained,
    loadEarnings: outcome.perLoad,
    loadPayBasis: outcome.perLoadBasis,
    lineItems,
    feeDeductions,
    totalLoads: orderedLines.length,
    loadedMiles,
    deadheadMiles,
    totalMiles,
    revenuePerMile,
    driverEarningsPerMile,
    fuelCostPerMile,
    expenseRatio,
    isEstimate: input.isEstimate,
    engineVersion: ENGINE_VERSION,
    warnings,
  };
}

// ---------------------------------------------------------------------------
//  Driver earnings
// ---------------------------------------------------------------------------

interface EarningsOutcome {
  perLoad: Map<string, Money>;
  perLoadBasis: Map<string, string>;
  settlementLevelLines: LineItem[];
}

function sumPercents(rule: PayRule): Dec {
  return rule.components
    .filter((c) => c.kind === "percent_of_gross")
    .reduce((acc, c) => acc.plus(dec(c.percent)), new D(0));
}

function calculateDriverEarnings(
  lines: LoadLine[],
  loadGrosses: Map<string, Money>,
  defaultRule: PayRule,
  payOnGrossRevenue: boolean,
  netBasis: Money,
  settlementHours: string | null,
  warnings: string[],
): EarningsOutcome {
  const perLoad = new Map<string, Money>();
  const perLoadBasis = new Map<string, string>();
  const settlementLines: LineItem[] = [];

  let netPercentPerLoad = new Map<string, Money>();
  if (!payOnGrossRevenue) {
    const netPercent = sumPercents(defaultRule);
    if (!netPercent.isZero()) {
      const total = netBasis.percentage(netPercent);
      netPercentPerLoad = allocate(total, lines.map((l) => [l.id, loadGrosses.get(l.id) ?? Money.zero]));
    }
  }

  for (const line of lines) {
    const rule = line.payRuleOverride ?? defaultRule;
    const gross = loadGrosses.get(line.id) ?? Money.zero;
    let lineTotal = Money.zero;
    const parts: string[] = [];

    for (const c of rule.components) {
      if (!isPerLoadKind(c.kind)) continue;
      if (c.kind === "percent_of_gross") {
        if (payOnGrossRevenue || line.payRuleOverride !== null) {
          const pct = dec(c.percent);
          lineTotal = lineTotal.plus(gross.percentage(pct));
          parts.push(`${percentString(pct)} of ${gross.format()}`);
        } else {
          lineTotal = lineTotal.plus(netPercentPerLoad.get(line.id) ?? Money.zero);
          parts.push(`${percentString(dec(c.percent))} of net`);
        }
      } else if (c.kind === "flat_per_load") {
        const rate = money(c.rate);
        lineTotal = lineTotal.plus(rate);
        parts.push(`${rate.format()} flat`);
      } else if (c.kind === "per_mile") {
        const rate = money(c.rate);
        const miles = D.max(0, lineMiles(line, c.mileBasis));
        lineTotal = lineTotal.plus(rate.times(miles));
        parts.push(`${milesString(miles)} mi × ${rate.roundedTo(3).format()}`);
      }
    }

    perLoad.set(line.id, lineTotal.rounded());
    perLoadBasis.set(
      line.id,
      parts.length === 0
        ? (rule.components.length === 0 ? "No pay rule" : ruleSummary(rule))
        : parts.join(" + "),
    );
  }

  if (!payOnGrossRevenue && netPercentPerLoad.size > 0) {
    const allocatedSum = Money.sum(lines.map((l) => netPercentPerLoad.get(l.id) ?? Money.zero));
    const intended = netBasis.percentage(sumPercents(defaultRule)).rounded();
    if (!allocatedSum.equals(intended)) {
      warnings.push(`Percentage allocation residual of ${intended.minus(allocatedSum).format()} detected.`);
    }
  }

  for (const c of defaultRule.components) {
    if (isPerLoadKind(c.kind)) continue;
    if (c.kind === "weekly_salary") {
      settlementLines.push({
        id: c.id, kind: "settlementEarning", label: c.label, basis: componentBasis(c),
        amount: money(c.rate).rounded(), relatedLoadId: null, category: c.kind, sourceId: c.id,
      });
    } else if (c.kind === "hourly") {
      const rate = money(c.rate);
      const hours = c.hours !== null ? dec(c.hours) : settlementHours !== null ? dec(settlementHours) : new D(0);
      if (hours.lte(0)) warnings.push("Hourly pay is configured but no hours were entered for this period.");
      const h = D.max(0, hours);
      settlementLines.push({
        id: c.id, kind: "settlementEarning", label: c.label,
        basis: `${hoursString(h)} hrs × ${rate.format()}`,
        amount: rate.times(h).rounded(), relatedLoadId: null, category: c.kind, sourceId: c.id,
      });
    } else if (c.kind === "manual") {
      settlementLines.push({
        id: c.id, kind: "settlementEarning", label: c.label, basis: componentBasis(c),
        amount: money(c.fixedAmount).rounded(), relatedLoadId: null, category: c.kind, sourceId: c.id,
      });
    }
  }

  if (defaultRule.components.length === 0 && lines.some((l) => l.payRuleOverride === null)) {
    warnings.push("No pay rule is set for this driver — load earnings calculated as $0.00.");
  }

  return { perLoad, perLoadBasis, settlementLevelLines: settlementLines };
}

// ---------------------------------------------------------------------------
//  Company fees → deduction lines (one pipeline decides who pays)
// ---------------------------------------------------------------------------

export function expandCompanyFees(fees: CompanyFeeTerms, gross: Money, profileId: string): Deduction[] {
  if (!feesHaveAny(fees)) return [];
  const out: Deduction[] = [];
  const add = (category: DeductionCategory, label: string, amount: Money, responsibility: Responsibility) => {
    if (amount.rounded().isZero()) return;
    out.push({
      id: deterministicFeeId(category, profileId),
      category,
      customCategoryId: null,
      description: label,
      amount: amount.rounded().toFixed2(),
      date: null,
      relatedLoadId: null,
      relatedExpenseId: null,
      documentId: null,
      notes: null,
      responsibility,
      driverSharePercent: responsibility === "driver" ? "100" : "0",
      recurringDeductionId: null,
      advanceId: null,
      sortOrder: 9000,
      createdAt: null,
    });
  };
  add("dispatcher_fee", `Dispatcher Fee (${percentString(dec(fees.dispatcherFeePercent))})`,
    gross.percentage(dec(fees.dispatcherFeePercent)), fees.dispatcherFeeResponsibility);
  add("factoring_fee", `Factoring Fee (${percentString(dec(fees.factoringFeePercent))})`,
    gross.percentage(dec(fees.factoringFeePercent)), fees.factoringFeeResponsibility);
  add("authority_fee", "Authority Fee", money(fees.authorityFee), fees.authorityFeeResponsibility);
  add("maintenance_reserve", "Maintenance Reserve", money(fees.maintenanceReserve), fees.maintenanceReserveResponsibility);
  return out;
}

// ---------------------------------------------------------------------------
//  Allocation — residual to the (first) largest bucket, like iOS
// ---------------------------------------------------------------------------

export function allocate(total: Money, buckets: Array<[string, Money]>): Map<string, Money> {
  const out = new Map<string, Money>();
  if (buckets.length === 0) return out;
  const target = total.rounded();
  const totalWeight = Money.sum(buckets.map((b) => b[1]));
  if (totalWeight.isZero()) {
    const even = target.dividedBy(buckets.length).rounded();
    for (const [id] of buckets) out.set(id, even);
  } else {
    for (const [id, w] of buckets) {
      out.set(id, Money.of(target.amount.mul(w.amount).div(totalWeight.amount)).rounded());
    }
  }
  const allocated = Money.sum(buckets.map(([id]) => out.get(id) ?? Money.zero));
  const residual = target.minus(allocated);
  if (!residual.isZero()) {
    // Swift max(by:) keeps the FIRST maximal element on ties.
    let anchor = buckets[0];
    for (const b of buckets) if (anchor[1].lt(b[1])) anchor = b;
    out.set(anchor[0], (out.get(anchor[0]) ?? Money.zero).plus(residual));
  }
  return out;
}

// ---------------------------------------------------------------------------
//  Deterministic ids (iOS byte-for-byte)
// ---------------------------------------------------------------------------

function uuidBytes(id: string): number[] {
  const hex = id.replace(/-/g, "").toLowerCase();
  if (!/^[0-9a-f]{32}$/.test(hex)) return new Array(16).fill(0);
  const out: number[] = [];
  for (let i = 0; i < 16; i++) out.push(parseInt(hex.slice(i * 2, i * 2 + 2), 16));
  return out;
}

function bytesToUuid(b: number[]): string {
  const h = b.map((x) => x.toString(16).padStart(2, "0")).join("").toUpperCase();
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

export function deterministicFeeId(category: DeductionCategory, profileId: string): string {
  const p = uuidBytes(profileId);
  const c = Array.from(new TextEncoder().encode(category));
  const out = p.map((pb, i) => pb ^ (c.length === 0 ? 0 : c[i % c.length]) ^ 0x5a);
  return bytesToUuid(out);
}

export function companySideId(id: string): string {
  const b = uuidBytes(id);
  b[15] ^= 0xc0;
  b[14] ^= 0x01;
  return bytesToUuid(b);
}

export { EMPTY_RULE, NO_FEES };
