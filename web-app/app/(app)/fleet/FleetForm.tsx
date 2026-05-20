// =============================================================================
//  FleetForm — shared client form for Add Truck and Add Trailer
// -----------------------------------------------------------------------------
//  The two forms share 95% of their fields (unit_number, make, model, year,
//  VIN, plate, state, status, notes). When `kind === "trailer"`, an extra
//  trailer_type select is rendered above Year/Make/Model.
//
//  Inline error display via useActionState. No client-side validation beyond
//  HTML `required` — server is the source of truth.
// =============================================================================

"use client";

import { useActionState } from "react";
import type { FleetStatus, TrailerType } from "@/lib/supabase/types";
import type { FleetActionState } from "./actions";

type ServerAction = (
  prev: FleetActionState | undefined,
  formData: FormData
) => Promise<FleetActionState>;

const STATUS_OPTIONS: ReadonlyArray<{ value: FleetStatus; label: string }> = [
  { value: "active",       label: "Active" },
  { value: "inactive",     label: "Inactive" },
  { value: "maintenance",  label: "In maintenance" },
  { value: "sold",         label: "Sold" },
];

const TRAILER_TYPE_OPTIONS: ReadonlyArray<{ value: TrailerType | ""; label: string }> = [
  { value: "",           label: "— Select type —" },
  { value: "dry_van",    label: "Dry van" },
  { value: "reefer",     label: "Reefer" },
  { value: "flatbed",    label: "Flatbed" },
  { value: "step_deck",  label: "Step deck" },
  { value: "tanker",     label: "Tanker" },
  { value: "lowboy",     label: "Lowboy" },
  { value: "car_hauler", label: "Car hauler" },
  { value: "container",  label: "Container" },
  { value: "dump",       label: "Dump" },
  { value: "hopper",     label: "Hopper" },
  { value: "other",      label: "Other" },
];

export default function FleetForm({
  kind,
  action,
  cancelHref,
}: {
  kind: "truck" | "trailer";
  action: ServerAction;
  cancelHref: string;
}) {
  const [state, formAction, pending] = useActionState<
    FleetActionState | undefined,
    FormData
  >(action, undefined);

  const isTrailer = kind === "trailer";

  return (
    <form action={formAction} className="space-y-6">
      {state && !state.ok && (
        <div className="rounded-md border border-sp-danger/40 bg-sp-danger/10 px-3 py-2 text-sm text-sp-danger">
          {state.error}
        </div>
      )}

      <section className="rounded-xl border border-white/5 bg-sp-card/40 p-5">
        <h2 className="text-base font-semibold text-sp-textPrimary">
          {isTrailer ? "Trailer" : "Truck"}
        </h2>
        <p className="mt-1 text-xs text-sp-textSecondary">
          Only Unit # is required. Everything else is optional and can be
          backfilled later.
        </p>
        <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2">
          <Field
            label="Unit # *"
            name="unit_number"
            required
            placeholder={isTrailer ? "T-101" : "7"}
          />
          {isTrailer && (
            <Select
              label="Trailer type"
              name="trailer_type"
              options={TRAILER_TYPE_OPTIONS}
              defaultValue=""
            />
          )}
          <Field label="Year"  name="year"  inputMode="numeric" placeholder="2024" />
          <Field label="Make"  name="make"  placeholder="Freightliner" />
          <Field label="Model" name="model" placeholder="Cascadia" />
          <Field label="VIN"   name="vin"   placeholder="17-character VIN" />
          <Field label="Plate #" name="plate_number" placeholder="ABC-1234" />
          <Field label="Plate state" name="state" maxLength={2} placeholder="TX" />
          <Select
            label="Status"
            name="status"
            options={STATUS_OPTIONS}
            defaultValue="active"
          />
        </div>
      </section>

      <section className="rounded-xl border border-white/5 bg-sp-card/40 p-5">
        <label className="block">
          <span className="block text-xs font-medium uppercase tracking-wide text-sp-textSecondary">
            Notes (optional)
          </span>
          <textarea
            name="notes"
            rows={3}
            placeholder="Title #, insurance carrier, maintenance reminders, etc."
            className="mt-1 w-full rounded-md border border-white/10 bg-sp-background px-3 py-2 text-sm text-sp-textPrimary placeholder:text-sp-textSecondary/60 focus:border-sp-gold focus:outline-none"
          />
        </label>
      </section>

      <div className="sticky bottom-0 -mx-4 border-t border-white/5 bg-sp-background/95 px-4 py-3 backdrop-blur">
        <div className="flex items-center justify-end gap-3">
          <a
            href={cancelHref}
            className="rounded-md border border-white/10 px-4 py-2 text-sm text-sp-textSecondary hover:bg-white/5"
          >
            Cancel
          </a>
          <button
            type="submit"
            disabled={pending}
            className="rounded-md bg-sp-gold px-4 py-2 text-sm font-semibold text-sp-black hover:bg-sp-goldLight disabled:opacity-50"
          >
            {pending ? "Saving…" : isTrailer ? "Add trailer" : "Add truck"}
          </button>
        </div>
      </div>
    </form>
  );
}

// =============================================================================
//  Tiny shared fields (kept local so the commit stays narrow)
// =============================================================================

function Field({
  label,
  name,
  type = "text",
  placeholder,
  required,
  inputMode,
  maxLength,
}: {
  label: string;
  name: string;
  type?: string;
  placeholder?: string;
  required?: boolean;
  inputMode?: "decimal" | "numeric" | "text";
  maxLength?: number;
}) {
  return (
    <label className="block">
      <span className="block text-xs font-medium uppercase tracking-wide text-sp-textSecondary">
        {label}
      </span>
      <input
        type={type}
        name={name}
        placeholder={placeholder}
        required={required}
        inputMode={inputMode}
        maxLength={maxLength}
        className="mt-1 w-full rounded-md border border-white/10 bg-sp-background px-3 py-2 text-sm text-sp-textPrimary placeholder:text-sp-textSecondary/60 focus:border-sp-gold focus:outline-none"
      />
    </label>
  );
}

function Select({
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
