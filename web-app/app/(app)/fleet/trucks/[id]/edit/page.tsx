// =============================================================================
//  /fleet/trucks/[id]/edit — edit a truck
// -----------------------------------------------------------------------------
//  Phase E2. Loads the truck, pre-fills FleetForm, posts to updateTruckAction.
//  RLS makes the SELECT return null for cross-user attempts → 404.
// =============================================================================

import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import FleetForm from "../../../FleetForm";
import { updateTruckAction } from "../../../actions";
import type { Truck } from "@/lib/supabase/types";

export const runtime = "edge";

export default async function EditTruckPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("trucks")
    .select("*")
    .eq("id", id)
    .maybeSingle();

  if (error) {
    return (
      <div className="rounded-lg border border-sp-danger/40 bg-sp-danger/10 p-4 text-sm text-sp-danger">
        {error.message}
      </div>
    );
  }
  if (!data) notFound();
  const truck = data as Truck;

  return (
    <section className="space-y-4">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">
            Edit truck #{truck.unit_number}
          </h1>
          <p className="mt-1 text-xs text-sp-textSecondary">
            Changes save to this truck. Historical load assignments aren't affected.
          </p>
        </div>
        <Link href="/fleet" className="text-xs text-sp-textSecondary hover:text-sp-textPrimary">
          ← Back to fleet
        </Link>
      </header>

      <FleetForm
        kind="truck"
        action={updateTruckAction.bind(null, truck.id)}
        cancelHref="/fleet"
        initial={truck}
        submitLabel="Save changes"
      />
    </section>
  );
}
