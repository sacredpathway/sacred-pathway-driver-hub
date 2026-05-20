// =============================================================================
//  /reports/payroll/csv — Carrier HQ Phase W6
// -----------------------------------------------------------------------------
//  Returns text/csv of every paystub/settlement row in the requested range.
//  Columns mirror what an accountant or QuickBooks importer will recognize.
// =============================================================================

import { NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { resolveRange } from "@/lib/reports/range";
import { buildCsv, csvResponse, type CsvColumn } from "@/lib/reports/csv";
import { fetchPayrollReport, type PayrollRow } from "../data";

export const runtime = "edge";

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const range = resolveRange({
    preset: sp.get("preset") ?? undefined,
    from:   sp.get("from")   ?? undefined,
    to:     sp.get("to")     ?? undefined,
  });

  const supabase = await createClient();
  const report = await fetchPayrollReport(supabase, range);

  const columns: CsvColumn<PayrollRow>[] = [
    { header: "Driver",                 get: (r) => r.driver_name },
    { header: "Worker type",            get: (r) => r.worker_type },
    { header: "Source",                 get: (r) => r.source === "paystub" ? "Paystub" : "Settlement" },
    { header: "Paystub #",              get: (r) => r.paystub_number },
    { header: "Pay period start",       get: (r) => r.pay_period_start },
    { header: "Pay period end",         get: (r) => r.pay_period_end },
    { header: "Check date",             get: (r) => r.check_date },
    { header: "Status",                 get: (r) => r.status },
    { header: "Payment method",         get: (r) => r.payment_method },
    { header: "Gross earnings",         get: (r) => r.gross_earnings },
    { header: "Taxes withheld",         get: (r) => r.total_taxes_withheld },
    { header: "Pre-tax deductions",     get: (r) => r.total_pretax_deductions },
    { header: "Post-tax deductions",    get: (r) => r.total_posttax_deductions },
    { header: "Settlement deductions",  get: (r) => r.total_settlement_deductions },
    { header: "Net pay",                get: (r) => r.net_pay },
  ];

  const csv = buildCsv(report.rows, columns);
  const filename = `payroll_${range.from}_to_${range.to}.csv`;
  return csvResponse(filename, csv);
}
