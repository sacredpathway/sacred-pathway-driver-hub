// =============================================================================
//  /expenses/[id]/edit — Carrier HQ Phase W5
// -----------------------------------------------------------------------------
//  Reuses ExpenseForm with the existing row pre-filled. Same loads pull as
//  /new so the picker is identical.
// =============================================================================

import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import ExpenseForm from "../../ExpenseForm";
import { updateExpenseAction } from "../../actions";
import type { Expense, Load } from "@/lib/supabase/types";

export const runtime = "edge";

export default async function EditExpensePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();

  const [{ data: row, error }, { data: loadsRaw }] = await Promise.all([
    supabase.from("expenses").select("*").eq("id", id).maybeSingle(),
    supabase
      .from("loads")
      .select("id, load_number, broker_name, pickup_date")
      .order("pickup_date", { ascending: false, nullsFirst: false })
      .order("created_at", { ascending: false })
      .limit(500),
  ]);

  if (error) {
    return (
      <div className="rounded-lg border border-sp-danger/40 bg-sp-danger/10 p-4 text-sm text-sp-danger">
        {error.message}
      </div>
    );
  }
  if (!row) notFound();

  const expense = row as Expense;
  const loads = (loadsRaw ?? []) as Array<
    Pick<Load, "id" | "load_number" | "broker_name" | "pickup_date">
  >;

  // Bind the row id so the action handler can route the update.
  const updateThis = updateExpenseAction.bind(null, expense.id);

  return (
    <section className="space-y-6">
      <header className="flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Edit expense</h1>
          <p className="mt-1 text-xs text-sp-textSecondary">
            Same fields as the iPhone app. Changes sync back to Cloud Sync.
          </p>
        </div>
        <Link
          href={`/expenses/${expense.id}`}
          className="rounded-md border border-white/10 px-3 py-1.5 text-xs text-sp-textPrimary hover:bg-white/5"
        >
          ← Back
        </Link>
      </header>

      <ExpenseForm
        expense={expense}
        loads={loads}
        action={updateThis}
        submitLabel="Save changes"
      />
    </section>
  );
}
