// =============================================================================
//  PaystubPrefsForm — Carrier HQ Phase W4
// -----------------------------------------------------------------------------
//  Theme picker (4 presets, mirrors iOS PaystubTheme enum), footer legal
//  textarea, and fee defaults block. All values write to public.profiles.
// =============================================================================

"use client";

import { useActionState, useState } from "react";
import type { Profile, PaystubTheme } from "@/lib/supabase/types";
import { PAYSTUB_THEMES } from "@/lib/supabase/types";
import {
  updatePaystubPrefsAction,
  type SettingsActionState,
} from "../actions";

const THEMES: ReadonlyArray<{
  id: PaystubTheme;
  label: string;
  primary: string;
  accent: string;
  description: string;
}> = [
  {
    id: "navy_gold",
    label: "Navy + Gold",
    primary: "#1a263f",
    accent: "#cdad42",
    description: "Default. Premium trucking-industry standard.",
  },
  {
    id: "forest_gold",
    label: "Forest + Gold",
    primary: "#1c4d2e",
    accent: "#cdad42",
    description: "Sacred Pathway brand alignment.",
  },
  {
    id: "black_silver",
    label: "Black + Silver",
    primary: "#19191e",
    accent: "#c7c7cc",
    description: "Minimal. High contrast for printers.",
  },
  {
    id: "blue_gray",
    label: "Blue + Gray",
    primary: "#33567f",
    accent: "#8c99a6",
    description: "Soft, modern, easy on screens.",
  },
];

export default function PaystubPrefsForm({
  profile,
}: {
  profile?: Partial<Profile>;
}) {
  const [theme, setTheme] = useState<PaystubTheme>(
    (profile?.paystub_theme as PaystubTheme | null) ?? "navy_gold"
  );
  const [state, formAction, pending] = useActionState<
    SettingsActionState | undefined,
    FormData
  >(updatePaystubPrefsAction, undefined);

  return (
    <form action={formAction} className="space-y-6">
      {state && !state.ok && (
        <div className="rounded-lg border border-sp-danger/40 bg-sp-danger/10 p-3 text-sm text-sp-danger">
          {state.error}
        </div>
      )}
      {state && state.ok && (
        <div className="rounded-lg border border-sp-success/40 bg-sp-success/10 p-3 text-sm text-sp-success">
          Saved.
        </div>
      )}

      {/* ---------- Theme picker ---------- */}
      <Section
        title="Paystub theme"
        subtitle="Color palette used on every PDF paystub. You can change this any time — existing PDFs are not retroactively re-rendered."
      >
        <input type="hidden" name="paystub_theme" value={theme} />
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {THEMES.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setTheme(t.id)}
              className={
                "group relative flex flex-col gap-2 rounded-xl border p-3 text-left transition " +
                (theme === t.id
                  ? "border-sp-gold/60 bg-sp-gold/5 ring-2 ring-sp-gold/60"
                  : "border-white/10 bg-sp-cardLight hover:border-white/30")
              }
            >
              <div className="flex items-center gap-2">
                <span
                  className="block h-6 w-6 rounded-md"
                  style={{ background: t.primary }}
                />
                <span
                  className="block h-6 w-6 rounded-md"
                  style={{ background: t.accent }}
                />
                <span className="text-sm font-medium text-sp-textPrimary">
                  {t.label}
                </span>
                {theme === t.id && (
                  <span className="ml-auto text-[10px] font-semibold uppercase tracking-wide text-sp-gold">
                    Selected
                  </span>
                )}
              </div>
              <span className="text-[11px] text-sp-textSecondary">
                {t.description}
              </span>
            </button>
          ))}
        </div>
      </Section>

      {/* ---------- Footer legal ---------- */}
      <Section
        title="Footer legal text"
        subtitle="Optional. Appears at the bottom of every paystub PDF. Common: independent-contractor language, dispute window, or contact email."
      >
        <textarea
          name="paystub_footer_legal"
          defaultValue={profile?.paystub_footer_legal ?? ""}
          rows={4}
          placeholder="Independent contractor — settlement disputes must be raised within 30 days of issue. Contact payroll@yourcompany.com."
          className="w-full rounded-lg bg-sp-cardLight px-3 py-2 text-sm text-sp-textPrimary placeholder:text-sp-textSecondary outline-none ring-1 ring-white/5 focus:ring-sp-gold"
        />
        <p className="text-[11px] text-sp-textSecondary">
          Leave blank to use no footer.
        </p>
      </Section>

      {/* ---------- Fee defaults ---------- */}
      <Section
        title="Settlement fee defaults"
        subtitle="Pre-filled into new 1099 paystubs. The carrier can still override per paystub."
      >
        <Grid2>
          <NumField
            label="Driver pay (%)"
            name="driver_pay_percentage"
            defaultValue={profile?.driver_pay_percentage}
            step="0.01"
            suffix="%"
          />
          <NumField
            label="Dispatcher fee (%)"
            name="dispatcher_fee_percentage"
            defaultValue={profile?.dispatcher_fee_percentage}
            step="0.01"
            suffix="%"
          />
        </Grid2>
        <Grid2>
          <NumField
            label="Factoring fee (%)"
            name="factoring_fee_percentage"
            defaultValue={profile?.factoring_fee_percentage}
            step="0.01"
            suffix="%"
          />
          <NumField
            label="Authority fee"
            name="authority_fee"
            defaultValue={profile?.authority_fee}
            step="0.01"
            prefix="$"
          />
        </Grid2>
        <NumField
          label="Maintenance reserve"
          name="maintenance_reserve"
          defaultValue={profile?.maintenance_reserve}
          step="0.01"
          prefix="$"
        />
      </Section>

      <div className="flex items-center justify-end gap-3">
        <button
          type="submit"
          disabled={pending}
          className="rounded-lg bg-sp-gold px-5 py-2.5 text-sm font-semibold text-sp-black transition disabled:opacity-50 hover:brightness-110"
        >
          {pending ? "Saving…" : "Save changes"}
        </button>
      </div>
    </form>
  );
}

// -----------------------------------------------------------------------------
// Layout primitives — same shape as CompanyProfileForm
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
        {subtitle && (
          <p className="text-xs text-sp-textSecondary">{subtitle}</p>
        )}
      </header>
      <div className="space-y-3">{children}</div>
    </section>
  );
}

function Grid2({ children }: { children: React.ReactNode }) {
  return <div className="grid grid-cols-1 gap-3 md:grid-cols-2">{children}</div>;
}

function NumField({
  label,
  name,
  defaultValue,
  step,
  prefix,
  suffix,
}: {
  label: string;
  name: string;
  defaultValue?: number | null;
  step?: string;
  prefix?: string;
  suffix?: string;
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
          defaultValue={defaultValue ?? ""}
          inputMode="decimal"
          className={
            "w-full rounded-lg bg-sp-cardLight py-2 text-sm text-sp-textPrimary placeholder:text-sp-textSecondary outline-none ring-1 ring-white/5 focus:ring-sp-gold " +
            (prefix ? "pl-7 " : "pl-3 ") +
            (suffix ? "pr-7" : "pr-3")
          }
        />
        {suffix && (
          <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm text-sp-textSecondary">
            {suffix}
          </span>
        )}
      </div>
    </label>
  );
}
