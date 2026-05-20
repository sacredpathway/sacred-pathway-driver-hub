// =============================================================================
//  NewPaystubForm — client component
// -----------------------------------------------------------------------------
//  Pick a driver, choose a pay period, optionally pick loads (1099 only),
//  then submit to createPaystubAction which lands you on the editor.
// =============================================================================

"use client";

import { useActionState, useMemo, useState } from "react";
import type { Driver, Load } from "@/lib/supabase/types";
import type { PaystubActionState } from "../actions";

type ServerAction = (
  prev: PaystubActionState | undefined,
  formData: FormData
) => Promise<PaystubActionState>;

type LoadRow = Pick<
  Load,
  "id" | "load_number" | "broker_name" | "origin" | "destination" |
  "pickup_date" | "delivery_date" | "total_miles" | "total_revenue" |
  "status" | "driver_id"
>;

export default function NewPaystubForm({
  drivers,
  loads,
  action,
}: {
  drivers: Driver[];
  loads: LoadRow[];
  action: ServerAction;
}) {
  const [driverId, setDriverId] = useState<string>(drivers[0]?.id ?? "");
  const [periodStart, setPeriodStart] = useState<string>(defaultPeriodStart());
  const [periodEnd, setPeriodEnd] = useState<string>(defaultPeriodEnd());
  // Check date defaults to period_end but tracks user overrides independently
  // so the carrier can pick a future payment date (e.g. Friday payday).
  const [checkDate, setCheckDate] = useState<string>(defaultPeriodEnd());
  const [checkDateTouched, setCheckDateTouched] = useState(false);
  const [selectedLoadIds, setSelectedLoadIds] = useState<Set<string>>(new Set());

  const [state, formAction, pending] = useActionState<
    PaystubActionState | undefined,
    FormData
  >(action, undefined);

  const driver = drivers.find((d) => d.id === driverId) ?? drivers[0];
  const isContractor = (driver?.worker_type ?? "1099") === "1099";

  const eligibleLoads = useMemo(() => {
    if (!isContractor || !driver) return [] as LoadRow[];
    return loads
      .filter((l) => l.driver_id === null || l.driver_id === driver.id)
      .filter((l) => {
        const ref = l.delivery_date ?? l.pickup_date;
        if (!ref) return true; // include undated; carrier can uncheck
        return ref >= periodStart && ref <= periodEnd;
      })
      .filter((l) => l.status !== "settled");
  }, [isContractor, driver, loads, periodStart, periodEnd]);

  const selectedTotal = useMemo(() => {
    return eligibleLoads
      .filter((l) => selectedLoadIds.has(l.id))
      .reduce((s, l) => s + (l.total_revenue ?? 0), 0);
  }, [eligibleLoads, selectedLoadIds]);

  return (
    <form action={formAction} className="space-y-6">
      {state && !state.ok && (
        <div className="rounded-lg border border-sp-danger/40 bg-sp-danger/10 p-3 text-sm text-sp-danger">
          {state.error}
        </div>
      )}

      <section className="rounded-xl border border-white/5 bg-sp-card/40 p-5">
        <h2 className="text-base font-semibold text-sp-textPrimary">Driver</h2>
        <p className="mt-1 text-xs text-sp-textSecondary">
          The form below adapts based on whether this driver is a 1099 contractor or W2 employee.
        </p>
        <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2">
          <label className="block">
            <span className="block text-xs font-medium uppercase tracking-wide text-sp-textSecondary">
              Driver
            </span>
            <select
              name="driver_id"
              value={driverId}
              onChange={(e) => {
                setDriverId(e.target.value);
                setSelectedLoadIds(new Set());
              }}
              className="mt-1 w-full rounded-md border border-white/10 bg-sp-background px-3 py-2 text-sm text-sp-textPrimary focus:border-sp-gold focus:outline-none"
            >
              {drivers.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name} · {d.worker_type === "W2" ? "W2 Employee" : "1099 Contractor"}
                </option>
              ))}
            </select>
          </label>
          <div className="self-end">
            <ClassificationPill workerType={driver?.worker_type ?? "1099"} />
          </div>
        </div>
      </section>

      <section className="rounded-xl border border-white/5 bg-sp-card/40 p-5">
        <h2 className="text-base font-semibold text-sp-textPrimary">Pay period</h2>
        <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-3">
          <DateField
            label="Period start"
            name="pay_period_start"
            value={periodStart}
            onChange={setPeriodStart}
          />
          <DateField
            label="Period end"
            name="pay_period_end"
            value={periodEnd}
            onChange={(v) => {
              setPeriodEnd(v);
              if (!checkDateTouched) setCheckDate(v);
            }}
          />
          <DateField
            label="Check date"
            name="check_date"
            value={checkDate}
            onChange={(v) => {
              setCheckDate(v);
              setCheckDateTouched(true);
            }}
            help="Defaults to period end. Override for a future payday."
          />
        </div>
      </section>

      {isContractor && (
        <section className="rounded-xl border border-white/5 bg-sp-card/40 p-5">
          <header className="flex items-baseline justify-between">
            <div>
              <h2 className="text-base font-semibold text-sp-textPrimary">
                Loads in this period
              </h2>
              <p className="mt-1 text-xs text-sp-textSecondary">
                Selected loads become the gross settlement lines. You'll add
                fuel / tolls / escrow / chargebacks on the next screen.
              </p>
            </div>
            <div className="text-right">
              <div className="text-xs text-sp-textSecondary">Selected gross</div>
              <div className="text-lg font-semibold text-sp-gold">
                {currency(selectedTotal)}
              </div>
            </div>
          </header>

          {eligibleLoads.length === 0 ? (
            <p className="mt-3 rounded-md border border-dashed border-white/10 px-3 py-6 text-center text-xs text-sp-textSecondary">
              No matching loads in this period for this driver. Adjust the
              dates above, or you can still create the paystub and add
              manual lines on the next screen.
            </p>
          ) : (
            <div className="mt-3 overflow-x-auto rounded-md border border-white/5">
              <table className="min-w-full divide-y divide-white/5 text-sm">
                <thead className="bg-sp-card text-left text-xs uppercase tracking-wide text-sp-textSecondary">
                  <tr>
                    <th className="px-3 py-2"></th>
                    <th className="px-3 py-2">Load #</th>
                    <th className="px-3 py-2">Broker</th>
                    <th className="hidden px-3 py-2 md:table-cell">Route</th>
                    <th className="hidden px-3 py-2 md:table-cell">Pickup</th>
                    <th className="px-3 py-2 text-right">Miles</th>
                    <th className="px-3 py-2 text-right">Revenue</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5 bg-sp-card/30">
                  {eligibleLoads.map((l) => {
                    const checked = selectedLoadIds.has(l.id);
                    return (
                      <tr key={l.id} className={checked ? "bg-sp-gold/5" : ""}>
                        <td className="px-3 py-2">
                          <input
                            type="checkbox"
                            name="load_ids"
                            value={l.id}
                            checked={checked}
                            onChange={(e) => {
                              setSelectedLoadIds((prev) => {
                                const s = new Set(prev);
                                if (e.target.checked) s.add(l.id);
                                else s.delete(l.id);
                                return s;
                              });
                            }}
                            className="h-4 w-4 rounded border-white/20 bg-sp-background text-sp-gold focus:ring-sp-gold"
                          />
                        </td>
                        <td className="px-3 py-2 font-medium text-sp-textPrimary">
                          {l.load_number ?? "—"}
                        </td>
                        <td className="px-3 py-2 text-sp-textSecondary">
                          {l.broker_name ?? "—"}
                        </td>
                        <td className="hidden px-3 py-2 text-sp-textSecondary md:table-cell">
                          {[l.origin, l.destination].filter(Boolean).join(" → ") || "—"}
                        </td>
                        <td className="hidden px-3 py-2 text-sp-textSecondary md:table-cell">
                          {l.pickup_date ?? "—"}
                        </td>
                        <td className="px-3 py-2 text-right text-sp-textSecondary">
                          {l.total_miles ?? "—"}
                        </td>
                        <td className="px-3 py-2 text-right text-sp-gold">
                          {currency(l.total_revenue)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      {!isContractor && driver && (
        <section className="rounded-xl border border-white/5 bg-sp-card/40 p-5 text-xs text-sp-textSecondary">
          <p>
            <strong className="text-sp-textPrimary">Employee payroll seed.</strong>{" "}
            We'll pre-fill {compTypeHint(driver)} based on this driver's setup.
            You'll enter the period's hours / miles / tax withholding on the
            next screen.
          </p>
        </section>
      )}

      <section className="rounded-xl border border-white/5 bg-sp-card/40 p-5">
        <label className="block">
          <span className="block text-xs font-medium uppercase tracking-wide text-sp-textSecondary">
            Notes (optional)
          </span>
          <textarea
            name="notes"
            rows={2}
            className="mt-1 w-full rounded-md border border-white/10 bg-sp-background px-3 py-2 text-sm text-sp-textPrimary focus:border-sp-gold focus:outline-none"
            placeholder="Internal notes — won't appear on the paystub unless you put them there too."
          />
        </label>
      </section>

      <div className="sticky bottom-0 -mx-4 border-t border-white/5 bg-sp-background/95 px-4 py-3 backdrop-blur">
        <div className="flex items-center justify-end gap-3">
          <a
            href="/payroll"
            className="rounded-md border border-white/10 px-4 py-2 text-sm text-sp-textSecondary hover:bg-white/5"
          >
            Cancel
          </a>
          <button
            type="submit"
            disabled={pending}
            className="rounded-md bg-sp-gold px-4 py-2 text-sm font-semibold text-sp-black hover:bg-sp-goldLight disabled:opacity-50"
          >
            {pending ? "Creating…" : "Create draft"}
          </button>
        </div>
      </div>
    </form>
  );
}

function ClassificationPill({ workerType }: { workerType: string }) {
  const isW2 = workerType === "W2";
  return (
    <span
      className={
        "inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold " +
        (isW2 ? "bg-sp-greenAccent/15 text-sp-greenAccent" : "bg-sp-gold/15 text-sp-gold")
      }
    >
      {isW2 ? "W2 Employee · taxes withheld" : "1099 Contractor · no withholding"}
    </span>
  );
}

function DateField({
  label,
  name,
  value,
  onChange,
  help,
}: {
  label: string;
  name: string;
  value: string;
  onChange: (v: string) => void;
  help?: string;
}) {
  return (
    <label className="block">
      <span className="block text-xs font-medium uppercase tracking-wide text-sp-textSecondary">
        {label}
      </span>
      <input
        type="date"
        name={name}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="mt-1 w-full rounded-md border border-white/10 bg-sp-background px-3 py-2 text-sm text-sp-textPrimary focus:border-sp-gold focus:outline-none"
      />
      {help && <span className="mt-1 block text-[10px] text-sp-textSecondary">{help}</span>}
    </label>
  );
}

function currency(n: number | null | undefined): string {
  if (n === null || n === undefined || Number.isNaN(n)) return "—";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(n);
}

function defaultPeriodStart(): string {
  const d = new Date();
  // Default to start of the current ISO week (Monday)
  const day = (d.getUTCDay() + 6) % 7; // Mon=0..Sun=6
  d.setUTCDate(d.getUTCDate() - day);
  return d.toISOString().slice(0, 10);
}

function defaultPeriodEnd(): string {
  const d = new Date();
  const day = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - day + 6); // Sunday
  return d.toISOString().slice(0, 10);
}

function compTypeHint(d: Driver): string {
  switch (d.comp_type) {
    case "hourly":  return `regular hours at $${d.hourly_rate ?? 0}/hr (OT × ${d.overtime_multiplier ?? 1.5})`;
    case "salary":  return `a salary line based on $${d.salary_annual ?? 0}/yr ÷ ${d.pay_frequency ?? "pay period"}`;
    case "mileage": return `mileage at $${d.mileage_rate ?? 0}/mi`;
    case "per_load": return `per-load at $${d.per_load_rate ?? 0}/load`;
    default:        return "a blank earnings line you can fill in";
  }
}
