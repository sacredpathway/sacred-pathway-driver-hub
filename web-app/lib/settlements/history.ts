// =============================================================================
//  Payroll history — one searchable list of every past payroll record
// -----------------------------------------------------------------------------
//    settlement         live settlement model (web + iPhone)       → editable/lockable
//    legacy_settlement  pre-itemized iPhone settlement rows         → read-only
//    paystub            retired web paystubs                        → read-only
//  Estimates are projections, never history, and are excluded. A legacy iPhone
//  settlement that was converted into a web paystub (paystub_id set) is shown
//  once, as its paystub, so nothing double-counts.
// =============================================================================

import { Money } from "@/lib/money/money";
import { STATUS_LABEL, normaliseStatus } from "./model";

export type HistoryKind = "settlement" | "legacy_settlement" | "paystub";

export interface HistoryRow {
  kind: HistoryKind;
  id: string;
  href: string;
  number: string | null;
  driverId: string | null;
  driverName: string;
  periodStart: string | null;
  periodEnd: string | null;
  /** paid date / check date when known, else period end. */
  dateKey: string;
  status: string;
  statusLabel: string;
  gross: Money;
  net: Money;
  loadNumbers: string[];
  notes: string;
  readOnly: boolean;
}

type Row = Record<string, unknown>;
const str = (v: unknown) => (typeof v === "string" ? v : null);
const day = (v: unknown) => { const s = str(v); return s ? s.slice(0, 10) : null; };

export function settlementToHistory(r: Row, driverName: string, loadNumbers: string[]): HistoryRow | null {
  if (r.is_estimate === true) return null;
  if (r.paystub_id) return null; // shown as its paystub
  const id = String(r.id);
  const engine = !!str(r.engine_version) || loadNumbers.length > 0;
  const status = normaliseStatus(str(r.status));
  const gross = Money.fromNumber((r.gross_load_revenue ?? r.total_revenue) as number | null);
  return {
    kind: engine ? "settlement" : "legacy_settlement",
    id,
    href: `/settlements/${id}`,
    number: str(r.settlement_number),
    driverId: str(r.driver_id),
    driverName,
    periodStart: day(r.settlement_period_start),
    periodEnd: day(r.settlement_period_end),
    dateKey: day(r.paid_at) ?? day(r.settlement_period_end) ?? day(r.created_at) ?? "",
    status,
    statusLabel: STATUS_LABEL[status],
    gross,
    net: Money.fromNumber(r.net_pay as number | null),
    loadNumbers,
    notes: str(r.notes) ?? "",
    readOnly: !engine || status === "approved" || status === "paid" || status === "voided",
  };
}

const PAYSTUB_STATUS: Record<string, string> = { draft: "Draft", issued: "Issued", paid: "Paid", void: "Void", voided: "Void" };

export function paystubToHistory(r: Row, driverName: string): HistoryRow {
  const id = String(r.id);
  const st = (str(r.status) ?? "draft").toLowerCase();
  return {
    kind: "paystub",
    id,
    href: `/payroll/${id}`,
    number: str(r.paystub_number),
    driverId: str(r.driver_id),
    driverName,
    periodStart: day(r.pay_period_start),
    periodEnd: day(r.pay_period_end),
    dateKey: day(r.check_date) ?? day(r.pay_period_end) ?? day(r.created_at) ?? "",
    status: `paystub_${st}`,
    statusLabel: PAYSTUB_STATUS[st] ?? st,
    gross: Money.fromNumber(r.gross_earnings as number | null),
    net: Money.fromNumber(r.net_pay as number | null),
    loadNumbers: [],
    notes: str(r.notes) ?? "",
    readOnly: true,
  };
}

export interface HistoryFilters {
  q?: string;
  driverId?: string;
  status?: string;
  kind?: HistoryKind | "";
  from?: string;
  to?: string;
  sort?: "newest" | "oldest" | "net_desc" | "net_asc";
}

export function filterHistory(rows: HistoryRow[], f: HistoryFilters): HistoryRow[] {
  const terms = (f.q ?? "").toLowerCase().split(/\s+/).filter(Boolean);
  let out = rows.filter((r) => {
    if (f.driverId && r.driverId !== f.driverId) return false;
    if (f.kind && r.kind !== f.kind) return false;
    if (f.status) {
      if (f.status === "legacy") { if (r.kind === "settlement") return false; }
      else if (r.status !== f.status) return false;
    }
    // Overlap with the period, falling back to the date key.
    const start = r.periodStart ?? r.dateKey;
    const end = r.periodEnd ?? r.dateKey;
    if (f.from && end && end < f.from) return false;
    if (f.to && start && start > f.to) return false;
    if (terms.length > 0) {
      const hay = [
        r.number ?? "", r.driverName, r.statusLabel, r.notes, r.net.toFixed2(), r.net.format(),
        r.gross.toFixed2(), r.periodStart ?? "", r.periodEnd ?? "", ...r.loadNumbers,
        r.kind === "paystub" ? "paystub legacy" : r.kind === "legacy_settlement" ? "legacy" : "settlement",
      ].join(" ").toLowerCase();
      if (!terms.every((t) => hay.includes(t.replace(/^#/, "")))) return false;
    }
    return true;
  });
  const sort = f.sort ?? "newest";
  out = [...out].sort((a, b) => {
    if (sort === "net_desc") return Money.compare(b.net, a.net);
    if (sort === "net_asc") return Money.compare(a.net, b.net);
    const c = a.dateKey.localeCompare(b.dateKey);
    return sort === "oldest" ? c : -c;
  });
  return out;
}

/** Paid out = settlements approved/paid + paystubs issued/paid. Voids never count. */
export function historyTotals(rows: HistoryRow[]): { count: number; paidOut: Money; open: Money } {
  let paidOut = Money.zero;
  let open = Money.zero;
  for (const r of rows) {
    if (r.status === "approved" || r.status === "paid" || r.status === "paystub_issued" || r.status === "paystub_paid") paidOut = paidOut.plus(r.net);
    else if (r.status === "draft" || r.status === "ready_for_review" || r.status === "paystub_draft") open = open.plus(r.net);
  }
  return { count: rows.length, paidOut: paidOut.rounded(), open: open.rounded() };
}
