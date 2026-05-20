// =============================================================================
//  /loads/[id]/edit — full load edit page
// -----------------------------------------------------------------------------
//  Phase E3. Loads everything LoadEditForm needs and binds updateLoadAction.
//  RLS makes cross-user attempts 404.
// =============================================================================

import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import LoadEditForm from "./LoadEditForm";
import { updateLoadAction } from "../../actions";
import type { Load, Truck, Trailer } from "@/lib/supabase/types";

export const runtime = "edge";

export default async function EditLoadPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();

  const { data: loadRaw, error } = await supabase
    .from("loads")
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
  if (!loadRaw) notFound();
  const load = loadRaw as Load;

  const [{ data: trucksRaw }, { data: trailersRaw }] = await Promise.all([
    supabase
      .from("trucks")
      .select("id, unit_number, status, make, model")
      .order("status", { ascending: true })
      .order("unit_number", { ascending: true }),
    supabase
      .from("trailers")
      .select("id, unit_number, status, trailer_type, make, model")
      .order("status", { ascending: true })
      .order("unit_number", { ascending: true }),
  ]);

  const trucks = (trucksRaw ?? []) as Array<
    Pick<Truck, "id" | "unit_number" | "status" | "make" | "model">
  >;
  const trailers = (trailersRaw ?? []) as Array<
    Pick<Trailer, "id" | "unit_number" | "status" | "trailer_type" | "make" | "model">
  >;

  return (
    <section className="space-y-4">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">
            Edit load {load.load_number ? `#${load.load_number}` : ""}
          </h1>
          <p className="mt-1 text-xs text-sp-textSecondary">
            {[load.origin, load.destination].filter(Boolean).join(" → ") || "—"}
            {load.broker_name ? ` · ${load.broker_name}` : ""}
          </p>
        </div>
        <Link
          href={`/loads/${load.id}`}
          className="text-xs text-sp-textSecondary hover:text-sp-textPrimary"
        >
          ← Back to load
        </Link>
      </header>

      <LoadEditForm
        load={load}
        trucks={trucks}
        trailers={trailers}
        action={updateLoadAction.bind(null, load.id)}
      />
    </section>
  );
}
