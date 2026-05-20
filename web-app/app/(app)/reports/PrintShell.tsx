// =============================================================================
//  PrintShell — Carrier HQ Phase W6
// -----------------------------------------------------------------------------
//  Wraps a report's print view in a print-friendly layout: light background,
//  black text, page-break hints, and a small client script that auto-opens
//  the browser's print dialog on load.
//
//  We deliberately avoid pulling the authenticated <Nav> here so the PDF
//  doesn't include the in-app chrome. The header takes its branding cue
//  from the company name + logo passed in by the parent server component.
// =============================================================================

import PrintAutoTrigger from "./PrintAutoTrigger";

export default function PrintShell({
  title,
  subtitle,
  companyName,
  logoUrl,
  rangeLabel,
  children,
}: {
  title: string;
  subtitle?: string;
  companyName: string | null;
  logoUrl: string | null;
  rangeLabel: string;
  children: React.ReactNode;
}) {
  const now = new Date();
  const generated = now.toLocaleString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });

  return (
    <div className="min-h-dvh bg-white text-black print:bg-white">
      <PrintAutoTrigger />
      <div className="mx-auto max-w-4xl px-8 py-10 print:px-6 print:py-6">
        <header className="mb-6 flex items-start justify-between border-b border-black/15 pb-4">
          <div className="flex items-center gap-3">
            {logoUrl && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={logoUrl}
                alt={companyName ?? "Company logo"}
                className="h-10 w-10 rounded-md object-contain"
              />
            )}
            <div>
              <div className="text-xs uppercase tracking-widest text-black/60">
                {companyName ?? "Sacred Pathway Driver Hub"}
              </div>
              <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
              {subtitle && (
                <p className="mt-0.5 text-xs text-black/60">{subtitle}</p>
              )}
            </div>
          </div>
          <div className="text-right text-[10px] uppercase tracking-widest text-black/60">
            <div>Range</div>
            <div className="font-mono text-[11px] text-black">{rangeLabel}</div>
            <div className="mt-2">Generated</div>
            <div className="font-mono text-[11px] text-black">{generated}</div>
          </div>
        </header>

        <main className="space-y-6">{children}</main>

        <footer className="mt-10 border-t border-black/15 pt-3 text-[10px] uppercase tracking-widest text-black/40">
          Carrier HQ · Sacred Pathway Driver Hub · Internal report
        </footer>
      </div>
    </div>
  );
}
