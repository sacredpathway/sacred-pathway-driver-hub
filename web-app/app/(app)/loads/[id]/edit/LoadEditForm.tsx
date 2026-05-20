// =============================================================================
//  LoadEditForm — full load edit (broker / route / dates / financials /
//                  status / fleet assignment) · Phase E3
// -----------------------------------------------------------------------------
//  All fields here map 1:1 to updateLoadAction's payload. Inline error display
//  via useActionState. Truck/Trailer pickers show active units first; the
//  carrier can still re-pick a now-retired unit to backfill historical data.
//  Explicit "— Unassigned —" option allows clearing the FK to NULL.
// =============================================================================

"use client";

import { useActionState } from "react";
import type { Load, Truck, Trailer } from "@/lib/supabase/types";
import type { LoadActionState } from "../../actions";

type ServerAction = (
  prev: LoadActionState | undefined,
  formData: FormData
) => Promise<LoadActionState>;

type TruckOption = Pick<Truck, "id" | "unit_number" | "status" | "make" | "model">;
type TrailerOption = Pick<Trailer, "id" | "unit_number" | "status" | "trailer_type" | "make" | "model">;

const LOAD_STATUS_OPTIONS: ReadonlyArray<{ value: string; label: string }> = [
  { value: "",                     label: "— Not set —" },
  { value: "unassigned",           label: "Unassigned" },
  { value: "assigned",             label: "Assigned" },
  { value: "in_transit",           label: "In transit" },
  { value: "delivered",            label: "Delivered" },
  { value: "ready_for_settlement", label: "Ready for settlement" },
  { value: "settled",              label: "Settled" },
  { value: "cancelled",            label: "Cancelled" },
];

export default function LoadEditForm({
  load,
  trucks,
  trailers,
  action,
}: {
  load: Load;
  trucks: TruckOption[];
  trailers: TrailerOption[];
  action: ServerAction;
}) {
  const [state, formAction, pending] = useActionState<
    LoadActionState | undefined,
    FormData
  >(action, undefined);

  return (
    <form action={formAction} className="space-y-6">
      {state && !state.ok && (
        <div className="rounded-md border border-sp-danger/40 bg-sp-danger/10 px-3 py-2 text-sm text-sp-danger">
          {state.error}
        </div>
      )}

      {/* Broker / load # / status */}
      <section className="rounded-xl border border-white/5 bg-sp-card/40 p-5">
        <h2 className="text-base font-semibold text-sp-textPrimary">Broker & status</h2>
        <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2">
          <Field label="Load #" name="load_number" defaultValue={load.load_number ?? ""} />
          <SelectField
            label="Status"
            name="status"
            defaultValue={load.status ?? ""}
            options={LOAD_STATUS_OPTIONS}
          />
          <Field label="Broker name" name="broker_name" defaultValue={load.broker_name ?? ""} />
          <Field label="Broker MC #" name="broker_mc_number" defaultValue={load.broker_mc_number ?? ""} />
        </div>
      </section>

      {/* Route + dates */}
      <section className="rounded-xl border border-white/5 bg-sp-card/40 p-5">
        <h2 className="text-base font-semibold text-sp-textPrimary">Route & schedule</h2>
        <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2">
          <Field label="Origin" name="origin" defaultValue={load.origin ?? ""} />
          <Field label="Destination" name="destination" defaultValue={load.destination ?? ""} />
          <Field
            label="Pickup date"
            name="pickup_date"
            type="date"
            defaultValue={load.pickup_date ?? ""}
          />
          <Field
            label="Delivery date"
            name="delivery_date"
            type="date"
            defaultValue={load.delivery_date ?? ""}
          />
          <Field
            label="Total miles"
            name="total_miles"
            inputMode="decimal"
            defaultValue={load.total_miles?.toString() ?? ""}
          />
        </div>
      </section>

      {/* Financials */}
      <section className="rounded-xl border border-white/5 bg-sp-card/40 p-5">
        <h2 className="text-base font-semibold text-sp-textPrimary">Financials</h2>
        <p className="mt-1 text-xs text-sp-textSecondary">
          Total revenue is what's settled in payroll. Line haul + FSC + accessorials
          are informational breakouts.
        </p>
        <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2">
          <Field
            label="Line haul ($)"
            name="line_haul_rate"
            inputMode="decimal"
            defaultValue={load.line_haul_rate?.toString() ?? ""}
          />
          <Field
            label="Fuel surcharge ($)"
            name="fuel_surcharge"
            inputMode="decimal"
            defaultValue={load.fuel_surcharge?.toString() ?? ""}
          />
          <Field
            label="Accessorials ($)"
            name="accessorial_charges"
            inputMode="decimal"
            defaultValue={load.accessorial_charges?.toString() ?? ""}
          />
          <Field
            label="Total revenue ($) *"
            name="total_revenue"
            inputMode="decimal"
            defaultValue={load.total_revenue?.toString() ?? ""}
            help="What the payroll generator uses"
          />
        </div>
      </section>

      {/* Fleet assignment — same logic as the standalone AssignmentForm,
          merged here so the carrier can edit everything in one form. */}
      <section className="rounded-xl border border-white/5 bg-sp-card/40 p-5">
        <header className="mb-3">
          <h2 className="text-base font-semibold text-sp-textPrimary">Fleet assignment</h2>
          <p className="mt-1 text-xs text-sp-textSecondary">
            Optional. Picking "— Unassigned —" explicitly clears the FK (sets to
            NULL). ON DELETE SET NULL applies if the truck/trailer is later removed.
          </p>
        </header>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <SelectFleet
            label="Truck"
            name="truck_id"
            defaultValue={load.truck_id ?? ""}
            options={trucksToOptions(trucks)}
          />
          <SelectFleet
            label="Trailer"
            name="trailer_id"
            defaultValue={load.trailer_id ?? ""}
            options={trailersToOptions(trailers)}
          />
        </div>
      </section>

      <div className="sticky bottom-0 -mx-4 border-t border-white/5 bg-sp-background/95 px-4 py-3 backdrop-blur">
        <div className="flex items-center justify-end gap-3">
          <a
            href={`/loads/${load.id}`}
            className="rounded-md border border-white/10 px-4 py-2 text-sm text-sp-textSecondary hover:bg-white/5"
          >
            Cancel
          </a>
          <button
            type="submit"
            disabled={pending}
            className="rounded-md bg-sp-gold px-4 py-2 text-sm font-semibold text-sp-black hover:bg-sp-goldLight disabled:opacity-50"
          >
            {pending ? "Saving…" : "Save changes"}
          </button>
        </div>
      </div>
    </form>
  );
}

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------

function Field({
  label,
  name,
  type = "text",
  defaultValue,
  help,
  inputMode,
}: {
  label: string;
  name: string;
  type?: string;
  defaultValue?: string;
  help?: string;
  inputMode?: "decimal" | "numeric" | "text";
}) {
  return (
    <label className="block">
      <span className="block text-xs font-medium uppercase tracking-wide text-sp-textSecondary">
        {label}
      </span>
      <input
        type={type}
        name={name}
        defaultValue={defaultValue ?? ""}
        inputMode={inputMode}
        className="mt-1 w-full rounded-md border border-white/10 bg-sp-background px-3 py-2 text-sm text-sp-textPrimary placeholder:text-sp-textSecondary/60 focus:border-sp-gold focus:outline-none"
      />
      {help && <span className="mt-1 block text-[10px] text-sp-textSecondary">{help}</span>}
    </label>
  );
}

function SelectField({
  label,
  name,
  defaultValue,
  options,
}: {
  label: string;
  name: string;
  defaultValue: string;
  options: ReadonlyArray<{ value: string; label: string }>;
}) {
  return (
    <label className="block">
      <span className="block text-xs font-medium uppercase tracking-wide text-sp-textSecondary">
        {label}
      </span>
      <select
        name={name}
        defaultValue={defaultValue}
        className="mt-1 w-full rounded-md border border-white/10 bg-sp-background px-3 py-2 text-sm text-sp-textPrimary focus:border-sp-gold focus:outline-none"
      >
        {options.map((o) => (
          <option key={o.value || "none"} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function SelectFleet({
  label,
  name,
  defaultValue,
  options,
}: {
  label: string;
  name: string;
  defaultValue: string;
  options: ReadonlyArray<{ value: string; label: string; group?: "active" | "other" }>;
}) {
  const active = options.filter((o) => o.group === "active");
  const others = options.filter((o) => o.group === "other");

  return (
    <label className="block">
      <span className="block text-xs font-medium uppercase tracking-wide text-sp-textSecondary">
        {label}
      </span>
      <select
        name={name}
        defaultValue={defaultValue}
        className="mt-1 w-full rounded-md border border-white/10 bg-sp-background px-3 py-2 text-sm text-sp-textPrimary focus:border-sp-gold focus:outline-none"
      >
        <option value="">— Unassigned —</option>
        {active.length > 0 && (
          <optgroup label="Active">
            {active.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </optgroup>
        )}
        {others.length > 0 && (
          <optgroup label="Inactive / Maintenance / Sold">
            {others.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </optgroup>
        )}
      </select>
    </label>
  );
}

function trucksToOptions(
  trucks: TruckOption[]
): Array<{ value: string; label: string; group: "active" | "other" }> {
  return trucks.map((t) => ({
    value: t.id,
    label: truckLabel(t),
    group: t.status === "active" ? "active" : "other",
  }));
}

function trailersToOptions(
  trailers: TrailerOption[]
): Array<{ value: string; label: string; group: "active" | "other" }> {
  return trailers.map((t) => ({
    value: t.id,
    label: trailerLabel(t),
    group: t.status === "active" ? "active" : "other",
  }));
}

function truckLabel(t: TruckOption): string {
  const ymm = [t.make, t.model].filter(Boolean).join(" ");
  const suffix = ymm ? ` · ${ymm}` : "";
  const status = t.status === "active" ? "" : ` (${t.status})`;
  return `#${t.unit_number}${suffix}${status}`;
}

function trailerLabel(t: TrailerOption): string {
  const ymm = [t.make, t.model].filter(Boolean).join(" ");
  const type = t.trailer_type
    ? t.trailer_type.split("_").map((p) => p.charAt(0).toUpperCase() + p.slice(1)).join(" ")
    : null;
  const parts = [type, ymm].filter(Boolean);
  const suffix = parts.length ? ` · ${parts.join(" ")}` : "";
  const status = t.status === "active" ? "" : ` (${t.status})`;
  return `#${t.unit_number}${suffix}${status}`;
}
