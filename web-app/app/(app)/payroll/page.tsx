// =============================================================================
//  /payroll — paystub list (drafts + issued + paid + voided)
// -----------------------------------------------------------------------------
//  Reads only `paystubs` (not the unified view) — legacy iOS settlements have
//  their own /loads workflow and surface in dashboards via the SQL view later.
// =============================================================================

import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import EmptyState from "@/components/EmptyState";
import GustoLinkButton from "@/components/GustoLinkButton";
import { formatCurrency, formatDate } from "@/lib/format";
import type { Paystub, Driver } from "@/lib/supabase/types";

export const runtime = "edge";

export default async function PayrollPage() {
  const supabase = await createClient();

  const [{ data: paystubs, error: psErr }, { data: drivers }] = await Promise.all([
    supabase
      .from("paystubs")
      .select("*")
      .order("check_date", { ascending: false, nullsFirst: false })
      .order("created_at", { ascending: false }),
    supabase.from("drivers").select("id, name, worker_type").eq("active", true),
  ]);

  if (psErr) {
    return (
      <div className="rounded-lg border border-sp-danger/40 bg-sp-danger/10 p-4 text-sm text-sp-danger">
        {psErr.message}
      </div>
    );
  }

  const rows = (paystubs ?? []) as Paystub[];
  const driverMap = new Map(
    ((drivers ?? []) as Pick<Driver, "id" | "name" | "worker_type">[]).map((d) => [d.id, d])
  );

  return (
    <section className="space-y-4">
      <header className="flex items-baseline justify-between">
        <h1 className="text-2xl font-bold tracking-tight">Payroll</h1>
        <div className="flex items-center gap-3">
          <span className="text-xs text-sp-textSecondary">
            {rows.length} {rows.length === 1 ? "paystub" : "paystubs"}
          </span>
          <Link
            href="/payroll/new"
            className="rounded-md bg-sp-gold px-3 py-1.5 text-xs font-semibold text-sp-black hover:bg-sp-goldLight"
          >
            + New paystub
          </Link>
        </div>
      </header>

      {/* Carrier HQ prepares the records; Gusto runs the actual payroll. */}
      <GustoLinkButton />

      {rows.length === 0 ? (
        <EmptyState
          title="No paystubs yet"
          body="Generate a 1099 contractor settlement or W2 employee paystub to start."
          cta={
            <Link
              href="/payroll/new"
              className="inline-block rounded-md bg-sp-gold px-4 py-2 text-sm font-semibold text-sp-black hover:bg-sp-goldLight"
            >
              Create your first paystub
            </Link>
          }
        />
      ) : (
        <div className="overflow-x-auto rounded-xl border border-white/5">
          <table className="min-w-full divide-y divide-white/5 text-sm">
            <thead className="bg-sp-card text-left text-xs uppercase tracking-wide text-sp-textSecondary">
              <tr>
                <th className="px-3 py-3">#</th>
                <th className="px-3 py-3">Driver</th>
                <th className="px-3 py-3">Type</th>
                <th className="hidden px-3 py-3 md:table-cell">Period</th>
                <th className="hidden px-3 py-3 md:table-cell">Check date</th>
                <th className="px-3 py-3">Status</th>
                <th className="px-3 py-3 text-right">Gross</th>
                <th className="px-3 py-3 text-right">Net</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5 bg-sp-card/30">
              {rows.map((p) => {
                const driver = p.driver_id ? driverMap.get(p.driver_id) : undefined;
                return (
                  <tr key={p.id} className="hover:bg-white/5">
                    <td className="px-3 py-3 font-mono text-[11px] text-sp-textSecondary">
                      <Link href={`/payroll/${p.id}`} className="hover:text-sp-gold">
                        {p.paystub_number ?? "DRAFT"}
                      </Link>
                    </td>
                    <td className="px-3 py-3 font-medium text-sp-textPrimary">
                      <Link href={`/payroll/${p.id}`} className="hover:text-sp-gold">
                        {driver?.name ?? "—"}
                      </Link>
                    </td>
                    <td className="px-3 py-3">
                      <WorkerTypePill workerType={p.worker_type} />
                    </td>
                    <td className="hidden px-3 py-3 text-sp-textSecondary md:table-cell">
                      {formatDate(p.pay_period_start)} – {formatDate(p.pay_period_end)}
                    </td>
                    <td className="hidden px-3 py-3 text-sp-textSecondary md:table-cell">
                      {formatDate(p.check_date)}
                    </td>
                    <td className="px-3 py-3">
                      <StatusBadge status={p.status} />
                    </td>
                    <td className="px-3 py-3 text-right text-sp-textSecondary">
                      {formatCurrency(p.gross_earnings)}
                    </td>
                    <td className="px-3 py-3 text-right font-semibold text-sp-gold">
                      {formatCurrency(p.net_pay)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function WorkerTypePill({ workerType }: { workerType: string }) {
  const isW2 = workerType === "W2";
  return (
    <span
      className={
        "inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide " +
        (isW2 ? "bg-sp-greenAccent/15 text-sp-greenAccent" : "bg-sp-gold/15 text-sp-gold")
      }
    >
      {isW2 ? "W2" : "1099"}
    </span>
  );
}

function StatusBadge({ status }: { status: string }) {
  const cls =
    status === "issued"
      ? "bg-sp-success/15 text-sp-success"
      : status === "paid"
      ? "bg-sp-greenAccent/15 text-sp-greenAccent"
      : status === "voided"
      ? "bg-sp-danger/15 text-sp-danger"
      : "bg-white/5 text-sp-textSecondary"; // draft
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide ${cls}`}>
      {status}
    </span>
  );
}
