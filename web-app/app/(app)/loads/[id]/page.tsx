// =============================================================================
//  /loads/[id] — load detail + fleet assignment
// -----------------------------------------------------------------------------
//  Read-only header summarising the load (origin → destination, miles, revenue,
//  broker, driver) plus an editable fleet-assignment card. Full load editing
//  (rate, miles, broker, dates) lands in a later W3 step.
// =============================================================================

import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { formatCurrency, formatDate, formatNumber } from "@/lib/format";
import AssignmentForm from "./AssignmentForm";
import DeleteLoadButton from "./DeleteLoadButton";
import { updateLoadAssignmentAction, deleteLoadAction } from "../actions";
import type { Load, Truck, Trailer, Driver } from "@/lib/supabase/types";

export const runtime = "edge";

export default async function LoadDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ updated?: string }>;
}) {
  const { id } = await params;
  const sp = await searchParams;
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

  // Pull active fleet + assigned (in case the currently-assigned unit was
  // deactivated). Trucks fetched separately so the picker can keep showing
  // the existing assignment even if it's now `inactive`.
  const [{ data: trucksRaw }, { data: trailersRaw }, { data: driverRaw }] = await Promise.all([
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
    load.driver_id
      ? supabase.from("drivers").select("id, name").eq("id", load.driver_id).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  const trucks = (trucksRaw ?? []) as Array<
    Pick<Truck, "id" | "unit_number" | "status" | "make" | "model">
  >;
  const trailers = (trailersRaw ?? []) as Array<
    Pick<Trailer, "id" | "unit_number" | "status" | "trailer_type" | "make" | "model">
  >;
  const driver = driverRaw as Pick<Driver, "id" | "name"> | null;

  const assignedTruck = load.truck_id
    ? trucks.find((t) => t.id === load.truck_id)
    : undefined;
  const assignedTrailer = load.trailer_id
    ? trailers.find((t) => t.id === load.trailer_id)
    : undefined;

  return (
    <section className="space-y-4">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">
            Load {load.load_number ? `#${load.load_number}` : ""}
          </h1>
          <p className="mt-1 text-xs text-sp-textSecondary">
            {[load.origin, load.destination].filter(Boolean).join(" → ") || "—"}
            {load.broker_name ? ` · ${load.broker_name}` : ""}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href={`/loads/${load.id}/edit`}
            className="rounded-md bg-sp-gold px-3 py-1.5 text-xs font-semibold text-sp-black hover:bg-sp-goldLight"
          >
            Edit
          </Link>
          <Link href="/loads" className="text-xs text-sp-textSecondary hover:text-sp-textPrimary">
            ← All loads
          </Link>
        </div>
      </header>

      {sp.updated && (
        <div className="rounded-md border border-sp-success/40 bg-sp-success/10 px-3 py-2 text-sm text-sp-success">
          Load updated.
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Tile label="Revenue" value={formatCurrency(load.total_revenue)} tone="gold" />
        <Tile label="Miles" value={formatNumber(load.total_miles)} />
        <Tile label="Pickup" value={formatDate(load.pickup_date)} />
        <Tile label="Delivery" value={formatDate(load.delivery_date)} />
      </div>

      <section className="rounded-xl border border-white/5 bg-sp-card/40 p-5 text-sm">
        <h2 className="text-base font-semibold text-sp-textPrimary">Details</h2>
        <dl className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2">
          <Field label="Status" value={load.status ?? "—"} />
          <Field label="Driver" value={driver?.name ?? "Unassigned"} />
          <Field label="Broker" value={load.broker_name ?? "—"} />
          <Field label="Broker rep" value={load.broker_contact_name ?? "—"} />
          <Field label="Line haul" value={formatCurrency(load.line_haul_rate)} />
          <Field label="Fuel surcharge" value={formatCurrency(load.fuel_surcharge)} />
          <Field label="Accessorials" value={formatCurrency(load.accessorial_charges)} />
          <Field label="Created" value={formatDate(load.created_at)} />
        </dl>
      </section>

      <AssignmentForm
        load={load}
        trucks={trucks}
        trailers={trailers}
        assignedTruck={assignedTruck}
        assignedTrailer={assignedTrailer}
        action={updateLoadAssignmentAction.bind(null, load.id)}
      />

      {/* Danger zone — hard delete, refused if referenced by any paystub. */}
      <section className="rounded-xl border border-white/5 bg-sp-card/40 p-5">
        <h2 className="text-base font-semibold text-sp-textPrimary">Danger zone</h2>
        <p className="mt-1 text-xs text-sp-textSecondary">
          Deleting is permanent. Refused automatically if this load is on any
          paystub (draft, issued, paid, or voided) — history is preserved.
        </p>
        <div className="mt-3">
          <form action={deleteLoadAction.bind(null, load.id)}>
            <DeleteLoadButton />
          </form>
        </div>
      </section>
    </section>
  );
}

function Tile({
  label,
  value,
  tone = "neutral",
}: {
  label: string;
  value: string;
  tone?: "neutral" | "gold";
}) {
  const cls = tone === "gold" ? "text-sp-gold" : "text-sp-textPrimary";
  return (
    <div className="rounded-xl border border-white/5 bg-sp-card p-4">
      <div className="text-xs font-semibold uppercase tracking-wide text-sp-textSecondary">
        {label}
      </div>
      <div className={`mt-1 text-xl font-bold tracking-tight ${cls}`}>{value}</div>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[10px] font-semibold uppercase tracking-wide text-sp-textSecondary">
        {label}
      </dt>
      <dd className="mt-0.5 text-sm text-sp-textPrimary">{value}</dd>
    </div>
  );
}
