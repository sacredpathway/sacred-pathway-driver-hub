// =============================================================================
//  /payroll/[id] — paystub editor + summary
// -----------------------------------------------------------------------------
//  Server component. Loads the paystub header + all 4 child tables, computes
//  live totals (matching what the actions persist), and renders the editor.
//  Issued/paid/voided paystubs are read-only.
// =============================================================================

import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import {
  issuePaystubAction,
  markPaidAction,
  voidPaystubAction,
  deleteDraftAction,
  updateDraftHeaderAction,
} from "../actions";
import PaystubEditor from "./PaystubEditor";
import ConfirmButton from "./ConfirmButton";
import EditHeaderForm from "./EditHeaderForm";
import GustoLinkButton from "@/components/GustoLinkButton";
import { formatDate, formatCurrency } from "@/lib/format";
import type {
  Paystub,
  PaystubEarning,
  PaystubDeduction,
  PaystubTax,
  PaystubSettlementItem,
  Driver,
} from "@/lib/supabase/types";

export const runtime = "edge";

export default async function PaystubDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ created?: string }>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const supabase = await createClient();

  const [{ data: psRaw, error: psErr }, { data: earnings }, { data: deductions }, { data: taxes }, { data: items }] =
    await Promise.all([
      supabase.from("paystubs").select("*").eq("id", id).maybeSingle(),
      supabase.from("paystub_earnings").select("*").eq("paystub_id", id).order("created_at"),
      supabase.from("paystub_deductions").select("*").eq("paystub_id", id).order("created_at"),
      supabase.from("paystub_taxes").select("*").eq("paystub_id", id).order("created_at"),
      supabase.from("paystub_settlement_items").select("*").eq("paystub_id", id).order("created_at"),
    ]);

  if (psErr) {
    return (
      <div className="rounded-lg border border-sp-danger/40 bg-sp-danger/10 p-4 text-sm text-sp-danger">
        {psErr.message}
      </div>
    );
  }
  if (!psRaw) notFound();
  const paystub = psRaw as Paystub;

  const { data: driverRaw } = await supabase
    .from("drivers")
    .select("*")
    .eq("id", paystub.driver_id)
    .maybeSingle();
  const driver = driverRaw as Driver | null;

  const editable = paystub.status === "draft";

  return (
    <section className="space-y-4">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">
            {paystub.paystub_number ?? "Draft paystub"}
          </h1>
          <p className="mt-1 text-xs text-sp-textSecondary">
            {paystub.worker_type === "W2" ? "Employee Payroll" : "Contractor Settlement"} ·{" "}
            {driver?.name ?? "—"} ·{" "}
            {formatDate(paystub.pay_period_start)} – {formatDate(paystub.pay_period_end)}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge status={paystub.status} />
          <Link
            href={`/payroll/${paystub.id}/print`}
            target="_blank"
            className="rounded-md border border-white/10 px-3 py-1.5 text-xs font-medium text-sp-textPrimary hover:bg-white/5"
          >
            Print / Save PDF
          </Link>
          <Link href="/payroll" className="text-xs text-sp-textSecondary hover:text-sp-textPrimary">
            ← All paystubs
          </Link>
        </div>
      </header>

      {sp.created && (
        <div className="rounded-md border border-sp-success/40 bg-sp-success/10 px-3 py-2 text-sm text-sp-success">
          Draft created. Add line items below, then click Issue.
        </div>
      )}

      {/* Totals — read-only summary */}
      <SummaryCard paystub={paystub} />

      {/* Header edit — payment_method / check_number / notes.
          Mounted only for drafts; server action also rejects non-draft writes. */}
      {editable && (
        <EditHeaderForm
          paystub={paystub}
          action={updateDraftHeaderAction.bind(null, paystub.id)}
        />
      )}

      {/* Editor body (draft only) or read-only line list (issued/paid/voided) */}
      <PaystubEditor
        paystub={paystub}
        driver={driver}
        earnings={(earnings ?? []) as PaystubEarning[]}
        deductions={(deductions ?? []) as PaystubDeduction[]}
        taxes={(taxes ?? []) as PaystubTax[]}
        settlementItems={(items ?? []) as PaystubSettlementItem[]}
        editable={editable}
      />

      {/* External-link card — Carrier HQ prepares records, Gusto runs payroll. */}
      <GustoLinkButton />

      {/* Lifecycle controls */}
      <section className="rounded-xl border border-white/5 bg-sp-card/40 p-5">
        <h2 className="text-base font-semibold text-sp-textPrimary">Lifecycle</h2>
        <p className="mt-1 text-xs text-sp-textSecondary">
          Issuing locks line items, assigns a paystub number, and snapshots YTD totals.
          Voiding flips the status but preserves all line items for audit.
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {paystub.status === "draft" && (
            <>
              <form action={issuePaystubAction.bind(null, paystub.id)}>
                <ConfirmButton
                  label="Issue paystub"
                  pendingLabel="Issuing…"
                  confirmText="Issuing locks all line items, snapshots YTD totals, and assigns a paystub number. Continue?"
                  variant="primary"
                />
              </form>
              <form action={deleteDraftAction.bind(null, paystub.id)}>
                <ConfirmButton
                  label="Delete draft"
                  pendingLabel="Deleting…"
                  confirmText="Delete this draft paystub? All line items will be removed. This cannot be undone."
                  variant="danger"
                />
              </form>
            </>
          )}
          {paystub.status === "issued" && (
            <>
              <form action={markPaidAction.bind(null, paystub.id)}>
                <ConfirmButton
                  label="Mark as paid"
                  pendingLabel="Saving…"
                  confirmText="Mark this paystub as paid? You can still void it later."
                  variant="success"
                />
              </form>
              <form action={voidPaystubAction.bind(null, paystub.id)}>
                <ConfirmButton
                  label="Void"
                  pendingLabel="Voiding…"
                  confirmText="Void this paystub? It will be flagged VOIDED on the printed copy. Line items are preserved for audit."
                  variant="danger"
                />
              </form>
            </>
          )}
          {paystub.status === "paid" && (
            <form action={voidPaystubAction.bind(null, paystub.id)}>
              <ConfirmButton
                label="Void"
                pendingLabel="Voiding…"
                confirmText="Void this paystub even though it's marked paid? The driver may already have the money."
                variant="danger"
              />
            </form>
          )}
        </div>
      </section>
    </section>
  );
}

function SummaryCard({ paystub }: { paystub: Paystub }) {
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
      <Tile label="Gross" value={formatCurrency(paystub.gross_earnings)} tone="gold" />
      {paystub.worker_type === "W2" ? (
        <>
          <Tile label="Pre-tax" value={formatCurrency(paystub.total_pretax_deductions)} />
          <Tile label="Taxes" value={formatCurrency(paystub.total_taxes_withheld)} tone="bad" />
          <Tile label="Post-tax" value={formatCurrency(paystub.total_posttax_deductions)} />
        </>
      ) : (
        <>
          <Tile
            label="Deductions"
            value={formatCurrency(paystub.total_settlement_deductions)}
            tone="bad"
          />
          <Tile
            label="Reimburse"
            value={formatCurrency(paystub.total_reimbursements)}
            tone="good"
          />
          <Tile label="Post-tax" value={formatCurrency(paystub.total_posttax_deductions)} />
        </>
      )}
      <Tile
        label="Net pay"
        value={formatCurrency(paystub.net_pay)}
        tone={(paystub.net_pay ?? 0) >= 0 ? "good" : "bad"}
      />
    </div>
  );
}

function Tile({
  label,
  value,
  tone = "neutral",
}: {
  label: string;
  value: string;
  tone?: "neutral" | "gold" | "good" | "bad";
}) {
  const cls =
    tone === "gold" ? "text-sp-gold"
    : tone === "good" ? "text-sp-success"
    : tone === "bad" ? "text-sp-danger"
    : "text-sp-textPrimary";
  return (
    <div className="rounded-xl border border-white/5 bg-sp-card p-4">
      <div className="text-xs font-semibold uppercase tracking-wide text-sp-textSecondary">{label}</div>
      <div className={`mt-1 text-xl font-bold tracking-tight ${cls}`}>{value}</div>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const cls =
    status === "issued" ? "bg-sp-success/15 text-sp-success"
    : status === "paid" ? "bg-sp-greenAccent/15 text-sp-greenAccent"
    : status === "voided" ? "bg-sp-danger/15 text-sp-danger"
    : "bg-white/5 text-sp-textSecondary";
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide ${cls}`}>
      {status}
    </span>
  );
}
