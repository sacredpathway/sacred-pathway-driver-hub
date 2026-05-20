// =============================================================================
//  AssignmentForm — set truck + trailer on a load
// -----------------------------------------------------------------------------
//  Renders two selects (truck, trailer) populated from the carrier's fleet,
//  pre-selecting the load's current assignment. Inactive / maintenance / sold
//  units are visible but de-emphasized so the carrier can backfill historical
//  loads to a now-retired truck if they need to.
//
//  Server action (updateLoadAssignmentAction) re-verifies ownership of both
//  the load and the picked truck/trailer before persisting.
// =============================================================================

"use client";

import { useActionState } from "react";
import type { Load, Truck, Trailer } from "@/lib/supabase/types";
import type { LoadActionState } from "../actions";

type TruckOption = Pick<Truck, "id" | "unit_number" | "status" | "make" | "model">;
type TrailerOption = Pick<
  Trailer,
  "id" | "unit_number" | "status" | "trailer_type" | "make" | "model"
>;

type ServerAction = (
  prev: LoadActionState | undefined,
  formData: FormData
) => Promise<LoadActionState>;

export default function AssignmentForm({
  load,
  trucks,
  trailers,
  assignedTruck,
  assignedTrailer,
  action,
}: {
  load: Load;
  trucks: TruckOption[];
  trailers: TrailerOption[];
  assignedTruck?: TruckOption;
  assignedTrailer?: TrailerOption;
  action: ServerAction;
}) {
  const [state, formAction, pending] = useActionState<
    LoadActionState | undefined,
    FormData
  >(action, undefined);

  return (
    <section className="rounded-xl border border-white/5 bg-sp-card/40 p-5">
      <header className="mb-3">
        <h2 className="text-base font-semibold text-sp-textPrimary">Fleet assignment</h2>
        <p className="mt-1 text-xs text-sp-textSecondary">
          Optional. Assign a truck and trailer so this load shows up under each
          fleet unit's history. ON DELETE SET NULL — if you delete the truck or
          trailer later, the load stays put.
        </p>
      </header>

      {state?.ok === true && (
        <div className="mb-3 rounded-md border border-sp-success/40 bg-sp-success/10 px-3 py-2 text-sm text-sp-success">
          Assignment saved.
        </div>
      )}
      {state && !state.ok && (
        <div className="mb-3 rounded-md border border-sp-danger/40 bg-sp-danger/10 px-3 py-2 text-sm text-sp-danger">
          {state.error}
        </div>
      )}

      <form action={formAction} className="space-y-4">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <label className="block">
            <span className="block text-xs font-medium uppercase tracking-wide text-sp-textSecondary">
              Truck
            </span>
            <select
              name="truck_id"
              defaultValue={load.truck_id ?? ""}
              className="mt-1 w-full rounded-md border border-white/10 bg-sp-background px-3 py-2 text-sm text-sp-textPrimary focus:border-sp-gold focus:outline-none"
            >
              <option value="">— Unassigned —</option>
              {renderUnitGroup(trucks, assignedTruck, truckLabel)}
            </select>
            {trucks.length === 0 && (
              <a
                href="/fleet/trucks/new"
                className="mt-1 inline-block text-[11px] text-sp-gold hover:underline"
              >
                + Add your first truck
              </a>
            )}
          </label>

          <label className="block">
            <span className="block text-xs font-medium uppercase tracking-wide text-sp-textSecondary">
              Trailer
            </span>
            <select
              name="trailer_id"
              defaultValue={load.trailer_id ?? ""}
              className="mt-1 w-full rounded-md border border-white/10 bg-sp-background px-3 py-2 text-sm text-sp-textPrimary focus:border-sp-gold focus:outline-none"
            >
              <option value="">— Unassigned —</option>
              {renderUnitGroup(trailers, assignedTrailer, trailerLabel)}
            </select>
            {trailers.length === 0 && (
              <a
                href="/fleet/trailers/new"
                className="mt-1 inline-block text-[11px] text-sp-gold hover:underline"
              >
                + Add your first trailer
              </a>
            )}
          </label>
        </div>

        <div className="flex items-center justify-end">
          <button
            type="submit"
            disabled={pending}
            className="rounded-md bg-sp-gold px-4 py-2 text-sm font-semibold text-sp-black hover:bg-sp-goldLight disabled:opacity-50"
          >
            {pending ? "Saving…" : "Save assignment"}
          </button>
        </div>
      </form>
    </section>
  );
}

// =============================================================================
//  Render helpers — group active + everything else
// =============================================================================

function renderUnitGroup<
  T extends { id: string; status: string; unit_number: string }
>(
  units: T[],
  assigned: T | undefined,
  label: (u: T) => string
): React.ReactNode {
  const active = units.filter((u) => u.status === "active");
  const others = units.filter((u) => u.status !== "active");

  // If the currently-assigned unit isn't active, make sure it still appears
  // (it lives in the "others" bucket already, but we'll surface its status).
  return (
    <>
      {active.length > 0 && (
        <optgroup label="Active">
          {active.map((u) => (
            <option key={u.id} value={u.id}>
              {label(u)}
            </option>
          ))}
        </optgroup>
      )}
      {others.length > 0 && (
        <optgroup label="Inactive / Maintenance / Sold">
          {others.map((u) => (
            <option key={u.id} value={u.id}>
              {label(u)}
              {assigned && u.id === assigned.id ? " (assigned)" : ""}
            </option>
          ))}
        </optgroup>
      )}
    </>
  );
}

function truckLabel(t: TruckOption): string {
  const ymm = [t.make, t.model].filter(Boolean).join(" ");
  const suffix = ymm ? `  ·  ${ymm}` : "";
  const statusSuffix = t.status === "active" ? "" : `  (${t.status})`;
  return `#${t.unit_number}${suffix}${statusSuffix}`;
}

function trailerLabel(t: TrailerOption): string {
  const ymm = [t.make, t.model].filter(Boolean).join(" ");
  const type = t.trailer_type ? prettyType(t.trailer_type) : null;
  const parts = [type, ymm].filter(Boolean);
  const suffix = parts.length ? `  ·  ${parts.join(" ")}` : "";
  const statusSuffix = t.status === "active" ? "" : `  (${t.status})`;
  return `#${t.unit_number}${suffix}${statusSuffix}`;
}

function prettyType(t: string): string {
  return t.split("_").map((p) => p.charAt(0).toUpperCase() + p.slice(1)).join(" ");
}
