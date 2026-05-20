// =============================================================================
//  /fleet/trailers/[id]/edit — edit a trailer
// -----------------------------------------------------------------------------
//  Phase E2. Loads the trailer, pre-fills FleetForm, posts to
//  updateTrailerAction. RLS makes cross-user attempts 404.
// =============================================================================

import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import FleetForm from "../../../FleetForm";
import { updateTrailerAction } from "../../../actions";
import type { Trailer } from "@/lib/supabase/types";

export const runtime = "edge";

export default async function EditTrailerPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("trailers")
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
  const trailer = data as Trailer;

  return (
    <section className="space-y-4">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">
            Edit trailer #{trailer.unit_number}
          </h1>
          <p className="mt-1 text-xs text-sp-textSecondary">
            Changes save to this trailer. Historical load assignments aren't affected.
          </p>
        </div>
        <Link href="/fleet" className="text-xs text-sp-textSecondary hover:text-sp-textPrimary">
          ← Back to fleet
        </Link>
      </header>

      <FleetForm
        kind="trailer"
        action={updateTrailerAction.bind(null, trailer.id)}
        cancelHref="/fleet"
        initial={trailer}
        submitLabel="Save changes"
      />
    </section>
  );
}
