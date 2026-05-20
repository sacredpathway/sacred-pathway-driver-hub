// =============================================================================
//  /reports/payroll/print — Carrier HQ Phase W6
// -----------------------------------------------------------------------------
//  Render inside the (app) layout but the layout's print:hidden classes hide
//  the Nav + footer when printing, leaving PrintShell as the only visible
//  block. PrintAutoTrigger fires window.print() on mount.
// =============================================================================

import { createClient } from "@/lib/supabase/server";
import { resolveRange } from "@/lib/reports/range";
import { fetchReportBranding } from "@/lib/reports/branding";
import { fetchPayrollReport } from "../data";
import PrintShell from "../../PrintShell";
import { formatCurrency, formatDate } from "@/lib/format";

export const runtime = "edge";

export default async function PayrollPrintPage({
  searchParams,
}: {
  searchParams: Promise<{ preset?: string; from?: string; to?: string }>;
}) {
  const sp = await searchParams;
  const range = resolveRange(sp);

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const [report, branding] = await Promise.all([
    fetchPayrollReport(supabase, range),
    fetchReportBranding(supabase, user!.id),
  ]);

  return (
    <PrintShell
      title="Payroll Report"
      subtitle="Web paystubs + legacy iOS settlements"
      companyName={branding.companyName}
      logoUrl={branding.logoUrl}
      rangeLabel={`${range.from} → ${range.to}`}
    >
      <section>
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-widest text-black/60">
          Totals
        </h2>
        <table className="w-full border-collapse text-sm">
          <tbody>
            <Row label="Paystubs">{report.totals.count}</Row>
            <Row label="Gross earnings">{formatCurrency(report.totals.gross)}</Row>
            <Row label="Taxes withheld">{formatCurrency(report.totals.taxes)}</Row>
            <Row label="Pre-tax deductions">{formatCurrency(report.totals.pretax)}</Row>
            <Row label="Post-tax deductions">{formatCurrency(report.totals.posttax)}</Row>
            <Row label="Settlement deductions">{formatCurrency(report.totals.settlement)}</Row>
            <Row label="Net pay" emphasis>{formatCurrency(report.totals.net)}</Row>
          </tbody>
        </table>
      </section>

      {report.groups.map((g) => (
        <section key={g.driver_id ?? "__none__"} className="break-inside-avoid">
          <h2 className="mb-2 mt-4 text-sm font-semibold uppercase tracking-widest text-black/60">
            {g.driver_name}{" "}
            <span className="font-normal text-black/40">
              · {g.count} {g.count === 1 ? "paystub" : "paystubs"} ·
              {" "}Net {formatCurrency(g.net_total)}
            </span>
          </h2>
          <table className="w-full border-collapse text-xs">
            <thead>
              <tr className="border-b border-black/30 text-left">
                <th className="px-2 py-1">Period</th>
                <th className="px-2 py-1">Check</th>
                <th className="px-2 py-1">Source</th>
                <th className="px-2 py-1">Worker</th>
                <th className="px-2 py-1">Status</th>
                <th className="px-2 py-1 text-right">Gross</th>
                <th className="px-2 py-1 text-right">Taxes</th>
                <th className="px-2 py-1 text-right">Settle</th>
                <th className="px-2 py-1 text-right">Net</th>
              </tr>
            </thead>
            <tbody>
              {g.rows.map((r) => (
                <tr key={r.id} className="border-b border-black/10">
                  <td className="px-2 py-1">
                    {formatDate(r.pay_period_start)} → {formatDate(r.pay_period_end)}
                  </td>
                  <td className="px-2 py-1">{formatDate(r.check_date)}</td>
                  <td className="px-2 py-1">{r.source === "paystub" ? "PS" : "Set"}</td>
                  <td className="px-2 py-1">{r.worker_type}</td>
                  <td className="px-2 py-1">{r.status ?? "—"}</td>
                  <td className="px-2 py-1 text-right">{formatCurrency(r.gross_earnings)}</td>
                  <td className="px-2 py-1 text-right">{formatCurrency(r.total_taxes_withheld)}</td>
                  <td className="px-2 py-1 text-right">{formatCurrency(r.total_settlement_deductions)}</td>
                  <td className="px-2 py-1 text-right font-semibold">{formatCurrency(r.net_pay)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ))}
    </PrintShell>
  );
}

function Row({
  label,
  children,
  emphasis = false,
}: {
  label: string;
  children: React.ReactNode;
  emphasis?: boolean;
}) {
  return (
    <tr className={"border-b border-black/10 " + (emphasis ? "font-bold" : "")}>
      <td className="px-2 py-1 text-black/70">{label}</td>
      <td className="px-2 py-1 text-right">{children}</td>
    </tr>
  );
}