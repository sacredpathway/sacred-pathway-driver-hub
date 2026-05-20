// =============================================================================
//  ReportToolbar — Carrier HQ Phase W6
// -----------------------------------------------------------------------------
//  Per-report export bar: "Download CSV" + "Print / Save as PDF".
//
//  PDF: until Cloudflare Browser Rendering is wired, we hand the carrier
//  the browser's built-in Save-as-PDF flow via window.print(). The print
//  view is a separate route with @media print styles so what they see is
//  what they save. This works on every desktop browser today and on iOS
//  Safari Share → Print → Save as PDF.
// =============================================================================

"use client";

export default function ReportToolbar({
  csvHref,
  printHref,
}: {
  csvHref: string;
  printHref: string;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2 print:hidden">
      <a
        href={csvHref}
        className="rounded-md bg-sp-gold px-3 py-1.5 text-xs font-semibold text-sp-black hover:bg-sp-goldLight"
      >
        Download CSV
      </a>
      <a
        href={printHref}
        target="_blank"
        rel="noreferrer"
        className="rounded-md border border-white/10 px-3 py-1.5 text-xs font-medium text-sp-textPrimary hover:bg-white/5"
      >
        Print / Save as PDF
      </a>
    </div>
  );
}
