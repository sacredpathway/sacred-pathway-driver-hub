// =============================================================================
//  /settlements — payroll work queue
// -----------------------------------------------------------------------------
//  The live payroll system (same settlements the iPhone uses):
//    To finish        draft / ready for review       → edit, finalize
//    Finalized        approved, not yet paid         → mark paid
//    Recently paid    last 10 paid                   → history
//  Everything older lives in Payroll history (/payroll).
// =============================================================================

import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import EmptyState from "@/components/EmptyState";
import { Money } from "@/lib/money/money";
import { normaliseStatus, STATUS_LABEL, type SettlementStatus } from "@/lib/settlements/model";
import { formatDate } from "@/lib/format";

interface Row {
  id: string;
  driver_id: string | null;
  settlement_number: string | null;
  settlement_period_start: string | null;
  settlement_period_end: string | null;
  status: string | null;
  net_pay: number | null;
  gross_load_revenue: number | null;
  updated_at: string | null;
  paid_at: string | null;
  engine_version: string | null;
  is_estimate: boolean | null;
  paystub_id: string | null;
}

export default async function SettlementsPage({ searchParams }: { searchParams: Promise<{ created?: string }> }) {
  await searchParams;
  const supabase = await createClient();
  const [{ data, error }, { data: drivers }] = await Promise.all([
    supabase.from("settlements")
      .select("id, driver_id, settlement_number, settlement_period_start, settlement_period_end, status, net_pay, gross_load_revenue, updated_at, paid_at, engine_version, is_estimate, paystub_id")
      .or("is_estimate.is.null,is_estimate.eq.false")
      .order("settlement_period_end", { ascending: false, nullsFirst: false })
      .limit(500),
    supabase.from("drivers").select("id, name"),
  ]);
  if (error) {
    return <div className="rounded-lg border border-sp-danger/40 bg-sp-danger/10 p-4 text-sm text-sp-danger">{error.message}</div>;
  }
  const nameOf = new Map(((drivers ?? []) as Array<{ id: string; name: string }>).map((d) => [d.id, d.name]));
  const rows = ((data ?? []) as Row[]).filter((r) => !r.paystub_id && r.engine_version);
  const by = (pred: (s: SettlementStatus) => boolean) => rows.filter((r) => pred(normaliseStatus(r.status)));
  const toFinish = by((s) => s === "draft" || s === "ready_for_review");
  const finalized = by((s) => s === "approved");
  const paid = by((s) => s === "paid")
    .sort((a, b) => (b.paid_at ?? "").localeCompare(a.paid_at ?? ""))
    .slice(0, 10);
  const sum = (rs: Row[]) => Money.sum(rs.map((r) => Money.fromNumber(r.net_pay))).format();

  return (
    <section className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-sp-gold/90">Finance</p>
          <h1 className="mt-1 text-2xl font-bold tracking-tight">Settlements</h1>
          <p className="mt-1 text-sm text-sp-textSecondary">Driver payroll — the same settlements as the iPhone app. Edit drafts, finalize, then mark paid.</p>
        </div>
        <div className="flex gap-2">
          <Link href="/payroll" className="rounded-md border border-white/10 px-3 py-2 text-xs text-sp-textPrimary hover:bg-white/5">Payroll history</Link>
          <Link href="/settlements/new" className="rounded-md bg-sp-gold px-3 py-2 text-xs font-semibold text-sp-black hover:bg-sp-goldLight">+ New settlement</Link>
        </div>
      </header>

      {rows.length === 0 ? (
        <EmptyState title="No settlements yet" body="Create one here or in the iPhone app — both show up in this list." />
      ) : (
        <>
          <Group title="To finish" hint={`${toFinish.length} · ${sum(toFinish)} net`} rows={toFinish} nameOf={nameOf} empty="Nothing in draft." />
          <Group title="Finalized — ready to pay" hint={`${finalized.length} · ${sum(finalized)} net`} rows={finalized} nameOf={nameOf} empty="Nothing waiting to be paid." />
          <Group title="Recently paid" hint="Last 10 — see Payroll history for everything" rows={paid} nameOf={nameOf} empty="No paid settlements yet." />
        </>
      )}
    </section>
  );
}

function Group({ title, hint, rows, nameOf, empty }: { title: string; hint: string; rows: Row[]; nameOf: Map<string, string>; empty: string }) {
  return (
    <div className="space-y-2">
      <div className="flex items-baseline justify-between">
        <h2 className="text-sm font-semibold text-sp-textPrimary">{title}</h2>
        <span className="text-xs text-sp-textSecondary">{hint}</span>
      </div>
      {rows.length === 0 ? (
        <p className="rounded-xl border border-white/5 bg-sp-card/40 px-4 py-3 text-sm text-sp-textSecondary">{empty}</p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-white/5">
          <table className="min-w-full divide-y divide-white/5 text-sm">
            <thead className="bg-sp-card text-left text-[11px] uppercase tracking-wide text-sp-textSecondary">
              <tr>
                <th className="px-3 py-2.5">Number</th><th className="px-3 py-2.5">Driver</th><th className="px-3 py-2.5">Period</th>
                <th className="px-3 py-2.5">Status</th><th className="px-3 py-2.5 text-right">Gross</th><th className="px-3 py-2.5 text-right">Net pay</th><th className="px-3 py-2.5" />
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5 bg-sp-card/30">
              {rows.map((r) => {
                const st = normaliseStatus(r.status);
                return (
                  <tr key={r.id} className="hover:bg-white/5">
                    <td className="px-3 py-2 font-medium text-sp-textPrimary">{r.settlement_number ?? "—"}</td>
                    <td className="px-3 py-2">{r.driver_id ? nameOf.get(r.driver_id) ?? "Former driver" : "Unassigned"}</td>
                    <td className="px-3 py-2 text-sp-textSecondary">{formatDate(r.settlement_period_start)} → {formatDate(r.settlement_period_end)}</td>
                    <td className="px-3 py-2 text-sp-textSecondary">{STATUS_LABEL[st]}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-sp-textSecondary">{Money.fromNumber(r.gross_load_revenue).format()}</td>
                    <td className="px-3 py-2 text-right font-semibold tabular-nums text-sp-gold">{Money.fromNumber(r.net_pay).format()}</td>
                    <td className="px-3 py-2 text-right">
                      <Link href={`/settlements/${r.id}`} className="rounded-md border border-white/10 px-2 py-1 text-[11px] text-sp-textPrimary hover:bg-white/5">
                        {st === "draft" || st === "ready_for_review" ? "Edit" : "Open"}
                      </Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
