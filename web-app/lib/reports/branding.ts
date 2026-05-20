// =============================================================================
//  Report branding fetch — Carrier HQ Phase W6
// -----------------------------------------------------------------------------
//  Loads the carrier's company name + signed logo URL for the print views.
//  Pulls from `profiles` (W4-extended). Edge-safe; the caller awaits a
//  Supabase client and passes it in to avoid double-instantiation.
// =============================================================================

import type { SupabaseClient } from "@supabase/supabase-js";

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

  const companyName = (data?.company_name as string | null) ?? null;
  const logoPath    = (data?.logo_storage_path as string | null) ?? null;

  let logoUrl: string | null = null;
  if (logoPath) {
    const { data: signed } = await supabase
      .storage
      .from("branding")
      .createSignedUrl(logoPath, 60 * 60);
    logoUrl = signed?.signedUrl ?? null;
  }
  return { companyName, logoUrl };
}
