// =============================================================================
//  NewLoadForm — Carrier HQ Phase W7
// -----------------------------------------------------------------------------
//  Client component. Server action (createLoadAction) is bound via the
//  useActionState hook for inline error rendering.
// =============================================================================

"use client";

import { useActionState } from "react";
import type { Driver, Truck, Trailer } from "@/lib/supabase/types";
import {
  createLoadAction,
  LOAD_STATUS_OPTIONS,
  type LoadActionState,
} from "../actions";

export default function NewLoadForm({
  drivers,
  trucks,
  trailers,
}: {
  drivers:  ReadonlyArray<Pick<Driver,  "id" | "name" | "worker_type" | "active" | "truck_number">>;
  trucks:   ReadonlyArray<Pick<Truck,   "id" | "unit_number" | "status">>;
  trailers: ReadonlyArray<Pick<Trailer, "id" | "unit_number" | "trailer_type" | "status">>;
}) {
  const [state, formAction, pending] = useActionState<
    LoadActionState | undefined,
    FormData
  >(createLoadAction, undefined);

  return (
    <form action={formAction} className="space-y-6">
      {state && !state.ok && (
        <div className="rounded-lg border border-sp-danger/40 bg-sp-danger/10 p-3 text-sm text-sp-danger">
          {state.error}
        </div>
      )}

      {/* ---------- Identifying ---------- */}
      <Section title="Load">
        <Grid2>
          <Field label="Load #"           name="load_number"      placeholder="e.g. 451223" />
          <Field label="Status"           name="status">
            <select
              name="status"
              defaultValue="unassigned"
              className="w-full rounded-lg bg-sp-cardLight px-3 py-2 text-sm text-sp-textPrimary outline-none ring-1 ring-white/5 focus:ring-sp-gold"
            >
              {LOAD_STATUS_OPTIONS.map((s) => (
                <option key={s} value={s}>{labelize(s)}</option>
              ))}
            </select>
          </Field>
        </Grid2>
      </Section>

      {/* ---------- Broker ---------- */}
      <Section title="Broker" subtitle="Free-form here. iOS Smart Scan and the brokers list normalize broker_id / contact links automatically.">
        <Grid2>
          <Field label="Broker name"      name="broker_name"      placeholder="TQL, Total Quality Logistics, etc." />
          <Field label="Broker MC #"      name="broker_mc_number" placeholder="012345" />
        </Grid2>
        <Grid2>
          <Field label="Rep / contact name" name="broker_contact_name"  placeholder="Aaron Dini" />
          <Field label="Rep phone"          name="broker_contact_phone" placeholder="(555) 555-0123" />
        </Grid2>
        <Grid2>
          <Field label="Phone extension"    name="broker_phone_extension" placeholder="x202" />
          <Field label="Rep email"          name="broker_contact_email"   placeholder="aaron@broker.com" />
        </Grid2>
      </Section>

      {/* ---------- Route + dates ---------- */}
      <Section title="Route & dates">
        <Grid2>
          <Field label="Origin"      name="origin"      placeholder="Dallas, TX" />
          <Field label="Destination" name="destination" placeholder="Chicago, IL" />
        </Grid2>
        <Grid2>
          <DateField label="Pickup date"   name="pickup_date" />
          <DateField label="Delivery date" name="delivery_date" />
        </Grid2>
        <NumField  label="Total miles"   name="total_miles" step="0.01" placeholder="930" />
      </Section>

      {/* ---------- Rates ---------- */}
      <Section title="Rates" subtitle="Leave Total Revenue blank to auto-sum Line Haul + Fuel Surcharge + Accessorials.">
        <Grid2>
          <NumField label="Line haul"     name="line_haul_rate"      step="0.01" prefix="$" />
          <NumField label="Fuel surcharge" name="fuel_surcharge"     step="0.01" prefix="$" />
        </Grid2>
        <Grid2>
          <NumField label="Accessorials"  name="accessorial_charges" step="0.01" prefix="$" />
          <NumField label="Total revenue" name="total_revenue"       step="0.01" prefix="$" />
        </Grid2>
      </Section>

      {/* ---------- Assignment ---------- */}
      <Section title="Assignment" subtitle="Optional — you can assign later from the load detail page.">
        <Grid2>
          <label className="block space-y-1">
            <span className="text-xs font-semibold uppercase tracking-wide text-sp-textSecondary">
              Driver
            </span>
            <select
              name="driver_id"
              defaultValue=""
              className="w-full rounded-lg bg-sp-cardLight px-3 py-2 text-sm text-sp-textPrimary outline-none ring-1 ring-white/5 focus:ring-sp-gold"
            >
              <option value="">— Unassigned —</option>
              {drivers.map((d) => (
                <option key={d.id} value={d.id}>
                  {driverOptionLabel(d)}
                </option>
              ))}
            </select>
          </label>
          <label className="block space-y-1">
            <span className="text-xs font-semibold uppercase tracking-wide text-sp-textSecondary">
              Truck
            </span>
            <select
              name="truck_id"
              defaultValue=""
              className="w-full rounded-lg bg-sp-cardLight px-3 py-2 text-sm text-sp-textPrimary outline-none ring-1 ring-white/5 focus:ring-sp-gold"
            >
              <option value="">— No truck —</option>
              {trucks.map((t) => (
                <option key={t.id} value={t.id}>
                  #{t.unit_number} {t.status !== "active" ? `· ${t.status}` : ""}
                </option>
              ))}
            </select>
          </label>
        </Grid2>
        <label className="block space-y-1">
          <span className="text-xs font-semibold uppercase tracking-wide text-sp-textSecondary">
            Trailer
          </span>
          <select
            name="trailer_id"
            defaultValue=""
            className="w-full rounded-lg bg-sp-cardLight px-3 py-2 text-sm text-sp-textPrimary outline-none ring-1 ring-white/5 focus:ring-sp-gold"
          >
            <option value="">— No trailer —</option>
            {trailers.map((t) => (
              <option key={t.id} value={t.id}>
                #{t.unit_number}{t.trailer_type ? ` · ${labelize(t.trailer_type)}` : ""}
                {t.status !== "active" ? ` · ${t.status}` : ""}
              </option>
            ))}
          </select>
        </label>
      </Section>

      <div className="flex items-center justify-end gap-3">
        <button
          type="submit"
          disabled={pending}
          className="rounded-lg bg-sp-gold px-5 py-2.5 text-sm font-semibold text-sp-black transition disabled:opacity-50 hover:brightness-110"
        >
          {pending ? "Saving…" : "Create load"}
        </button>
      </div>
    </form>
  );
}

// -----------------------------------------------------------------------------
// Layout primitives — same vocabulary as ExpenseForm
// -----------------------------------------------------------------------------

function Section({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-3 rounded-xl border border-white/5 bg-sp-card p-5">
      <header className="space-y-1">
        <h2 className="text-base font-semibold text-sp-textPrimary">{title}</h2>
        {subtitle && <p className="text-xs text-sp-textSecondary">{subtitle}</p>}
      </header>
      <div className="space-y-3">{children}</div>
    </section>
  );
}

function Grid2({ children }: { children: React.ReactNode }) {
  return <div className="grid grid-cols-1 gap-3 md:grid-cols-2">{children}</div>;
}

function Field({
  label,
  name,
  placeholder,
  children,
}: {
  label: string;
  name: string;
  placeholder?: string;
  children?: React.ReactNode;
}) {
  if (children) {
    return (
      <label className="block space-y-1">
        <span className="text-xs font-semibold uppercase tracking-wide text-sp-textSecondary">
          {label}
        </span>
        {children}
      </label>
    );
  }
  return (
    <label className="block space-y-1">
      <span className="text-xs font-semibold uppercase tracking-wide text-sp-textSecondary">
        {label}
      </span>
      <input
        type="text"
        name={name}
        placeholder={placeholder}
        className="w-full rounded-lg bg-sp-cardLight px-3 py-2 text-sm text-sp-textPrimary placeholder:text-sp-textSecondary outline-none ring-1 ring-white/5 focus:ring-sp-gold"
      />
    </label>
  );
}

function DateField({ label, name }: { label: string; name: string }) {
  return (
    <label className="block space-y-1">
      <span className="text-xs font-semibold uppercase tracking-wide text-sp-textSecondary">
        {label}
      </span>
      <input
        type="date"
        name={name}
        className="w-full rounded-lg bg-sp-cardLight px-3 py-2 text-sm text-sp-textPrimary outline-none ring-1 ring-white/5 focus:ring-sp-gold"
      />
    </label>
  );
}

function NumField({
  label,
  name,
  step,
  prefix,
  placeholder,
}: {
  label: string;
  name: string;
  step?: string;
  prefix?: string;
  placeholder?: string;
}) {
  return (
    <label className="block space-y-1">
      <span className="text-xs font-semibold uppercase tracking-wide text-sp-textSecondary">
        {label}
      </span>
      <div className="relative">
        {prefix && (
          <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-sp-textSecondary">
            {prefix}
          </span>
        )}
        <input
          type="number"
          name={name}
          step={step ?? "any"}
          placeholder={placeholder}
          inputMode="decimal"
          className={
            "w-full rounded-lg bg-sp-cardLight py-2 pr-3 text-sm text-sp-textPrimary placeholder:text-sp-textSecondary outline-none ring-1 ring-white/5 focus:ring-sp-gold " +
            (prefix ? "pl-7" : "pl-3")
          }
        />
      </div>
    </label>
  );
}

function labelize(slug: string): string {
  return slug.split("_").map((p) => p[0]?.toUpperCase() + p.slice(1)).join(" ");
}

function driverOptionLabel(
  d: Pick<Driver, "id" | "name" | "worker_type" | "active" | "truck_number">
): string {
  const parts: string[] = [d.name];
  if (d.truck_number) parts.push(`#${d.truck_number}`);
  if (d.worker_type)  parts.push(d.worker_type);
  if (d.active === false) parts.push("inactive");
  return parts.join(" · ");
}
