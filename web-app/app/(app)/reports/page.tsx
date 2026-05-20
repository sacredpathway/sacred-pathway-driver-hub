// =============================================================================
//  /reports — Carrier HQ Phase W6 landing
// -----------------------------------------------------------------------------
//  Five report cards. Each links to its sub-page; sub-pages own their own
//  date range and export buttons. Reports are read-only — no schema impact.
// =============================================================================

import Link from "next/link";

export const runtime = "edge";

interface Card {
  href: string;
  title: string;
  body: string;
  cta: string;
}

const CARDS: ReadonlyArray<Card> = [
  {
    href: "/reports/payroll",
    title: "Payroll",
    body: "Every paystub + legacy settlement in a date range, grouped by driver. Net pay, gross, taxes, deductions, settlement items.",
    cta: "Open payroll report",
  },
  {
    href: "/reports/drivers",
    title: "Driver earnings",
    body: "Per-driver loads, miles, revenue, gross paid, profit per mile. Quick read on who's pulling weight.",
    cta: "Open driver report",
  },
  {
    href: "/reports/revenue",
    title: "Revenue",
    body: "Per-broker rollup: loads, miles, total revenue, average rate per load and per mile. Find your best lanes.",
    cta: "Open revenue report",
  },
  {
    href: "/reports/expenses",
    title: "Expenses",
    body: "Category totals, fuel cost per gallon, DEF totals. Carrier overhead at a glance.",
    cta: "Open expense report",
  },
  {
    href: "/reports/cpa",
    title: "CPA export",
    body: "Year-to-date P&L summary your accountant can drop straight into a tax return. CSV + printable PDF.",
    cta: "Open CPA export",
  },
];

export default function ReportsLandingPage() {
  return (
    <section className="space-y-6">
      <header className="flex items-baseline justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Reports</h1>
          <p className="mt-1 text-xs text-sp-textSecondary">
            Read-only, exportable. CSV for spreadsheets, Print/Save-as-PDF for
            email and your accountant.
          </p>
        </div>
      </header>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
        {CARDS.map((c) => (
          <Link
            key={c.href}
            href={c.href}
            className="group rounded-xl border border-white/5 bg-sp-card p-5 transition hover:border-sp-gold/40 hover:bg-sp-gold/5"
          >
            <h2 className="text-base font-semibold text-sp-textPrimary">
              {c.title}
            </h2>
            <p className="mt-2 text-xs text-sp-textSecondary">{c.body}</p>
            <div className="mt-4 text-xs font-semibold text-sp-gold group-hover:underline">
              {c.cta} →
            </div>
          </Link>
        ))}
      </div>
    </section>
  );
}
