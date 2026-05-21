// =============================================================================
//  Centralized entitlement resolver
// -----------------------------------------------------------------------------
//  ONE place that answers "what can this user do right now?" for the whole
//  web app. Every server component, server action, and middleware check
//  reads from here so the rules can't drift.
//
//  Decision order:
//    1. Not signed in                                     → AccessLevel.free
//    2. Signed-in user.id == profiles.id (their own row)  → carrier_admin
//    3. Active carrier_member where role='admin'          → carrier_admin
//    4. Active carrier_member where role='driver'         → carrier_driver
//    5. Active personal Basic Driver subscription         → basic_driver
//                                                          (Stripe/IAP TBD)
//    6. Else                                              → free
//
//  Carrier sponsorship overrides the personal subscription requirement —
//  drivers invited by an active Carrier do NOT need to pay $4.99/mo.
//  When a carrier removes them (carrier_members.status = 'removed'), this
//  resolver immediately demotes them to .basic_driver if they have a
//  personal sub or .free if they don't.
// =============================================================================

import type { SupabaseClient } from "@supabase/supabase-js";

export type AccessLevel =
  | "free"
  | "basic_driver"
  | "carrier_driver"
  | "carrier_admin";

export interface ResolvedEntitlement {
  accessLevel: AccessLevel;
  /** Auth user id, or null if not signed in. */
  userId: string | null;
  /** The carrier profile this user is under. For carrier_admin = their own
   *  profiles.id. For carrier_driver = the sponsoring carrier's profiles.id.
   *  Null for basic_driver / free. */
  carrierProfileId: string | null;
  /** Display name of the sponsoring carrier (for the "Provided by …" banner).
   *  Null if not sponsored. */
  carrierCompanyName: string | null;
  /** True only for carrier_driver — used by paywall to bypass Basic Driver. */
  isSponsored: boolean;
  /** True for any tier that can use the app (everything except .free). */
  hasAppAccess: boolean;
  /** Free / basic_driver users sometimes need to know if they're outside any
   *  carrier so the upgrade copy can say "subscribe to Basic Driver".  */
  isOutsideDriver: boolean;
}

const FREE: ResolvedEntitlement = {
  accessLevel: "free",
  userId: null,
  carrierProfileId: null,
  carrierCompanyName: null,
  isSponsored: false,
  hasAppAccess: false,
  isOutsideDriver: true,
};

/**
 * Resolve a user's effective access level + carrier context in one query.
 *
 * Uses the supabase client passed in (server-side, authenticated). Falls back
 * to `free` whenever the user isn't signed in or any lookup fails — never
 * throws.
 *
 * Safe to call from middleware (edge), server components, route handlers,
 * and server actions.
 */
export async function resolveAccess(
  supabase: SupabaseClient
): Promise<ResolvedEntitlement> {
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return FREE;

  // ---------------------------------------------------------------------
  // Step 1 — does this user own a profile row? (= carrier admin pattern
  // since profiles.id = auth.users.id is the iOS-app convention)
  // ---------------------------------------------------------------------
  const { data: ownProfile } = await supabase
    .from("profiles")
    .select("id, company_name, account_type")
    .eq("id", user.id)
    .maybeSingle();

  if (ownProfile && ownProfile.account_type !== "driver") {
    // Existing carrier accounts (every pre-W-driver profile) — and any
    // future profile explicitly created as a carrier — own a profiles row
    // with their auth.uid() as the id.
    return {
      accessLevel: "carrier_admin",
      userId: user.id,
      carrierProfileId: ownProfile.id,
      carrierCompanyName:
        (ownProfile.company_name as string | null) ?? null,
      isSponsored: false,
      hasAppAccess: true,
      isOutsideDriver: false,
    };
  }

  // ---------------------------------------------------------------------
  // Step 2 — is this user a member of any carrier (active)?
  // ---------------------------------------------------------------------
  const { data: memberships } = await supabase
    .from("carrier_members")
    .select("carrier_profile_id, role, status")
    .eq("user_id", user.id)
    .eq("status", "active");

  const activeMember = (memberships ?? []).find(
    (m) => (m as { status: string }).status === "active"
  ) as
    | { carrier_profile_id: string; role: string; status: string }
    | undefined;

  if (activeMember) {
    // Pull the carrier's display name in a second cheap lookup so the
    // resolver result is fully self-contained for the UI (no second
    // round-trip needed by the layout banner).
    const { data: carrierRow } = await supabase
      .from("profiles")
      .select("id, company_name")
      .eq("id", activeMember.carrier_profile_id)
      .maybeSingle();

    const accessLevel: AccessLevel =
      activeMember.role === "admin" ? "carrier_admin" : "carrier_driver";

    return {
      accessLevel,
      userId: user.id,
      carrierProfileId: activeMember.carrier_profile_id,
      carrierCompanyName:
        (carrierRow?.company_name as string | null) ?? null,
      isSponsored: accessLevel === "carrier_driver",
      hasAppAccess: true,
      isOutsideDriver: false,
    };
  }

  // ---------------------------------------------------------------------
  // Step 3 — basic_driver via personal subscription.
  // ---------------------------------------------------------------------
  // The personal Basic Driver subscription ($4.99/mo) lives in a future
  // basic_driver_subscriptions table (or Stripe webhook synced into one).
  // It does NOT exist yet — leaving this as a clear extension point.
  //
  // To add later (DO NOT remove this stub without updating the resolver):
  //   const { data: sub } = await supabase
  //     .from("basic_driver_subscriptions")
  //     .select("status")
  //     .eq("user_id", user.id)
  //     .eq("status", "active")
  //     .maybeSingle();
  //   if (sub) return { accessLevel: "basic_driver", ... };

  // ---------------------------------------------------------------------
  // Step 4 — no carrier, no personal sub → "free" (outside driver).
  // The signed-in user IS recognized (we have userId), so we don't return
  // the FREE constant; we return a populated object so the UI can offer
  // an "upgrade to Basic Driver $4.99/mo" CTA.
  // ---------------------------------------------------------------------
  return {
    accessLevel: "free",
    userId: user.id,
    carrierProfileId: null,
    carrierCompanyName: null,
    isSponsored: false,
    hasAppAccess: false,
    isOutsideDriver: true,
  };
}

// ---------------------------------------------------------------------------
// Convenience predicates for the UI — keeps `if (entitlement.accessLevel ===
// "carrier_admin")` out of templates.
// ---------------------------------------------------------------------------

export function isCarrierAdmin(e: ResolvedEntitlement): boolean {
  return e.accessLevel === "carrier_admin";
}

export function isCarrierDriver(e: ResolvedEntitlement): boolean {
  return e.accessLevel === "carrier_driver";
}

export function isAnyDriver(e: ResolvedEntitlement): boolean {
  return e.accessLevel === "carrier_driver" || e.accessLevel === "basic_driver";
}

export function canAccessApp(e: ResolvedEntitlement): boolean {
  return e.hasAppAccess;
}
