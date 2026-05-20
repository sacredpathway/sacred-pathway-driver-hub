import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import StatCard from "@/components/StatCard";
import GustoLinkButton from "@/components/GustoLinkButton";
import { formatCurrency, formatNumber } from "@/lib/format";
import type { Load, Expense } from "@/lib/supabase/types";

export const runtime = "edge";

export default async function DashboardPage() {
  const supabase = await createClient();

  const [{ data: loadsRaw }, { data: expensesRaw }] = await Promise.all([
    supabase.from("loads").select("*").order("created_at", { ascending: false }),
    supabase.from("expenses").select("*").order("created_at", { ascending: false }),
  ]);

  const loads: Load[] = (loadsRaw ?? []) as Load[];
  const expenses: Expense[] = (expensesRaw ?? []) as Expense[];

  const totalRevenue  = loads.reduce((s, l) => s + (l.total_revenue ?? 0), 0);
  const totalExpenses = expenses.reduce((s, e) => s + (e.amount ?? 0), 0);
  const netProfit     = totalRevenue - totalExpenses;
  const totalMiles    = loads.reduce((s, l) => s + (l.total_miles ?? 0), 0);
  const profitPerMile = totalMiles > 0 ? netProfit / totalMiles : 0;
  const loadCount     = loads.length;

  return (
    <section className="space-y-6">
      <header className="flex items-baseline justify-between">
        <h1 className="text-2xl font-bold tracking-tight">Dashboard</h1>
        <span className="text-xs text-sp-textSecondary">All time</span>
      </header>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard label="Revenue"        value={formatCurrency(totalRevenue)} tone="gold" />
        <StatCard label="Expenses"       value={formatCurrency(totalExpenses)} tone="bad" />
        <StatCard label="Net Profit"     value={formatCurrency(netProfit)} tone={netProfit >= 0 ? "good" : "bad"} />
        <StatCard label="Loads"          value={formatNumber(loadCount)} />
        <StatCard label="Miles"          value={formatNumber(totalMiles)} />
        <StatCard label="Profit / Mile"  value={formatCurrency(profitPerMile)} tone={profitPerMile >= 0 ? "good" : "bad"} />
        <StatCard
          label="Avg Revenue / Load"
          value={loadCount > 0 ? formatCurrency(totalRevenue / loadCount) : "—"}
        />
        <StatCard label="Total Expenses Logged" value={formatNumber(expenses.length)} />
      </div>

      <section className="flex flex-wrap items-center gap-2">
        <Link
          href="/payroll/new"
          className="rounded-md bg-sp-gold px-3 py-1.5 text-xs font-semibold text-sp-black hover:bg-sp-goldLight"
        >
          + New paystub
        </Link>
        <Link
          href="/drivers/new"
          className="rounded-md border border-white/10 px-3 py-1.5 text-xs font-medium text-sp-textPrimary hover:bg-white/5"
        >
          Add driver
        </Link>
        <GustoLinkButton variant="button" />
      </section>

      <p className="text-xs text-sp-textSecondary">
        Driver Hub Carrier HQ — drivers and payroll edits live here on the web.
        Smart Scan and the on-the-road workflow live in the iPhone app.
      </p>
    </section>
  );
}
