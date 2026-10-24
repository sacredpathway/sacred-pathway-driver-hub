// =============================================================================
//  Settlement model — web twin of iOS SettlementModels.swift / Settlement.swift
// -----------------------------------------------------------------------------
//  The iPhone settlement model is the ONE live payroll model (owner decision,
//  2026-10). Everything here mirrors Driver Hub 2.3.5:
//
//    • category / status / responsibility raw values are EXACTLY the strings
//      the iPhone decodes. The iPhone decodes whole tables at once, so a single
//      unknown category or audit action would make every settlement fail to
//      load on the phone. Custom categories therefore never write a new
//      category string — see `customCategoryId` below.
//    • Money is exact decimal (lib/money/money.ts, the Swift Money twin).
//    • Pay-rule JSON shape is the iPhone's PayRule Codable shape.
// =============================================================================

import { D, Money, type Dec } from "@/lib/money/money";
import { swiftDecimalFromDouble } from "@/lib/money/swiftDecimal";

// ---------------------------------------------------------------------------
//  Status
// ---------------------------------------------------------------------------

export const SETTLEMENT_STATUSES = [
  "draft",
  "ready_for_review",
  "approved",
  "paid",
  "voided",
] as const;
export type SettlementStatus = (typeof SETTLEMENT_STATUSES)[number];

export const STATUS_LABEL: Record<SettlementStatus, string> = {
  draft: "Draft",
  ready_for_review: "Ready for Review",
  approved: "Approved",
  paid: "Paid",
  voided: "Voided",
};

/** Legacy rows carry NULL or 'draft' — both are drafts. */
export function normaliseStatus(raw: string | null | undefined): SettlementStatus {
  const s = (raw ?? "").trim().toLowerCase();
  return (SETTLEMENT_STATUSES as readonly string[]).includes(s)
    ? (s as SettlementStatus)
    : "draft";
}

/** iPhone `isLocked` (paid / voided): financial history. */
export function isIosLocked(s: SettlementStatus): boolean {
  return s === "paid" || s === "voided";
}

/**
 * WEB edit lock (owner rule): finalized (approved) and paid settlements — and
 * voided ones — are read-only until someone explicitly reopens them. This is
 * stricter than the iPhone, which lets an approved settlement be edited and
 * then drops it back to draft.
 */
export function isWebEditLocked(s: SettlementStatus): boolean {
  return s === "approved" || s === "paid" || s === "voided";
}

/** iPhone `allowedTransitions`. */
export const ALLOWED_TRANSITIONS: Record<SettlementStatus, SettlementStatus[]> = {
  draft: ["ready_for_review", "approved", "voided"],
  ready_for_review: ["draft", "approved", "voided"],
  approved: ["paid", "draft", "voided"],
  paid: ["approved", "voided"],
  voided: ["draft"],
};

export function isFinancialRecord(s: SettlementStatus): boolean {
  return s === "approved" || s === "paid";
}

// ---------------------------------------------------------------------------
//  Settlement type & responsibilities
// ---------------------------------------------------------------------------

export const SETTLEMENT_TYPES = ["company_driver", "lease_operator", "owner_operator", "custom"] as const;
export type SettlementType = (typeof SETTLEMENT_TYPES)[number];

export const SETTLEMENT_TYPE_LABEL: Record<SettlementType, string> = {
  company_driver: "Company Driver",
  lease_operator: "Lease Operator",
  owner_operator: "Owner Operator",
  custom: "Custom",
};

export function normaliseSettlementType(raw: unknown): SettlementType {
  return (SETTLEMENT_TYPES as readonly string[]).includes(raw as string)
    ? (raw as SettlementType)
    : "company_driver";
}

export const RESPONSIBILITIES = ["driver", "company", "split"] as const;
export type Responsibility = (typeof RESPONSIBILITIES)[number];

export const RESPONSIBILITY_LABEL: Record<Responsibility, string> = {
  driver: "Driver Pays",
  company: "Company Pays",
  split: "Split",
};

export function normaliseResponsibility(raw: unknown): Responsibility {
  return (RESPONSIBILITIES as readonly string[]).includes(raw as string)
    ? (raw as Responsibility)
    : "driver";
}

// ---------------------------------------------------------------------------
//  Categories (raw values = DB CHECK lists = iPhone enums)
// ---------------------------------------------------------------------------

export const ADDITION_CATEGORIES = [
  "bonus", "detention", "layover", "tonu", "lumper_reimbursement", "reimbursement",
  "fuel_credit", "maintenance_credit", "safety_bonus", "referral_bonus",
  "manual_credit", "other",
] as const;
export type AdditionCategory = (typeof ADDITION_CATEGORIES)[number];

export const ADDITION_CATEGORY_LABEL: Record<AdditionCategory, string> = {
  bonus: "Bonus",
  detention: "Detention",
  layover: "Layover",
  tonu: "TONU",
  lumper_reimbursement: "Lumper Reimbursement",
  reimbursement: "Reimbursement",
  fuel_credit: "Fuel Credit",
  maintenance_credit: "Maintenance Credit",
  safety_bonus: "Safety Bonus",
  referral_bonus: "Referral Bonus",
  manual_credit: "Manual Credit",
  other: "Other",
};

export const DEDUCTION_CATEGORIES = [
  "truck_lease", "insurance", "fuel", "fuel_advance", "cash_advance", "maintenance",
  "repair", "escrow", "maintenance_reserve", "tolls", "scale_tickets", "permits",
  "violation", "damage", "trailer_charge", "equipment_charge", "dispatcher_fee",
  "factoring_fee", "authority_fee", "other",
] as const;
export type DeductionCategory = (typeof DEDUCTION_CATEGORIES)[number];

export const DEDUCTION_CATEGORY_LABEL: Record<DeductionCategory, string> = {
  truck_lease: "Truck Lease / Payment",
  insurance: "Insurance",
  fuel: "Fuel",
  fuel_advance: "Fuel Advance",
  cash_advance: "Cash Advance",
  maintenance: "Maintenance",
  repair: "Repair",
  escrow: "Escrow",
  maintenance_reserve: "Maintenance Reserve",
  tolls: "Tolls",
  scale_tickets: "Scale Tickets",
  permits: "Permits",
  violation: "Violation / Fine",
  damage: "Damage Charge",
  trailer_charge: "Trailer Charge",
  equipment_charge: "Equipment Charge",
  dispatcher_fee: "Dispatcher Fee",
  factoring_fee: "Factoring Fee",
  authority_fee: "Authority Fee",
  other: "Other",
};

export function normaliseAdditionCategory(raw: unknown): AdditionCategory {
  return (ADDITION_CATEGORIES as readonly string[]).includes(raw as string)
    ? (raw as AdditionCategory)
    : "other";
}

export function normaliseDeductionCategory(raw: unknown): DeductionCategory {
  return (DEDUCTION_CATEGORIES as readonly string[]).includes(raw as string)
    ? (raw as DeductionCategory)
    : "other";
}

/** iPhone `SettlementType.defaultDriverResponsibilities`. */
export const DEFAULT_DRIVER_RESPONSIBILITIES: Record<SettlementType, DeductionCategory[]> = {
  company_driver: ["cash_advance", "fuel_advance", "violation", "damage"],
  lease_operator: [
    "truck_lease", "insurance", "fuel", "fuel_advance", "cash_advance",
    "maintenance", "repair", "escrow", "tolls", "permits",
    "violation", "damage", "trailer_charge",
  ],
  owner_operator: [
    "fuel", "fuel_advance", "cash_advance", "maintenance", "repair",
    "tolls", "scale_tickets", "permits", "violation", "damage",
  ],
  custom: [],
};

// ---------------------------------------------------------------------------
//  Pay rule (iPhone PayRule / PayComponent JSON)
// ---------------------------------------------------------------------------

export const PAY_KINDS = [
  "percent_of_gross", "flat_per_load", "per_mile", "weekly_salary", "hourly", "manual",
] as const;
export type PayKind = (typeof PAY_KINDS)[number];

export const PAY_KIND_LABEL: Record<PayKind, string> = {
  percent_of_gross: "Percentage of Gross",
  flat_per_load: "Flat Amount per Load",
  per_mile: "Per Mile",
  weekly_salary: "Weekly Salary",
  hourly: "Hourly",
  manual: "Custom Manual Pay",
};

export function isPerLoadKind(k: PayKind): boolean {
  return k === "percent_of_gross" || k === "flat_per_load" || k === "per_mile";
}

export const MILE_BASES = ["loaded", "total", "deadhead"] as const;
export type MileBasis = (typeof MILE_BASES)[number];
export const MILE_BASIS_LABEL: Record<MileBasis, string> = {
  loaded: "Loaded Miles",
  total: "All Miles",
  deadhead: "Deadhead Miles",
};

export interface PayComponent {
  id: string;
  kind: PayKind;
  label: string;
  /** percent_of_gross: 70 means 70%. Decimal string. */
  percent: string | null;
  /** per_mile / flat / salary / hourly rate, full precision. Decimal string. */
  rate: string | null;
  mileBasis: MileBasis;
  /** manual: fixed dollars. Decimal string. */
  fixedAmount: string | null;
  /** hourly: hours for the period; null falls back to settlement hours. */
  hours: string | null;
}

export interface CompanyFeeTerms {
  dispatcherFeePercent: string;
  factoringFeePercent: string;
  authorityFee: string;
  maintenanceReserve: string;
  dispatcherFeeResponsibility: Responsibility;
  factoringFeeResponsibility: Responsibility;
  authorityFeeResponsibility: Responsibility;
  maintenanceReserveResponsibility: Responsibility;
}

export const NO_FEES: CompanyFeeTerms = {
  dispatcherFeePercent: "0",
  factoringFeePercent: "0",
  authorityFee: "0",
  maintenanceReserve: "0",
  dispatcherFeeResponsibility: "company",
  factoringFeeResponsibility: "company",
  authorityFeeResponsibility: "company",
  maintenanceReserveResponsibility: "company",
};

export function feesHaveAny(f: CompanyFeeTerms): boolean {
  return !dec(f.dispatcherFeePercent).isZero() || !dec(f.factoringFeePercent).isZero()
    || !Money.of(dec(f.authorityFee)).isZero() || !Money.of(dec(f.maintenanceReserve)).isZero();
}

export interface PayRule {
  components: PayComponent[];
  feeTerms: CompanyFeeTerms | null;
}

export const EMPTY_RULE: PayRule = { components: [], feeTerms: null };

// ---------------------------------------------------------------------------
//  Rows (camelCase in memory; snake_case on the wire — see rows.ts)
// ---------------------------------------------------------------------------

export interface SettlementHeader {
  id: string;
  profileId: string;
  driverId: string | null;
  periodStart: string | null; // YYYY-MM-DD
  periodEnd: string | null;
  status: SettlementStatus;
  settlementNumber: string | null;
  settlementType: SettlementType | null;
  truckNumber: string | null;
  /** Raw stored rule; use effectivePayRule() for math. */
  payRule: PayRule | null;
  payOnGrossRevenue: boolean | null;
  hoursWorked: string | null;
  notes: string | null;
  paymentMethod: string | null;
  paymentReference: string | null;
  /** Legacy fallback for the pay rule (iPhone effectivePayRule). */
  driverPayPercentage: number | null;
  netPay: number | null;
  isEstimate: boolean;
  engineVersion: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  approvedAt: string | null;
  approvedBy: string | null;
  paidAt: string | null;
  voidedAt: string | null;
  createdBy: string | null;
}

export interface LoadLine {
  id: string;
  loadId: string | null;
  loadNumber: string | null;
  brokerName: string | null;
  brokerMcNumber: string | null;
  pickupDate: string | null;
  deliveryDate: string | null;
  origin: string | null;
  destination: string | null;
  loadedMiles: string;
  deadheadMiles: string;
  linehaul: string;
  fuelSurcharge: string;
  accessorials: string;
  detention: string;
  layover: string;
  tonu: string;
  lumperReimbursement: string;
  /** When set, the authoritative gross; components are informational. */
  grossRateOverride: string | null;
  payRuleOverride: PayRule | null;
  hoursWorked: string | null;
  /** Frozen engine output (written on every recalculation). */
  driverEarnings: string;
  payBasisDescription: string;
  notes: string | null;
  isAdjustment: boolean;
  correctsSettlementId: string | null;
  sortOrder: number;
  /** Columns the web never edits but must carry through on save. */
  rateConfirmationDocumentId: string | null;
  proofOfDeliveryDocumentId: string | null;
  createdAt: string | null;
}

export interface Addition {
  id: string;
  category: AdditionCategory;
  /** Web-only pointer to a carrier-defined category (payroll_custom_categories). */
  customCategoryId: string | null;
  description: string;
  amount: string;
  date: string | null;
  relatedLoadId: string | null;
  documentId: string | null;
  notes: string | null;
  sortOrder: number;
  createdAt: string | null;
}

export interface Deduction {
  id: string;
  category: DeductionCategory;
  customCategoryId: string | null;
  description: string;
  amount: string;
  date: string | null;
  relatedLoadId: string | null;
  relatedExpenseId: string | null;
  documentId: string | null;
  notes: string | null;
  responsibility: Responsibility;
  driverSharePercent: string;
  recurringDeductionId: string | null;
  advanceId: string | null;
  sortOrder: number;
  createdAt: string | null;
}

export interface SettlementBundle {
  header: SettlementHeader;
  loadLines: LoadLine[];
  additions: Addition[];
  deductions: Deduction[];
}

export interface RecurringDeductionRule {
  id: string;
  driverId: string;
  category: DeductionCategory;
  description: string;
  amount: string;
  percentOfGross: string | null;
  frequency: "every_settlement" | "weekly" | "biweekly" | "monthly" | "quarterly";
  effectiveStartDate: string;
  effectiveEndDate: string | null;
  isActive: boolean;
  responsibility: Responsibility;
  driverSharePercent: string;
}

export interface CustomCategory {
  id: string;
  kind: "addition" | "deduction";
  name: string;
  baseCategory: string;
  defaultResponsibility: Responsibility;
  defaultDriverSharePercent: string;
  isArchived: boolean;
}

// ---------------------------------------------------------------------------
//  Small decimal helpers
// ---------------------------------------------------------------------------

/** Lenient decimal parse for stored strings: bad / empty → 0. */
export function dec(v: string | number | null | undefined): Dec {
  if (v === null || v === undefined) return new D(0);
  if (typeof v === "number") return Number.isFinite(v) ? new D(v.toFixed(6)) : new D(0);
  const s = v.trim().replace(/[$,%\s]/g, "");
  if (!s || !/^-?(\d+\.?\d*|\.\d+)$/.test(s)) return new D(0);
  return new D(s);
}

export function money(v: string | number | null | undefined): Money {
  return Money.of(dec(v));
}

/**
 * iPhone Settlement.effectivePayRule — exact: a stored rule with components
 * wins; otherwise the legacy percentage column becomes a bare 70%-style rule
 * (no fee terms, same as `.percentOfGross(...)` on iOS); otherwise no rule.
 */
export function effectivePayRule(h: Pick<SettlementHeader, "payRule" | "driverPayPercentage">): PayRule {
  if (h.payRule && h.payRule.components.length > 0) return h.payRule;
  if (h.driverPayPercentage !== null && h.driverPayPercentage > 0) {
    // iOS: `.percentOfGross(Decimal(pct))` — Foundation's Decimal(Double),
    // NOT the shortest string: 33.33 → 33.32999999999999488. Reproduced
    // exactly so half-cent cases round like the iPhone.
    return { components: [percentComponent(swiftDecimalFromDouble(h.driverPayPercentage))], feeTerms: null };
  }
  return EMPTY_RULE;
}

export function percentComponent(percent: string, id = "00000000-0000-4000-8000-000000000001"): PayComponent {
  return {
    id, kind: "percent_of_gross", label: PAY_KIND_LABEL.percent_of_gross,
    percent, rate: null, mileBasis: "loaded", fixedAmount: null, hours: null,
  };
}

/** iPhone SettlementLoadLine.grossRate. */
export function lineGross(l: LoadLine): Money {
  if (l.grossRateOverride !== null && l.grossRateOverride !== "") return money(l.grossRateOverride);
  return Money.sum([
    money(l.linehaul), money(l.fuelSurcharge), money(l.accessorials),
    money(l.detention), money(l.layover), money(l.tonu), money(l.lumperReimbursement),
  ]);
}

export function lineMiles(l: LoadLine, basis: MileBasis): Dec {
  const loaded = dec(l.loadedMiles);
  const dead = dec(l.deadheadMiles);
  if (basis === "loaded") return loaded;
  if (basis === "deadhead") return dead;
  return loaded.plus(dead);
}

/** iPhone SettlementDeduction.effectiveDriverPercent. */
export function effectiveDriverPercent(d: Pick<Deduction, "responsibility" | "driverSharePercent">): Dec {
  if (d.responsibility === "driver") return new D(100);
  if (d.responsibility === "company") return new D(0);
  const p = dec(d.driverSharePercent);
  if (p.lt(0)) return new D(0);
  if (p.gt(100)) return new D(100);
  return p;
}

export function deductionDriverAmount(d: Pick<Deduction, "amount" | "responsibility" | "driverSharePercent">): Money {
  return money(d.amount).percentage(effectiveDriverPercent(d)).rounded();
}

export function deductionCompanyAmount(d: Pick<Deduction, "amount" | "responsibility" | "driverSharePercent">): Money {
  const a = money(d.amount);
  return a.minus(a.percentage(effectiveDriverPercent(d))).rounded();
}
