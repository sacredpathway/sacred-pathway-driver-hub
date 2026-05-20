// =============================================================================
//  /reports/expenses/csv — Carrier HQ Phase W6
// =============================================================================

import { NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { resolveRange } from "@/lib/reports/range";
import { buildCsv, csvResponse, type CsvColumn } from "@/lib/reports/csv";
import { fetchExpenseReport, type ExpenseCategoryRow } from "../data";

export const runtime = "edge";

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const range = resolveRange({
    preset: sp.get("preset") ?? undefined,
    from:   sp.get("from")   ?? undefined,
    to:     sp.get("to")     ?? undefined,
  });

  const supabase = await createClient();
  const report = await fetchExpenseReport(supabase, range);

  const columns: CsvColumn<ExpenseCategoryRow>[] = [
    { header: "Category",     get: (r) => r.category },
    { header: "Entries",      get: (r) => r.count },
    { header: "Total",        get: (r) => r.total },
    { header: "Gallons",      get: (r) => r.gallons },
    { header: "Avg $/gal",    get: (r) => r.avg_price_per_gallon },
    { header: "DEF total",    get: (r) => r.def_total },
  ];

  const csv = buildCsv(report.rows, columns);
  const filename = `expenses_${range.from}_to_${range.to}.csv`;
  return csvResponse(filename, csv);
}
