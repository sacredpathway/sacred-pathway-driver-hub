// =============================================================================
//  DriverForm — Carrier HQ drivers UI · Phase W2 commit #2
// -----------------------------------------------------------------------------
//  Single client component used by both /drivers/new and /drivers/[id].
//  The worker_type toggle reveals either:
//    • 1099 Contractor block (escrow, pay %, flat rate, contractor notes)
//    • W2 Employee block (hourly/salary/mileage/per-load, OT eligibility,
//      W-4 placeholders, state withholding placeholder, hire date)
//
//  Backward compat: a driver with no worker_type column value (legacy iOS
//  rows) is rendered as 1099 by the parent server component setting the
//  initial value — this component just trusts the prop.
//
//  No payroll generation here. No Stripe. No multi-user.
// =============================================================================

"use client";

import { useActionState } from "react";
import { useState } from "react";
import type {
  Driver,
  WorkerType,
  EmploymentStatus,
  PayFrequency,
  CompType,
  FilingStatus,
} from "@/lib/supabase/types";
import type { DriverActionState } from "./actions";

type ServerAction = (
  prev: DriverActionState | undefined,
  formData: FormData
) => Promise<DriverActionState>;

export default function DriverForm({
  driver,
  action,
  submitLabel,
}: {
  driver?: Partial<Driver>;
  action: ServerAction;
  submitLabel: string;
}) {
  const initialWorkerType: WorkerType = (driver?.worker_type as WorkerType) ?? "1099";
  const [workerType, setWorkerType] = useState<WorkerType>(initialWorkerType);
  const [state, formAction, pending] = useActionState<
    DriverActionState | undefined,
    FormData
  >(action, undefined);

  return (
    <form action={formAction} className="space-y-8">
      {state && !state.ok && (
        <div className="rounded-lg border border-sp-danger/40 bg-sp-danger/10 p-3 text-sm text-sp-danger">
          {state.error}
        </div>
      )}

      {/* ---------- Worker classification ---------- */}
      <Section
        title="Classification"
        subtitle="Choose how this driver is paid. Existing drivers default to 1099."
      >
        <div className="grid grid-cols-2 gap-2">
          <ToggleCard
            label="1099 Contractor"
            sub="Owner-operator / independent. No tax withholding."
            checked={workerType === "1099"}
            onChange={() => setWorkerType("1099")}
            inputName="worker_type"
            inputValue="1099"
          />
          <ToggleCard
            label="W2 Employee"
            sub="Company driver. Withhold federal / state / SS / Medicare."
            checked={workerType === "W2"}
            onChange={() => setWorkerType("W2")}
            inputName="worker_type"
            inputValue="W2"
          />
        </div>
      </Section>

      {/* ---------- Identity ---------- */}
      <Section title="Driver">
        <Grid cols={2}>
          <Field label="Name *" name="name" defaultValue={driver?.name ?? ""} required />
          <Field
            label="Truck #"
            name="truck_number"
            defaultValue={driver?.truck_number ?? ""}
          />
          <Field label="Phone" name="phone" type="tel" defaultValue={driver?.phone ?? ""} />
          <Field
            label="Email"
            name="email"
            type="email"
            defaultValue={driver?.email ?? ""}
          />
        </Grid>
        <CheckboxField
          name="active"
          label="Active"
          defaultChecked={driver?.active ?? true}
        />
      </Section>

      {/* ============================================ */}
      {/* 1099 BLOCK                                    */}
      {/* ============================================ */}
      {workerType === "1099" && (
        <>
          <Section
            title="Contractor Compensation"
            subtitle="Used on every settlement Carrier HQ generates."
          >
            <Grid cols={2}>
              <SelectField
                label="Pay type"
                name="pay_type"
                defaultValue={driver?.pay_type ?? "percent"}
                options={[
                  { value: "percent", label: "% of revenue / profit" },
                  { value: "flat", label: "Flat per settlement" },
                ]}
              />
              <Field
                label="Pay percentage (%)"
                name="pay_percentage"
                inputMode="decimal"
                defaultValue={driver?.pay_percentage ?? ""}
                help="e.g. 25 = 25% of base"
              />
              <Field
                label="Flat rate ($)"
                name="flat_rate"
                inputMode="decimal"
                defaultValue={driver?.flat_rate ?? ""}
                help="Used only when pay type = flat"
              />
            </Grid>
          </Section>

          <Section
            title="Escrow"
            subtitle="Optional. Auto-deducted from each contractor settlement."
          >
            <Grid cols={2}>
              <Field
                label="Escrow per settlement ($)"
                name="escrow_per_settlement"
                inputMode="decimal"
                defaultValue={driver?.escrow_per_settlement ?? ""}
                help="0 or blank = no auto-deduction"
              />
              <Field
                label="Current escrow balance ($)"
                name="escrow_balance"
                inputMode="decimal"
                defaultValue={driver?.escrow_balance ?? ""}
                help="Read-only after first settlement"
              />
            </Grid>
          </Section>
        </>
      )}

      {/* ============================================ */}
      {/* W2 BLOCK                                      */}
      {/* ============================================ */}
      {workerType === "W2" && (
        <>
          <Section
            title="Employment"
            subtitle="W2 employee fields. Required before running employee payroll."
          >
            <Grid cols={2}>
              <SelectField
                label="Employment status"
                name="employment_status"
                defaultValue={driver?.employment_status ?? "active"}
                options={EMPLOYMENT_STATUS_OPTIONS}
              />
              <SelectField
                label="Pay frequency"
                name="pay_frequency"
                defaultValue={driver?.pay_frequency ?? "weekly"}
                options={PAY_FREQUENCY_OPTIONS}
              />
              <Field
                label="Hire date"
                name="hire_date"
                type="date"
                defaultValue={driver?.hire_date ?? ""}
              />
              <Field
                label="Termination date"
                name="termination_date"
                type="date"
                defaultValue={driver?.termination_date ?? ""}
              />
            </Grid>
          </Section>

          <Section title="Pay Rate">
            <Grid cols={2}>
              <SelectField
                label="Compensation type"
                name="comp_type"
                defaultValue={driver?.comp_type ?? "hourly"}
                options={COMP_TYPE_OPTIONS}
              />
              <Field
                label="Overtime multiplier"
                name="overtime_multiplier"
                inputMode="decimal"
                defaultValue={driver?.overtime_multiplier ?? "1.5"}
                help="1.5 = time-and-a-half"
              />
              <Field
                label="Hourly rate ($/hr)"
                name="hourly_rate"
                inputMode="decimal"
                defaultValue={driver?.hourly_rate ?? ""}
              />
              <Field
                label="Annual salary ($)"
                name="salary_annual"
                inputMode="decimal"
                defaultValue={driver?.salary_annual ?? ""}
              />
              <Field
                label="Mileage rate ($/mi)"
                name="mileage_rate"
                inputMode="decimal"
                defaultValue={driver?.mileage_rate ?? ""}
              />
              <Field
                label="Per-load rate ($)"
                name="per_load_rate"
                inputMode="decimal"
                defaultValue={driver?.per_load_rate ?? ""}
              />
              <Field
                label="Per diem ($/day)"
                name="per_diem_daily"
                inputMode="decimal"
                defaultValue={driver?.per_diem_daily ?? ""}
                help="Non-taxable within IRS rate"
              />
            </Grid>
          </Section>

          <Section
            title="Tax Withholding (Placeholders)"
            subtitle="No auto-compute yet. Values entered here are stored and referenced on the paystub; per-period withholding amounts are entered manually on each paystub."
          >
            <Grid cols={2}>
              <SelectField
                label="Filing status"
                name="filing_status"
                defaultValue={driver?.filing_status ?? ""}
                options={[{ value: "", label: "—" }, ...FILING_STATUS_OPTIONS]}
              />
              <Field
                label="Federal allowances"
                name="federal_allowances"
                inputMode="numeric"
                defaultValue={driver?.federal_allowances ?? ""}
                help="Pre-2020 W-4 only"
              />
              <Field
                label="W-4 extra withholding ($)"
                name="w4_extra_withholding"
                inputMode="decimal"
                defaultValue={driver?.w4_extra_withholding ?? ""}
              />
              <Field
                label="State (work)"
                name="state_code"
                defaultValue={driver?.state_code ?? ""}
                help="e.g. TX, CA — for state withholding"
                maxLength={2}
              />
              <Field
                label="State allowances"
                name="state_allowances"
                inputMode="numeric"
                defaultValue={driver?.state_allowances ?? ""}
              />
              <Field
                label="EIN (corp contractors)"
                name="ein"
                defaultValue={driver?.ein ?? ""}
                help="Optional — used on year-end 1099-NEC"
              />
            </Grid>
          </Section>
        </>
      )}

      {/* ---------- Address + emergency contact + CDL (both worker types) ---------- */}
      <Section title="Address">
        <Grid cols={2}>
          <Field
            label="Street"
            name="address"
            defaultValue={driver?.address ?? ""}
            wide
          />
          <Field label="City" name="city" defaultValue={driver?.city ?? ""} />
          <Field
            label="State"
            name="state"
            defaultValue={driver?.state ?? ""}
            maxLength={2}
          />
          <Field label="ZIP" name="zip" defaultValue={driver?.zip ?? ""} />
          <Field
            label="Date of birth"
            name="dob"
            type="date"
            defaultValue={driver?.dob ?? ""}
          />
        </Grid>
      </Section>

      <Section title="CDL & Emergency">
        <Grid cols={2}>
          <Field
            label="CDL #"
            name="cdl_number"
            defaultValue={driver?.cdl_number ?? ""}
          />
          <Field
            label="CDL state"
            name="cdl_state"
            defaultValue={driver?.cdl_state ?? ""}
            maxLength={2}
          />
          <Field
            label="CDL expiration"
            name="cdl_expiration"
            type="date"
            defaultValue={driver?.cdl_expiration ?? ""}
          />
          <Field
            label="Emergency contact name"
            name="emergency_contact_name"
            defaultValue={driver?.emergency_contact_name ?? ""}
          />
          <Field
            label="Emergency contact phone"
            name="emergency_contact_phone"
            type="tel"
            defaultValue={driver?.emergency_contact_phone ?? ""}
          />
        </Grid>
      </Section>

      {/* ---------- Submit ---------- */}
      <div className="sticky bottom-0 -mx-4 border-t border-white/5 bg-sp-background/95 px-4 py-3 backdrop-blur">
        <div className="flex items-center justify-end gap-3">
          <a
            href="/drivers"
            className="rounded-md border border-white/10 px-4 py-2 text-sm text-sp-textSecondary hover:bg-white/5"
          >
            Cancel
          </a>
          <button
            type="submit"
            disabled={pending}
            className="rounded-md bg-sp-gold px-4 py-2 text-sm font-semibold text-sp-black hover:bg-sp-goldLight disabled:opacity-50"
          >
            {pending ? "Saving…" : submitLabel}
          </button>
        </div>
      </div>
    </form>
  );
}

// =============================================================================
//  Tiny presentational helpers (same file to keep the commit narrow)
// =============================================================================

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
    <section className="rounded-xl border border-white/5 bg-sp-card/40 p-5">
      <header className="mb-4">
        <h2 className="text-base font-semibold text-sp-textPrimary">{title}</h2>
        {subtitle && (
          <p className="mt-1 text-xs text-sp-textSecondary">{subtitle}</p>
        )}
      </header>
      <div className="space-y-3">{children}</div>
    </section>
  );
}

function Grid({ cols, children }: { cols: 2 | 3; children: React.ReactNode }) {
  const c = cols === 3 ? "md:grid-cols-3" : "md:grid-cols-2";
  return <div className={`grid grid-cols-1 gap-3 ${c}`}>{children}</div>;
}

function Field({
  label,
  name,
  type = "text",
  defaultValue,
  help,
  required,
  inputMode,
  maxLength,
  wide,
}: {
  label: string;
  name: string;
  type?: string;
  defaultValue?: string | number | null;
  help?: string;
  required?: boolean;
  inputMode?: "decimal" | "numeric" | "text" | "tel" | "email";
  maxLength?: number;
  wide?: boolean;
}) {
  const value =
    defaultValue === null || defaultValue === undefined ? "" : String(defaultValue);
  return (
    <label className={`block ${wide ? "md:col-span-2" : ""}`}>
      <span className="block text-xs font-medium uppercase tracking-wide text-sp-textSecondary">
        {label}
      </span>
      <input
        type={type}
        name={name}
        defaultValue={value}
        required={required}
        inputMode={inputMode}
        maxLength={maxLength}
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
  defaultValue?: string | null;
  options: ReadonlyArray<{ value: string; label: string }>;
}) {
  return (
    <label className="block">
      <span className="block text-xs font-medium uppercase tracking-wide text-sp-textSecondary">
        {label}
      </span>
      <select
        name={name}
        defaultValue={defaultValue ?? ""}
        className="mt-1 w-full rounded-md border border-white/10 bg-sp-background px-3 py-2 text-sm text-sp-textPrimary focus:border-sp-gold focus:outline-none"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function CheckboxField({
  name,
  label,
  defaultChecked,
}: {
  name: string;
  label: string;
  defaultChecked?: boolean;
}) {
  return (
    <label className="mt-2 inline-flex items-center gap-2 text-sm text-sp-textPrimary">
      <input
        type="checkbox"
        name={name}
        defaultChecked={defaultChecked}
        className="h-4 w-4 rounded border-white/20 bg-sp-background text-sp-gold focus:ring-sp-gold"
      />
      <span>{label}</span>
    </label>
  );
}

function ToggleCard({
  label,
  sub,
  checked,
  onChange,
  inputName,
  inputValue,
}: {
  label: string;
  sub: string;
  checked: boolean;
  onChange: () => void;
  inputName: string;
  inputValue: string;
}) {
  return (
    <button
      type="button"
      onClick={onChange}
      className={
        "rounded-lg border p-4 text-left transition " +
        (checked
          ? "border-sp-gold bg-sp-gold/10"
          : "border-white/10 bg-sp-card/40 hover:border-white/20")
      }
      aria-pressed={checked}
    >
      <div className={"text-sm font-semibold " + (checked ? "text-sp-gold" : "text-sp-textPrimary")}>
        {label}
      </div>
      <div className="mt-1 text-xs text-sp-textSecondary">{sub}</div>
      {checked && (
        <input type="hidden" name={inputName} value={inputValue} />
      )}
    </button>
  );
}

// =============================================================================
//  Static option lists
// =============================================================================

const EMPLOYMENT_STATUS_OPTIONS: ReadonlyArray<{ value: EmploymentStatus; label: string }> = [
  { value: "active", label: "Active" },
  { value: "on_leave", label: "On leave" },
  { value: "terminated", label: "Terminated" },
];

const PAY_FREQUENCY_OPTIONS: ReadonlyArray<{ value: PayFrequency; label: string }> = [
  { value: "weekly", label: "Weekly" },
  { value: "biweekly", label: "Bi-weekly" },
  { value: "semimonthly", label: "Semi-monthly" },
  { value: "monthly", label: "Monthly" },
];

const COMP_TYPE_OPTIONS: ReadonlyArray<{ value: CompType; label: string }> = [
  { value: "hourly", label: "Hourly" },
  { value: "salary", label: "Salary" },
  { value: "mileage", label: "Mileage" },
  { value: "per_load", label: "Per load" },
];

const FILING_STATUS_OPTIONS: ReadonlyArray<{ value: FilingStatus; label: string }> = [
  { value: "single", label: "Single" },
  { value: "married", label: "Married filing jointly" },
  { value: "married_separate", label: "Married filing separately" },
  { value: "head_of_household", label: "Head of household" },
];
