"use client";

export default function FleetError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <section className="space-y-3 rounded-xl border border-sp-danger/40 bg-sp-danger/10 p-5">
      <h2 className="text-base font-semibold text-sp-danger">
        Couldn't save that change
      </h2>
      <p className="text-sm text-sp-textPrimary">{error.message}</p>
      <div className="flex flex-wrap items-center gap-2">
        <button
          onClick={reset}
          className="rounded-md bg-sp-gold px-3 py-1.5 text-xs font-semibold text-sp-black hover:bg-sp-goldLight"
        >
          Try again
        </button>
        <a
          href="/fleet"
          className="rounded-md border border-white/10 px-3 py-1.5 text-xs text-sp-textSecondary hover:bg-white/5"
        >
          Back to fleet
        </a>
      </div>
    </section>
  );
}
