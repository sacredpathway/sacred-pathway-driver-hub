// Sign-in page — email magic link only for Phase W1.
// Apple Sign In lands in W1.5 once a web Services ID is registered in
// the Apple Developer console and added to Supabase Auth → Providers.

import SignInForm from "./SignInForm";

export const runtime = "edge";

// Next 15 ships `searchParams` (and `params`) as Promises into page
// components. We await it once at the top of the function.
export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; error?: string }>;
}) {
  const sp = await searchParams;
  return (
    <main className="flex min-h-dvh items-center justify-center px-6">
      <div className="w-full max-w-md rounded-2xl border border-white/5 bg-sp-card p-8 shadow-lg">
        <div className="mb-6 space-y-1 text-center">
          <h1 className="text-2xl font-bold tracking-tight text-sp-gold">Driver Hub</h1>
          <p className="text-sm text-sp-textSecondary">Sign in with your Cloud Sync account</p>
        </div>

        {sp.error && (
          <div
            className="mb-4 rounded-lg border border-sp-danger/40 bg-sp-danger/10 px-3 py-2 text-sm text-sp-danger"
            role="alert"
          >
            {sp.error}
          </div>
        )}

        <SignInForm nextPath={sp.next ?? "/dashboard"} />

        <p className="mt-6 text-center text-xs text-sp-textSecondary">
          We’ll email you a one-tap sign-in link. Same account as the iPhone app.
        </p>
      </div>
    </main>
  );
}
