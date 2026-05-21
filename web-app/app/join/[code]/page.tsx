// =============================================================================
//  /join/[code] — driver-side invite acceptance
// -----------------------------------------------------------------------------
//  Public route (not behind the /(app) signed-in gate). Two states:
//
//  • Not signed in   → "Sign in to accept invite from <Carrier>" + sign-in
//                      link that round-trips back to /join/<code> after auth.
//  • Signed in       → "You're about to join <Carrier>" + Accept button.
//
//  Invite preview is fetched via the public.preview_carrier_invite RPC which
//  is SECURITY DEFINER + readable to anon, so the carrier name + role show
//  before sign-in.
// =============================================================================

import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import AcceptInviteForm from "./AcceptInviteForm";

export const runtime = "edge";

interface InvitePreview {
  ok: boolean;
  error?: string;
  carrier_company_name?: string;
  role?: string;
  expired?: boolean;
  revoked?: boolean;
  exhausted?: boolean;
}

export default async function JoinPage({
  params,
}: {
  params: Promise<{ code: string }>;
}) {
  const { code } = await params;
  const supabase = await createClient();

  // Preview the invite (works without a signed-in user — SECURITY DEFINER).
  const { data: previewRaw } = await supabase.rpc("preview_carrier_invite", {
    p_invite_code: code,
  });
  const preview = (previewRaw ?? { ok: false, error: "invite_not_found" }) as InvitePreview;

  // Are we signed in?
  const { data: { user } } = await supabase.auth.getUser();

  return (
    <main className="flex min-h-dvh items-center justify-center bg-sp-background px-6 text-sp-textPrimary">
      <div className="w-full max-w-md rounded-2xl border border-white/5 bg-sp-card p-8 shadow-lg">
        <div className="mb-6 space-y-1 text-center">
          <h1 className="text-2xl font-bold tracking-tight text-sp-gold">
            Driver Hub
          </h1>
          <p className="text-sm text-sp-textSecondary">Invite to join</p>
        </div>

        <div className="rounded-xl border border-white/5 bg-sp-cardLight px-4 py-3 text-sm">
          <div className="text-[11px] uppercase tracking-wide text-sp-textSecondary">
            Invite code
          </div>
          <div className="mt-0.5 font-mono text-base text-sp-gold">{code}</div>
        </div>

        <div className="mt-5 space-y-3">
          {!preview.ok ? (
            <InvalidInvite error={preview.error ?? "invite_not_found"} />
          ) : preview.revoked ? (
            <InvalidInvite error="invite_revoked" />
          ) : preview.expired ? (
            <InvalidInvite error="invite_expired" />
          ) : preview.exhausted ? (
            <InvalidInvite error="invite_max_uses_reached" />
          ) : !user ? (
            <SignInPrompt
              company={preview.carrier_company_name ?? "a Carrier"}
              role={preview.role ?? "driver"}
              code={code}
            />
          ) : (
            <AcceptBlock
              company={preview.carrier_company_name ?? "a Carrier"}
              role={preview.role ?? "driver"}
              code={code}
            />
          )}
        </div>

        <p className="mt-6 text-center text-[11px] text-sp-textSecondary">
          Sponsored drivers get Basic Driver access included with the
          carrier&apos;s subscription — no separate charge.
        </p>
      </div>
    </main>
  );
}

// -----------------------------------------------------------------------------
// State blocks
// -----------------------------------------------------------------------------

function SignInPrompt({
  company,
  role,
  code,
}: {
  company: string;
  role: string;
  code: string;
}) {
  return (
    <>
      <p className="text-sm text-sp-textPrimary">
        <strong className="text-sp-gold">{company}</strong> is inviting you to
        join as a <strong>{role}</strong>.
      </p>
      <p className="text-xs text-sp-textSecondary">
        Sign in to accept this invite. If you don&apos;t have an account yet,
        you&apos;ll be guided to create one and then come back here.
      </p>
      <Link
        href={`/auth/signin?next=${encodeURIComponent(`/join/${code}`)}`}
        className="inline-block w-full rounded-lg bg-sp-gold px-6 py-3 text-center font-semibold text-sp-black transition hover:brightness-110"
      >
        Sign In to Accept
      </Link>
    </>
  );
}

function AcceptBlock({
  company,
  role,
  code,
}: {
  company: string;
  role: string;
  code: string;
}) {
  return (
    <>
      <p className="text-sm text-sp-textPrimary">
        You&apos;re about to join <strong className="text-sp-gold">{company}</strong>{" "}
        as a <strong>{role}</strong>.
      </p>
      <p className="text-xs text-sp-textSecondary">
        Tap Accept to link your account. You can leave at any time from
        Settings.
      </p>
      <AcceptInviteForm code={code} />
    </>
  );
}

function InvalidInvite({ error }: { error: string }) {
  const message = (() => {
    switch (error) {
      case "invite_not_found":      return "This invite link is invalid or has been deleted.";
      case "invite_revoked":        return "This invite has been revoked by the carrier.";
      case "invite_expired":        return "This invite has expired. Ask the carrier for a fresh code.";
      case "invite_max_uses_reached": return "This invite has reached its maximum uses.";
      default:                       return error;
    }
  })();
  return (
    <div className="rounded-md border border-sp-danger/40 bg-sp-danger/10 px-3 py-3 text-sm text-sp-danger">
      {message}
    </div>
  );
}
