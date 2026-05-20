// =============================================================================
//  /reports/cpa/csv — Carrier HQ Phase W6
// -----------------------------------------------------------------------------
//  Emits a single CSV with multiple "tables" stacked under section headers.
//  Excel + Google Sheets handle this fine; the CPA can import directly.
//  Sections:
//    1. P&L summary  (label, value)
//    2. Revenue by broker
//    3. Expenses by category
// =============================================================================

import { NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { resolveRange } from "@/lib/reports/range";
import { csvResponse } from "@/lib/reports/csv";
import { fetchCpaReport } from "../data";

export const runtime = "edge";

// Hand-rolled escape (instead of pulling buildCsv) so each section can use
// its own column shape without invoking the generic builder N times.
function esc(v: unknown): string {
  if (v === null || v === undefined) return "";
  const s = String(v);
  if (s.includes('"') || s.includes(",") || s.includes("\n") || s.includes("\r")) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function row(...cells: unknown[]): string {
  return cells.map(esc).join(",");
}

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const range = resolveRange({
    preset: sp.get("preset") ?? undefined,
    from:   sp.get("from")   ?? undefined,
    to:     sp.get("to")     ?? undefined,
  });

  const supabase = await createClient();
  const report = await fetchCpaReport(supabase, range);

  const lines: string[] = [];

  // ---------- Header block ----------
  lines.push(row("Sacred Pathway Driver Hub — CPA Export"));
  lines.push(row("Range", range.label));
  lines.push("");

  // ---------- 1. P&L ----------
  lines.push(row("P&L SUMMARY"));
  lines.push(row("Line", "Amount"));
  lines.push(row("Revenue",            report.totals.revenue));
  lines.push(row("Total expenses",     report.totals.expenses));
  lines.push(row("Operating profit",   report.totals.operating_profit));
  lines.push(row("Driver pay (net)",   report.totals.paystub_net));
  lines.push(row("Carrier net",        report.totals.carrier_net));
  lines.push(row("Loads",              report.totals.load_count));
  lines.push(row("Miles",              report.totals.miles));
  lines.push(row("Fuel spend",         report.totals.fuel_total));
  lines.push(row("Paystub gross",      report.totals.paystub_gross));
  lines.push(row("Deductible miles",   report.totals.deductible_miles));
  lines.push("");

  // ---------- 2. Revenue by broker ----------
  lines.push(row("REVENUE BY BROKER"));
  lines.push(row("Broker", "Loads", "Miles", "Revenue", "Avg revenue/load", "Revenue / mi"));
  for (const b of report.revenue_by_broker) {
    lines.push(row(b.broker_name, b.load_count, b.miles, b.revenue, b.avg_revenue, b.rev_per_mile));
  }
  lines.push("");

  // ---------- 3. Expenses by category ----------
  lines.push(row("EXPENSES BY CATEGORY"));
  lines.push(row("Category", "Entries", "Total", "Gallons", "Avg $/gal", "DEF total"));
  for (const e of report.expenses_by_category) {
    lines.push(row(e.category, e.count, e.total, e.gallons, e.avg_price_per_gallon, e.def_total));
  }

  const csv = lines.join("\r\n") + "\r\n";
  const filename = `cpa_export_${range.from}_to_${range.to}.csv`;
  return csvResponse(filename, csv);
}
