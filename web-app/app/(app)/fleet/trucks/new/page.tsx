// =============================================================================
//  /fleet/trucks/new — add a truck
// =============================================================================

import Link from "next/link";
import FleetForm from "../../FleetForm";
import { createTruckAction } from "../../actions";

export const runtime = "edge";

export default function NewTruckPage() {
  return (
    <section className="space-y-4">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Add truck</h1>
          <p className="mt-1 text-xs text-sp-textSecondary">
            Only Unit # is required. You can fill in the rest later.
          </p>
        </div>
        <Link href="/fleet" className="text-xs text-sp-textSecondary hover:text-sp-textPrimary">
          ← Back to fleet
        </Link>
      </header>

      <FleetForm kind="truck" action={createTruckAction} cancelHref="/fleet" />
    </section>
  );
}
