import { createClient } from "@/lib/supabase/server";
import EmptyState from "@/components/EmptyState";
import { formatCurrency, formatNumber } from "@/lib/format";
import type { Broker } from "@/lib/supabase/types";

export const runtime = "edge";

export default async function BrokersPage() {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("brokers")
    .select("*")
    .order("total_revenue", { ascending: false, nullsFirst: false });

  if (error) {
    return (
      <div className="rounded-lg border border-sp-danger/40 bg-sp-danger/10 p-4 text-sm text-sp-danger">
        {error.message}
      </div>
    );
  }

  const brokers: Broker[] = (data ?? []) as Broker[];
  if (brokers.length === 0) {
    return (
      <EmptyState
        title="No brokers yet"
        body="Brokers detected via Smart Scan, or added in the Driver Hub iPhone app, appear here automatically."
      />
    );
  }

  return (
    <section className="space-y-4">
      <header className="flex items-baseline justify-between">
        <h1 className="text-2xl font-bold tracking-tight">Brokers</h1>
        <span className="text-xs text-sp-textSecondary">{brokers.length} total</span>
      </header>

      <div className="overflow-x-auto rounded-xl border border-white/5">
        <table className="min-w-full divide-y divide-white/5 text-sm">
          <thead className="bg-sp-card text-left text-xs uppercase tracking-wide text-sp-textSecondary">
            <tr>
              <th className="px-3 py-3">Broker</th>
              <th className="hidden px-3 py-3 md:table-cell">MC #</th>
              <th className="px-3 py-3 text-right">Loads</th>
              <th className="px-3 py-3 text-right">Total Revenue</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/5 bg-sp-card/30">
            {brokers.map((b) => (
              <tr key={b.id} className="hover:bg-white/5">
                <td className="px-3 py-3 font-medium text-sp-textPrimary">{b.broker_name}</td>
                <td className="hidden px-3 py-3 text-sp-textSecondary md:table-cell">
                  {b.mc_number ?? "—"}
                </td>
                <td className="px-3 py-3 text-right text-sp-textSecondary">
                  {formatNumber(b.total_loads ?? 0)}
                </td>
                <td className="px-3 py-3 text-right font-semibold text-sp-gold">
                  {formatCurrency(b.total_revenue)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
