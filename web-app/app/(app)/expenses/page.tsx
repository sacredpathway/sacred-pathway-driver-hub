import { createClient } from "@/lib/supabase/server";
import EmptyState from "@/components/EmptyState";
import { formatCurrency, formatDate } from "@/lib/format";
import type { Expense } from "@/lib/supabase/types";

export const runtime = "edge";

export default async function ExpensesPage() {
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

  if (expenses.length === 0) {
    return (
      <EmptyState
        title="No expenses yet"
        body="Expenses logged in the iPhone app appear here within a few seconds."
      />
    );
  }

  return (
    <section className="space-y-4">
      <header className="flex items-baseline justify-between">
        <h1 className="text-2xl font-bold tracking-tight">Expenses</h1>
        <span className="text-xs text-sp-textSecondary">
          {expenses.length} entries · {formatCurrency(total)}
        </span>
      </header>

      <div className="overflow-x-auto rounded-xl border border-white/5">
        <table className="min-w-full divide-y divide-white/5 text-sm">
          <thead className="bg-sp-card text-left text-xs uppercase tracking-wide text-sp-textSecondary">
            <tr>
              <th className="px-3 py-3">Date</th>
              <th className="px-3 py-3">Category</th>
              <th className="hidden px-3 py-3 md:table-cell">Vendor</th>
              <th className="hidden px-3 py-3 md:table-cell">Description</th>
              <th className="px-3 py-3 text-right">Amount</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/5 bg-sp-card/30">
            {expenses.map((e) => (
              <tr key={e.id} className="hover:bg-white/5">
                <td className="px-3 py-3 text-sp-textSecondary">{formatDate(e.receipt_date)}</td>
                <td className="px-3 py-3 font-medium text-sp-textPrimary">
                  {capitalize(e.category)}
                </td>
                <td className="hidden px-3 py-3 text-sp-textSecondary md:table-cell">{e.vendor_name ?? "—"}</td>
                <td className="hidden px-3 py-3 text-sp-textSecondary md:table-cell">{e.description ?? "—"}</td>
                <td className="px-3 py-3 text-right font-semibold text-sp-danger">
                  {formatCurrency(e.amount)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function capitalize(s: string): string {
  return s ? s[0].toUpperCase() + s.slice(1) : s;
}
