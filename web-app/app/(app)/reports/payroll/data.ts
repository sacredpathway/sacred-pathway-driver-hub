// =============================================================================
//  Payroll report — shared data fetch + aggregation
// -----------------------------------------------------------------------------
//  Used by /reports/payroll, /reports/payroll/csv, /reports/payroll/print.
//  Pulling the calc into one module guarantees the screen, the CSV, and the
//  PDF agree number-for-number.
//
//  Source: v_payroll_unified — unions web `paystubs` with legacy iOS
//  `settlements`, filtering out double-counts. Same view the /payroll list
//  reads from in Phase W7.
// =============================================================================

import type { SupabaseClient } from "@supabase/supabase-js";
import type { PayrollUnifiedRow, Driver } from "@/lib/supabase/types";
import type { ResolvedRange } from "@/lib/reports/range";

export interface PayrollRow extends PayrollUnifiedRow {
  driver_name: string;
}

export interface DriverGroup {
  driver_id: string | null;
  driver_name: string;
  rows: PayrollRow[];
  count: number;
  gross_total: number;
  taxes_total: number;
  pretax_total: number;
  posttax_total: number;
  settlement_total: number;
  net_total: number;
}

export interface PayrollReport {
  range: ResolvedRange;
  rows: PayrollRow[];
  groups: DriverGroup[];
  totals: {
    count: number;
    gross: number;
    taxes: number;
    pretax: number;
    posttax: number;
    settlement: number;
    net: number;
  };
}

export async function fetchPayrollReport(
  supabase: SupabaseClient,
  range: ResolvedRange
): Promise<PayrollReport> {
  // Filter on check_date when present; fall back to created_at so legacy
  // settlement rows (which can be missing check_date) still surface.
  const { data: rowsRaw } = await supabase
    .from("v_payroll_unified")
    .select("*")
    .or(
      `and(check_date.gte.${range.from},check_date.lte.${range.to}),` +
      `and(check_date.is.null,created_at.gte.${range.from}T00:00:00.000Z,created_at.lte.${range.to}T23:59:59.999Z)`
    )
    .order("check_date", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false });

  const unified = (rowsRaw ?? []) as PayrollUnifiedRow[];

  const driverIds = new Set<string>();
  for (const r of unified) if (r.driver_id) driverIds.add(r.driver_id);

  let driverNameById = new Map<string, string>();
  if (driverIds.size > 0) {
    const { data: dRaw } = await supabase
      .from("drivers")
      .select("id, name")
      .in("id", [...driverIds]);
    for (const d of (dRaw ?? []) as Array<Pick<Driver, "id" | "name">>) {
      driverNameById.set(d.id, d.name);
    }
  }

  const rows: PayrollRow[] = unified.map((r) => ({
    ...r,
    driver_name: r.driver_id
      ? driverNameById.get(r.driver_id) ?? "Unknown driver"
      : "Unassigned",
  }));

  // Group by driver
  const groupMap = new Map<string, DriverGroup>();
  for (const r of rows) {
    const key = r.driver_id ?? "__none__";
    let g = groupMap.get(key);
    if (!g) {
      g = {
        driver_id: r.driver_id,
        driver_name: r.driver_name,
        rows: [],
        count: 0,
        gross_total: 0,
        taxes_total: 0,
        pretax_total: 0,
        posttax_total: 0,
        settlement_total: 0,
        net_total: 0,
      };
      groupMap.set(key, g);
    }
    g.rows.push(r);
    g.count += 1;
    g.gross_total      += r.gross_earnings ?? 0;
    g.taxes_total      += r.total_taxes_withheld ?? 0;
    g.pretax_total     += r.total_pretax_deductions ?? 0;
    g.posttax_total    += r.total_posttax_deductions ?? 0;
    g.settlement_total += r.total_settlement_deductions ?? 0;
    g.net_total        += r.net_pay ?? 0;
  }
  const groups = [...groupMap.values()].sort(
    (a, b) => b.net_total - a.net_total
  );

  const totals = groups.reduce(
    (acc, g) => ({
      count:      acc.count      + g.count,
      gross:      acc.gross      + g.gross_total,
      taxes:      acc.taxes      + g.taxes_total,
      pretax:     acc.pretax     + g.pretax_total,
      posttax:    acc.posttax    + g.posttax_total,
      settlement: acc.settlement + g.settlement_total,
      net:        acc.net        + g.net_total,
    }),
    { count: 0, gross: 0, taxes: 0, pretax: 0, posttax: 0, settlement: 0, net: 0 }
  );

  return { range, rows, groups, totals };
}
