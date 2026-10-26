// =============================================================================
//  /payroll — Payroll History
// -----------------------------------------------------------------------------
//  Every past payroll in one searchable list: live settlements (web + iPhone),
//  older iPhone settlements, and retired web paystubs (read-only legacy).
//  Search matches settlement / paystub number, driver, load numbers, notes and
//  amounts. New payroll is created from Settlements.
// =============================================================================

import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import EmptyState from "@/components/EmptyState";
import GustoLinkButton from "@/components/GustoLinkButton";
import {
  filterHistory, historyTotals, paystubToHistory, settlementToHistory,
  type HistoryFilters, type HistoryKind, type HistoryRow,
} from "@/lib/settlements/history";
import { STATUS_LABEL, SETTLEMENT_STATUSES } from "@/lib/settlements/model";
import { formatDate } from "@/lib/format";

const PAGE_SIZE = 50;

export default async function PayrollHistoryPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  const filters: HistoryFilters = {
    q: (sp.q ?? "").slice(0, 100),
    driverId: sp.driver || undefined,
    status: sp.status || undefined,
    kind: (["settlement", "legacy_settlement", "paystub"].includes(sp.kind ?? "") ? sp.kind : "") as HistoryKind | "",
    from: /^\d{4}-\d{2}-\d{2}$/.test(sp.from ?? "") ? sp.from : undefined,
    to: /^\d{4}-\d{2}-\d{2}$/.test(sp.to ?? "") ? sp.to : undefined,
    sort: (["newest", "oldest", "net_desc", "net_asc"].includes(sp.sort ?? "") ? sp.sort : "newest") as HistoryFilters["sort"],
  };
  const page = Math.max(1, Math.min(1000, Number(sp.page) || 1));

  const supabase = await createClient();
  const [sRes, pRes, dRes] = await Promise.all([
    supabase.from("settlements").select(
      "id, driver_id, settlement_number, settlement_period_start, settlement_period_end, status, net_pay, " +
      "gross_load_revenue, total_revenue, notes, paid_at, created_at, engine_version, is_estimate, paystub_id",
    ).order("settlement_period_end", { ascending: false, nullsFirst: false }).limit(5000),
    supabase.from("paystubs").select(
      "id, driver_id, paystub_number, pay_period_start, pay_period_end, check_date, status, gross_earnings, net_pay, notes, created_at",
    ).order("pay_period_end", { ascending: false }).limit(5000),
    supabase.from("drivers").select("id, name").order("name"),
  ]);
  const error = sRes.error ?? pRes.error;
  if (error) {
    return <div className="rounded-lg border border-sp-danger/40 bg-sp-danger/10 p-4 text-sm text-sp-danger">{error.message}</div>;
  }

  const drivers = (dRes.data ?? []) as Array<{ id: string; name: string }>;
  const nameOf = new Map(drivers.map((d) => [d.id, d.name]));
  const settlements = (sRes.data ?? []) as unknown as Array<Record<string, unknown>>;

  // Load numbers for search (one query, chunked).
  const sids = settlements.map((s) => String(s.id));
  const loadNums = new Map<string, string[]>();
  for (let i = 0; i < sids.length; i += 200) {
    const { data } = await supabase.from("settlement_loads").select("settlement_id, load_number").in("settlement_id", sids.slice(i, i + 200));
    for (const l of (data ?? []) as Array<{ settlement_id: string; load_number: string | null }>) {
      if (!l.load_number) continue;
      const arr = loadNums.get(l.settlement_id) ?? [];
      arr.push(l.load_number);
      loadNums.set(l.settlement_id, arr);
    }
  }

  const all: HistoryRow[] = [];
  for (const s of settlements) {
    const row = settlementToHistory(s, s.driver_id ? nameOf.get(String(s.driver_id)) ?? "Former driver" : "Unassigned", loadNums.get(String(s.id)) ?? []);
    if (row) all.push(row);
  }
  for (const p of (pRes.data ?? []) as Array<Record<string, unknown>>) {
    all.push(paystubToHistory(p, p.driver_id ? nameOf.get(String(p.driver_id)) ?? "Former driver" : "Unassigned"));
  }

  const rows = filterHistory(all, filters);
  const totals = historyTotals(rows);
  const pages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const shown = rows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const active = !!(filters.q || filters.driverId || filters.status || filters.kind || filters.from || filters.to);
  const qs = (patch: Record<string, string | number | undefined>) => {
    const p = new URLSearchParams();
    const base: Record<string, string | undefined> = { q: filters.q || undefined, driver: filters.driverId, status: filters.status, kind: filters.kind || undefined, from: filters.from, to: filters.to, sort: filters.sort === "newest" ? undefined : filters.sort };
    for (const [k, v] of Object.entries({ ...base, ...patch })) if (v !== undefined && v !== "") p.set(k, String(v));
    const s = p.toString();
    return s ? `?${s}` : "";
  };

  const field = "w-full rounded-lg bg-sp-cardLight px-3 py-2 text-sm text-sp-textPrimary outline-none ring-1 ring-white/5 focus:ring-sp-gold";
  const lab = "text-[11px] font-semibold uppercase tracking-wide text-sp-textSecondary";

  return (
    <section className="space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-sp-gold/90">Finance</p>
          <h1 className="mt-1 text-2xl font-bold tracking-tight">Payroll history</h1>
          <p className="mt-1 text-sm text-sp-textSecondary">Every past payroll — settlements from the web and iPhone, plus older paystubs (read-only).</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <GustoLinkButton variant="button" />
          <Link href="/settlements" className="rounded-md border border-white/10 px-3 py-2 text-xs text-sp-textPrimary hover:bg-white/5">Open settlements</Link>
          <Link href="/settlements/new" className="rounded-md bg-sp-gold px-3 py-2 text-xs font-semibold text-sp-black hover:bg-sp-goldLight">+ New settlement</Link>
        </div>
      </header>

      <form method="get" action="/payroll" className="grid grid-cols-2 gap-3 rounded-xl border border-white/5 bg-sp-card p-4 md:grid-cols-6">
        <label className="col-span-2 block space-y-1 md:col-span-2">
          <span className={lab}>Search</span>
          <input name="q" defaultValue={filters.q} placeholder="Settlement #, driver, load #, amount…" className={field} />
        </label>
        <label className="block space-y-1">
          <span className={lab}>Driver</span>
          <select name="driver" defaultValue={filters.driverId ?? ""} className={field}>
            <option value="">All drivers</option>
            {drivers.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
        </label>
        <label className="block space-y-1">
          <span className={lab}>Status</span>
          <select name="status" defaultValue={filters.status ?? ""} className={field}>
            <option value="">All statuses</option>
            {SETTLEMENT_STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
            <option value="paystub_issued">Paystub · Issued</option>
            <option value="paystub_paid">Paystub · Paid</option>
            <option value="paystub_voided">Paystub · Void</option>
            <option value="legacy">Any legacy record</option>
          </select>
        </label>
        <label className="block space-y-1">
          <span className={lab}>From</span>
          <input type="date" name="from" defaultValue={filters.from ?? ""} className={field} />
        </label>
        <label className="block space-y-1">
          <span className={lab}>To</span>
          <input type="date" name="to" defaultValue={filters.to ?? ""} className={field} />
        </label>
        <label className="block space-y-1">
          <span className={lab}>Type</span>
          <select name="kind" defaultValue={filters.kind ?? ""} className={field}>
            <option value="">All types</option>
            <option value="settlement">Settlements</option>
            <option value="legacy_settlement">Older iPhone settlements</option>
            <option value="paystub">Legacy paystubs</option>
          </select>
        </label>
        <label className="block space-y-1">
          <span className={lab}>Sort</span>
          <select name="sort" defaultValue={filters.sort} className={field}>
            <option value="newest">Newest first</option>
            <option value="oldest">Oldest first</option>
            <option value="net_desc">Net pay high → low</option>
            <option value="net_asc">Net pay low → high</option>
          </select>
        </label>
        <div className="col-span-2 flex items-end gap-2 md:col-span-4 md:justify-end">
          {active && <Link href="/payroll" className="rounded-md border border-white/10 px-4 py-2 text-xs text-sp-textPrimary hover:bg-white/5">Clear</Link>}
          <button type="submit" className="rounded-md bg-sp-gold px-5 py-2 text-xs font-semibold text-sp-black hover:bg-sp-goldLight">Search</button>
        </div>
      </form>

      <div className="flex flex-wrap gap-x-6 gap-y-1 text-xs text-sp-textSecondary">
        <span>{totals.count} record{totals.count === 1 ? "" : "s"}</span>
        <span>Paid / finalized: <span className="font-semibold text-sp-gold tabular-nums">{totals.paidOut.format()}</span></span>
        <span>Open drafts: <span className="tabular-nums text-sp-textPrimary">{totals.open.format()}</span></span>
      </div>

      {all.length === 0 ? (
        <EmptyState title="No payroll yet" body="Create your first settlement — it shows up here once it exists." />
      ) : rows.length === 0 ? (
        <EmptyState title="Nothing matches" body="Try a different search or clear the filters." />
      ) : (
        <div className="overflow-x-auto rounded-xl border border-white/5">
          <table className="min-w-full divide-y divide-white/5 text-sm">
            <thead className="bg-sp-card text-left text-[11px] uppercase tracking-wide text-sp-textSecondary">
              <tr>
                <th className="px-3 py-3">Number</th>
                <th className="px-3 py-3">Driver</th>
                <th className="px-3 py-3">Period</th>
                <th className="px-3 py-3">Type</th>
                <th className="px-3 py-3">Status</th>
                <th className="px-3 py-3 text-right">Gross</th>
                <th className="px-3 py-3 text-right">Net pay</th>
                <th className="px-3 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5 bg-sp-card/30">
              {shown.map((r) => (
                <tr key={`${r.kind}-${r.id}`} className="hover:bg-white/5">
                  <td className="px-3 py-2 font-medium text-sp-textPrimary">{r.number ?? "—"}{r.loadNumbers.length > 0 && <span className="block text-[11px] font-normal text-sp-textSecondary">Loads {r.loadNumbers.slice(0, 4).join(", ")}{r.loadNumbers.length > 4 ? "…" : ""}</span>}</td>
                  <td className="px-3 py-2 text-sp-textPrimary">{r.driverName}</td>
                  <td className="px-3 py-2 text-sp-textSecondary">{formatDate(r.periodStart)} → {formatDate(r.periodEnd)}</td>
                  <td className="px-3 py-2 text-sp-textSecondary">{r.kind === "settlement" ? "Settlement" : r.kind === "paystub" ? "Paystub (legacy)" : "Settlement (legacy)"}</td>
                  <td className="px-3 py-2 text-sp-textSecondary">{r.statusLabel}{r.readOnly && <span className="ml-1 text-[10px]" title="Locked / read-only">🔒</span>}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-sp-textSecondary">{r.gross.format()}</td>
                  <td className="px-3 py-2 text-right font-semibold tabular-nums text-sp-gold">{r.net.format()}</td>
                  <td className="px-3 py-2 text-right">
                    <Link href={r.href} className="inline-flex items-center rounded-md border border-white/10 px-2 py-1 text-[11px] font-medium text-sp-textPrimary hover:bg-white/5">Open</Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {pages > 1 && (
        <nav className="flex items-center justify-between text-xs text-sp-textSecondary" aria-label="Pages">
          {page > 1 ? <Link href={`/payroll${qs({ page: page - 1 })}`} className="hover:text-sp-textPrimary">← Newer</Link> : <span />}
          <span>Page {page} of {pages}</span>
          {page < pages ? <Link href={`/payroll${qs({ page: page + 1 })}`} className="hover:text-sp-textPrimary">Older →</Link> : <span />}
        </nav>
      )}
    </section>
  );
}
