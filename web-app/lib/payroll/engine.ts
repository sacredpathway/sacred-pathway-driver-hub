// =============================================================================
//  Payroll engine — Carrier HQ Phase W2 commit #3
// -----------------------------------------------------------------------------
//  Pure TypeScript. No DB calls, no Supabase imports — safe in Edge runtime,
//  server components, AND client components (for live preview while editing).
//
//  Math contract (mirrors CARRIER_HQ_PAYROLL_SCHEMA.md §4):
//
//  W2 paystub:
//    gross_earnings              = SUM(earnings.amount)
//    total_pretax_deductions     = SUM(deductions WHERE is_pre_tax = TRUE)
//    taxable_wages               = gross_earnings
//                                  - total_pretax_deductions
//                                  - SUM(earnings WHERE is_taxable = FALSE)
//    total_taxes_withheld        = SUM(taxes.employee_amount)
//    total_posttax_deductions    = SUM(deductions WHERE is_pre_tax = FALSE)
//    net_pay = gross
//              - pretax_deductions
//              - taxes_withheld
//              - posttax_deductions
//
//  1099 paystub:
//    gross_earnings              = SUM(earnings.amount)
//    total_settlement_deductions = SUM(settlement_items WHERE direction='deduct')
//    total_reimbursements        = SUM(settlement_items WHERE direction='add')
//    total_posttax_deductions    = SUM(deductions)  (rare but supported)
//    taxable_wages               = null
//    total_taxes_withheld        = 0
//    net_pay = gross + reimbursements - settlement_deductions - posttax_deductions
// =============================================================================

import type {
  WorkerType,
  PaystubEarning,
  PaystubDeduction,
  PaystubTax,
  PaystubSettlementItem,
} from "@/lib/supabase/types";

// ---------- Inputs ----------

export interface PaystubCalcInput {
  worker_type: WorkerType;
  earnings: ReadonlyArray<Pick<PaystubEarning, "amount" | "is_taxable">>;
  deductions: ReadonlyArray<Pick<PaystubDeduction, "amount" | "is_pre_tax">>;
  taxes: ReadonlyArray<Pick<PaystubTax, "employee_amount" | "employer_amount">>;
  settlement_items: ReadonlyArray<
    Pick<PaystubSettlementItem, "amount" | "direction">
  >;
}

// ---------- Outputs ----------

export interface PaystubTotals {
  gross_earnings: number;
  total_pretax_deductions: number;
  /** Null on 1099. */
  taxable_wages: number | null;
  /** Always 0 on 1099. */
  total_taxes_withheld: number;
  total_employer_taxes: number;
  total_posttax_deductions: number;
  total_reimbursements: number;
  /** Always 0 on W2. */
  total_settlement_deductions: number;
  net_pay: number;
}

// ---------- Rounding ----------

/** Round to cents using banker-safe half-up. Avoids 0.1 + 0.2 floats sneaking into totals. */
export function r2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

function sum<T>(items: ReadonlyArray<T>, pick: (t: T) => number | null | undefined): number {
  let total = 0;
  for (const it of items) {
    const v = pick(it);
    if (typeof v === "number" && Number.isFinite(v)) total += v;
  }
  return total;
}

// ---------- Engine ----------

export function calculatePaystub(input: PaystubCalcInput): PaystubTotals {
  const gross = sum(input.earnings, (e) => e.amount);

  const pretax = sum(
    input.deductions.filter((d) => d.is_pre_tax === true),
    (d) => d.amount
  );

  const posttax = sum(
    input.deductions.filter((d) => d.is_pre_tax !== true),
    (d) => d.amount
  );

  if (input.worker_type === "W2") {
    const nontaxableEarnings = sum(
      input.earnings.filter((e) => e.is_taxable === false),
      (e) => e.amount
    );
    const taxable = gross - pretax - nontaxableEarnings;
    const employeeTaxes = sum(input.taxes, (t) => t.employee_amount);
    const employerTaxes = sum(input.taxes, (t) => t.employer_amount);
    const net = gross - pretax - employeeTaxes - posttax;
    return {
      gross_earnings: r2(gross),
      total_pretax_deductions: r2(pretax),
      taxable_wages: r2(taxable),
      total_taxes_withheld: r2(employeeTaxes),
      total_employer_taxes: r2(employerTaxes),
      total_posttax_deductions: r2(posttax),
      total_reimbursements: 0,
      total_settlement_deductions: 0,
      net_pay: r2(net),
    };
  }

  // 1099
  const reimbursements = sum(
    input.settlement_items.filter((s) => s.direction === "add"),
    (s) => s.amount
  );
  const settlementDeductions = sum(
    input.settlement_items.filter((s) => s.direction === "deduct"),
    (s) => s.amount
  );
  const net = gross + reimbursements - settlementDeductions - posttax;
  return {
    gross_earnings: r2(gross),
    total_pretax_deductions: r2(pretax),
    taxable_wages: null,
    total_taxes_withheld: 0,
    total_employer_taxes: 0,
    total_posttax_deductions: r2(posttax),
    total_reimbursements: r2(reimbursements),
    total_settlement_deductions: r2(settlementDeductions),
    net_pay: r2(net),
  };
}

// =============================================================================
//  Build initial line items from raw inputs (used when seeding a new paystub).
// =============================================================================

export interface NewLineSeed {
  earnings: Array<Pick<PaystubEarning, "kind" | "label" | "amount" | "is_taxable" | "hours" | "units" | "rate" | "load_id" | "notes">>;
  deductions: Array<Pick<PaystubDeduction, "kind" | "label" | "amount" | "is_pre_tax" | "notes">>;
  taxes: Array<Pick<PaystubTax, "kind" | "jurisdiction" | "label" | "employee_amount" | "employer_amount" | "rate_basis" | "notes">>;
  settlement_items: Array<Pick<PaystubSettlementItem, "kind" | "label" | "amount" | "direction" | "load_id" | "notes">>;
}

/**
 * Seed the line items for a fresh 1099 paystub from a list of selected loads.
 * Each load becomes one `settlement_gross` earning row pinned to that load_id.
 * The carrier then adds fuel/tolls/escrow/etc. through the editor.
 */
export function seedContractorLines(
  loads: ReadonlyArray<{
    id: string;
    load_number: string | null;
    origin: string | null;
    destination: string | null;
    total_revenue: number | null;
    total_miles: number | null;
  }>
): NewLineSeed {
  const earnings: NewLineSeed["earnings"] = loads.map((l) => ({
    kind: "settlement_gross",
    label: settlementLabelForLoad(l),
    amount: r2(l.total_revenue ?? 0),
    is_taxable: true, // not used for 1099 net calc but kept consistent
    hours: null,
    units: l.total_miles,
    rate: null,
    load_id: l.id,
    notes: null,
  }));
  return { earnings, deductions: [], taxes: [], settlement_items: [] };
}

function settlementLabelForLoad(l: {
  load_number: string | null;
  origin: string | null;
  destination: string | null;
}): string {
  const route = [l.origin, l.destination].filter(Boolean).join(" → ");
  if (l.load_number && route) return `Load #${l.load_number}  ${route}`;
  if (l.load_number) return `Load #${l.load_number}`;
  if (route) return route;
  return "Load";
}

/**
 * Seed earnings for a fresh W2 paystub from the driver's compensation defaults.
 * Returns a single "regular" line with hours=0 so the carrier just types hours
 * and the rate is already filled in. For salary drivers, returns a "salary"
 * row with the annual-divided-by-pay-period amount.
 */
export function seedEmployeeLines(driver: {
  comp_type: string | null;
  pay_frequency: string | null;
  hourly_rate: number | null;
  salary_annual: number | null;
  mileage_rate: number | null;
  per_load_rate: number | null;
  per_diem_daily: number | null;
}): NewLineSeed {
  const earnings: NewLineSeed["earnings"] = [];

  switch (driver.comp_type) {
    case "hourly": {
      const rate = driver.hourly_rate ?? 0;
      earnings.push({
        kind: "regular",
        label: "Regular hours",
        amount: 0,
        is_taxable: true,
        hours: 0,
        units: null,
        rate,
        load_id: null,
        notes: null,
      });
      break;
    }
    case "salary": {
      const annual = driver.salary_annual ?? 0;
      const periods = payPeriodsPerYear(driver.pay_frequency);
      const amount = periods > 0 ? r2(annual / periods) : 0;
      earnings.push({
        kind: "regular",
        label: "Salary",
        amount,
        is_taxable: true,
        hours: null,
        units: null,
        rate: null,
        load_id: null,
        notes: null,
      });
      break;
    }
    case "mileage": {
      const rate = driver.mileage_rate ?? 0;
      earnings.push({
        kind: "mileage",
        label: "Mileage",
        amount: 0,
        is_taxable: true,
        hours: null,
        units: 0,
        rate,
        load_id: null,
        notes: null,
      });
      break;
    }
    case "per_load": {
      const rate = driver.per_load_rate ?? 0;
      earnings.push({
        kind: "per_load",
        label: "Loads delivered",
        amount: 0,
        is_taxable: true,
        hours: null,
        units: 0,
        rate,
        load_id: null,
        notes: null,
      });
      break;
    }
    default:
      // No comp_type set yet — let the user add lines manually.
      break;
  }

  if (driver.per_diem_daily && driver.per_diem_daily > 0) {
    earnings.push({
      kind: "per_diem",
      label: "Per diem",
      amount: 0,
      is_taxable: false,
      hours: null,
      units: 0,
      rate: driver.per_diem_daily,
      load_id: null,
      notes: "Non-taxable within IRS rate",
    });
  }

  return { earnings, deductions: [], taxes: [], settlement_items: [] };
}

function payPeriodsPerYear(freq: string | null): number {
  switch (freq) {
    case "weekly":      return 52;
    case "biweekly":    return 26;
    case "semimonthly": return 24;
    case "monthly":     return 12;
    default:            return 0;
  }
}
