// =============================================================================
//  /payroll/[id]/print — print-optimized paystub view
// -----------------------------------------------------------------------------
//  One HTML template; two layouts (W2 / 1099). Designed for letter-size print.
//  Carrier opens this in a new tab → Cmd+P → "Save as PDF" → done.
//
//  Why not Puppeteer/Edge Chromium for true server-side PDF gen?
//    • Edge runtime chromium binaries are fragile; cold-start ~3s; bundle size.
//    • Browser print-to-PDF is one click for the carrier and preserves fonts.
//    • We can layer Puppeteer (Node route) later for emailing PDFs.
//  Audit trail: the issued paystub row contains all data needed to re-render
//  identically forever (line items are frozen on issue).
// =============================================================================

import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { formatCurrency, formatDate } from "@/lib/format";
import PrintButton from "./PrintButton";
import type {
  Paystub,
  PaystubEarning,
  PaystubDeduction,
  PaystubTax,
  PaystubSettlementItem,
  Driver,
  Profile,
} from "@/lib/supabase/types";

export const runtime = "edge";

export default async function PrintPaystubPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();

  const [{ data: psRaw }, { data: earnings }, { data: deductions }, { data: taxes }, { data: items }] =
    await Promise.all([
      supabase.from("paystubs").select("*").eq("id", id).maybeSingle(),
      supabase.from("paystub_earnings").select("*").eq("paystub_id", id).order("created_at"),
      supabase.from("paystub_deductions").select("*").eq("paystub_id", id).order("created_at"),
      supabase.from("paystub_taxes").select("*").eq("paystub_id", id).order("created_at"),
      supabase.from("paystub_settlement_items").select("*").eq("paystub_id", id).order("created_at"),
    ]);

  if (!psRaw) notFound();
  const paystub = psRaw as Paystub;

  const [{ data: driverRaw }, { data: profileRaw }] = await Promise.all([
    supabase.from("drivers").select("*").eq("id", paystub.driver_id).maybeSingle(),
    supabase.from("profiles").select("*").eq("id", paystub.profile_id).maybeSingle(),
  ]);
  const driver = driverRaw as Driver | null;
  const profile = profileRaw as Profile | null;

  const isW2 = paystub.worker_type === "W2";

  return (
    <>
      <style>{PRINT_CSS}</style>
      <div className="paystub-page">
        <header className="paystub-header">
          <div className="paystub-brand">
            <div className="brand-mark">DH</div>
            <div className="brand-text">
              <div className="brand-company">
                {profile?.company_name ?? "Sacred Pathway Driver Hub"}
              </div>
              <div className="brand-meta">
                {profile?.mc_number ? `MC# ${profile.mc_number}` : ""}
                {profile?.dot_number ? ` · DOT# ${profile.dot_number}` : ""}
              </div>
            </div>
          </div>
          <div className="paystub-id">
            <div className="paystub-id-title">
              {isW2 ? "EMPLOYEE PAYSTUB" : "CONTRACTOR SETTLEMENT"}
            </div>
            <div className="paystub-id-meta">
              {paystub.paystub_number && <div><strong>#</strong> {paystub.paystub_number}</div>}
              <div><strong>Period:</strong> {formatDate(paystub.pay_period_start)} – {formatDate(paystub.pay_period_end)}</div>
              <div><strong>Check Date:</strong> {formatDate(paystub.check_date)}</div>
              <div><strong>Status:</strong> {paystub.status.toUpperCase()}</div>
            </div>
          </div>
        </header>

        <section className="paystub-parties">
          <div className="party">
            <div className="party-title">{isW2 ? "Employee" : "Contractor"}</div>
            <div className="party-name">{driver?.name ?? "—"}</div>
            {driver?.address && <div>{driver.address}</div>}
            {(driver?.city || driver?.state || driver?.zip) && (
              <div>
                {[driver?.city, driver?.state, driver?.zip].filter(Boolean).join(", ")}
              </div>
            )}
            {driver?.truck_number && <div>Truck #{driver.truck_number}</div>}
            {!isW2 && driver?.ein && <div>EIN {driver.ein}</div>}
          </div>
          <div className="party">
            <div className="party-title">Payer</div>
            <div className="party-name">{profile?.company_name ?? "—"}</div>
            {profile?.phone && <div>{profile.phone}</div>}
          </div>
        </section>

        {/* ---------- W2 layout ---------- */}
        {isW2 ? (
          <W2Body
            earnings={(earnings ?? []) as PaystubEarning[]}
            deductions={(deductions ?? []) as PaystubDeduction[]}
            taxes={(taxes ?? []) as PaystubTax[]}
            paystub={paystub}
          />
        ) : (
          <C1099Body
            earnings={(earnings ?? []) as PaystubEarning[]}
            items={(items ?? []) as PaystubSettlementItem[]}
            deductions={(deductions ?? []) as PaystubDeduction[]}
            paystub={paystub}
            driver={driver}
          />
        )}

        <footer className="paystub-footer">
          <div>Generated by Sacred Pathway Driver Hub · sacredpathway.org</div>
          {paystub.status === "draft" && (
            <div className="watermark">DRAFT — NOT YET ISSUED</div>
          )}
          {paystub.status === "voided" && (
            <div className="watermark">VOIDED</div>
          )}
        </footer>

        <div className="print-toolbar no-print">
          <PrintButton />
          <a href={`/payroll/${paystub.id}`} className="print-link">
            ← Back to paystub
          </a>
        </div>
      </div>
    </>
  );
}

function W2Body({
  earnings,
  deductions,
  taxes,
  paystub,
}: {
  earnings: PaystubEarning[];
  deductions: PaystubDeduction[];
  taxes: PaystubTax[];
  paystub: Paystub;
}) {
  const preTaxDed = deductions.filter((d) => d.is_pre_tax);
  const postTaxDed = deductions.filter((d) => !d.is_pre_tax);

  return (
    <>
      <Block title="Earnings">
        <table className="lines">
          <thead>
            <tr><th>Description</th><th className="r">Hours/Units</th><th className="r">Rate</th><th className="r">This period</th><th className="r">YTD</th></tr>
          </thead>
          <tbody>
            {earnings.map((e) => (
              <tr key={e.id}>
                <td>{e.label}{!e.is_taxable && <span className="muted"> (non-tax)</span>}</td>
                <td className="r">{e.hours ?? e.units ?? "—"}</td>
                <td className="r">{e.rate != null ? formatCurrency(e.rate) : "—"}</td>
                <td className="r">{formatCurrency(e.amount)}</td>
                <td className="r muted">{formatCurrency(e.ytd_amount ?? null)}</td>
              </tr>
            ))}
            <tr className="subtotal"><td colSpan={3}>Gross earnings</td><td className="r">{formatCurrency(paystub.gross_earnings)}</td><td className="r muted">{formatCurrency(paystub.ytd_gross_earnings)}</td></tr>
          </tbody>
        </table>
      </Block>

      {preTaxDed.length > 0 && (
        <Block title="Pre-tax deductions">
          <table className="lines">
            <thead><tr><th>Description</th><th className="r">This period</th><th className="r">YTD</th></tr></thead>
            <tbody>
              {preTaxDed.map((d) => (
                <tr key={d.id}><td>{d.label}</td><td className="r">−{formatCurrency(d.amount)}</td><td className="r muted">{formatCurrency(d.ytd_amount ?? null)}</td></tr>
              ))}
              <tr className="subtotal"><td>Total pre-tax</td><td className="r">−{formatCurrency(paystub.total_pretax_deductions)}</td><td className="r muted">—</td></tr>
            </tbody>
          </table>
        </Block>
      )}

      <Block title="Tax withholding">
        <table className="lines">
          <thead>
            <tr><th>Description</th><th>Jurisdiction</th><th className="r">Employee</th><th className="r">Employer</th><th className="r">YTD employee</th></tr>
          </thead>
          <tbody>
            {taxes.length === 0 && (
              <tr><td colSpan={5} className="muted">No tax withholding entries.</td></tr>
            )}
            {taxes.map((t) => (
              <tr key={t.id}>
                <td>{t.label}</td>
                <td>{t.jurisdiction ?? "—"}</td>
                <td className="r">−{formatCurrency(t.employee_amount)}</td>
                <td className="r muted">{formatCurrency(t.employer_amount)}</td>
                <td className="r muted">{formatCurrency(t.ytd_employee_amount ?? null)}</td>
              </tr>
            ))}
            <tr className="subtotal">
              <td colSpan={2}>Total taxes</td>
              <td className="r">−{formatCurrency(paystub.total_taxes_withheld)}</td>
              <td className="r muted">—</td>
              <td className="r muted">{formatCurrency(paystub.ytd_taxes_withheld)}</td>
            </tr>
          </tbody>
        </table>
      </Block>

      {postTaxDed.length > 0 && (
        <Block title="Post-tax deductions">
          <table className="lines">
            <thead><tr><th>Description</th><th className="r">This period</th><th className="r">YTD</th></tr></thead>
            <tbody>
              {postTaxDed.map((d) => (
                <tr key={d.id}><td>{d.label}</td><td className="r">−{formatCurrency(d.amount)}</td><td className="r muted">{formatCurrency(d.ytd_amount ?? null)}</td></tr>
              ))}
              <tr className="subtotal"><td>Total post-tax</td><td className="r">−{formatCurrency(paystub.total_posttax_deductions)}</td><td className="r muted">—</td></tr>
            </tbody>
          </table>
        </Block>
      )}

      <section className="netpay">
        <div>
          <div className="label">Gross</div>
          <div className="value">{formatCurrency(paystub.gross_earnings)}</div>
        </div>
        <div>
          <div className="label">Taxable wages</div>
          <div className="value">{formatCurrency(paystub.taxable_wages)}</div>
        </div>
        <div>
          <div className="label">Total taxes</div>
          <div className="value">{formatCurrency(paystub.total_taxes_withheld)}</div>
        </div>
        <div className="big">
          <div className="label">Net pay</div>
          <div className="value">{formatCurrency(paystub.net_pay)}</div>
        </div>
      </section>
    </>
  );
}

function C1099Body({
  earnings,
  items,
  deductions,
  paystub,
  driver,
}: {
  earnings: PaystubEarning[];
  items: PaystubSettlementItem[];
  deductions: PaystubDeduction[];
  paystub: Paystub;
  driver: Driver | null;
}) {
  const deducts = items.filter((i) => i.direction === "deduct");
  const adds = items.filter((i) => i.direction === "add");

  return (
    <>
      <Block title="Loads & Earnings">
        <table className="lines">
          <thead><tr><th>Description</th><th className="r">Miles</th><th className="r">Amount</th></tr></thead>
          <tbody>
            {earnings.map((e) => (
              <tr key={e.id}>
                <td>{e.label}</td>
                <td className="r">{e.units ?? "—"}</td>
                <td className="r">{formatCurrency(e.amount)}</td>
              </tr>
            ))}
            <tr className="subtotal">
              <td colSpan={2}>Gross settlement</td>
              <td className="r">{formatCurrency(paystub.gross_earnings)}</td>
            </tr>
          </tbody>
        </table>
      </Block>

      {deducts.length > 0 && (
        <Block title="Deductions">
          <table className="lines">
            <thead><tr><th>Description</th><th className="r">Amount</th></tr></thead>
            <tbody>
              {deducts.map((it) => (
                <tr key={it.id}><td>{it.label}</td><td className="r">−{formatCurrency(it.amount)}</td></tr>
              ))}
              {deductions.map((d) => (
                <tr key={d.id}><td>{d.label} (post-tax)</td><td className="r">−{formatCurrency(d.amount)}</td></tr>
              ))}
              <tr className="subtotal">
                <td>Total deductions</td>
                <td className="r">−{formatCurrency((paystub.total_settlement_deductions ?? 0) + (paystub.total_posttax_deductions ?? 0))}</td>
              </tr>
            </tbody>
          </table>
        </Block>
      )}

      {adds.length > 0 && (
        <Block title="Add-backs">
          <table className="lines">
            <thead><tr><th>Description</th><th className="r">Amount</th></tr></thead>
            <tbody>
              {adds.map((it) => (
                <tr key={it.id}><td>{it.label}</td><td className="r">+{formatCurrency(it.amount)}</td></tr>
              ))}
              <tr className="subtotal"><td>Total add-backs</td><td className="r">+{formatCurrency(paystub.total_reimbursements)}</td></tr>
            </tbody>
          </table>
        </Block>
      )}

      <section className="netpay">
        <div>
          <div className="label">Gross</div>
          <div className="value">{formatCurrency(paystub.gross_earnings)}</div>
        </div>
        <div>
          <div className="label">Deductions</div>
          <div className="value">{formatCurrency((paystub.total_settlement_deductions ?? 0) + (paystub.total_posttax_deductions ?? 0))}</div>
        </div>
        <div>
          <div className="label">Add-backs</div>
          <div className="value">{formatCurrency(paystub.total_reimbursements)}</div>
        </div>
        <div className="big">
          <div className="label">Net payout</div>
          <div className="value">{formatCurrency(paystub.net_pay)}</div>
        </div>
      </section>

      {driver?.escrow_balance != null && driver.escrow_balance > 0 && (
        <section className="footer-meta">
          <div>Escrow balance: <strong>{formatCurrency(driver.escrow_balance)}</strong></div>
          <div>YTD gross: <strong>{formatCurrency(paystub.ytd_gross_earnings)}</strong></div>
        </section>
      )}
    </>
  );
}

function Block({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="block">
      <h3>{title}</h3>
      {children}
    </section>
  );
}

const PRINT_CSS = `
.paystub-page {
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  color: #111;
  background: #fff;
  max-width: 8in;
  margin: 0 auto;
  padding: 0.5in;
  font-size: 11pt;
  line-height: 1.4;
}
.paystub-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  border-bottom: 2px solid #111;
  padding-bottom: 12px;
  margin-bottom: 16px;
}
.paystub-brand { display: flex; gap: 12px; align-items: center; }
.brand-mark {
  background: #D4AF37;
  color: #0A0A0A;
  font-weight: 700;
  padding: 8px 12px;
  border-radius: 4px;
  font-size: 14pt;
  letter-spacing: 1px;
}
.brand-company { font-size: 14pt; font-weight: 700; }
.brand-meta { font-size: 9pt; color: #555; }
.paystub-id { text-align: right; }
.paystub-id-title { font-weight: 700; letter-spacing: 1px; font-size: 12pt; }
.paystub-id-meta { font-size: 9pt; color: #333; margin-top: 4px; }
.paystub-id-meta div { margin-top: 2px; }

.paystub-parties {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 24px;
  margin-bottom: 20px;
}
.party-title { text-transform: uppercase; letter-spacing: 1px; font-size: 8pt; color: #777; }
.party-name { font-weight: 700; font-size: 12pt; margin-top: 2px; }
.party div { margin-top: 2px; font-size: 10pt; }

.block { margin-bottom: 18px; }
.block h3 {
  text-transform: uppercase;
  letter-spacing: 1px;
  font-size: 9pt;
  color: #777;
  margin: 0 0 6px 0;
  font-weight: 600;
}
table.lines { width: 100%; border-collapse: collapse; }
table.lines th, table.lines td {
  border-bottom: 1px solid #eee;
  padding: 6px 8px;
  font-size: 10pt;
  text-align: left;
  vertical-align: top;
}
table.lines th { font-size: 8pt; color: #777; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px; }
table.lines td.r, table.lines th.r { text-align: right; }
table.lines tr.subtotal td { border-top: 1px solid #111; border-bottom: 0; font-weight: 700; padding-top: 8px; }
.muted { color: #888; }

.netpay {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 8px;
  background: #fafaf6;
  border: 1px solid #ddd;
  border-radius: 6px;
  padding: 12px;
  margin-top: 14px;
}
.netpay > div .label { font-size: 8pt; color: #777; text-transform: uppercase; letter-spacing: 0.5px; }
.netpay > div .value { font-size: 12pt; font-weight: 700; margin-top: 2px; }
.netpay > div.big .value { font-size: 18pt; color: #B89020; }
.netpay > div.big .label { color: #B89020; }

.footer-meta {
  margin-top: 12px;
  padding: 8px 12px;
  background: #fafaf6;
  border: 1px solid #ddd;
  border-radius: 6px;
  display: flex;
  justify-content: space-between;
  font-size: 10pt;
}

.paystub-footer {
  margin-top: 24px;
  border-top: 1px solid #ddd;
  padding-top: 8px;
  font-size: 8pt;
  color: #999;
  text-align: center;
  position: relative;
}
.watermark {
  position: absolute;
  top: -200px;
  left: 0;
  right: 0;
  text-align: center;
  font-size: 80pt;
  color: rgba(217, 80, 80, 0.08);
  font-weight: 900;
  letter-spacing: 4px;
  pointer-events: none;
  z-index: 0;
}

.print-toolbar {
  position: fixed;
  bottom: 20px;
  right: 20px;
  display: flex;
  gap: 8px;
  z-index: 10;
}
.print-button {
  background: #D4AF37;
  color: #0A0A0A;
  border: 0;
  padding: 10px 18px;
  border-radius: 6px;
  font-weight: 700;
  cursor: pointer;
  box-shadow: 0 4px 12px rgba(0,0,0,0.2);
}
.print-link {
  background: #fff;
  color: #333;
  padding: 10px 14px;
  border-radius: 6px;
  text-decoration: none;
  border: 1px solid #ddd;
  font-size: 10pt;
}

@media print {
  .no-print { display: none !important; }
  .paystub-page { padding: 0.4in; max-width: none; }
  @page { size: letter; margin: 0.5in; }
}
`;
