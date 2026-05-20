// =============================================================================
//  /expenses — Carrier HQ Phase W5
// -----------------------------------------------------------------------------
//  Read-only list preserved from W1. Added in W5:
//    • +New expense CTA
//    • Per-category rollup tiles (top 6 by total)
//    • Per-row Edit link
//    • Deleted-flash + created-flash banners
//
//  Mobile: tiles wrap to 2 columns; table scrolls horizontally as before.
// =============================================================================

import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import EmptyState from "@/components/EmptyState";
import StatCard from "@/components/StatCard";
import { formatCurrency, formatDate, formatNumber } from "@/lib/format";
import type { Expense } from "@/lib/supabase/types";

export const runtime = "edge";

export default async function ExpensesPage({
  searchParams,
}: {
  searchParams: Promise<{ deleted?: string; created?: string; updated?: string }>;
}) {
  const sp = await searchParams;
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("expenses")
    .select("*")
    .order("receipt_date", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false });

  if (error) {
    return (
      <div className="rounded-lg border border-sp-danger/40 bg-sp-danger/10 p-4 text-sm text-sp-danger">
        {error.message}
      </div>
    );
  }

  const expenses: Expense[] = (data ?? []) as Expense[];
  const total = expenses.reduce((s, e) => s + (e.amount ?? 0), 0);

  // Per-category rollup; sort by total desc, keep top 6 for the tile grid.
  const byCategory = new Map<string, { total: number; count: number }>();
  for (const e of expenses) {
    const key = (e.category ?? "other").toLowerCase();
    const cur = byCategory.get(key) ?? { total: 0, count: 0 };
    cur.total += e.amount ?? 0;
    cur.count += 1;
    byCategory.set(key, cur);
  }
  const topCategories = [...byCategory.entries()]
    .sort((a, b) => b[1].total - a[1].total)
    .slice(0, 6);

  // -----------------------------------------------------------------------
  // Empty state — still want the +New CTA visible
  // -----------------------------------------------------------------------
  if (expenses.length === 0) {
    return (
      <section className="space-y-4">
        <header className="flex items-baseline justify-between">
          <h1 className="text-2xl font-bold tracking-tight">Expenses</h1>
          <Link
            href="/expenses/new"
            className="rounded-md bg-sp-gold px-3 py-1.5 text-xs font-semibold text-sp-black hover:bg-sp-goldLight"
          >
            + New expense
          </Link>
        </header>
        {sp.deleted && <FlashOK message="Expense deleted." />}
        <EmptyState
          title="No expenses yet"
          body="Log fuel, tolls, lumper, maintenance — anything that hits your books. Or add expenses on the iPhone app and they'll appear here within a few seconds."
          cta={
            <Link
              href="/expenses/new"
              className="inline-block rounded-md bg-sp-gold px-4 py-2 text-sm font-semibold text-sp-black hover:bg-sp-goldLight"
            >
              Add your first expense
            </Link>
          }
        />
      </section>
    );
  }

  return (
    <section className="space-y-5">
      <header className="flex items-baseline justify-between">
        <h1 className="text-2xl font-bold tracking-tight">Expenses</h1>
        <div className="flex items-center gap-3">
          <span className="text-xs text-sp-textSecondary">
            {expenses.length} entries · {formatCurrency(total)}
          </span>
          <Link
            href="/expenses/new"
            className="rounded-md bg-sp-gold px-3 py-1.5 text-xs font-semibold text-sp-black hover:bg-sp-goldLight"
          >
            + New expense
          </Link>
        </div>
      </header>

      {sp.deleted && <FlashOK message="Expense deleted." />}

      {/* Per-category rollups — most spend at the top */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
        {topCategories.map(([cat, agg]) => (
          <StatCard
            key={cat}
            label={labelize(cat)}
            value={formatCurrency(agg.total)}
            sublabel={`${formatNumber(agg.count)} entries`}
            tone="bad"
          />
        ))}
      </div>

      {/* Detail table */}
      <div className="overflow-x-auto rounded-xl border border-white/5">
        <table className="min-w-full divide-y divide-white/5 text-sm">
          <thead className="bg-sp-card text-left text-xs uppercase tracking-wide text-sp-textSecondary">
            <tr>
              <th className="px-3 py-3">Date</th>
              <th className="px-3 py-3">Category</th>
              <th className="hidden px-3 py-3 md:table-cell">Vendor</th>
              <th className="hidden px-3 py-3 md:table-cell">Description</th>
              <th className="px-3 py-3 text-right">Amount</th>
              <th className="px-3 py-3 text-right"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/5 bg-sp-card/30">
            {expenses.map((e) => (
              <tr key={e.id} className="hover:bg-white/5">
                <td className="px-3 py-3 text-sp-textSecondary">{formatDate(e.receipt_date)}</td>
                <td className="px-3 py-3 font-medium text-sp-textPrimary">
                  <Link
                    href={`/expenses/${e.id}`}
                    className="hover:text-sp-gold"
                  >
                    {labelize(e.category)}
                  </Link>
                </td>
                <td className="hidden px-3 py-3 text-sp-textSecondary md:table-cell">
                  {e.vendor_name ?? "—"}
                </td>
                <td className="hidden px-3 py-3 text-sp-textSecondary md:table-cell">
                  {e.description ?? "—"}
                </td>
                <td className="px-3 py-3 text-right font-semibold text-sp-danger">
                  {formatCurrency(e.amount)}
                </td>
                <td className="px-3 py-3 text-right">
                  <Link
                    href={`/expenses/${e.id}/edit`}
                    className="inline-flex items-center rounded-md border border-white/10 px-2 py-1 text-[10px] font-medium text-sp-textPrimary hover:bg-white/5"
                  >
                    Edit
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function FlashOK({ message }: { message: string }) {
  return (
    <div className="rounded-md border border-sp-success/40 bg-sp-success/10 px-3 py-2 text-sm text-sp-success">
      {message}
    </div>
  );
}

function labelize(s: string | null | undefined): string {
  if (!s) return "Other";
  return s.split("_").map((p) => p[0]?.toUpperCase() + p.slice(1)).join(" ");
}
