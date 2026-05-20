// =============================================================================
//  CSV helpers — Carrier HQ Phase W6
// -----------------------------------------------------------------------------
//  RFC 4180-compliant CSV emit. Pure functions only — safe in Edge runtime.
//
//  Why hand-rolled instead of a library:
//    • Cloudflare Pages Edge ships nothing CSV-related; pulling in a npm
//      package costs cold-start + bundle weight for ~20 lines of logic.
//    • The full RFC 4180 rules we actually need are: quote any field that
//      contains ", \n, \r, or , — and double-up embedded quotes. That's it.
// =============================================================================

export type CsvCellPrimitive = string | number | boolean | null | undefined;
export type CsvCell = CsvCellPrimitive | Date;

export interface CsvColumn<Row> {
  header: string;
  /** Pulled from `row`. Return any primitive; null/undefined → empty cell. */
  get: (row: Row) => CsvCell;
}

function ymd(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const da = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${da}`;
}

function toCell(v: CsvCell): string {
  if (v === null || v === undefined) return "";
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? "" : ymd(v);
  if (typeof v === "boolean") return v ? "true" : "false";
  if (typeof v === "number") {
    if (!Number.isFinite(v)) return "";
    return String(v);
  }
  return v;
}

function quoteIfNeeded(s: string): string {
  if (s.includes('"') || s.includes(",") || s.includes("\n") || s.includes("\r")) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

/**
 * Assemble rows + columns into a single CSV string. Always emits the header
 * row first. Uses CRLF line terminators (RFC 4180) so Excel on Windows /
 * QuickBooks Desktop parse cleanly without manual import-wizard fiddling.
 */
export function buildCsv<Row>(
  rows: ReadonlyArray<Row>,
  columns: ReadonlyArray<CsvColumn<Row>>
): string {
  const out: string[] = [];
  out.push(columns.map((c) => quoteIfNeeded(c.header)).join(","));
  for (const row of rows) {
    const line = columns
      .map((c) => quoteIfNeeded(toCell(c.get(row))))
      .join(",");
    out.push(line);
  }
  // Trailing CRLF so the file ends on a newline (common spreadsheet expectation).
  return out.join("\r\n") + "\r\n";
}

/**
 * Wrap a CSV string in the headers + body shape that a Next.js Route Handler
 * returns. Adds a Content-Disposition so the browser triggers a download
 * instead of rendering the CSV as text.
 *
 * Adds the Excel-friendly UTF-8 BOM so non-ASCII vendor names (e.g. brokers
 * with accents) survive Excel for Windows' default decoding.
 */
export function csvResponse(filename: string, csv: string): Response {
  const body = "﻿" + csv;
  return new Response(body, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
