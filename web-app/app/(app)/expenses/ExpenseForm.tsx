// =============================================================================
//  ExpenseForm — Carrier HQ Phase W5
// -----------------------------------------------------------------------------
//  Single client component shared by /expenses/new and /expenses/[id]/edit.
//  Fuel-specific fields (gallons, $/gal, DEF) appear only when the category
//  is "fuel" so the form stays compact for tolls / lumper / etc.
// =============================================================================

"use client";

import { useActionState, useState } from "react";
import type { Expense, Load } from "@/lib/supabase/types";
import { EXPENSE_CATEGORIES, type ExpenseActionState } from "./actions";

type ServerAction = (
  prev: ExpenseActionState | undefined,
  formData: FormData
) => Promise<ExpenseActionState>;

export default function ExpenseForm({
  expense,
  loads,
  action,
  submitLabel,
}: {
  expense?: Partial<Expense>;
  loads: ReadonlyArray<Pick<Load, "id" | "load_number" | "broker_name" | "pickup_date">>;
  action: ServerAction;
  submitLabel: string;
}) {
  const initialCategory = (expense?.category ?? "fuel").toLowerCase();
  const [category, setCategory] = useState<string>(initialCategory);
  const [state, formAction, pending] = useActionState<
    ExpenseActionState | undefined,
    FormData
  >(action, undefined);

  const isFuel = category === "fuel";

  return (
    <form action={formAction} className="space-y-6">
      {state && !state.ok && (
        <div className="rounded-lg border border-sp-danger/40 bg-sp-danger/10 p-3 text-sm text-sp-danger">
          {state.error}
        </div>
      )}

      <Section title="Category & amount">
        <Grid2>
          <label className="block space-y-1">
            <span className="text-xs font-semibold uppercase tracking-wide text-sp-textSecondary">
              Category
            </span>
            <select
              name="category"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              className="w-full rounded-lg bg-sp-cardLight px-3 py-2 text-sm text-sp-textPrimary outline-none ring-1 ring-white/5 focus:ring-sp-gold"
            >
              {EXPENSE_CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {labelize(c)}
                </option>
              ))}
            </select>
          </label>
          <NumField
            label="Amount"
            name="amount"
            required
            prefix="$"
            step="0.01"
            defaultValue={expense?.amount ?? undefined}
          />
        </Grid2>
        <Grid2>
          <Field
            label="Vendor"
            name="vendor_name"
            defaultValue={expense?.vendor_name ?? ""}
            placeholder="Pilot, TA, Love's, etc."
          />
          <DateField
            label="Receipt date"
            name="receipt_date"
            defaultValue={expense?.receipt_date ?? ""}
          />
        </Grid2>
      </Section>

      {isFuel && (
        <Section title="Fuel details" subtitle="Optional — gallons and per-gallon price let reports compute fuel efficiency.">
          <Grid2>
            <NumField
              label="Gallons"
              name="gallons"
              step="0.001"
              defaultValue={expense?.gallons ?? undefined}
            />
            <NumField
              label="Price / gal"
              name="price_per_gallon"
              prefix="$"
              step="0.001"
              defaultValue={expense?.price_per_gallon ?? undefined}
            />
          </Grid2>
          <Grid2>
            <NumField
              label="DEF gallons"
              name="def_gallons"
              step="0.001"
              defaultValue={expense?.def_gallons ?? undefined}
            />
            <NumField
              label="DEF price / gal"
              name="def_price_per_gallon"
              prefix="$"
              step="0.001"
              defaultValue={expense?.def_price_per_gallon ?? undefined}
            />
          </Grid2>
        </Section>
      )}

      <Section title="Link to load" subtitle="Optional — ties the expense to a load so profit-per-load is accurate.">
        <label className="block space-y-1">
          <span className="text-xs font-semibold uppercase tracking-wide text-sp-textSecondary">
            Load
          </span>
          <select
            name="load_id"
            defaultValue={expense?.load_id ?? ""}
            className="w-full rounded-lg bg-sp-cardLight px-3 py-2 text-sm text-sp-textPrimary outline-none ring-1 ring-white/5 focus:ring-sp-gold"
          >
            <option value="">— Unlinked —</option>
            {loads.map((l) => (
              <option key={l.id} value={l.id}>
                {loadOptionLabel(l)}
              </option>
            ))}
          </select>
        </label>
      </Section>

      <Section title="Notes">
        <label className="block space-y-1">
          <span className="text-xs font-semibold uppercase tracking-wide text-sp-textSecondary">
            Description
          </span>
          <textarea
            name="description"
            rows={3}
            defaultValue={expense?.description ?? ""}
            placeholder="Optional context for tax time."
            className="w-full rounded-lg bg-sp-cardLight px-3 py-2 text-sm text-sp-textPrimary placeholder:text-sp-textSecondary outline-none ring-1 ring-white/5 focus:ring-sp-gold"
          />
        </label>
      </Section>

      <div className="flex items-center justify-end gap-3">
        <button
          type="submit"
          disabled={pending}
          className="rounded-lg bg-sp-gold px-5 py-2.5 text-sm font-semibold text-sp-black transition disabled:opacity-50 hover:brightness-110"
        >
          {pending ? "Saving…" : submitLabel}
        </button>
      </div>
    </form>
  );
}

// -----------------------------------------------------------------------------
// Layout primitives
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
  defaultValue,
  placeholder,
}: {
  label: string;
  name: string;
  defaultValue?: string;
  placeholder?: string;
}) {
  return (
    <label className="block space-y-1">
      <span className="text-xs font-semibold uppercase tracking-wide text-sp-textSecondary">
        {label}
      </span>
      <input
        type="text"
        name={name}
        defaultValue={defaultValue}
        placeholder={placeholder}
        className="w-full rounded-lg bg-sp-cardLight px-3 py-2 text-sm text-sp-textPrimary placeholder:text-sp-textSecondary outline-none ring-1 ring-white/5 focus:ring-sp-gold"
      />
    </label>
  );
}

function DateField({
  label,
  name,
  defaultValue,
}: {
  label: string;
  name: string;
  defaultValue?: string;
}) {
  return (
    <label className="block space-y-1">
      <span className="text-xs font-semibold uppercase tracking-wide text-sp-textSecondary">
        {label}
      </span>
      <input
        type="date"
        name={name}
        defaultValue={defaultValue}
        className="w-full rounded-lg bg-sp-cardLight px-3 py-2 text-sm text-sp-textPrimary outline-none ring-1 ring-white/5 focus:ring-sp-gold"
      />
    </label>
  );
}

function NumField({
  label,
  name,
  defaultValue,
  step,
  prefix,
  required,
}: {
  label: string;
  name: string;
  defaultValue?: number | null;
  step?: string;
  prefix?: string;
  required?: boolean;
}) {
  return (
    <label className="block space-y-1">
      <span className="text-xs font-semibold uppercase tracking-wide text-sp-textSecondary">
        {label}
        {required && <span className="ml-1 text-sp-danger">*</span>}
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
          defaultValue={defaultValue ?? ""}
          required={required}
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

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------

function labelize(slug: string): string {
  return slug.split("_").map((p) => p[0]?.toUpperCase() + p.slice(1)).join(" ");
}

function loadOptionLabel(
  l: Pick<Load, "id" | "load_number" | "broker_name" | "pickup_date">
): string {
  const parts: string[] = [];
  if (l.load_number) parts.push(`#${l.load_number}`);
  if (l.broker_name) parts.push(l.broker_name);
  if (l.pickup_date) parts.push(l.pickup_date);
  return parts.length ? parts.join(" · ") : l.id.slice(0, 8);
}
