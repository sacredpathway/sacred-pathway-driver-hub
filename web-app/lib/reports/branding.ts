// =============================================================================
//  Report branding fetch — Carrier HQ Phase W6
// -----------------------------------------------------------------------------
//  Loads the carrier's company name + signed logo URL for the print views.
//  Pulls from `profiles` (W4-extended). Edge-safe; the caller awaits a
//  Supabase client and passes it in to avoid double-instantiation.
// =============================================================================

import type { SupabaseClient } from "@supabase/supabase-js";
import { profileToBranding, signLogoUrl } from "@/lib/branding/profile";

export interface ReportBranding {
  companyName: string | null;
  logoUrl: string | null;
}

export async function fetchReportBranding(
  supabase: SupabaseClient,
  userId: string
): Promise<ReportBranding> {
  const { data } = await supabase
    .from("profiles")
    .select("company_name, logo_storage_path")
    .eq("id", userId)
    .maybeSingle();

  const branding = profileToBranding(data);
  const logoUrl = await signLogoUrl(supabase, branding.logoPath);
  return { companyName: branding.companyName, logoUrl };
}
