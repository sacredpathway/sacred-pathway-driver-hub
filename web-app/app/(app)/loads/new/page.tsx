// =============================================================================
//  /loads/new — Carrier HQ Phase W7
// -----------------------------------------------------------------------------
//  Manual load entry. Same fields as iOS Smart Scan output so a typed load
//  is indistinguishable from a scanned one downstream (paystub generator,
//  reports, exports).
// =============================================================================

import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import NewLoadForm from "./NewLoadForm";
import type { Driver, Truck, Trailer } from "@/lib/supabase/types";

export const runtime = "edge";

export default async function NewLoadPage() {
  const supabase = await createClient();

  // Pull pickers in parallel; cap to a sane bound. Drivers stay active-first
  // to match the existing /drivers list ordering.
  const [
    { data: driversRaw },
    { data: trucksRaw },
    { data: trailersRaw },
  ] = await Promise.all([
    supabase
      .from("drivers")
      .select("id, name, worker_type, active, truck_number")
      .order("active", { ascending: false })
      .order("name", { ascending: true })
      .limit(500),
    supabase
      .from("trucks")
      .select("id, unit_number, status")
      .order("status", { ascending: true })
      .order("unit_number", { ascending: true })
      .limit(500),
    supabase
      .from("trailers")
      .select("id, unit_number, trailer_type, status")
      .order("status", { ascending: true })
      .order("unit_number", { ascending: true })
      .limit(500),
  ]);

  const drivers = (driversRaw ?? []) as Array<
    Pick<Driver, "id" | "name" | "worker_type" | "active" | "truck_number">
  >;
  const trucks = (trucksRaw ?? []) as Array<
    Pick<Truck, "id" | "unit_number" | "status">
  >;
  const trailers = (trailersRaw ?? []) as Array<
    Pick<Trailer, "id" | "unit_number" | "trailer_type" | "status">
  >;

  return (
    <section className="space-y-6">
      <header className="flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">New load</h1>
          <p className="mt-1 text-xs text-sp-textSecondary">
            Same shape as Smart Scan on the iPhone — broker, route, dates,
            rates, and equipment.
          </p>
        </div>
        <Link
          href="/loads"
          className="rounded-md border border-white/10 px-3 py-1.5 text-xs text-sp-textPrimary hover:bg-white/5"
        >
          ← Back
        </Link>
      </header>

      <NewLoadForm drivers={drivers} trucks={trucks} trailers={trailers} />
    </section>
  );
}
