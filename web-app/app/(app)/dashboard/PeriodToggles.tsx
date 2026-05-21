// =============================================================================
//  PeriodToggles — quick-pick buttons for the dashboard date range
// -----------------------------------------------------------------------------
//  Five presets the carrier reaches for most often, surfaced as a button row
//  near the dashboard header. Each is a plain Link that writes ?preset=… to
//  the URL. The dashboard server component re-resolves the range and the
//  Revenue / Expenses / Loads / Miles tiles recompute on the next render.
//
//  - No client JS. Hover/active state is pure CSS.
//  - "Custom" + the existing PeriodFilter card below this row are preserved;
//    if the URL has preset=custom (or arbitrary from/to), none of these
//    toggles highlight as selected.
//  - Active Drivers + Pending Payroll tiles are intentionally scope-wide
//    and don't respond to the period filter (documented in the
//    PeriodFilter hint copy).
// =============================================================================

import Link from "next/link";
import type { RangePresetId } from "@/lib/reports/range";

const TOGGLES: ReadonlyArray<{ id: RangePresetId; label: string }> = [
  { id: "this_week",  label: "This week"  },
  { id: "last_week",  label: "Last week"  },
  { id: "this_month", label: "This month" },
  { id: "last_month", label: "Last month" },
  { id: "all_time",   label: "All time"   },
];

export default function PeriodToggles({
  selected,
}: {
  /** Active preset id resolved from the URL. */
  selected: RangePresetId;
}) {
  return (
    <nav
      aria-label="Dashboard period"
      className="flex flex-wrap items-center gap-1.5 print:hidden"
    >
      {TOGGLES.map((t) => {
        const isActive = t.id === selected;
        return (
          <Link
            key={t.id}
            href={`/dashboard?preset=${t.id}`}
            // Replace history rather than push so the back button works
            // intuitively (returns to the page the carrier came from, not
            // through a stack of preset clicks).
            replace
            scroll={false}
            aria-current={isActive ? "page" : undefined}
            className={
              "rounded-md px-3 py-1.5 text-xs font-medium transition " +
              (isActive
                ? "bg-sp-gold text-sp-black hover:bg-sp-goldLight"
                : "border border-white/10 text-sp-textSecondary hover:bg-white/5 hover:text-sp-textPrimary")
            }
          >
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}
