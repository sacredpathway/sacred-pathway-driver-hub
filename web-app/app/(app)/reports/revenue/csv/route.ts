// =============================================================================
//  /reports/revenue/csv — Carrier HQ Phase W6
// =============================================================================

import { NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { resolveRange } from "@/lib/reports/range";
import { buildCsv, csvResponse, type CsvColumn } from "@/lib/reports/csv";
import { fetchRevenueReport, type RevenueRow } from "../data";

export const runtime = "edge";

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const range = resolveRange({
    preset: sp.get("preset") ?? undefined,
    from:   sp.get("from")   ?? undefined,
    to:     sp.get("to")     ?? undefined,
  });

  const supabase = await createClient();
  const report = await fetchRevenueReport(supabase, range);

  const columns: CsvColumn<RevenueRow>[] = [
    { header: "Broker",          get: (r) => r.broker_name },
    { header: "Loads",           get: (r) => r.load_count },
    { header: "Miles",           get: (r) => r.miles },
    { header: "Revenue",         get: (r) => r.revenue },
    { header: "Avg revenue/load",get: (r) => r.avg_revenue },
    { header: "Revenue / mi",    get: (r) => Number.isFinite(r.rev_per_mile) ? r.rev_per_mile : 0 },
  ];

  const csv = buildCsv(report.rows, columns);
  const filename = `revenue_${range.from}_to_${range.to}.csv`;
  return csvResponse(filename, csv);
}
