// =============================================================================
//  /drivers/[id]/edit — driver edit form
// -----------------------------------------------------------------------------
//  Phase E1. Loads the driver, hands it to the shared DriverForm with the
//  updateDriverAction bound. updateDriverAction already enforces:
//    • auth.getUser()
//    • profile_id = auth.uid() belt+suspenders on the UPDATE
//    • worker_type cross-field scrubs (W2 nulls 1099 cols, 1099 nulls W2 cols)
//
//  HISTORICAL PAYSTUB SAFETY: edits here do NOT touch the paystubs table.
//  Paystubs row each carry their own worker_type snapshot; child rows freeze
//  their own ytd_amount. A driver reclassification or rate change only
//  affects paystubs generated AFTER the change.
// =============================================================================

import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import DriverForm from "../../DriverForm";
import { updateDriverAction } from "../../actions";
import type { Driver } from "@/lib/supabase/types";

export const runtime = "edge";

export default async function EditDriverPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("drivers")
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

  const driver = data as Driver;
  const boundUpdate = updateDriverAction.bind(null, driver.id);

  return (
    <section className="space-y-4">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Edit {driver.name}</h1>
          <p className="mt-1 text-xs text-sp-textSecondary">
            Changes save to {driver.worker_type === "W2" ? "W2 Employee" : "1099 Contractor"} {driver.name}.
            Historical paystubs are immutable and won't be rewritten.
          </p>
        </div>
        <Link
          href={`/drivers/${driver.id}`}
          className="text-xs text-sp-textSecondary hover:text-sp-textPrimary"
        >
          ← Back to driver
        </Link>
      </header>

      <DriverForm
        driver={driver}
        action={boundUpdate}
        submitLabel="Save changes"
      />
    </section>
  );
}
