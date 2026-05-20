// =============================================================================
//  /expenses/new — Carrier HQ Phase W5
// -----------------------------------------------------------------------------
//  Create form. Loads list is pulled server-side so the picker has labels
//  available without a client round-trip.
// =============================================================================

import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import ExpenseForm from "../ExpenseForm";
import { createExpenseAction } from "../actions";
import type { Load } from "@/lib/supabase/types";

export const runtime = "edge";

export default async function NewExpensePage() {
  const supabase = await createClient();
  const { data: loadsRaw } = await supabase
    .from("loads")
    .select("id, load_number, broker_name, pickup_date")
    .order("pickup_date", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false })
    .limit(500);

  const loads = (loadsRaw ?? []) as Array<
    Pick<Load, "id" | "load_number" | "broker_name" | "pickup_date">
  >;

  return (
    <section className="space-y-6">
      <header className="flex items-baseline justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">New expense</h1>
          <p className="mt-1 text-xs text-sp-textSecondary">
            Logged the same way as expenses entered in the iPhone app — same
            categories, same totals.
          </p>
        </div>
        <Link
          href="/expenses"
          className="rounded-md border border-white/10 px-3 py-1.5 text-xs text-sp-textPrimary hover:bg-white/5"
        >
          ← Back
        </Link>
      </header>

      <ExpenseForm
        loads={loads}
        action={createExpenseAction}
        submitLabel="Create expense"
      />
    </section>
  );
}
