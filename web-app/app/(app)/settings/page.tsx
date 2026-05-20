// =============================================================================
//  /settings — Carrier HQ Phase W4
// -----------------------------------------------------------------------------
//  Company profile (name, MC, DOT, EIN, address, phone) + logo upload.
//  Paystub preferences live on /settings/paystub.
// =============================================================================

import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import type { Profile } from "@/lib/supabase/types";
import CompanyProfileForm from "./CompanyProfileForm";
import LogoCard from "./LogoCard";

export const runtime = "edge";

export default async function SettingsPage() {
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

  let logoUrl: string | null = null;
  if (profile?.logo_storage_path) {
    const { data: signed } = await supabase
      .storage
      .from("branding")
      .createSignedUrl(profile.logo_storage_path, 60 * 60);
    logoUrl = signed?.signedUrl ?? null;
  }

  return (
    <section className="space-y-6">
      <header className="flex items-baseline justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Settings</h1>
          <p className="mt-1 text-xs text-sp-textSecondary">
            Company branding, paystub defaults, and account preferences.
          </p>
        </div>
        <nav className="flex gap-1 text-xs">
          <span className="rounded-md bg-sp-gold/15 px-3 py-1.5 font-medium text-sp-gold">
            Company
          </span>
          <Link
            href="/settings/paystub"
            className="rounded-md px-3 py-1.5 text-sp-textSecondary hover:bg-white/5 hover:text-sp-textPrimary"
          >
            Paystub
          </Link>
        </nav>
      </header>

      <LogoCard logoUrl={logoUrl} hasLogo={!!profile?.logo_storage_path} />

      <CompanyProfileForm profile={profile ?? undefined} />
    </section>
  );
}
