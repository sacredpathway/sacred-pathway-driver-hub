import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import EmptyState from "@/components/EmptyState";
import { formatCurrency, formatDate, formatNumber } from "@/lib/format";
import type { Load, Truck, Trailer } from "@/lib/supabase/types";

export const runtime = "edge";

export default async function LoadsPage() {
  const supabase = await createClient();

  // Pull the loads plus the carrier's fleet so we can render unit numbers
  // without a join column on the loads SELECT. Fleet table is small (<200
  // rows for typical carriers) so the in-memory join is cheap.
  const [{ data: loadsRaw, error }, { data: trucksRaw }, { data: trailersRaw }] =
    await Promise.all([
      supabase
        .from("loads")
        .select("*")
        .order("pickup_date", { ascending: false, nullsFirst: false })
        .order("created_at", { ascending: false }),
      supabase.from("trucks").select("id, unit_number"),
      supabase.from("trailers").select("id, unit_number"),
    ]);

  if (error) {
    return (
      <div className="rounded-lg border border-sp-danger/40 bg-sp-danger/10 p-4 text-sm text-sp-danger">
        {error.message}
      </div>
    );
  }

  const loads: Load[] = (loadsRaw ?? []) as Load[];
  const truckById = new Map(
    ((trucksRaw ?? []) as Pick<Truck, "id" | "unit_number">[]).map((t) => [t.id, t])
  );
  const trailerById = new Map(
    ((trailersRaw ?? []) as Pick<Trailer, "id" | "unit_number">[]).map((t) => [t.id, t])
  );

  if (loads.length === 0) {
    return (
      <EmptyState
        title="No loads yet"
        body="Loads created in the Driver Hub iPhone app appear here automatically. You can also generate a 1099 settlement directly from Payroll once you've added a load."
      />
    );
  }

  return (
    <section className="space-y-4">
      <header className="flex items-baseline justify-between">
        <h1 className="text-2xl font-bold tracking-tight">Loads</h1>
        <span className="text-xs text-sp-textSecondary">{loads.length} total</span>
      </header>

      <div className="overflow-x-auto rounded-xl border border-white/5">
        <table className="min-w-full divide-y divide-white/5 text-sm">
          <thead className="bg-sp-card text-left text-xs uppercase tracking-wide text-sp-textSecondary">
            <tr>
              <th className="px-3 py-3">Load #</th>
              <th className="px-3 py-3">Broker</th>
              <th className="hidden px-3 py-3 md:table-cell">Route</th>
              <th className="hidden px-3 py-3 md:table-cell">Pickup</th>
              <th className="px-3 py-3">Truck</th>
              <th className="px-3 py-3">Trailer</th>
              <th className="px-3 py-3 text-right">Miles</th>
              <th className="px-3 py-3 text-right">Revenue</th>
              <th className="px-3 py-3 text-right"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/5 bg-sp-card/30">
            {loads.map((l) => {
              const truck = l.truck_id ? truckById.get(l.truck_id) : undefined;
              const trailer = l.trailer_id ? trailerById.get(l.trailer_id) : undefined;
              return (
                <tr key={l.id} className="hover:bg-white/5">
                  <td className="px-3 py-3 font-medium text-sp-textPrimary">
                    <Link href={`/loads/${l.id}`} className="hover:text-sp-gold">
                      {l.load_number ?? "—"}
                    </Link>
                  </td>
                  <td className="px-3 py-3 text-sp-textSecondary">
                    {l.broker_name ?? "—"}
                  </td>
                  <td className="hidden px-3 py-3 text-sp-textSecondary md:table-cell">
                    {[l.origin, l.destination].filter(Boolean).join(" → ") || "—"}
                  </td>
                  <td className="hidden px-3 py-3 text-sp-textSecondary md:table-cell">
                    {formatDate(l.pickup_date)}
                  </td>
                  <td className="px-3 py-3 text-sp-textSecondary">
                    {truck ? `#${truck.unit_number}` : "—"}
                  </td>
                  <td className="px-3 py-3 text-sp-textSecondary">
                    {trailer ? `#${trailer.unit_number}` : "—"}
                  </td>
                  <td className="px-3 py-3 text-right text-sp-textSecondary">
                    {formatNumber(l.total_miles)}
                  </td>
                  <td className="px-3 py-3 text-right font-semibold text-sp-gold">
                    {formatCurrency(l.total_revenue)}
                  </td>
                  <td className="px-3 py-3 text-right">
                    <Link
                      href={`/loads/${l.id}/edit`}
                      className="inline-flex items-center rounded-md border border-white/10 px-2 py-1 text-[10px] font-medium text-sp-textPrimary hover:bg-white/5"
                    >
                      Edit
                    </Link>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
