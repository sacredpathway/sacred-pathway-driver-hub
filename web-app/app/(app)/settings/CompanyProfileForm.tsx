// =============================================================================
//  CompanyProfileForm — Carrier HQ Phase W4
// -----------------------------------------------------------------------------
//  Client form for the company-profile block on /settings.
//  Mirrors the look-and-feel of DriverForm so the whole settings tree feels
//  like one product.
// =============================================================================

"use client";

import { useActionState } from "react";
import type { Profile } from "@/lib/supabase/types";
import {
  updateCompanyProfileAction,
  type SettingsActionState,
} from "./actions";

export default function CompanyProfileForm({
  profile,
}: {
  profile?: Partial<Profile>;
}) {
  const [state, formAction, pending] = useActionState<
    SettingsActionState | undefined,
    FormData
  >(updateCompanyProfileAction, undefined);

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

      <Section
        title="Company"
        subtitle="Shown on every paystub PDF, settlement, and in the app header."
      >
        <Field label="Company name" name="company_name" defaultValue={profile?.company_name ?? ""} placeholder="Sacred Pathway Logistics LLC" />
        <Grid2>
          <Field label="MC #" name="mc_number" defaultValue={profile?.mc_number ?? ""} placeholder="123456" />
          <Field label="DOT #" name="dot_number" defaultValue={profile?.dot_number ?? ""} placeholder="9876543" />
        </Grid2>
        <Grid2>
          <Field
            label="EIN"
            name="company_ein"
            defaultValue={profile?.company_ein ?? ""}
            placeholder="12-3456789"
            hint="9 digits — dashes added for you."
          />
          <Field label="Phone" name="phone" defaultValue={profile?.phone ?? ""} placeholder="(555) 555-5555" />
        </Grid2>
      </Section>

      <Section
        title="Mailing address"
        subtitle="Used on paystubs and 1099-NEC exports."
      >
        <Field label="Street" name="company_address" defaultValue={profile?.company_address ?? ""} placeholder="123 Main St" />
        <Grid3>
          <Field label="City" name="company_city" defaultValue={profile?.company_city ?? ""} placeholder="Dallas" />
          <Field label="State" name="company_state" defaultValue={profile?.company_state ?? ""} placeholder="TX" />
          <Field label="ZIP" name="company_zip" defaultValue={profile?.company_zip ?? ""} placeholder="75201" />
        </Grid3>
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
// Tiny layout primitives (kept inline — reused by the paystub form too)
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

function Grid3({ children }: { children: React.ReactNode }) {
  return <div className="grid grid-cols-1 gap-3 md:grid-cols-3">{children}</div>;
}

function Field({
  label,
  name,
  defaultValue,
  placeholder,
  hint,
  type = "text",
}: {
  label: string;
  name: string;
  defaultValue?: string;
  placeholder?: string;
  hint?: string;
  type?: string;
}) {
  return (
    <label className="block space-y-1">
      <span className="text-xs font-semibold uppercase tracking-wide text-sp-textSecondary">
        {label}
      </span>
      <input
        type={type}
        name={name}
        defaultValue={defaultValue}
        placeholder={placeholder}
        className="w-full rounded-lg bg-sp-cardLight px-3 py-2 text-sm text-sp-textPrimary placeholder:text-sp-textSecondary outline-none ring-1 ring-white/5 focus:ring-sp-gold"
      />
      {hint && <span className="block text-[11px] text-sp-textSecondary">{hint}</span>}
    </label>
  );
}
