// =============================================================================
//  Recent settlements — AUTHORITATIVE (new) settlement model only
// -----------------------------------------------------------------------------
//  The Driver Pay & Settlements migration (20260912120000) extended
//  `public.settlements` with the engine columns. A row belongs to the new
//  model when the calculation engine produced it:
//
//      engine_version IS NOT NULL  AND  is_estimate IS NOT TRUE
//
//  Legacy iOS settlement rows (engine_version NULL) and web paystubs are NOT
//  settlement data for this card — they stay under Settlements / Payroll.
//  Estimates are live projections and never financial history.
// =============================================================================

import { Money } from "@/lib/money/money";

/** Explicit column list — every name exists in production `settlements`. */
export const AUTHORITATIVE_SETTLEMENT_COLUMNS =
  "id, settlement_number, driver_id, settlement_period_start, settlement_period_end, " +
  "total_driver_earnings, total_additions, total_deductions, net_pay, status, " +
  "engine_version, is_estimate";

export const RECENT_SETTLEMENTS_LIMIT = 5;

export interface AuthoritativeSettlementRow {
  id: string;
  settlement_number: string | null;
  driver_id: string | null;
  settlement_period_start: string | null;
  settlement_period_end: string | null;
  total_driver_earnings: number | null;
  total_additions: number | null;
  total_deductions: number | null;
  net_pay: number | null;
  status: string | null;
  engine_version: string | null;
  is_estimate: boolean | null;
}

export function isAuthoritativeSettlement(
  r: Pick<AuthoritativeSettlementRow, "engine_version" | "is_estimate">,
): boolean {
  return !!(r.engine_version && r.engine_version.trim()) && r.is_estimate !== true;
}

const STATUS_LABELS: Record<string, string> = {
  draft: "Draft",
  ready_for_review: "Ready for Review",
  approved: "Approved",
  paid: "Paid",
  voided: "Voided",
};

export type SettlementStatusTone = "neutral" | "gold" | "info" | "success" | "danger";

const STATUS_TONES: Record<string, SettlementStatusTone> = {
  draft: "neutral",
  ready_for_review: "gold",
  approved: "info",
  paid: "success",
  voided: "danger",
};

export function settlementStatusLabel(raw: string | null | undefined): string {
  const v = (raw ?? "").trim().toLowerCase();
  if (!v) return "Draft";
  return STATUS_LABELS[v] ?? v.split("_").map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
}

export function settlementStatusTone(raw: string | null | undefined): SettlementStatusTone {
  const v = (raw ?? "").trim().toLowerCase();
  return STATUS_TONES[v || "draft"] ?? "neutral";
}

export interface RecentSettlementView {
  id: string;
  number: string | null;
  driverName: string | null;
  periodStart: string | null;
  periodEnd: string | null;
  gross: Money;
  additions: Money;
  deductions: Money;
  net: Money;
  status: string | null;
}

/** Filters defensively (the query already does) and maps to display values. */
export function recentSettlementViews(
  rows: ReadonlyArray<AuthoritativeSettlementRow>,
  driverNameById: ReadonlyMap<string, string>,
  limit = RECENT_SETTLEMENTS_LIMIT,
): RecentSettlementView[] {
  return rows
    .filter(isAuthoritativeSettlement)
    .slice(0, limit)
    .map((r) => ({
      id: r.id,
      number: r.settlement_number,
      driverName: r.driver_id ? driverNameById.get(r.driver_id) ?? null : null,
      periodStart: r.settlement_period_start,
      periodEnd: r.settlement_period_end,
      gross: Money.fromNumber(r.total_driver_earnings),
      additions: Money.fromNumber(r.total_additions),
      deductions: Money.fromNumber(r.total_deductions),
      net: Money.fromNumber(r.net_pay),
      status: r.status,
    }));
}
