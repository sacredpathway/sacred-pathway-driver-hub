// =============================================================================
//  /fleet/trailers/new — add a trailer
// =============================================================================

import Link from "next/link";
import FleetForm from "../../FleetForm";
import { createTrailerAction } from "../../actions";

export const runtime = "edge";

export default function NewTrailerPage() {
  return (
    <section className="space-y-4">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Add trailer</h1>
          <p className="mt-1 text-xs text-sp-textSecondary">
            Only Unit # is required. Trailer type unlocks group-by-equipment reports later.
          </p>
        </div>
        <Link href="/fleet" className="text-xs text-sp-textSecondary hover:text-sp-textPrimary">
          ← Back to fleet
        </Link>
      </header>

      <FleetForm kind="trailer" action={createTrailerAction} cancelHref="/fleet" />
    </section>
  );
}
