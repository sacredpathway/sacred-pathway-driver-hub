// =============================================================================
//  Join server action — Carrier-Sponsored Driver Access
// -----------------------------------------------------------------------------
//  Calls the SECURITY DEFINER public.accept_carrier_invite(code) RPC, which
//  validates the code (not revoked / not expired / use_count < max_uses / email
//  match if scoped) and inserts the carrier_members row + bumps use_count.
//
//  Returns the same {ok, error|carrier_profile_id, …} shape as the SQL fn.
// =============================================================================

"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

export type JoinActionState =
  | { ok: true; carrierProfileId: string; alreadyMember: boolean }
  | { ok: false; error: string };

function humanizeError(code: string): string {
  switch (code) {
    case "not_signed_in":         return "You need to sign in first.";
    case "invite_not_found":      return "This invite link is invalid or has been deleted.";
    case "invite_revoked":        return "This invite has been revoked by the carrier.";
    case "invite_expired":        return "This invite has expired. Ask the carrier for a fresh code.";
    case "invite_max_uses_reached": return "This invite has reached its maximum uses.";
    case "invite_email_mismatch": return "This invite is for a different email address. Sign in with the email it was sent to.";
    default:                       return code;
  }
}

export async function acceptInviteAction(
  inviteCode: string,
  _prev: JoinActionState | undefined,
  _formData: FormData
): Promise<JoinActionState> {
  if (!inviteCode) return { ok: false, error: "Missing invite code." };

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("accept_carrier_invite", {
    p_invite_code: inviteCode,
  });

  if (error) return { ok: false, error: error.message };

  const result = (data ?? {}) as {
    ok?: boolean;
    error?: string;
    carrier_profile_id?: string;
    already_member?: boolean;
  };

  if (!result.ok) {
    return { ok: false, error: humanizeError(result.error ?? "unknown_error") };
  }

  // Mint a profiles row for this driver so the rest of the app behaves
  // consistently (driver dashboard reads from profiles for branding etc).
  // Idempotent — only inserts if missing.
  const { data: { user } } = await supabase.auth.getUser();
  if (user) {
    await supabase
      .from("profiles")
      .upsert(
        { id: user.id, account_type: "driver" },
        { onConflict: "id", ignoreDuplicates: true }
      );
  }

  revalidatePath("/", "layout");
  redirect("/dashboard?joined=1");
}
