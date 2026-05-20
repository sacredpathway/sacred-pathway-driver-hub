// =============================================================================
//  /payroll/new — start a new paystub draft
// -----------------------------------------------------------------------------
//  Server component. Loads the carrier's active drivers + unsettled loads,
//  passes them to NewPaystubForm (client) which lets the carrier pick a
//  driver, a pay period, and (for 1099s) which loads to include.
//
//  Submitting calls createPaystubAction which creates a draft + seeds
//  earnings lines, then redirects to /payroll/[id].
// =============================================================================

import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import EmptyState from "@/components/EmptyState";
import NewPaystubForm from "./NewPaystubForm";
import { createPaystubAction } from "../actions";
import type { Driver, Load } from "@/lib/supabase/types";

export const runtime = "edge";

export default async function NewPaystubPage() {
  const supabase = await createClient();

  const [{ data: driversRaw }, { data: loadsRaw }] = await Promise.all([
    supabase
      .from("drivers")
      .select("*")
      .eq("active", true)
      .order("name", { ascending: true }),
    // Loads that haven't been settled yet. We don't enforce strict eligibility
    // here — the carrier can still skip loads. Status filter is advisory.
    supabase
      .from("loads")
      .select(
        "id, load_number, broker_name, origin, destination, pickup_date, " +
          "delivery_date, total_miles, total_revenue, status, driver_id"
      )
      .order("pickup_date", { ascending: false, nullsFirst: false })
      .limit(200),
  ]);

  const drivers = (driversRaw ?? []) as Driver[];
  const loads = (loadsRaw ?? []) as unknown as Pick<
    Load,
    "id" | "load_number" | "broker_name" | "origin" | "destination" |
    "pickup_date" | "delivery_date" | "total_miles" | "total_revenue" |
    "status" | "driver_id"
  >[];

  return (
    <section className="space-y-4">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">New paystub</h1>
          <p className="mt-1 text-xs text-sp-textSecondary">
            Carrier HQ creates a draft. You'll review line items on the next screen before issuing.
          </p>
        </div>
        <Link href="/payroll" className="text-xs text-sp-textSecondary hover:text-sp-textPrimary">
          ← All paystubs
        </Link>
      </header>

      {drivers.length === 0 ? (
        <EmptyState
          title="Add a driver first"
          body="Create at least one 1099 contractor or W2 employee before generating payroll."
          cta={
            <Link
              href="/drivers/new"
              className="inline-block rounded-md bg-sp-gold px-4 py-2 text-sm font-semibold text-sp-black hover:bg-sp-goldLight"
            >
              Add driver
            </Link>
          }
        />
      ) : (
        <NewPaystubForm
          drivers={drivers}
          loads={loads}
          action={createPaystubAction}
        />
      )}
    </section>
  );
}
