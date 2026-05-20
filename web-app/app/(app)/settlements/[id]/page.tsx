// =============================================================================
//  /settlements/[id] — Carrier HQ Phase W7
// -----------------------------------------------------------------------------
//  Read-only detail. The `id` here is either:
//    • a paystubs.id            → render summary + link to /payroll/[id] to edit
//    • a settlements.id (legacy) → render summary + "Convert to paystub" button
//
//  We try paystubs first since that's the current write path; legacy is the
//  fallback. RLS makes the cross-user noise return no rows.
// =============================================================================

import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { formatCurrency, formatDate } from "@/lib/format";
import type { Paystub, Settlement, Driver } from "@/lib/supabase/types";
import ConvertButton from "./ConvertButton";

export const runtime = "edge";

export default async function SettlementDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();

  // 1. Try paystub
  const { data: paystubRaw } = await supabase
    .from("paystubs").select("*").eq("id", id).maybeSingle();

  if (paystubRaw) {
    const p = paystubRaw as Paystub;
    const driver = await fetchDriver(supabase, p.driver_id);
    return <PaystubView paystub={p} driverName={driver?.name ?? "Unknown driver"} />;
  }

  // 2. Fall back to legacy settlement
  const { data: settleRaw } = await supabase
    .from("settlements").select("*").eq("id", id).maybeSingle();

  if (settleRaw) {
    const s = settleRaw as Settlement;
    const driver = await fetchDriver(supabase, s.driver_id);
    return (
      <LegacyView
        settlement={s}
        driverName={driver?.name ?? null}
      />
    );
  }

  notFound();
}

async function fetchDriver(
  supabase: Awaited<ReturnType<typeof createClient>>,
  driverId: string | null
): Promise<Pick<Driver, "id" | "name"> | null> {
  if (!driverId) return null;
  const { data } = await supabase
    .from("drivers")
    .select("id, name")
    .eq("id", driverId)
    .maybeSingle();
  return (data ?? null) as Pick<Driver, "id" | "name"> | null;
}

// =============================================================================
//  Paystub-sourced view — read-only summary + deep-link into Payroll editor
// =============================================================================

function PaystubView({
  paystub: p,
  driverName,
}: {
  paystub: Paystub;
  driverName: string;
}) {
  return (
    <section className="space-y-6">
      <header className="flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">
            Paystub for {driverName}
          </h1>
          <p className="mt-1 text-xs text-sp-textSecondary">
            Source: Web Payroll · status {p.status}
          </p>
        </div>
        <div className="flex gap-2">
          <Link
            href="/settlements"
            className="rounded-md border border-white/10 px-3 py-1.5 text-xs text-sp-textPrimary hover:bg-white/5"
          >
            ← Back
          </Link>
          <Link
            href={`/payroll/${p.id}`}
            className="rounded-md bg-sp-gold px-3 py-1.5 text-xs font-semibold text-sp-black hover:bg-sp-goldLight"
          >
            Open in Payroll
          </Link>
        </div>
      </header>

      <div className="rounded-xl border border-white/5 bg-sp-card p-5">
        <dl className="grid grid-cols-1 gap-x-6 gap-y-4 text-sm md:grid-cols-2">
          <Row label="Driver">{driverName}</Row>
          <Row label="Worker type">{p.worker_type}</Row>
          <Row label="Pay period">
            {formatDate(p.pay_period_start)} → {formatDate(p.pay_period_end)}
          </Row>
          <Row label="Check date">{formatDate(p.check_date)}</Row>
          <Row label="Status">{p.status}</Row>
          <Row label="Payment method">{p.payment_method ?? "—"}</Row>

          <Row label="Gross earnings">{formatCurrency(p.gross_earnings)}</Row>
          <Row label="Taxes withheld">{formatCurrency(p.total_taxes_withheld)}</Row>
          <Row label="Pre-tax deductions">{formatCurrency(p.total_pretax_deductions)}</Row>
          <Row label="Post-tax deductions">{formatCurrency(p.total_posttax_deductions)}</Row>
          <Row label="Settlement deductions">{formatCurrency(p.total_settlement_deductions)}</Row>
          <Row label="Reimbursements">{formatCurrency(p.total_reimbursements)}</Row>
          <Row label="Net pay" emphasis>{formatCurrency(p.net_pay)}</Row>
        </dl>
      </div>

      <p className="text-xs text-sp-textSecondary">
        Settlements is a read-only ledger. Edit, issue, void, or print this
        paystub from Payroll.
      </p>
    </section>
  );
}

// =============================================================================
//  Legacy iOS settlement view — read-only + Convert action
// =============================================================================

function LegacyView({
  settlement: s,
  driverName,
}: {
  settlement: Settlement;
  driverName: string | null;
}) {
  const canConvert =
    !s.paystub_id && !!s.driver_id &&
    !!s.settlement_period_start && !!s.settlement_period_end;

  return (
    <section className="space-y-6">
      <header className="flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">
            Legacy settlement
          </h1>
          <p className="mt-1 text-xs text-sp-textSecondary">
            Source: iOS Driver Hub · status {s.status ?? "—"}
          </p>
        </div>
        <Link
          href="/settlements"
          className="rounded-md border border-white/10 px-3 py-1.5 text-xs text-sp-textPrimary hover:bg-white/5"
        >
          ← Back
        </Link>
      </header>

      <div className="rounded-xl border border-white/5 bg-sp-card p-5">
        <dl className="grid grid-cols-1 gap-x-6 gap-y-4 text-sm md:grid-cols-2">
          <Row label="Driver">{driverName ?? "Unassigned"}</Row>
          <Row label="Settlement period">
            {formatDate(s.settlement_period_start)} → {formatDate(s.settlement_period_end)}
          </Row>
          <Row label="Created">{formatDate(s.created_at)}</Row>
          <Row label="Status">{s.status ?? "—"}</Row>

          <Row label="Revenue">{formatCurrency(s.total_revenue)}</Row>
          <Row label="Expenses">{formatCurrency(s.total_expenses)}</Row>
          <Row label="Gross profit">{formatCurrency(s.gross_profit)}</Row>
          <Row label="Net pay" emphasis>{formatCurrency(s.net_pay)}</Row>

          {s.pdf_storage_path && (
            <Row label="PDF (legacy storage path)">
              <code className="break-all rounded bg-sp-cardLight px-2 py-1 text-[11px] text-sp-textSecondary">
                {s.pdf_storage_path}
              </code>
            </Row>
          )}
        </dl>
      </div>

      <div className="rounded-xl border border-white/5 bg-sp-card p-5">
        <header className="mb-3 space-y-1">
          <h2 className="text-base font-semibold text-sp-textPrimary">
            Convert to web paystub
          </h2>
          <p className="text-xs text-sp-textSecondary">
            Creates a draft paystub with the same period, gross, and net,
            assigned to the same driver. The legacy row is linked to the new
            paystub (settlements.paystub_id) and drops out of this list so
            nothing double-counts. You can then add earnings, deductions, and
            taxes from Payroll before issuing.
          </p>
        </header>

        {canConvert ? (
          <ConvertButton settlementId={s.id!} />
        ) : (
          <div className="rounded-md border border-sp-warning/40 bg-sp-warning/10 px-3 py-2 text-xs text-sp-warning">
            {!s.driver_id && "Cannot convert — settlement isn't assigned to a driver. "}
            {!s.settlement_period_start && "Cannot convert — pay-period start date is missing. "}
            {!s.settlement_period_end && "Cannot convert — pay-period end date is missing. "}
            Fix on the iPhone app, then return here.
          </div>
        )}
      </div>
    </section>
  );
}

// -----------------------------------------------------------------------------
// Bits
// -----------------------------------------------------------------------------

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
    <div>
      <dt className="text-[11px] font-semibold uppercase tracking-wide text-sp-textSecondary">
        {label}
      </dt>
      <dd
        className={
          "mt-0.5 text-sm " +
          (emphasis ? "font-semibold text-sp-gold" : "text-sp-textPrimary")
        }
      >
        {children}
      </dd>
    </div>
  );
}
