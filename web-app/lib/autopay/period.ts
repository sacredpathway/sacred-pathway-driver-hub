// =============================================================================
//  Pay period for an automatic draft (owner decision 2026-10-25)
// -----------------------------------------------------------------------------
//  Default: the Monday–Sunday week containing the load's date (the New
//  Settlement screen's default). The only carrier-specific pay-period setting
//  that exists is drivers.pay_frequency (weekly | biweekly | semimonthly |
//  monthly), and it is honoured when set:
//    weekly       Monday–Sunday
//    semimonthly  1st–15th, 16th–last day of the month
//    monthly      the calendar month
//    biweekly     14-day periods continuing the driver's most recent 14-day
//                 settlement; with no such settlement there is no start date
//                 to continue from, so the draft is HELD (never guessed).
// =============================================================================

import { payWeekFor, type AutoHold } from "./plan";

export interface PeriodSetting {
  frequency: string | null;
  /** Recent settlement periods of this driver (any status except voided), newest first. */
  recent: ReadonlyArray<{ start: string; end: string }>;
}

const DAY = 86_400_000;
const t = (ymd: string) => Date.parse(ymd + "T00:00:00Z");
const f = (ms: number) => new Date(ms).toISOString().slice(0, 10);

function lastDayOfMonth(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate(); // m is 1-based
}

export function payPeriodFor(date: string, s: PeriodSetting): { start: string; end: string } | AutoHold {
  const freq = (s.frequency ?? "").trim().toLowerCase();
  const [y, m, d] = date.split("-").map(Number);
  const mm = String(m).padStart(2, "0");
  switch (freq) {
    case "":
    case "weekly":
      return payWeekFor(date);
    case "semimonthly":
      return d <= 15
        ? { start: `${y}-${mm}-01`, end: `${y}-${mm}-15` }
        : { start: `${y}-${mm}-16`, end: `${y}-${mm}-${String(lastDayOfMonth(y, m)).padStart(2, "0")}` };
    case "monthly":
      return { start: `${y}-${mm}-01`, end: `${y}-${mm}-${String(lastDayOfMonth(y, m)).padStart(2, "0")}` };
    case "biweekly": {
      const anchor = s.recent.find((p) => (t(p.end) - t(p.start)) / DAY === 13);
      if (!anchor) {
        return { code: "pay_period_unknown", message: "This driver is paid every two weeks, but there is no earlier two-week settlement to continue from. Create the first one by hand; later drafts follow it automatically." };
      }
      const k = Math.floor((t(date) - t(anchor.start)) / (14 * DAY));
      const start = t(anchor.start) + k * 14 * DAY;
      return { start: f(start), end: f(start + 13 * DAY) };
    }
    default:
      return { code: "pay_period_unknown", message: `Unrecognised pay frequency "${s.frequency}" on the driver.` };
  }
}
