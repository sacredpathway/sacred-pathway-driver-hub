// =============================================================================
//  /settings/paystub — Carrier HQ Phase W4
// -----------------------------------------------------------------------------
//  Theme picker, footer legal, and fee defaults that flow into every new
//  paystub. Same Save pattern as /settings.
// =============================================================================

import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import type { Profile } from "@/lib/supabase/types";
import PaystubPrefsForm from "./PaystubPrefsForm";

export const runtime = "edge";

export default async function PaystubSettingsPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  const { data: profileRaw, error } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", user!.id)
    .maybeSingle();

  if (error) {
    return (
      <div className="rounded-lg border border-sp-danger/40 bg-sp-danger/10 p-4 text-sm text-sp-danger">
        {error.message}
      </div>
    );
  }

  const profile: Profile | null = (profileRaw ?? null) as Profile | null;

  return (
    <section className="space-y-6">
      <header className="flex items-baseline justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Settings</h1>
          <p className="mt-1 text-xs text-sp-textSecondary">
            Paystub branding, footer text, and fee defaults applied to new
            paystubs.
          </p>
        </div>
        <nav className="flex gap-1 text-xs">
          <Link
            href="/settings"
            className="rounded-md px-3 py-1.5 text-sp-textSecondary hover:bg-white/5 hover:text-sp-textPrimary"
          >
            Company
          </Link>
          <span className="rounded-md bg-sp-gold/15 px-3 py-1.5 font-medium text-sp-gold">
            Paystub
          </span>
        </nav>
      </header>

      <PaystubPrefsForm profile={profile ?? undefined} />
    </section>
  );
}
