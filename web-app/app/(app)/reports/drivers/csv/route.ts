// =============================================================================
//  /reports/drivers/csv — Carrier HQ Phase W6
// =============================================================================

import { NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { resolveRange } from "@/lib/reports/range";
import { buildCsv, csvResponse, type CsvColumn } from "@/lib/reports/csv";
import { fetchDriverEarningsReport, type DriverEarningsRow } from "../data";

export const runtime = "edge";

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const range = resolveRange({
    preset: sp.get("preset") ?? undefined,
    from:   sp.get("from")   ?? undefined,
    to:     sp.get("to")     ?? undefined,
  });

  const supabase = await createClient();
  const report = await fetchDriverEarningsReport(supabase, range);

  const columns: CsvColumn<DriverEarningsRow>[] = [
    { header: "Driver",       get: (r) => r.driver_name },
    { header: "Worker type",  get: (r) => r.worker_type },
    { header: "Active",       get: (r) => r.active },
    { header: "Loads",        get: (r) => r.load_count },
    { header: "Miles",        get: (r) => r.miles },
    { header: "Revenue",      get: (r) => r.revenue },
    { header: "Revenue / mi", get: (r) => Number.isFinite(r.rev_per_mile) ? r.rev_per_mile : 0 },
    { header: "Paystubs",     get: (r) => r.paystubs },
    { header: "Gross paid",   get: (r) => r.gross_paid },
    { header: "Net paid",     get: (r) => r.net_paid },
    { header: "Pay ratio",    get: (r) => Number.isFinite(r.pay_ratio) ? r.pay_ratio : 0 },
  ];

  const csv = buildCsv(report.rows, columns);
  const filename = `driver_earnings_${range.from}_to_${range.to}.csv`;
  return csvResponse(filename, csv);
}
