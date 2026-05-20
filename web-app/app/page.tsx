// Landing page — signed-in users get bounced to /dashboard by middleware.
// Unauthed visitors see a thin marketing splash + sign-in CTA.

import Link from "next/link";

export const runtime = "edge";

export default function LandingPage() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-8 px-6 text-center">
      <div className="space-y-2">
        <div className="text-4xl font-bold tracking-tight text-sp-gold">Driver Hub</div>
        <div className="text-sm text-sp-textSecondary">Sacred Pathway</div>
      </div>
      <p className="max-w-md text-sp-textSecondary">
        Sign in to see your loads, brokers, expenses, and reports from any browser.
        Same account as the Driver Hub iPhone app.
      </p>
      <div className="flex flex-col gap-3">
        <Link
          href="/auth/signin"
          className="rounded-xl bg-sp-gold px-6 py-3 font-semibold text-sp-black transition hover:brightness-110"
        >
          Sign In
        </Link>
        <a
          href="https://apps.apple.com/app/id0000000000"
          className="text-xs text-sp-textSecondary underline-offset-2 hover:underline"
        >
          Get the iPhone app
        </a>
      </div>
      <p className="max-w-md text-xs text-sp-textSecondary">
        Driver Hub web is for Cloud Sync users. If you’re using <span className="text-sp-gold">Free Local Mode</span> on
        your iPhone, your data stays on-device and is not visible here.
      </p>
    </main>
  );
}
