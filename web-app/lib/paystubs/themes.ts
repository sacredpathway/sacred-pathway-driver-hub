// =============================================================================
//  Paystub theme palette — Carrier HQ Phase W8
// -----------------------------------------------------------------------------
//  Single source of truth for the 4 paystub themes a carrier can pick from on
//  /settings/paystub. The same primary/accent pair is used:
//    • on /settings/paystub (preview swatch + selected card)
//    • inside the /payroll/[id]/print template
//
//  Pure constants — no React, no Supabase — safe to import from anywhere.
//  Values were lifted from iOS Services/PaystubPDFService.swift `PaystubTheme`
//  so the printed paystub matches the iOS-rendered settlement bytes for byte.
// =============================================================================

import type { PaystubTheme } from "@/lib/supabase/types";

export interface PaystubColors {
  /** Primary header / section-bar color. Dark, readable on white. */
  primary: string;
  /** Accent for totals, hero net-pay block, brand dots. */
  accent:  string;
  /** Optional tinted highlight tied to accent, used for soft chips. */
  accentSoft: string;
}

export const PAYSTUB_THEME_COLORS: Record<PaystubTheme, PaystubColors> = {
  navy_gold: {
    primary:    "#1a263f",  // iOS navy
    accent:     "#cdad42",  // iOS spGold
    accentSoft: "#fff4cf",  // light gold tint
  },
  forest_gold: {
    primary:    "#1c4d2e",
    accent:     "#cdad42",
    accentSoft: "#fff4cf",
  },
  black_silver: {
    primary:    "#19191e",
    accent:     "#c7c7cc",
    accentSoft: "#f2f2f5",
  },
  blue_gray: {
    primary:    "#33567f",
    accent:     "#8c99a6",
    accentSoft: "#eef1f5",
  },
};

/**
 * Resolve a theme string from profiles.paystub_theme (which may be NULL on
 * a fresh account). Falls back to "navy_gold" — same default as the
 * profiles.paystub_theme column.
 */
export function resolvePaystubColors(theme: PaystubTheme | null | undefined): PaystubColors {
  if (theme && theme in PAYSTUB_THEME_COLORS) {
    return PAYSTUB_THEME_COLORS[theme];
  }
  return PAYSTUB_THEME_COLORS.navy_gold;
}
