// =============================================================================
//  /drivers — list view · Phase W2 commit #2
// -----------------------------------------------------------------------------
//  Server component. Lists all drivers for the signed-in carrier with a
//  worker-type pill (1099 / W2) so the carrier can see classification at a
//  glance. Add-driver CTA routes to /drivers/new.
// =============================================================================

import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import EmptyState from "@/components/EmptyState";
import { formatCurrency } from "@/lib/format";
import type { Driver } from "@/lib/supabase/types";

export const runtime = "edge";

export default async function DriversPage() {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("drivers")
    .select("*")
    .order("active", { ascending: false })
    .order("name", { ascending: true });

  if (error) {
    return (
      <div className="rounded-lg border border-sp-danger/40 bg-sp-danger/10 p-4 text-sm text-sp-danger">
        {error.message}
      </div>
    );
  }

  const drivers: Driver[] = (data ?? []) as Driver[];

  return (
    <section className="space-y-4">
      <header className="flex items-baseline justify-between">
        <h1 className="text-2xl font-bold tracking-tight">Drivers</h1>
        <div className="flex items-center gap-3">
          <span className="text-xs text-sp-textSecondary">
            {drivers.length} {drivers.length === 1 ? "driver" : "drivers"}
          </span>
          <Link
            href="/drivers/new"
            className="rounded-md bg-sp-gold px-3 py-1.5 text-xs font-semibold text-sp-black hover:bg-sp-goldLight"
          >
            + Add driver
          </Link>
        </div>
      </header>

      {drivers.length === 0 ? (
        <EmptyState
          title="No drivers yet"
          body="Carrier HQ payroll needs at least one driver. Add a 1099 contractor for owner-operator settlements, or a W2 employee to run withholding-based payroll."
          cta={
            <Link
              href="/drivers/new"
              className="inline-block rounded-md bg-sp-gold px-4 py-2 text-sm font-semibold text-sp-black hover:bg-sp-goldLight"
            >
              Add your first driver
            </Link>
          }
        />
      ) : (
        <div className="overflow-x-auto rounded-xl border border-white/5">
          <table className="min-w-full divide-y divide-white/5 text-sm">
            <thead className="bg-sp-card text-left text-xs uppercase tracking-wide text-sp-textSecondary">
              <tr>
                <th className="px-3 py-3">Name</th>
                <th className="px-3 py-3">Type</th>
                <th className="hidden px-3 py-3 md:table-cell">Truck #</th>
                <th className="hidden px-3 py-3 md:table-cell">Phone</th>
                <th className="hidden px-3 py-3 md:table-cell">Status</th>
                <th className="px-3 py-3 text-right">Pay</th>
                <th className="px-3 py-3 text-right"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5 bg-sp-card/30">
              {drivers.map((d) => (
                <tr key={d.id} className="hover:bg-white/5">
                  <td className="px-3 py-3 font-medium text-sp-textPrimary">
                    <Link href={`/drivers/${d.id}`} className="hover:text-sp-gold">
                      {d.name}
                    </Link>
                  </td>
                  <td className="px-3 py-3">
                    <WorkerTypePill workerType={d.worker_type ?? "1099"} />
                  </td>
                  <td className="hidden px-3 py-3 text-sp-textSecondary md:table-cell">
                    {d.truck_number ?? "—"}
                  </td>
                  <td className="hidden px-3 py-3 text-sp-textSecondary md:table-cell">
                    {d.phone ?? "—"}
                  </td>
                  <td className="hidden px-3 py-3 md:table-cell">
                    <ActiveBadge active={d.active ?? true} />
                  </td>
                  <td className="px-3 py-3 text-right text-sp-textSecondary">
                    {payDescription(d)}
                  </td>
                  <td className="px-3 py-3 text-right">
                    <Link
                      href={`/drivers/${d.id}/edit`}
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
        (isW2
          ? "bg-sp-greenAccent/15 text-sp-greenAccent"
          : "bg-sp-gold/15 text-sp-gold")
      }
    >
      {isW2 ? "W2" : "1099"}
    </span>
  );
}

function ActiveBadge({ active }: { active: boolean }) {
  return (
    <span
      className={
        "inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium " +
        (active
          ? "bg-sp-success/15 text-sp-success"
          : "bg-white/5 text-sp-textSecondary")
      }
    >
      {active ? "Active" : "Inactive"}
    </span>
  );
}

function payDescription(d: Driver): string {
  if (d.worker_type === "W2") {
    if (d.comp_type === "hourly" && d.hourly_rate != null)
      return `${formatCurrency(d.hourly_rate)} / hr`;
    if (d.comp_type === "salary" && d.salary_annual != null)
      return `${formatCurrency(d.salary_annual)} / yr`;
    if (d.comp_type === "mileage" && d.mileage_rate != null)
      return `${formatCurrency(d.mileage_rate)} / mi`;
    if (d.comp_type === "per_load" && d.per_load_rate != null)
      return `${formatCurrency(d.per_load_rate)} / load`;
    return "W2 — not set";
  }
  // 1099
  if ((d.pay_type ?? "percent") === "flat" && d.flat_rate != null) {
    return `${formatCurrency(d.flat_rate)} flat`;
  }
  if (d.pay_percentage != null) {
    return `${d.pay_percentage}%`;
  }
  return "—";
}
