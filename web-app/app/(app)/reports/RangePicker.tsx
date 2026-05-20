// =============================================================================
//  RangePicker — Carrier HQ Phase W6
// -----------------------------------------------------------------------------
//  Tiny GET-form for selecting the report date range. Submits with method=get
//  so the URL is shareable, the page is cacheable, and the export buttons
//  can read the resolved range straight off the URL.
// =============================================================================

import { RANGE_PRESETS, type ResolvedRange } from "@/lib/reports/range";

export default function RangePicker({
  actionPath,
  range,
}: {
  actionPath: string;
  range: ResolvedRange;
}) {
  return (
    <form
      method="get"
      action={actionPath}
      className="space-y-3 rounded-xl border border-white/5 bg-sp-card p-4 print:hidden"
    >
      <header className="flex items-baseline justify-between">
        <h2 className="text-sm font-semibold text-sp-textPrimary">Range</h2>
        <span className="text-xs text-sp-textSecondary">{range.label}</span>
      </header>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
        <label className="block space-y-1">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-sp-textSecondary">
            Preset
          </span>
          <select
            name="preset"
            defaultValue={range.preset}
            className="w-full rounded-lg bg-sp-cardLight px-3 py-2 text-sm text-sp-textPrimary outline-none ring-1 ring-white/5 focus:ring-sp-gold"
          >
            {RANGE_PRESETS.map((p) => (
              <option key={p.id} value={p.id}>{p.label}</option>
            ))}
          </select>
        </label>

        <label className="block space-y-1">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-sp-textSecondary">
            From
          </span>
          <input
            type="date"
            name="from"
            defaultValue={range.from}
            className="w-full rounded-lg bg-sp-cardLight px-3 py-2 text-sm text-sp-textPrimary outline-none ring-1 ring-white/5 focus:ring-sp-gold"
          />
        </label>

        <label className="block space-y-1">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-sp-textSecondary">
            To
          </span>
          <input
            type="date"
            name="to"
            defaultValue={range.to}
            className="w-full rounded-lg bg-sp-cardLight px-3 py-2 text-sm text-sp-textPrimary outline-none ring-1 ring-white/5 focus:ring-sp-gold"
          />
        </label>

        <div className="flex items-end">
          <button
            type="submit"
            className="w-full rounded-md bg-sp-gold px-4 py-2 text-xs font-semibold text-sp-black hover:bg-sp-goldLight"
          >
            Apply
          </button>
        </div>
      </div>

      <p className="text-[11px] text-sp-textSecondary">
        Tip: pick &quot;Custom&quot; to use the exact From/To dates above; other
        presets ignore those fields.
      </p>
    </form>
  );
}
