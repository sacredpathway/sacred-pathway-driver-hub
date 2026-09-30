// =============================================================================
//  PeriodToggles — quick-pick period control for the dashboard
// -----------------------------------------------------------------------------
//  Same five presets and same URLs as before (?preset=…); restyled as a
//  segmented control in Phase A. No client JS — plain Links.
// =============================================================================

import Link from "next/link";
import type { RangePresetId } from "@/lib/reports/range";

export const DASHBOARD_PERIOD_TOGGLES: ReadonlyArray<{ id: RangePresetId; label: string }> = [
  { id: "this_week", label: "This week" },
  { id: "last_week", label: "Last week" },
  { id: "this_month", label: "This month" },
  { id: "last_month", label: "Last month" },
  { id: "all_time", label: "All time" },
];

export default function PeriodToggles({ selected }: { selected: RangePresetId }) {
  return (
    <nav aria-label="Dashboard period" className="max-w-full print:hidden">
      <ul className="flex gap-1 overflow-x-auto rounded-xl border border-white/[0.08] bg-white/[0.02] p-1 [scrollbar-width:none]">
        {DASHBOARD_PERIOD_TOGGLES.map((t) => {
          const isActive = t.id === selected;
          return (
            <li key={t.id} className="shrink-0">
              <Link
                href={`/dashboard?preset=${t.id}`}
                replace
                scroll={false}
                aria-current={isActive ? "page" : undefined}
                className={
                  "inline-flex h-9 items-center rounded-lg px-3 text-xs font-semibold transition-colors " +
                  (isActive
                    ? "bg-sp-gold text-sp-black"
                    : "text-sp-textSecondary hover:bg-white/[0.06] hover:text-sp-textPrimary")
                }
              >
                {t.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
