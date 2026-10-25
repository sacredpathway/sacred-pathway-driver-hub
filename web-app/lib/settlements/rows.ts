// =============================================================================
//  Settlement row mapping — DB snake_case ↔ in-memory model
// -----------------------------------------------------------------------------
//  Reads: Supabase returns numeric columns as JS numbers; every one goes
//  through decimal.js (6-dp fixed, the Swift `Money(double:)` rule) so no
//  float ever reaches the math.
//  Writes: numeric columns are sent as exact decimal STRINGS ("1234.57"), so
//  the stored cents are exactly the engine's cents. Only columns that exist in
//  production are written (same set the iPhone writes). `custom_category_id`
//  is written only when the custom-categories migration is present.
// =============================================================================

import { D } from "@/lib/money/money";
import {
  dec, normaliseAdditionCategory, normaliseDeductionCategory, normaliseResponsibility,
  normaliseSettlementType, normaliseStatus,
  type Addition, type Deduction, type LoadLine, type RecurringDeductionRule,
  type SettlementHeader, type SettlementType,
} from "./model";
import { encodePayRule, parsePayRule } from "./payrule";
import type { HeaderTotals } from "./workflow";
import { ymd } from "./workflow";

type Row = Record<string, unknown>;

export function n2s(v: unknown, fallback = "0"): string {
  if (v === null || v === undefined || v === "") return fallback;
  if (typeof v === "number") return Number.isFinite(v) ? new D(v.toFixed(6)).toFixed() : fallback;
  if (typeof v === "string") { try { return new D(v).toFixed(); } catch { return fallback; } }
  return fallback;
}
function n2sOrNull(v: unknown): string | null {
  return v === null || v === undefined || v === "" ? null : n2s(v);
}
const s = (v: unknown): string | null => (typeof v === "string" ? v : null);
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v)) ? Number(v) : null);

export const SETTLEMENT_COLUMNS =
  "id, profile_id, driver_id, settlement_period_start, settlement_period_end, status, " +
  "settlement_number, settlement_type, truck_number, pay_rule, pay_on_gross_revenue, hours_worked, " +
  "notes, payment_method, payment_reference, driver_pay_percentage, net_pay, total_revenue, " +
  "gross_load_revenue, total_driver_earnings, total_additions, total_deductions, " +
  "company_expenses, company_retained, is_estimate, engine_version, created_at, updated_at, " +
  "approved_at, approved_by, paid_at, voided_at, created_by, paystub_id";

export function headerFromRow(r: Row): SettlementHeader {
  return {
    id: String(r.id),
    profileId: String(r.profile_id),
    driverId: s(r.driver_id),
    periodStart: ymd(s(r.settlement_period_start)),
    periodEnd: ymd(s(r.settlement_period_end)),
    status: normaliseStatus(s(r.status)),
    settlementNumber: s(r.settlement_number),
    settlementType: r.settlement_type ? normaliseSettlementType(r.settlement_type) : null,
    truckNumber: s(r.truck_number),
    payRule: parsePayRule(r.pay_rule),
    payOnGrossRevenue: typeof r.pay_on_gross_revenue === "boolean" ? r.pay_on_gross_revenue : null,
    hoursWorked: n2sOrNull(r.hours_worked),
    notes: s(r.notes),
    paymentMethod: s(r.payment_method),
    paymentReference: s(r.payment_reference),
    driverPayPercentage: num(r.driver_pay_percentage),
    netPay: num(r.net_pay),
    isEstimate: r.is_estimate === true,
    engineVersion: s(r.engine_version),
    createdAt: s(r.created_at),
    updatedAt: s(r.updated_at),
    approvedAt: s(r.approved_at),
    approvedBy: s(r.approved_by),
    paidAt: s(r.paid_at),
    voidedAt: s(r.voided_at),
    createdBy: s(r.created_by),
  };
}

/** Editable header fields + engine totals. Status / timestamps are NOT here:
 *  a save never changes status (that is what a transition is for). */
export function headerEditRow(h: SettlementHeader, totals: HeaderTotals, settlementType: SettlementType): Row {
  return {
    driver_id: h.driverId,
    settlement_period_start: h.periodStart,
    settlement_period_end: h.periodEnd,
    settlement_number: h.settlementNumber && h.settlementNumber.trim() ? h.settlementNumber.trim() : null,
    settlement_type: settlementType,
    truck_number: h.truckNumber && h.truckNumber.trim() ? h.truckNumber.trim() : null,
    pay_rule: h.payRule ? encodePayRule(h.payRule) : null,
    pay_on_gross_revenue: h.payOnGrossRevenue ?? true,
    hours_worked: h.hoursWorked && h.hoursWorked.trim() ? dec(h.hoursWorked).toDecimalPlaces(2, D.ROUND_HALF_UP).toFixed(2) : null,
    notes: h.notes && h.notes.trim() ? h.notes : null,
    is_estimate: h.isEstimate,
    ...totals,
  };
}

export const LOAD_LINE_COLUMNS =
  "id, settlement_id, profile_id, load_id, load_number, broker_name, broker_mc_number, pickup_date, " +
  "delivery_date, origin, destination, loaded_miles, deadhead_miles, linehaul, fuel_surcharge, " +
  "accessorials, detention, layover, tonu, lumper_reimbursement, gross_rate_override, pay_rule_override, " +
  "hours_worked, driver_earnings, pay_basis_description, rate_confirmation_document_id, " +
  "proof_of_delivery_document_id, notes, is_adjustment, corrects_settlement_id, sort_order, created_at";

export function lineFromRow(r: Row): LoadLine {
  return {
    id: String(r.id),
    loadId: s(r.load_id),
    loadNumber: s(r.load_number),
    brokerName: s(r.broker_name),
    brokerMcNumber: s(r.broker_mc_number),
    pickupDate: ymd(s(r.pickup_date)),
    deliveryDate: ymd(s(r.delivery_date)),
    origin: s(r.origin),
    destination: s(r.destination),
    loadedMiles: n2s(r.loaded_miles),
    deadheadMiles: n2s(r.deadhead_miles),
    linehaul: n2s(r.linehaul),
    fuelSurcharge: n2s(r.fuel_surcharge),
    accessorials: n2s(r.accessorials),
    detention: n2s(r.detention),
    layover: n2s(r.layover),
    tonu: n2s(r.tonu),
    lumperReimbursement: n2s(r.lumper_reimbursement),
    grossRateOverride: n2sOrNull(r.gross_rate_override),
    payRuleOverride: parsePayRule(r.pay_rule_override),
    hoursWorked: n2sOrNull(r.hours_worked),
    driverEarnings: n2s(r.driver_earnings),
    payBasisDescription: s(r.pay_basis_description) ?? "",
    notes: s(r.notes),
    isAdjustment: r.is_adjustment === true,
    correctsSettlementId: s(r.corrects_settlement_id),
    sortOrder: num(r.sort_order) ?? 0,
    rateConfirmationDocumentId: s(r.rate_confirmation_document_id),
    proofOfDeliveryDocumentId: s(r.proof_of_delivery_document_id),
    createdAt: s(r.created_at),
  };
}

const m2 = (v: string) => dec(v).toDecimalPlaces(2, D.ROUND_HALF_UP).toFixed(2);
const m2n = (v: string | null) => (v === null || v === "" ? null : m2(v));
const t = (v: string | null) => (v && v.trim() ? v.trim() : null);

export function lineToRow(l: LoadLine, settlementId: string, profileId: string): Row {
  return {
    id: l.id,
    settlement_id: settlementId,
    profile_id: profileId,
    load_id: l.loadId,
    load_number: t(l.loadNumber),
    broker_name: t(l.brokerName),
    broker_mc_number: t(l.brokerMcNumber),
    pickup_date: l.pickupDate || null,
    delivery_date: l.deliveryDate || null,
    origin: t(l.origin),
    destination: t(l.destination),
    loaded_miles: m2(l.loadedMiles),
    deadhead_miles: m2(l.deadheadMiles),
    linehaul: m2(l.linehaul),
    fuel_surcharge: m2(l.fuelSurcharge),
    accessorials: m2(l.accessorials),
    detention: m2(l.detention),
    layover: m2(l.layover),
    tonu: m2(l.tonu),
    lumper_reimbursement: m2(l.lumperReimbursement),
    gross_rate_override: m2n(l.grossRateOverride),
    pay_rule_override: l.payRuleOverride ? encodePayRule(l.payRuleOverride) : null,
    hours_worked: l.hoursWorked && l.hoursWorked.trim() ? m2(l.hoursWorked) : null,
    driver_earnings: m2(l.driverEarnings),
    pay_basis_description: l.payBasisDescription,
    notes: t(l.notes),
    is_adjustment: l.isAdjustment,
    corrects_settlement_id: l.correctsSettlementId,
    sort_order: l.sortOrder,
  };
}

export const ADDITION_COLUMNS =
  "id, settlement_id, profile_id, category, description, amount, date, related_load_id, document_id, notes, sort_order, created_at";
export const DEDUCTION_COLUMNS =
  "id, settlement_id, profile_id, category, description, amount, date, related_load_id, related_expense_id, " +
  "document_id, notes, responsibility, driver_share_percent, recurring_deduction_id, advance_id, sort_order, created_at";

export function additionFromRow(r: Row): Addition {
  return {
    id: String(r.id),
    category: normaliseAdditionCategory(r.category),
    customCategoryId: s(r.custom_category_id),
    description: s(r.description) ?? "",
    amount: n2s(r.amount),
    date: ymd(s(r.date)),
    relatedLoadId: s(r.related_load_id),
    documentId: s(r.document_id),
    notes: s(r.notes),
    sortOrder: num(r.sort_order) ?? 0,
    createdAt: s(r.created_at),
  };
}

export function additionToRow(a: Addition, settlementId: string, profileId: string, withCustom: boolean): Row {
  const row: Row = {
    id: a.id,
    settlement_id: settlementId,
    profile_id: profileId,
    category: a.category,
    description: a.description.trim(),
    amount: m2(a.amount),
    date: a.date || null,
    related_load_id: a.relatedLoadId,
    notes: t(a.notes),
    sort_order: a.sortOrder,
  };
  if (withCustom) row.custom_category_id = a.customCategoryId;
  return row;
}

export function deductionFromRow(r: Row): Deduction {
  return {
    id: String(r.id),
    category: normaliseDeductionCategory(r.category),
    customCategoryId: s(r.custom_category_id),
    description: s(r.description) ?? "",
    amount: n2s(r.amount),
    date: ymd(s(r.date)),
    relatedLoadId: s(r.related_load_id),
    relatedExpenseId: s(r.related_expense_id),
    documentId: s(r.document_id),
    notes: s(r.notes),
    responsibility: normaliseResponsibility(r.responsibility),
    driverSharePercent: n2s(r.driver_share_percent, "100"),
    recurringDeductionId: s(r.recurring_deduction_id),
    advanceId: s(r.advance_id),
    sortOrder: num(r.sort_order) ?? 0,
    createdAt: s(r.created_at),
  };
}

export function deductionToRow(d: Deduction, settlementId: string, profileId: string, withCustom: boolean): Row {
  const share = d.responsibility === "driver" ? "100" : d.responsibility === "company" ? "0" : d.driverSharePercent;
  const row: Row = {
    id: d.id,
    settlement_id: settlementId,
    profile_id: profileId,
    category: d.category,
    description: d.description.trim(),
    amount: m2(d.amount),
    date: d.date || null,
    related_load_id: d.relatedLoadId,
    related_expense_id: d.relatedExpenseId,
    notes: t(d.notes),
    responsibility: d.responsibility,
    driver_share_percent: dec(share).toDecimalPlaces(3, D.ROUND_HALF_UP).toFixed(3),
    recurring_deduction_id: d.recurringDeductionId,
    advance_id: d.advanceId,
    sort_order: d.sortOrder,
  };
  if (withCustom) row.custom_category_id = d.customCategoryId;
  // Source document (receipt) link: sent only when set, so every existing
  // payload is byte-identical; the database writes it on insert only.
  if (d.documentId) row.document_id = d.documentId;
  return row;
}

export function recurringFromRow(r: Row): RecurringDeductionRule {
  const f = s(r.frequency);
  return {
    id: String(r.id),
    driverId: String(r.driver_id),
    category: normaliseDeductionCategory(r.category),
    description: s(r.description) ?? "",
    amount: n2s(r.amount),
    percentOfGross: n2sOrNull(r.percent_of_gross),
    frequency: (["every_settlement", "weekly", "biweekly", "monthly", "quarterly"].includes(f ?? "") ? f : "every_settlement") as RecurringDeductionRule["frequency"],
    effectiveStartDate: ymd(s(r.effective_start_date)) ?? "1970-01-01",
    effectiveEndDate: ymd(s(r.effective_end_date)),
    isActive: r.is_active !== false,
    responsibility: normaliseResponsibility(r.responsibility),
    driverSharePercent: n2s(r.driver_share_percent, "100"),
  };
}

/**
 * Snap every value to the precision its column stores (money/miles/hours 2dp,
 * driver share 3dp, rates 6dp) BEFORE the engine runs, so the totals written
 * on save are exactly what a later recalculation of the stored rows produces
 * — on the web or on the iPhone.
 */
export function snapToStoredPrecision<T extends { loadLines: LoadLine[]; additions: Addition[]; deductions: Deduction[]; header: SettlementHeader }>(b: T): T {
  const rateRule = (r: SettlementHeader["payRule"]) =>
    r ? {
      ...r,
      components: r.components.map((c) => ({
        ...c,
        rate: c.rate === null || c.rate === "" ? null : dec(c.rate).toDecimalPlaces(6, D.ROUND_HALF_UP).toFixed(),
        fixedAmount: c.fixedAmount === null || c.fixedAmount === "" ? null : m2(c.fixedAmount),
        percent: c.percent === null || c.percent === "" ? null : dec(c.percent).toFixed(),
        hours: c.hours === null || c.hours === "" ? null : dec(c.hours).toFixed(),
      })),
      feeTerms: r.feeTerms ? { ...r.feeTerms, authorityFee: m2(r.feeTerms.authorityFee), maintenanceReserve: m2(r.feeTerms.maintenanceReserve) } : null,
    } : null;
  return {
    ...b,
    header: {
      ...b.header,
      payRule: rateRule(b.header.payRule),
      hoursWorked: b.header.hoursWorked && b.header.hoursWorked.trim() ? m2(b.header.hoursWorked) : null,
    },
    loadLines: b.loadLines.map((l) => ({
      ...l,
      loadedMiles: m2(l.loadedMiles), deadheadMiles: m2(l.deadheadMiles),
      linehaul: m2(l.linehaul), fuelSurcharge: m2(l.fuelSurcharge), accessorials: m2(l.accessorials),
      detention: m2(l.detention), layover: m2(l.layover), tonu: m2(l.tonu),
      lumperReimbursement: m2(l.lumperReimbursement), grossRateOverride: m2n(l.grossRateOverride),
      payRuleOverride: rateRule(l.payRuleOverride),
    })),
    additions: b.additions.map((a) => ({ ...a, amount: m2(a.amount) })),
    deductions: b.deductions.map((d) => ({
      ...d, amount: m2(d.amount),
      driverSharePercent: dec(d.driverSharePercent).toDecimalPlaces(3, D.ROUND_HALF_UP).toFixed(),
    })),
  };
}
