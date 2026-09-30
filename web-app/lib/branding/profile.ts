// =============================================================================
//  Profile-backed branding — single source of truth
// -----------------------------------------------------------------------------
//  A carrier's branding lives on its `profiles` row:
//    company_name, logo_storage_path, paystub_theme, paystub_footer_legal
//  The logo FILE lives in the private Storage BUCKET named "branding" at
//  `<profile_id>/logo.<ext>` (storage policy: folder must equal auth.uid()).
//
//  There is no `branding` TABLE in production and nothing here needs one.
//  Every read of branding goes through this module so the transform and the
//  signed-URL call are written once.
// =============================================================================

import type { SupabaseClient } from "@supabase/supabase-js";
import type { PaystubTheme } from "@/lib/supabase/types";
import { PAYSTUB_THEME_COLORS } from "@/lib/paystubs/themes";

/** Storage bucket (not a table) that holds carrier logos. */
export const BRANDING_BUCKET = "branding";
export const LOGO_SIGNED_URL_TTL_SECONDS = 60 * 60;

/** Columns to select from `profiles` for branding. */
export const PROFILE_BRANDING_COLUMNS =
  "company_name, logo_storage_path, paystub_theme, paystub_footer_legal";

export interface ProfileBrandingRow {
  company_name?: string | null;
  logo_storage_path?: string | null;
  paystub_theme?: string | null;
  paystub_footer_legal?: string | null;
}

export interface ProfileBranding {
  companyName: string | null;
  logoPath: string | null;
  /** Always a valid theme — falls back to navy_gold like the DB default. */
  paystubTheme: PaystubTheme;
  footerLegal: string;
}

function clean(v: string | null | undefined): string | null {
  const t = (v ?? "").trim();
  return t ? t : null;
}

/** Pure transform: a (possibly partial / null) profiles row → branding. */
export function profileToBranding(
  row: ProfileBrandingRow | null | undefined,
): ProfileBranding {
  const theme = clean(row?.paystub_theme);
  return {
    companyName: clean(row?.company_name),
    logoPath: clean(row?.logo_storage_path),
    paystubTheme:
      theme && theme in PAYSTUB_THEME_COLORS ? (theme as PaystubTheme) : "navy_gold",
    footerLegal: clean(row?.paystub_footer_legal) ?? "",
  };
}

/**
 * Storage object path for a carrier logo upload. Storage RLS compares the
 * first folder to auth.uid()::text, which Postgres renders lowercase — Swift
 * UUIDs are uppercase, so always lowercase here to avoid a 403.
 */
export function logoStoragePath(profileId: string, ext: string): string {
  return `${profileId.toLowerCase()}/logo.${ext}`;
}

/**
 * Short-lived signed URL for a logo in the private `branding` bucket.
 * Returns null when there is no logo, or when the caller isn't allowed to read
 * it (storage RLS) — the UI then shows its fallback tile.
 */
export async function signLogoUrl(
  supabase: SupabaseClient,
  logoPath: string | null | undefined,
): Promise<string | null> {
  const path = clean(logoPath);
  if (!path) return null;
  try {
    const { data } = await supabase.storage
      .from(BRANDING_BUCKET)
      .createSignedUrl(path, LOGO_SIGNED_URL_TTL_SECONDS);
    return data?.signedUrl ?? null;
  } catch {
    return null;
  }
}
