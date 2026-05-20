// =============================================================================
//  /drivers/new — create a new driver · Phase W2 commit #2
// -----------------------------------------------------------------------------
//  Thin server page that hands off to DriverForm. Defaults the new driver to
//  worker_type='1099' to match existing iOS behavior; the carrier can flip the
//  toggle to 'W2' before saving.
// =============================================================================

import Link from "next/link";
import DriverForm from "../DriverForm";
import { createDriverAction } from "../actions";

export const runtime = "edge";

export default function NewDriverPage() {
  return (
    <section className="space-y-4">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Add driver</h1>
          <p className="mt-1 text-xs text-sp-textSecondary">
            Choose 1099 contractor or W2 employee — fields change based on the type.
          </p>
        </div>
        <Link
          href="/drivers"
          className="text-xs text-sp-textSecondary hover:text-sp-textPrimary"
        >
          ← All drivers
        </Link>
      </header>

      <DriverForm
        driver={{ worker_type: "1099", active: true }}
        action={createDriverAction}
        submitLabel="Create driver"
      />
    </section>
  );
}
