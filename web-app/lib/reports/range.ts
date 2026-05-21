// =============================================================================
//  Report date-range helpers — Carrier HQ Phase W6
// -----------------------------------------------------------------------------
//  Every report page accepts ?from=YYYY-MM-DD&to=YYYY-MM-DD&preset=<id>.
//  When `preset` is supplied (and not "custom"), it overrides from/to.
//  Defaults to YTD if nothing supplied, so first-time visitors see useful data.
//
//  All dates are returned as plain "YYYY-MM-DD" strings — matching Postgres
//  DATE columns and the iOS app's SPDate convention. No timezone math: the
//  caller compares against `receipt_date` / `pickup_date` / `check_date`
//  columns which are also DATE.
//
//  Pure functions only — no Supabase, no fetch.
// =============================================================================

export type RangePresetId =
  | "this_week"
  | "last_week"
  | "this_month"
  | "last_month"
  | "this_quarter"
  | "ytd"
  | "last_30"
  | "last_90"
  | "last_year"
  | "all_time"
  | "custom";

export interface ResolvedRange {
  preset: RangePresetId;
  from: string;        // "YYYY-MM-DD"
  to: string;          // "YYYY-MM-DD"
  label: string;       // human-friendly
}

export const RANGE_PRESETS: ReadonlyArray<{
  id: RangePresetId;
  label: string;
}> = [
  { id: "this_week",    label: "This week" },
  { id: "last_week",    label: "Last week" },
  { id: "this_month",   label: "This month" },
  { id: "last_month",   label: "Last month" },
  { id: "this_quarter", label: "This quarter" },
  { id: "ytd",          label: "Year to date" },
  { id: "last_30",      label: "Last 30 days" },
  { id: "last_90",      label: "Last 90 days" },
  { id: "last_year",    label: "Last year" },
  { id: "all_time",     label: "All time" },
  { id: "custom",       label: "Custom" },
];

function ymd(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const da = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${da}`;
}

function utcDate(year: number, month: number, day: number): Date {
  return new Date(Date.UTC(year, month, day));
}

/**
 * Convert a preset into an absolute [from, to] range.
 *
 * - Week: Monday → Sunday (ISO-8601, matches iOS PayWeekService default
 *   `firstWeekday = 2`). Was Sunday-start prior to 2026-05-21; switched to
 *   Monday to keep web "This week" totals identical to iOS for the same
 *   user.
 * - Quarter: Q1 = Jan–Mar, etc.
 * - all_time: returns 1970-01-01 .. today (effectively "no lower bound").
 * - last_30 / last_90 / last_year: rolling windows ending today.
 */
function applyPreset(
  preset: Exclude<RangePresetId, "custom">,
  now: Date = new Date()
): { from: string; to: string } {
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth();
  const d = now.getUTCDate();
  const today = utcDate(y, m, d);
  const todayYmd = ymd(today);

  switch (preset) {
    case "this_week": {
      // ISO-8601 Monday start. JS getUTCDay() returns 0=Sun..6=Sat; convert
      // to 0=Mon..6=Sun by ((dow + 6) % 7), then subtract from today.
      const dow = (today.getUTCDay() + 6) % 7; // Mon=0..Sun=6
      const start = utcDate(y, m, d - dow);
      return { from: ymd(start), to: todayYmd };
    }
    case "last_week": {
      // [last Monday → last Sunday], i.e. the 7 days *before* this_week's start.
      const dow = (today.getUTCDay() + 6) % 7; // Mon=0..Sun=6
      const thisWeekStart = utcDate(y, m, d - dow);
      const start = utcDate(
        thisWeekStart.getUTCFullYear(),
        thisWeekStart.getUTCMonth(),
        thisWeekStart.getUTCDate() - 7
      );
      const end = utcDate(
        thisWeekStart.getUTCFullYear(),
        thisWeekStart.getUTCMonth(),
        thisWeekStart.getUTCDate() - 1
      );
      return { from: ymd(start), to: ymd(end) };
    }
    case "this_month": {
      const start = utcDate(y, m, 1);
      return { from: ymd(start), to: todayYmd };
    }
    case "last_month": {
      // utcDate handles month wrap when m=0 → previous year, month=11.
      const start = utcDate(y, m - 1, 1);
      // Day 0 of the current month is the last day of the previous month.
      const end = utcDate(y, m, 0);
      return { from: ymd(start), to: ymd(end) };
    }
    case "this_quarter": {
      const qStartMonth = Math.floor(m / 3) * 3;
      const start = utcDate(y, qStartMonth, 1);
      return { from: ymd(start), to: todayYmd };
    }
    case "ytd": {
      const start = utcDate(y, 0, 1);
      return { from: ymd(start), to: todayYmd };
    }
    case "last_30": {
      const start = utcDate(y, m, d - 29);
      return { from: ymd(start), to: todayYmd };
    }
    case "last_90": {
      const start = utcDate(y, m, d - 89);
      return { from: ymd(start), to: todayYmd };
    }
    case "last_year": {
      const start = utcDate(y - 1, 0, 1);
      const end   = utcDate(y - 1, 11, 31);
      return { from: ymd(start), to: ymd(end) };
    }
    case "all_time": {
      return { from: "1970-01-01", to: todayYmd };
    }
  }
}

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Normalize raw URL query into a ResolvedRange the report can trust.
 * Bad inputs fall back to YTD silently so reports always render something.
 */
export function resolveRange(searchParams: {
  from?: string;
  to?: string;
  preset?: string;
}): ResolvedRange {
  const presetId = (searchParams.preset ?? "") as RangePresetId;

  // Custom: trust from/to if both look valid; else fall back to ytd.
  if (presetId === "custom") {
    const f = searchParams.from?.trim() ?? "";
    const t = searchParams.to?.trim()   ?? "";
    if (ISO_DATE_RE.test(f) && ISO_DATE_RE.test(t)) {
      const [a, b] = f <= t ? [f, t] : [t, f]; // sort defensively
      return { preset: "custom", from: a, to: b, label: `${a} → ${b}` };
    }
    // bad custom — fall through to the default below
  }

  const known = RANGE_PRESETS.find((p) => p.id === presetId);
  const resolved = known && presetId !== "custom"
    ? applyPreset(presetId as Exclude<RangePresetId, "custom">)
    : applyPreset("ytd");

  const id: RangePresetId = known && presetId !== "custom" ? presetId : "ytd";
  const label = id === "ytd"
    ? `Year to date (${resolved.from} → ${resolved.to})`
    : (RANGE_PRESETS.find((p) => p.id === id)?.label ?? "Range") +
      ` (${resolved.from} → ${resolved.to})`;

  return { preset: id, from: resolved.from, to: resolved.to, label };
}

/**
 * Build a querystring suitable for an Apply-Filters form action redirect, an
 * <a>, or CSV/Print links: `?preset=ytd&from=2026-01-01&to=2026-05-20`.
 */
export function rangeToSearch(range: ResolvedRange): string {
  const sp = new URLSearchParams();
  sp.set("preset", range.preset);
  sp.set("from", range.from);
  sp.set("to", range.to);
  return sp.toString();
}
