// =============================================================================
//  /expenses/[id] — Carrier HQ Phase W5 (detail view)
// -----------------------------------------------------------------------------
//  Read-only summary of a single expense, with Edit + Delete CTAs. Delete
//  uses the form-action variant; no useActionState since there's no inline
//  error UI — failures bubble to the route error boundary.
// =============================================================================

import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { formatCurrency, formatDate } from "@/lib/format";
import type { Expense, Load } from "@/lib/supabase/types";
import { deleteExpenseAction } from "../actions";

export const runtime = "edge";

export default async function ExpenseDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ created?: string; updated?: string }>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const supabase = await createClient();

  const { data: row, error } = await supabase
    .from("expenses").select("*").eq("id", id).maybeSingle();

  if (error) {
    return (
      <div className="rounded-lg border border-sp-danger/40 bg-sp-danger/10 p-4 text-sm text-sp-danger">
        {error.message}
      </div>
    );
  }
  if (!row) notFound();
  const expense = row as Expense;

  let load: Pick<Load, "id" | "load_number" | "broker_name"> | null = null;
  if (expense.load_id) {
    const { data: l } = await supabase
      .from("loads")
      .select("id, load_number, broker_name")
      .eq("id", expense.load_id)
      .maybeSingle();
    load = (l ?? null) as Pick<Load, "id" | "load_number" | "broker_name"> | null;
  }

  // bound `id` so the server-action form receives it on submit
  const deleteThis = deleteExpenseAction.bind(null, expense.id);

  return (
    <section className="space-y-6">
      <header className="flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">
            {labelize(expense.category)} expense
          </h1>
          <p className="mt-1 text-xs text-sp-textSecondary">
            {formatDate(expense.receipt_date)}{" "}
            {expense.vendor_name ? `· ${expense.vendor_name}` : ""}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href="/expenses"
            className="rounded-md border border-white/10 px-3 py-1.5 text-xs text-sp-textPrimary hover:bg-white/5"
          >
            ← Back
          </Link>
          <Link
            href={`/expenses/${expense.id}/edit`}
            className="rounded-md bg-sp-gold px-3 py-1.5 text-xs font-semibold text-sp-black hover:bg-sp-goldLight"
          >
            Edit
          </Link>
        </div>
      </header>

      {sp.created && <FlashOK message="Expense created." />}
      {sp.updated && <FlashOK message="Expense updated." />}

      <div className="rounded-xl border border-white/5 bg-sp-card p-5">
        <dl className="grid grid-cols-1 gap-x-6 gap-y-4 text-sm md:grid-cols-2">
          <Row label="Amount">
            <span className="font-semibold text-sp-danger">
              {formatCurrency(expense.amount)}
            </span>
          </Row>
          <Row label="Category">{labelize(expense.category)}</Row>
          <Row label="Vendor">{expense.vendor_name ?? "—"}</Row>
          <Row label="Receipt date">{formatDate(expense.receipt_date)}</Row>

          {expense.category === "fuel" && (
            <>
              <Row label="Gallons">{expense.gallons ?? "—"}</Row>
              <Row label="Price / gal">
                {expense.price_per_gallon != null
                  ? formatCurrency(expense.price_per_gallon)
                  : "—"}
              </Row>
              <Row label="DEF gallons">{expense.def_gallons ?? "—"}</Row>
              <Row label="DEF total">
                {expense.def_total != null
                  ? formatCurrency(expense.def_total)
                  : "—"}
              </Row>
            </>
          )}

          <Row label="Linked load">
            {load ? (
              <Link
                href={`/loads/${load.id}`}
                className="text-sp-gold hover:underline"
              >
                {load.load_number ? `#${load.load_number}` : load.id.slice(0, 8)}
                {load.broker_name ? ` · ${load.broker_name}` : ""}
              </Link>
            ) : (
              "—"
            )}
          </Row>
          <Row label="Description">{expense.description ?? "—"}</Row>
        </dl>
      </div>

      <div className="rounded-xl border border-sp-danger/30 bg-sp-danger/5 p-5">
        <header className="mb-2">
          <h2 className="text-sm font-semibold text-sp-danger">Danger zone</h2>
          <p className="mt-1 text-xs text-sp-textSecondary">
            Deletes this expense. Not recoverable.
          </p>
        </header>
        <form action={deleteThis}>
          <button
            type="submit"
            className="rounded-md border border-sp-danger/40 bg-sp-danger/10 px-3 py-1.5 text-xs font-semibold text-sp-danger hover:bg-sp-danger/20"
          >
            Delete expense
          </button>
        </form>
      </div>
    </section>
  );
}

// -----------------------------------------------------------------------------
// Bits
// -----------------------------------------------------------------------------

function Row({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <dt className="text-[11px] font-semibold uppercase tracking-wide text-sp-textSecondary">
        {label}
      </dt>
      <dd className="mt-0.5 text-sm text-sp-textPrimary">{children}</dd>
    </div>
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
  if (!s) return "Expense";
  return s.split("_").map((p) => p[0]?.toUpperCase() + p.slice(1)).join(" ");
}
