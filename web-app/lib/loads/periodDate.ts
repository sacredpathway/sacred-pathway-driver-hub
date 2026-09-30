// =============================================================================
//  Load period attribution — the ONE rule for "which week/period is this load in"
// -----------------------------------------------------------------------------
//  delivery_date  →  pickup_date  →  created_at (UTC calendar day)
//
//  Matches iOS `WeeklyStatsService.windowDate(for:)` / `Load.periodDate`
//  (changed 2026-09-30: loads count in the period they are DELIVERED, falling
//  back to pickup so a load missing a delivery date never vanishes, and to
//  created_at so an undated load still lands somewhere).
//
//  Every web surface that buckets loads by date (dashboard tiles, revenue and
//  driver reports) must go through this module — never compare pickup_date or
//  created_at directly.
//
//  All dates are "YYYY-MM-DD" strings (Postgres DATE / lib/reports/range.ts),
//  so comparisons are plain string compares with no timezone math.
// =============================================================================

export interface LoadDateFields {
  delivery_date?: string | null;
  pickup_date?: string | null;
  created_at?: string | null;
}

export interface DateRange {
  /** inclusive "YYYY-MM-DD" */
  from: string;
  /** inclusive "YYYY-MM-DD" */
  to: string;
}

const YMD = /^\d{4}-\d{2}-\d{2}$/;

/** "2026-09-28" from a DATE or an ISO timestamp; null for anything malformed. */
function toYmd(value: string | null | undefined): string | null {
  if (!value) return null;
  const v = value.trim();
  if (YMD.test(v)) return v;
  // Timestamps: normalise through Date so "+00:00", "Z" and offsets all map
  // to the UTC calendar day (same convention the dashboard used before).
  const t = Date.parse(v);
  if (Number.isNaN(t)) return null;
  return new Date(t).toISOString().slice(0, 10);
}

/** The single date that decides which period a load belongs to. */
export function loadPeriodDate(load: LoadDateFields): string | null {
  return (
    toYmd(load.delivery_date) ??
    toYmd(load.pickup_date) ??
    toYmd(load.created_at)
  );
}

/** Inclusive range test using `loadPeriodDate`. Undated loads are excluded. */
export function loadInRange(load: LoadDateFields, range: DateRange): boolean {
  const d = loadPeriodDate(load);
  if (!d) return false;
  return d >= range.from && d <= range.to;
}

export function filterLoadsByRange<T extends LoadDateFields>(
  loads: ReadonlyArray<T>,
  range: DateRange,
): T[] {
  return loads.filter((l) => loadInRange(l, range));
}

/** Columns a query must select for `loadPeriodDate` to work. */
export const LOAD_PERIOD_COLUMNS = "delivery_date, pickup_date, created_at";

/**
 * PostgREST `.or()` expression that applies the same rule server-side, so a
 * ranged query returns exactly the loads `loadInRange` accepts:
 *
 *   delivery in range
 *   OR (no delivery AND pickup in range)
 *   OR (no delivery AND no pickup AND created_at in range)
 *
 * Callers should still pass results through `filterLoadsByRange` as a
 * belt-and-braces check.
 */
export function loadPeriodOrFilter(range: DateRange): string {
  if (!YMD.test(range.from) || !YMD.test(range.to)) {
    throw new RangeError(`loadPeriodOrFilter: bad range ${range.from}..${range.to}`);
  }
  const { from, to } = range;
  return [
    `and(delivery_date.gte.${from},delivery_date.lte.${to})`,
    `and(delivery_date.is.null,pickup_date.gte.${from},pickup_date.lte.${to})`,
    `and(delivery_date.is.null,pickup_date.is.null,` +
      `created_at.gte.${from}T00:00:00.000Z,created_at.lte.${to}T23:59:59.999Z)`,
  ].join(",");
}
