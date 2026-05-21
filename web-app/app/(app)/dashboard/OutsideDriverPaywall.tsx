// =============================================================================
//  OutsideDriverPaywall — Carrier-Sponsored Driver Access
// -----------------------------------------------------------------------------
//  Shown on /dashboard when a signed-in user has NO carrier sponsorship and
//  NO active personal Basic Driver subscription (entitlement.accessLevel ===
//  "free" AND entitlement.userId is present).
//
//  At Carrier HQ today this primarily serves driver-account users who landed
//  here after a sponsorship was revoked. The "Subscribe — $4.99/mo" button
//  is a stub: real Stripe / IAP wiring lands when the Basic Driver product
//  is created (deferred per the spec — no $0 ASC product allowed and the
//  paid Basic Driver IAP is a separate setup pass).
// =============================================================================

import Link from "next/link";

export default function OutsideDriverPaywall() {
  return (
    <section className="rounded-xl border border-sp-warning/30 bg-sp-warning/5 p-5">
      <header className="mb-2 flex items-center gap-2">
        <span className="rounded-md bg-sp-warning/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-sp-warning">
          Basic Driver required
        </span>
      </header>
      <h2 className="text-base font-semibold text-sp-textPrimary">
        You don&apos;t have access yet
      </h2>
      <p className="mt-2 text-sm text-sp-textSecondary">
        Driver Hub Basic Driver is $4.99/month — earnings dashboard, pay
        history, basic expenses, and reports. If your carrier already has
        Driver Hub Carrier, ask them to invite you and access is provided
        for free.
      </p>

      <div className="mt-4 flex flex-wrap gap-2">
        <Link
          href="/settings"
          className="rounded-md border border-white/10 bg-sp-cardLight px-3 py-1.5 text-xs font-medium text-sp-textPrimary hover:bg-white/10"
          aria-disabled
          title="Subscription wiring lands once the Basic Driver IAP product is created in App Store Connect / Stripe."
        >
          Subscribe — $4.99/month
        </Link>
        <Link
          href="/auth/signout"
          className="rounded-md border border-white/10 px-3 py-1.5 text-xs font-medium text-sp-textSecondary hover:bg-white/5"
        >
          Sign out
        </Link>
      </div>

      <p className="mt-3 text-[11px] text-sp-textSecondary">
        Have an invite code from your carrier? Open{" "}
        <code className="rounded bg-sp-cardLight px-1.5 py-0.5">/join/&lt;code&gt;</code>{" "}
        to accept and switch to Carrier-sponsored access.
      </p>
    </section>
  );
}
