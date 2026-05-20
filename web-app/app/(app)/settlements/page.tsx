// =============================================================================
//  /settlements — Carrier HQ Phase W7
// -----------------------------------------------------------------------------
//  Read-only carrier-side ledger of every settlement event in the account.
//  Source: v_payroll_unified — same SQL view /reports/payroll reads from.
//  Rows have:
//    source = 'paystub'           → row was created by the web Payroll editor
//    source = 'legacy_settlement' → row was created by the iOS settlement flow
//
//  The view filters out legacy settlements that have been linked to a paystub
//  (settlements.paystub_id IS NOT NULL) so converted rows don't double-count.
// =============================================================================

import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import EmptyState from "@/components/EmptyState";
import { formatCurrency, formatDate } from "@/lib/format";
import type { PayrollUnifiedRow, Driver } from "@/lib/supabase/types";

export const runtime = "edge";

interface Filters {
  source?: "paystub" | "legacy_settlement";
  status?: string;
  from?: string;
  to?: string;
}

export default async function SettlementsPage({
  searchParams,
}: {
  searchParams: Promise<{
    source?: string;
    status?: string;
    from?: string;
    to?: string;
    converted?: string;
  }>;
}) {
  const sp = await searchParams;
  const filters: Filters = {
    source: sp.source === "paystub" || sp.source === "legacy_settlement"
      ? sp.source
      : undefined,
    status: sp.status || undefined,
    from:   sp.from   || undefined,
    to:     sp.to     || undefined,
  };

  const supabase = await createClient();

  const { data: rowsRaw, error } = await supabase
    .from("v_payroll_unified")
    .select("*")
    .order("check_date", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false });

  if (error) {
    return (
      <div className="rounded-lg border border-sp-danger/40 bg-sp-danger/10 p-4 text-sm text-sp-danger">
        {error.message}
      </div>
    );
  }

  let rows = (rowsRaw ?? []) as PayrollUnifiedRow[];

  // Apply filters in-memory (the view is per-carrier already; the dataset
  // is tiny relative to the cost of a more complex .or() chain).
  if (filters.source) {
    rows = rows.filter((r) => r.source === filters.source);
  }
  if (filters.status) {
    rows = rows.filter((r) => (r.status ?? "") === filters.status);
  }
  if (filters.from) {
    rows = rows.filter((r) => {
      const d = r.check_date ?? (r.created_at ?? "").slice(0, 10);
      return d >= filters.from!;
    });
  }
  if (filters.to) {
    rows = rows.filter((r) => {
      const d = r.check_date ?? (r.created_at ?? "").slice(0, 10);
      return d <= filters.to!;
    });
  }

  // Resolve driver names once
  const driverIds = new Set<string>();
  for (const r of rows) if (r.driver_id) driverIds.add(r.driver_id);
  let driverNameById = new Map<string, string>();
  if (driverIds.size > 0) {
    const { data: dRaw } = await supabase
      .from("drivers")
      .select("id, name")
      .in("id", [...driverIds]);
    for (const d of (dRaw ?? []) as Array<Pick<Driver, "id" | "name">>) {
      driverNameById.set(d.id, d.name);
    }
  }

  // Distinct status values for the filter dropdown
  const statusSet = new Set<string>();
  for (const r of (rowsRaw ?? []) as PayrollUnifiedRow[]) {
    if (r.status) statusSet.add(r.status);
  }
  const statuses = [...statusSet].sort();

  const totalNet = rows.reduce((s, r) => s + (r.net_pay ?? 0), 0);

  const anyFilter = !!(filters.source || filters.status || filters.from || filters.to);

  return (
    <section className="space-y-5">
      <header className="flex items-baseline justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Settlements</h1>
          <p className="mt-1 text-xs text-sp-textSecondary">
            Every paystub + legacy iOS settlement in this carrier account.
            Read-only here — edit web paystubs from Payroll.
          </p>
        </div>
        <span className="text-xs text-sp-textSecondary">
          {rows.length} {rows.length === 1 ? "row" : "rows"} · {formatCurrency(totalNet)} net
        </span>
      </header>

      {sp.converted && (
        <div className="rounded-md border border-sp-success/40 bg-sp-success/10 px-3 py-2 text-sm text-sp-success">
          Settlement converted to a draft paystub.
        </div>
      )}

      <FilterBar filters={filters} statuses={statuses} active={anyFilter} />

      {(rowsRaw ?? []).length === 0 ? (
        <EmptyState
          title="No settlements yet"
          body="Generate one in Payroll, or settle a load in the iPhone app — both surface here."
        />
      ) : rows.length === 0 ? (
        <EmptyState
          title="No settlements match those filters"
          body="Try clearing one of the filters above."
        />
      ) : (
        <div className="overflow-x-auto rounded-xl border border-white/5">
          <table className="min-w-full divide-y divide-white/5 text-sm">
            <thead className="bg-sp-card text-left text-[11px] uppercase tracking-wide text-sp-textSecondary">
              <tr>
                <th className="px-3 py-3">Driver</th>
                <th className="px-3 py-3">Period</th>
                <th className="px-3 py-3">Check</th>
                <th className="px-3 py-3">Source</th>
                <th className="px-3 py-3">Worker</th>
                <th className="px-3 py-3">Status</th>
                <th className="px-3 py-3 text-right">Gross</th>
                <th className="px-3 py-3 text-right">Net</th>
                <th className="px-3 py-3 text-right"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5 bg-sp-card/30">
              {rows.map((r) => (
                <tr key={`${r.source}-${r.id}`} className="hover:bg-white/5">
                  <td className="px-3 py-2 font-medium text-sp-textPrimary">
                    {r.driver_id
                      ? driverNameById.get(r.driver_id) ?? "Unknown driver"
                      : "Unassigned"}
                  </td>
                  <td className="px-3 py-2 text-sp-textSecondary">
                    {formatDate(r.pay_period_start)} → {formatDate(r.pay_period_end)}
                  </td>
                  <td className="px-3 py-2 text-sp-textSecondary">{formatDate(r.check_date)}</td>
                  <td className="px-3 py-2">
                    <SourcePill source={r.source} />
                  </td>
                  <td className="px-3 py-2 text-sp-textSecondary">{r.worker_type}</td>
                  <td className="px-3 py-2 text-sp-textSecondary">{r.status ?? "—"}</td>
                  <td className="px-3 py-2 text-right text-sp-textSecondary">
                    {formatCurrency(r.gross_earnings)}
                  </td>
                  <td className="px-3 py-2 text-right font-semibold text-sp-gold">
                    {formatCurrency(r.net_pay)}
                  </td>
                  <td className="px-3 py-2 text-right">
                    <Link
                      href={`/settlements/${r.id}`}
                      className="inline-flex items-center rounded-md border border-white/10 px-2 py-1 text-[10px] font-medium text-sp-textPrimary hover:bg-white/5"
                    >
                      Open
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

// -----------------------------------------------------------------------------
// Pieces
// -----------------------------------------------------------------------------

function SourcePill({ source }: { source: "paystub" | "legacy_settlement" }) {
  const isPaystub = source === "paystub";
  return (
    <span
      className={
        "inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide " +
        (isPaystub
          ? "bg-sp-gold/15 text-sp-gold"
          : "bg-sp-greenAccent/15 text-sp-greenAccent")
      }
    >
      {isPaystub ? "Paystub" : "Legacy"}
    </span>
  );
}

function FilterBar({
  filters,
  statuses,
  active,
}: {
  filters: Filters;
  statuses: ReadonlyArray<string>;
  active: boolean;
}) {
  return (
    <form
      method="get"
      action="/settlements"
      className="space-y-3 rounded-xl border border-white/5 bg-sp-card p-4"
    >
      <header className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-sp-textPrimary">Filter</h2>
        {active && (
          <Link href="/settlements" className="text-xs text-sp-gold hover:underline">
            Clear all
          </Link>
        )}
      </header>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-5">
        <label className="block space-y-1">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-sp-textSecondary">
            Source
          </span>
          <select
            name="source"
            defaultValue={filters.source ?? ""}
            className="w-full rounded-lg bg-sp-cardLight px-3 py-2 text-sm text-sp-textPrimary outline-none ring-1 ring-white/5 focus:ring-sp-gold"
          >
            <option value="">All sources</option>
            <option value="paystub">Paystub (web)</option>
            <option value="legacy_settlement">Legacy (iOS)</option>
          </select>
        </label>

        <label className="block space-y-1">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-sp-textSecondary">
            Status
          </span>
          <select
            name="status"
            defaultValue={filters.status ?? ""}
            className="w-full rounded-lg bg-sp-cardLight px-3 py-2 text-sm text-sp-textPrimary outline-none ring-1 ring-white/5 focus:ring-sp-gold"
          >
            <option value="">All statuses</option>
            {statuses.map((s) => (
              <option key={s} value={s}>{s}</option>
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
            defaultValue={filters.from ?? ""}
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
            defaultValue={filters.to ?? ""}
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
    </form>
  );
}
