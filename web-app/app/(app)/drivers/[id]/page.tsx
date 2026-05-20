// =============================================================================
//  /drivers/[id] — edit a driver · Phase W2 commit #2
// -----------------------------------------------------------------------------
//  Server component. Loads one driver row by id (RLS enforces ownership) and
//  passes it to DriverForm. Legacy iOS rows without worker_type are rendered
//  as 1099 by the form's prop default.
// =============================================================================

import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import DriverForm from "../DriverForm";
import {
  deactivateDriverAction,
  reactivateDriverAction,
  updateDriverAction,
} from "../actions";
import type { Driver } from "@/lib/supabase/types";

export const runtime = "edge";

export default async function EditDriverPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ created?: string; updated?: string }>;
}) {
  const { id } = await params;
  const sp = await searchParams;

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
  // Bound server action so the form posts to it directly.
  const boundUpdate = updateDriverAction.bind(null, driver.id);

  return (
    <section className="space-y-4">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{driver.name}</h1>
          <p className="mt-1 text-xs text-sp-textSecondary">
            {driver.worker_type === "W2" ? "W2 Employee" : "1099 Contractor"} ·{" "}
            {driver.active ? "Active" : "Inactive"}
          </p>
        </div>
        <Link
          href="/drivers"
          className="text-xs text-sp-textSecondary hover:text-sp-textPrimary"
        >
          ← All drivers
        </Link>
      </header>

      {sp.created && (
        <FlashOK message="Driver created." />
      )}
      {sp.updated && (
        <FlashOK message="Driver updated." />
      )}

      <DriverForm
        driver={driver}
        action={boundUpdate}
        submitLabel="Save changes"
      />

      <section className="rounded-xl border border-white/5 bg-sp-card/40 p-5">
        <h2 className="text-base font-semibold text-sp-textPrimary">Danger zone</h2>
        <p className="mt-1 text-xs text-sp-textSecondary">
          Drivers can't be hard-deleted (their paystub history must remain
          intact). Deactivate to remove them from active payroll.
        </p>
        <div className="mt-3 flex items-center gap-2">
          {driver.active ? (
            <form action={deactivateDriverAction.bind(null, driver.id)}>
              <button
                type="submit"
                className="rounded-md border border-sp-danger/40 px-3 py-1.5 text-xs font-medium text-sp-danger hover:bg-sp-danger/10"
              >
                Deactivate driver
              </button>
            </form>
          ) : (
            <form action={reactivateDriverAction.bind(null, driver.id)}>
              <button
                type="submit"
                className="rounded-md border border-sp-success/40 px-3 py-1.5 text-xs font-medium text-sp-success hover:bg-sp-success/10"
              >
                Reactivate driver
              </button>
            </form>
          )}
        </div>
      </section>
    </section>
  );
}

function FlashOK({ message }: { message: string }) {
  return (
    <div className="rounded-md border border-sp-success/40 bg-sp-success/10 px-3 py-2 text-sm text-sp-success">
      {message}
    </div>
  );
}
