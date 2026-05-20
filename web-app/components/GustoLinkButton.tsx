// =============================================================================
//  GustoLinkButton — opens gusto.com in a new tab.
// -----------------------------------------------------------------------------
//  This is an EXTERNAL LINK ONLY. There is no Gusto API integration, no data
//  sync, and no partnership. The carrier finishes payroll in their own Gusto
//  account; Carrier HQ just gives them a one-click way to get there.
//
//  Styling is intentionally secondary so it never visually competes with the
//  primary "Issue paystub" / "+ New paystub" gold CTAs.
// =============================================================================

const GUSTO_URL = "https://gusto.com/";

type Variant = "card" | "button";

export default function GustoLinkButton({
  variant = "card",
  className = "",
}: {
  variant?: Variant;
  className?: string;
}) {
  if (variant === "button") {
    return (
      <a
        href={GUSTO_URL}
        target="_blank"
        rel="noopener noreferrer"
        className={
          "inline-flex items-center gap-2 rounded-md border border-white/10 bg-sp-card/60 " +
          "px-3 py-1.5 text-xs font-medium text-sp-textPrimary hover:bg-white/5 " +
          className
        }
      >
        <ExternalIcon />
        Open Gusto to run payroll
      </a>
    );
  }

  // Default: full card with helper copy
  return (
    <section
      className={
        "rounded-xl border border-white/5 bg-sp-card/40 p-4 md:p-5 " + className
      }
    >
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div className="max-w-2xl">
          <h3 className="text-sm font-semibold text-sp-textPrimary">
            Run payroll in Gusto
          </h3>
          <p className="mt-1 text-xs text-sp-textSecondary">
            Carrier HQ helps you prepare payroll records. Gusto handles payroll
            submission, taxes, and direct deposit after you log in.
          </p>
        </div>
        <a
          href={GUSTO_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center justify-center gap-2 self-start rounded-md border border-white/10 bg-sp-card/60 px-4 py-2 text-sm font-medium text-sp-textPrimary hover:bg-white/5 md:self-auto"
        >
          <ExternalIcon />
          Open Gusto to run payroll
        </a>
      </div>
    </section>
  );
}

function ExternalIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className="h-3.5 w-3.5"
    >
      <path d="M14 3h7v7" />
      <path d="M10 14L21 3" />
      <path d="M21 14v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5" />
    </svg>
  );
}
