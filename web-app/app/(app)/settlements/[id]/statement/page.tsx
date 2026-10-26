// =============================================================================
//  /settlements/[id]/statement — the driver's paystub (settlement statement)
// -----------------------------------------------------------------------------
//  Printable / "Save as PDF". Every figure is recomputed from the STORED
//  settlement rows by the shared engine (the same cents as the editor and the
//  iPhone). The status is printed on the page and a watermark marks anything
//  that isn't paid: a draft statement can never be mistaken for a payment.
// =============================================================================

import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { profileToBranding, signLogoUrl } from "@/lib/branding/profile";
import { resolvePaystubColors } from "@/lib/paystubs/themes";
import { buildPrintCss } from "@/lib/paystubs/printCss";
import { formatDate } from "@/lib/format";
import { loadBundle } from "@/lib/settlements/server";
import { displayCalculation, periodDescription } from "@/lib/settlements/workflow";
import { STATUS_LABEL, SETTLEMENT_TYPE_LABEL, effectivePayRule, lineGross, money } from "@/lib/settlements/model";
import { ruleSummary } from "@/lib/settlements/payrule";
import { documentTypeLabel } from "@/lib/documents/taxonomy";
import PrintButton from "@/app/(app)/payroll/[id]/print/PrintButton";
import PrintAutoTrigger from "@/app/(app)/reports/PrintAutoTrigger";

export const dynamic = "force-dynamic";

function watermarkFor(status: string): string | null {
  switch (status) {
    case "draft":
    case "ready_for_review": return "DRAFT — NOT PAID";
    case "approved": return "APPROVED — NOT YET PAID";
    case "voided": return "VOIDED";
    default: return null;
  }
}

export default async function SettlementStatementPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ autoprint?: string; from?: string }>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const supabase = await createClient();
  const loaded = await loadBundle(supabase, id);
  if (!loaded) notFound();
  const b = loaded.bundle;
  if (!b.header.payRule || b.header.payRule.components.length === 0) {
    const eff = effectivePayRule(b.header);
    if (eff.components.length > 0) b.header.payRule = eff;
  }
  const r = displayCalculation(b);

  const [{ data: driver }, { data: profileRaw }, { data: docsRaw }] = await Promise.all([
    b.header.driverId
      ? supabase.from("drivers").select("id, name, truck_number, address, city, state, zip").eq("id", b.header.driverId).maybeSingle()
      : Promise.resolve({ data: null }),
    supabase.from("profiles").select("*").eq("id", b.header.profileId).maybeSingle(),
    supabase.from("documents").select("id, document_type, routing, created_at").eq("settlement_id", id).order("created_at"),
  ]);
  const profile = (profileRaw ?? null) as Record<string, string | null> | null;
  const branding = profileToBranding(profile as never);
  const logoUrl = await signLogoUrl(supabase, branding.logoPath);
  const theme = resolvePaystubColors(branding.paystubTheme);
  const d = (driver ?? null) as Record<string, string | null> | null;

  const status = b.header.status;
  const mark = watermarkFor(status);
  const earningsByLine = new Map(r.lineItems.filter((l) => l.kind === "loadEarning").map((l) => [l.id, l]));
  const settlementEarnings = r.lineItems.filter((l) => l.kind === "settlementEarning");
  const additions = r.lineItems.filter((l) => l.kind === "addition");
  const deductions = r.lineItems.filter((l) => l.kind === "driverDeduction");
  const docs = (docsRaw ?? []) as Array<{ id: string; document_type: string | null; routing: { type?: string } | null }>;

  return (
    <>
      <style>{buildPrintCss(theme)}</style>
      {sp.autoprint === "1" && <PrintAutoTrigger />}
      <div className="paystub-page" data-testid="settlement-statement" data-status={status}>
        {sp.from === "document" && (
          <p className="no-print" style={{ marginBottom: 12, fontSize: "10pt", color: "#555" }}>
            Created automatically from your uploaded paperwork. Review it, then approve it on the settlement — nothing has been paid.
          </p>
        )}
        <header className="paystub-header">
          <div className="paystub-brand">
            {logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={logoUrl} alt={profile?.company_name ?? "Company logo"} className="brand-logo" />
            ) : (
              <div className="brand-mark">DH</div>
            )}
            <div className="brand-text">
              <div className="brand-company">{profile?.company_name ?? "Driver settlement"}</div>
              <div className="brand-meta">
                {[profile?.mc_number ? `MC# ${profile.mc_number}` : null, profile?.dot_number ? `DOT# ${profile.dot_number}` : null].filter(Boolean).join(" · ")}
              </div>
            </div>
          </div>
          <div className="paystub-id">
            <div className="paystub-id-title">DRIVER SETTLEMENT</div>
            <div className="paystub-id-meta">
              {b.header.settlementNumber && <div><strong>#</strong> {b.header.settlementNumber}</div>}
              <div><strong>Period:</strong> {periodDescription(b.header.periodStart, b.header.periodEnd)}</div>
              <div data-testid="statement-status"><strong>Status:</strong> {STATUS_LABEL[status].toUpperCase()}</div>
              {status === "paid" && (
                <div><strong>Paid:</strong> {formatDate(b.header.paidAt)}{b.header.paymentMethod ? ` · ${b.header.paymentMethod}` : ""}{b.header.paymentReference ? ` · ${b.header.paymentReference}` : ""}</div>
              )}
            </div>
          </div>
        </header>

        <section className="paystub-parties">
          <div className="party">
            <div className="party-title">Driver</div>
            <div className="party-name" data-testid="statement-driver">{d?.name ?? "—"}</div>
            {(b.header.truckNumber || d?.truck_number) && <div>Truck #{b.header.truckNumber ?? d?.truck_number}</div>}
            {d?.address && <div>{d.address}</div>}
            {(d?.city || d?.state || d?.zip) && <div>{[d?.city, d?.state, d?.zip].filter(Boolean).join(", ")}</div>}
          </div>
          <div className="party">
            <div className="party-title">Pay terms</div>
            <div className="party-name">{SETTLEMENT_TYPE_LABEL[b.header.settlementType ?? "company_driver"]}</div>
            <div>{ruleSummary(b.header.payRule)}</div>
          </div>
        </section>

        <section className="block">
          <h3>Loads</h3>
          <table className="lines" data-testid="statement-loads">
            <thead>
              <tr><th>Load</th><th>Dates</th><th>Route</th><th className="r">Miles</th><th className="r">Load gross</th><th className="r">Driver pay</th></tr>
            </thead>
            <tbody>
              {b.loadLines.length === 0 && <tr><td colSpan={6} className="muted">No loads on this settlement.</td></tr>}
              {b.loadLines.map((l) => {
                const e = earningsByLine.get(l.id);
                return (
                  <tr key={l.id}>
                    <td>{l.loadNumber ? `#${l.loadNumber}` : "—"}{l.brokerName ? <div className="muted">{l.brokerName}</div> : null}</td>
                    <td>{formatDate(l.pickupDate)}{l.deliveryDate ? ` – ${formatDate(l.deliveryDate)}` : ""}</td>
                    <td>{[l.origin, l.destination].filter(Boolean).join(" → ") || "—"}</td>
                    <td className="r">{money(l.loadedMiles).amount.toFixed(0)}</td>
                    <td className="r">{lineGross(l).rounded().format()}</td>
                    <td className="r">{(e?.amount ?? money("0")).format()}{e?.basis ? <div className="muted">{e.basis}</div> : null}</td>
                  </tr>
                );
              })}
              {settlementEarnings.map((l) => (
                <tr key={l.id}><td colSpan={5}>{l.label} <span className="muted">· {l.basis}</span></td><td className="r">{l.amount.format()}</td></tr>
              ))}
              <tr className="subtotal"><td colSpan={5}>Driver earnings</td><td className="r">{r.driverBaseEarnings.format()}</td></tr>
            </tbody>
          </table>
        </section>

        {additions.length > 0 && (
          <section className="block">
            <h3>Additions &amp; reimbursements</h3>
            <table className="lines" data-testid="statement-additions">
              <thead><tr><th>Description</th><th className="r">Amount</th></tr></thead>
              <tbody>
                {additions.map((a) => <tr key={a.id}><td>{a.label} <span className="muted">· {a.basis}</span></td><td className="r">+{a.amount.format()}</td></tr>)}
                <tr className="subtotal"><td>Total additions</td><td className="r">+{r.totalAdditions.format()}</td></tr>
              </tbody>
            </table>
          </section>
        )}

        {deductions.length > 0 && (
          <section className="block">
            <h3>Deductions</h3>
            <table className="lines" data-testid="statement-deductions">
              <thead><tr><th>Description</th><th className="r">Amount</th></tr></thead>
              <tbody>
                {deductions.map((x) => <tr key={x.id}><td>{x.label} <span className="muted">· {x.basis}</span></td><td className="r">−{x.amount.format()}</td></tr>)}
                <tr className="subtotal"><td>Total deductions</td><td className="r">−{r.totalDriverDeductions.format()}</td></tr>
              </tbody>
            </table>
          </section>
        )}

        <section className="netpay">
          <div><div className="label">Driver earnings</div><div className="value">{r.driverBaseEarnings.format()}</div></div>
          <div><div className="label">Additions</div><div className="value">{r.totalAdditions.format()}</div></div>
          <div><div className="label">Deductions</div><div className="value">{r.totalDriverDeductions.format()}</div></div>
          <div className="big"><div className="label">Net pay</div><div className="value" data-testid="statement-net">{r.netDriverPay.format()}</div></div>
        </section>

        {docs.length > 0 && (
          <section className="footer-meta" style={{ display: "block" }}>
            <strong>Source paperwork:</strong>{" "}
            {docs.map((x) => documentTypeLabel(x.routing?.type ?? x.document_type)).join(", ")}
          </section>
        )}

        {branding.footerLegal && <div className="paystub-legal">{branding.footerLegal}</div>}

        <footer className="paystub-footer">
          {mark && <div className="watermark" data-testid="statement-watermark">{mark}</div>}
          Statement generated {new Date().toLocaleDateString("en-US", { timeZone: "America/Chicago" })} · amounts calculated by Driver Hub settlement engine {r.engineVersion}
        </footer>

        <div className="print-toolbar no-print">
          <Link href={`/settlements/${id}`} className="print-link">Open settlement</Link>
          <PrintButton />
        </div>
      </div>
    </>
  );
}
