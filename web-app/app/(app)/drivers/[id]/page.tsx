// =============================================================================
//  /drivers/[id] — driver detail (read-only) + Edit CTA + danger zone
// -----------------------------------------------------------------------------
//  Phase E1 split: this page is now a read-only summary of one driver. Editing
//  happens on /drivers/[id]/edit. Danger zone (deactivate / reactivate) stays
//  here because it's a status flip, not a field edit.
//
//  Paystub immutability guarantee
//  ------------------------------
//  Editing a driver does NOT rewrite historical paystubs. The paystubs table
//  snapshots worker_type per row at issuance; child rows snapshot their own
//  ytd_amount values. Driver-side edits only affect FUTURE paystubs the
//  carrier generates after the change.
// =============================================================================

import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { formatDate } from "@/lib/format";
import {
  deactivateDriverAction,
  reactivateDriverAction,
} from "../actions";
import type { Driver } from "@/lib/supabase/types";

export const runtime = "edge";

export default async function DriverDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ created?: string; updated?: string }>;
}) {
  const { id } = await params;
  const sp = await searchParams;

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("drivers")
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
  const driver = data as Driver;

  const isW2 = driver.worker_type === "W2";

  return (
    <section className="space-y-4">
      <header className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{driver.name}</h1>
          <p className="mt-1 text-xs text-sp-textSecondary">
            {isW2 ? "W2 Employee" : "1099 Contractor"} ·{" "}
            {driver.active ? "Active" : "Inactive"}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href={`/drivers/${driver.id}/edit`}
            className="rounded-md bg-sp-gold px-3 py-1.5 text-xs font-semibold text-sp-black hover:bg-sp-goldLight"
          >
            Edit
          </Link>
          <Link
            href="/drivers"
            className="text-xs text-sp-textSecondary hover:text-sp-textPrimary"
          >
            ← All drivers
          </Link>
        </div>
      </header>

      {sp.created && <FlashOK message="Driver created." />}
      {sp.updated && <FlashOK message="Driver updated." />}

      {/* Contact + classification card */}
      <section className="rounded-xl border border-white/5 bg-sp-card/40 p-5 text-sm">
        <h2 className="text-base font-semibold text-sp-textPrimary">Contact</h2>
        <dl className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-3">
          <Field label="Phone" value={driver.phone ?? "—"} />
          <Field label="Email" value={driver.email ?? "—"} />
          <Field label="Truck #" value={driver.truck_number ?? "—"} />
        </dl>
      </section>

      {/* Compensation card — branches on worker_type */}
      <section className="rounded-xl border border-white/5 bg-sp-card/40 p-5 text-sm">
        <h2 className="text-base font-semibold text-sp-textPrimary">
          {isW2 ? "W2 Compensation" : "Contractor Compensation"}
        </h2>
        {isW2 ? (
          <dl className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-3">
            <Field label="Comp type" value={driver.comp_type ?? "—"} />
            <Field label="Pay frequency" value={driver.pay_frequency ?? "—"} />
            <Field label="Overtime ×" value={driver.overtime_multiplier?.toString() ?? "—"} />
            <Field label="Hourly rate" value={dollars(driver.hourly_rate)} />
            <Field label="Annual salary" value={dollars(driver.salary_annual)} />
            <Field label="Mileage rate" value={dollars(driver.mileage_rate)} />
            <Field label="Per-load rate" value={dollars(driver.per_load_rate)} />
            <Field label="Per diem / day" value={dollars(driver.per_diem_daily)} />
            <Field label="Hire date" value={formatDate(driver.hire_date)} />
          </dl>
        ) : (
          <dl className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-3">
            <Field label="Pay type" value={driver.pay_type ?? "percent"} />
            <Field label="Pay %" value={driver.pay_percentage != null ? `${driver.pay_percentage}%` : "—"} />
            <Field label="Flat rate" value={dollars(driver.flat_rate)} />
            <Field label="Escrow / settlement" value={dollars(driver.escrow_per_settlement)} />
            <Field label="Escrow balance" value={dollars(driver.escrow_balance)} />
            <Field label="EIN" value={driver.ein ?? "—"} />
          </dl>
        )}
      </section>

      {/* Tax setup (W2 only) */}
      {isW2 && (
        <section className="rounded-xl border border-white/5 bg-sp-card/40 p-5 text-sm">
          <h2 className="text-base font-semibold text-sp-textPrimary">
            Tax setup (placeholders)
          </h2>
          <dl className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-3">
            <Field label="Filing status" value={driver.filing_status ?? "—"} />
            <Field
              label="Federal allowances"
              value={driver.federal_allowances?.toString() ?? "—"}
            />
            <Field label="W-4 extra" value={dollars(driver.w4_extra_withholding)} />
            <Field label="State" value={driver.state_code ?? "—"} />
            <Field
              label="State allowances"
              value={driver.state_allowances?.toString() ?? "—"}
            />
          </dl>
        </section>
      )}

      {/* Address + CDL */}
      <section className="rounded-xl border border-white/5 bg-sp-card/40 p-5 text-sm">
        <h2 className="text-base font-semibold text-sp-textPrimary">Address & CDL</h2>
        <dl className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-3">
          <Field label="Street" value={driver.address ?? "—"} />
          <Field label="City" value={driver.city ?? "—"} />
          <Field label="State / ZIP" value={[driver.state, driver.zip].filter(Boolean).join(" ") || "—"} />
          <Field label="CDL #" value={driver.cdl_number ?? "—"} />
          <Field label="CDL state" value={driver.cdl_state ?? "—"} />
          <Field label="CDL expires" value={formatDate(driver.cdl_expiration)} />
          <Field label="Emergency contact" value={driver.emergency_contact_name ?? "—"} />
          <Field label="Emergency phone" value={driver.emergency_contact_phone ?? "—"} />
          <Field label="DOB" value={formatDate(driver.dob)} />
        </dl>
      </section>

      {/* Danger zone */}
      <section className="rounded-xl border border-white/5 bg-sp-card/40 p-5">
        <h2 className="text-base font-semibold text-sp-textPrimary">Danger zone</h2>
        <p className="mt-1 text-xs text-sp-textSecondary">
          Drivers can't be hard-deleted — their paystub history must remain
          intact. Deactivate to remove from active payroll instead. Existing
          paystubs are immutable snapshots and won't change.
        </p>
        <div className="mt-3 flex items-center gap-2">
          {driver.active ? (
            <form action={deactivateDriverAction.bind(null, driver.id)}>
              <button
                type="submit"
                className="rounded-md border border-sp-danger/40 px-3 py-1.5 text-xs font-medium text-sp-danger hover:bg-sp-danger/10"
              >
                Deactivate driver
              </button>
            </form>
          ) : (
            <form action={reactivateDriverAction.bind(null, driver.id)}>
              <button
                type="submit"
                className="rounded-md border border-sp-success/40 px-3 py-1.5 text-xs font-medium text-sp-success hover:bg-sp-success/10"
              >
                Reactivate driver
              </button>
            </form>
          )}
        </div>
      </section>
    </section>
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

function dollars(n: number | null | undefined): string {
  if (n == null) return "—";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(n);
}

function FlashOK({ message }: { message: string }) {
  return (
    <div className="rounded-md border border-sp-success/40 bg-sp-success/10 px-3 py-2 text-sm text-sp-success">
      {message}
    </div>
  );
}
