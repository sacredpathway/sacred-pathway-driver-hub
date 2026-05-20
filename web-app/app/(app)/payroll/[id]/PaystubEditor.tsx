// =============================================================================
//  PaystubEditor — line item editor + read-only viewer
// -----------------------------------------------------------------------------
//  Renders four sections, dispatched by worker_type:
//
//    W2:                                    1099:
//      • Earnings                             • Earnings (settlement_gross + other)
//      • Pre-tax & Post-tax Deductions        • Settlement Items (deduct / add)
//      • Tax Withholding (employee+employer)  • Post-tax Deductions (rare)
//
//  Each section has an "Add row" inline form that posts to the add* server
//  action. Existing rows have a Remove button (form posting to removeLineAction).
//  When editable=false (issued/paid/voided), the add-forms and remove-buttons
//  are hidden — the data is preserved verbatim for the audit trail and printed paystub.
//
//  This is a Server Component — the inline forms post to server actions
//  directly (no useState needed). That keeps the bundle small and the data
//  always fresh after each add/remove.
// =============================================================================

import { formatCurrency, formatDate } from "@/lib/format";
import {
  addEarning,
  addDeduction,
  addTax,
  addSettlementItem,
  addLoadToDraft,
  removeLineAction,
} from "../actions";
import type {
  Paystub,
  Driver,
  PaystubEarning,
  PaystubDeduction,
  PaystubTax,
  PaystubSettlementItem,
} from "@/lib/supabase/types";

interface EligibleLoad {
  id: string;
  load_number: string | null;
  broker_name: string | null;
  origin: string | null;
  destination: string | null;
  pickup_date: string | null;
  total_miles: number | null;
  total_revenue: number | null;
}

interface Props {
  paystub: Paystub;
  driver: Driver | null;
  earnings: PaystubEarning[];
  deductions: PaystubDeduction[];
  taxes: PaystubTax[];
  settlementItems: PaystubSettlementItem[];
  editable: boolean;
  /** 1099 only. Loads in the paystub's pay period not yet attached. */
  eligibleLoads?: EligibleLoad[];
}

export default function PaystubEditor({
  paystub,
  driver,
  earnings,
  deductions,
  taxes,
  settlementItems,
  editable,
  eligibleLoads,
}: Props) {
  const isW2 = paystub.worker_type === "W2";

  return (
    <div className="space-y-4">
      {/* ---------- EARNINGS ---------- */}
      <SectionCard
        title={isW2 ? "Earnings" : "Loads & Earnings"}
        subtitle={
          isW2
            ? "Regular hours, OT, per diem, bonuses. Per-diem rows can be flagged non-taxable."
            : "Gross settlement lines. One row per load; ad-hoc rows allowed."
        }
      >
        <EarningsList
          earnings={earnings}
          paystubId={paystub.id}
          editable={editable}
        />
        {/* 1099 + draft: dedicated "Add load" picker that seeds a
            settlement_gross row from a real load's total_revenue. */}
        {editable && !isW2 && eligibleLoads && eligibleLoads.length > 0 && (
          <AddLoadForm paystubId={paystub.id} loads={eligibleLoads} />
        )}
        {editable && (
          <AddEarningForm
            paystubId={paystub.id}
            isW2={isW2}
            driver={driver}
          />
        )}
      </SectionCard>

      {/* ---------- 1099 SETTLEMENT ITEMS ---------- */}
      {!isW2 && (
        <SectionCard
          title="Settlement items"
          subtitle="Fuel, escrow, factoring, dispatcher, chargebacks, reimbursements, bonuses."
        >
          <SettlementItemsList
            items={settlementItems}
            paystubId={paystub.id}
            editable={editable}
          />
          {editable && <AddSettlementItemForm paystubId={paystub.id} />}
        </SectionCard>
      )}

      {/* ---------- W2 DEDUCTIONS ---------- */}
      <SectionCard
        title={isW2 ? "Pre-tax & Post-tax deductions" : "Other deductions (optional)"}
        subtitle={
          isW2
            ? "401(k), insurance premiums, garnishments. Pre-tax reduces taxable wages."
            : "Rare on 1099 — used for things like loan repayment."
        }
      >
        <DeductionsList
          deductions={deductions}
          paystubId={paystub.id}
          editable={editable}
        />
        {editable && <AddDeductionForm paystubId={paystub.id} />}
      </SectionCard>

      {/* ---------- W2 TAXES ---------- */}
      {isW2 && (
        <SectionCard
          title="Tax withholding"
          subtitle="Manual placeholders. Employee amount comes out of the check; employer amount is the company's match (SS, Medicare, FUTA, SUTA, WC)."
        >
          <TaxesList taxes={taxes} paystubId={paystub.id} editable={editable} />
          {editable && <AddTaxForm paystubId={paystub.id} driver={driver} />}
        </SectionCard>
      )}
    </div>
  );
}

// =============================================================================
//  Section wrapper
// =============================================================================

function SectionCard({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-xl border border-white/5 bg-sp-card/40 p-5">
      <header className="mb-3">
        <h2 className="text-base font-semibold text-sp-textPrimary">{title}</h2>
        {subtitle && <p className="mt-1 text-xs text-sp-textSecondary">{subtitle}</p>}
      </header>
      <div className="space-y-3">{children}</div>
    </section>
  );
}

// =============================================================================
//  Add-load form (1099 draft only)
// -----------------------------------------------------------------------------
//  Server-component form. The carrier picks one load from the dropdown and
//  clicks Add. The action seeds a settlement_gross earnings row with the
//  load's gross revenue, and recomputes totals. Loads already on this paystub
//  are not present in the list (filtered server-side on the parent route).
// =============================================================================

function AddLoadForm({
  paystubId,
  loads,
}: {
  paystubId: string;
  loads: EligibleLoad[];
}) {
  return (
    <form
      action={addLoadToDraft.bind(null, paystubId)}
      className="grid grid-cols-1 gap-2 rounded-md border border-dashed border-white/10 p-3 md:grid-cols-[1fr_auto]"
    >
      <label className="block">
        <span className="block text-[10px] font-semibold uppercase tracking-wide text-sp-textSecondary">
          Add a load from this period
        </span>
        <select
          name="load_id"
          defaultValue=""
          required
          className="mt-1 w-full rounded-md border border-white/10 bg-sp-background px-3 py-2 text-xs text-sp-textPrimary focus:border-sp-gold focus:outline-none"
        >
          <option value="" disabled>
            — Pick a load —
          </option>
          {loads.map((l) => (
            <option key={l.id} value={l.id}>
              {loadOptionLabel(l)}
            </option>
          ))}
        </select>
      </label>
      <button
        type="submit"
        className="self-end rounded-md bg-sp-gold px-3 py-1.5 text-xs font-semibold text-sp-black hover:bg-sp-goldLight"
      >
        Add load
      </button>
    </form>
  );
}

function loadOptionLabel(l: EligibleLoad): string {
  const parts: string[] = [];
  if (l.load_number) parts.push(`#${l.load_number}`);
  if (l.broker_name) parts.push(l.broker_name);
  const route = [l.origin, l.destination].filter(Boolean).join(" → ");
  if (route) parts.push(route);
  if (l.pickup_date) parts.push(formatDate(l.pickup_date));
  if (l.total_revenue != null) parts.push(formatCurrency(l.total_revenue));
  return parts.join("  ·  ") || "Load";
}

// =============================================================================
//  EARNINGS
// =============================================================================

function EarningsList({
  earnings,
  paystubId,
  editable,
}: {
  earnings: PaystubEarning[];
  paystubId: string;
  editable: boolean;
}) {
  if (earnings.length === 0) {
    return (
      <p className="rounded-md border border-dashed border-white/10 px-3 py-4 text-center text-xs text-sp-textSecondary">
        No earnings yet.
      </p>
    );
  }
  return (
    <div className="overflow-x-auto rounded-md border border-white/5">
      <table className="min-w-full divide-y divide-white/5 text-sm">
        <thead className="bg-sp-card text-left text-xs uppercase tracking-wide text-sp-textSecondary">
          <tr>
            <th className="px-3 py-2">Kind</th>
            <th className="px-3 py-2">Label</th>
            <th className="hidden px-3 py-2 md:table-cell">Hours/Units</th>
            <th className="hidden px-3 py-2 md:table-cell">Rate</th>
            <th className="px-3 py-2 text-right">Amount</th>
            <th className="px-3 py-2 text-center">Taxable</th>
            {editable && <th className="px-3 py-2"></th>}
          </tr>
        </thead>
        <tbody className="divide-y divide-white/5 bg-sp-card/30">
          {earnings.map((e) => (
            <tr key={e.id}>
              <td className="px-3 py-2 text-sp-textSecondary">{kindLabel(e.kind)}</td>
              <td className="px-3 py-2 text-sp-textPrimary">{e.label}</td>
              <td className="hidden px-3 py-2 text-sp-textSecondary md:table-cell">
                {e.hours ?? e.units ?? "—"}
              </td>
              <td className="hidden px-3 py-2 text-sp-textSecondary md:table-cell">
                {e.rate != null ? formatCurrency(e.rate) : "—"}
              </td>
              <td className="px-3 py-2 text-right font-medium text-sp-gold">
                {formatCurrency(e.amount)}
              </td>
              <td className="px-3 py-2 text-center text-[11px] text-sp-textSecondary">
                {e.is_taxable ? "Yes" : "No"}
              </td>
              {editable && (
                <td className="px-3 py-2 text-right">
                  <RemoveLineButton
                    paystubId={paystubId}
                    table="paystub_earnings"
                    lineId={e.id}
                  />
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function AddEarningForm({
  paystubId,
  isW2,
  driver,
}: {
  paystubId: string;
  isW2: boolean;
  driver: Driver | null;
}) {
  const defaultKind = isW2 ? "regular" : "settlement_gross";
  const w2Kinds = ["regular", "overtime", "doubletime", "holiday", "sick", "vacation",
                   "per_diem", "mileage", "per_load", "bonus", "commission",
                   "reimbursement", "detention", "layover", "accessorial", "other"];
  const c1099Kinds = ["settlement_gross", "detention", "layover", "accessorial", "bonus",
                      "reimbursement", "other"];
  const kinds = isW2 ? w2Kinds : c1099Kinds;

  return (
    <form
      action={addEarning.bind(null, paystubId)}
      className="grid grid-cols-1 gap-2 rounded-md border border-dashed border-white/10 p-3 md:grid-cols-[140px_1fr_80px_80px_100px_60px_auto]"
    >
      <SelectMini name="kind" defaultValue={defaultKind} options={kinds.map((k) => ({ value: k, label: kindLabel(k) }))} />
      <InputMini name="label" placeholder="Label" required />
      <InputMini name="hours" placeholder="Hrs" inputMode="decimal" />
      <InputMini name="units" placeholder="Units" inputMode="decimal" />
      <InputMini name="rate" placeholder="Rate"
                 inputMode="decimal"
                 defaultValue={defaultRate(driver, defaultKind)} />
      <InputMini name="amount" placeholder="Amt" inputMode="decimal" />
      <button
        type="submit"
        className="rounded-md bg-sp-gold px-3 py-1.5 text-xs font-semibold text-sp-black hover:bg-sp-goldLight"
      >
        Add
      </button>
      {/* Taxable toggle for per-diem; default true otherwise */}
      <label className="col-span-full flex items-center gap-2 text-[11px] text-sp-textSecondary">
        <input type="checkbox" name="is_taxable" value="true" defaultChecked
               className="h-3 w-3 rounded border-white/20 bg-sp-background text-sp-gold focus:ring-sp-gold" />
        Taxable (uncheck for IRS-rate per diem)
      </label>
    </form>
  );
}

function defaultRate(driver: Driver | null, kind: string): string {
  if (!driver) return "";
  switch (kind) {
    case "regular":  return String(driver.hourly_rate ?? "");
    case "overtime": {
      const base = driver.hourly_rate ?? 0;
      const mult = driver.overtime_multiplier ?? 1.5;
      return base ? String(+(base * mult).toFixed(2)) : "";
    }
    case "mileage":  return String(driver.mileage_rate ?? "");
    case "per_load": return String(driver.per_load_rate ?? "");
    case "per_diem": return String(driver.per_diem_daily ?? "");
    default: return "";
  }
}

// =============================================================================
//  DEDUCTIONS
// =============================================================================

function DeductionsList({
  deductions,
  paystubId,
  editable,
}: {
  deductions: PaystubDeduction[];
  paystubId: string;
  editable: boolean;
}) {
  if (deductions.length === 0) {
    return (
      <p className="rounded-md border border-dashed border-white/10 px-3 py-4 text-center text-xs text-sp-textSecondary">
        No deductions yet.
      </p>
    );
  }
  return (
    <div className="overflow-x-auto rounded-md border border-white/5">
      <table className="min-w-full divide-y divide-white/5 text-sm">
        <thead className="bg-sp-card text-left text-xs uppercase tracking-wide text-sp-textSecondary">
          <tr>
            <th className="px-3 py-2">Kind</th>
            <th className="px-3 py-2">Label</th>
            <th className="px-3 py-2 text-center">Pre-tax</th>
            <th className="px-3 py-2 text-right">Amount</th>
            {editable && <th className="px-3 py-2"></th>}
          </tr>
        </thead>
        <tbody className="divide-y divide-white/5 bg-sp-card/30">
          {deductions.map((d) => (
            <tr key={d.id}>
              <td className="px-3 py-2 text-sp-textSecondary">{kindLabel(d.kind)}</td>
              <td className="px-3 py-2 text-sp-textPrimary">{d.label}</td>
              <td className="px-3 py-2 text-center text-[11px] text-sp-textSecondary">
                {d.is_pre_tax ? "Yes" : "No"}
              </td>
              <td className="px-3 py-2 text-right text-sp-danger">−{formatCurrency(d.amount)}</td>
              {editable && (
                <td className="px-3 py-2 text-right">
                  <RemoveLineButton paystubId={paystubId} table="paystub_deductions" lineId={d.id} />
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function AddDeductionForm({ paystubId }: { paystubId: string }) {
  const kinds = [
    "401k","401k_roth","health_premium","dental_premium","vision_premium","hsa","fsa",
    "commuter","life_insurance","disability","garnishment","child_support","union_dues",
    "loan_repayment","uniform","advance_repayment","other",
  ];
  return (
    <form
      action={addDeduction.bind(null, paystubId)}
      className="grid grid-cols-1 gap-2 rounded-md border border-dashed border-white/10 p-3 md:grid-cols-[180px_1fr_110px_120px_auto]"
    >
      <SelectMini name="kind" defaultValue="401k" options={kinds.map((k) => ({ value: k, label: kindLabel(k) }))} />
      <InputMini name="label" placeholder="Label" required />
      <SelectMini
        name="is_pre_tax"
        defaultValue="true"
        options={[
          { value: "true", label: "Pre-tax" },
          { value: "false", label: "Post-tax" },
        ]}
      />
      <InputMini name="amount" placeholder="Amount" inputMode="decimal" required />
      <button
        type="submit"
        className="rounded-md bg-sp-gold px-3 py-1.5 text-xs font-semibold text-sp-black hover:bg-sp-goldLight"
      >
        Add
      </button>
    </form>
  );
}

// =============================================================================
//  TAXES (W2)
// =============================================================================

function TaxesList({
  taxes,
  paystubId,
  editable,
}: {
  taxes: PaystubTax[];
  paystubId: string;
  editable: boolean;
}) {
  if (taxes.length === 0) {
    return (
      <p className="rounded-md border border-dashed border-white/10 px-3 py-4 text-center text-xs text-sp-textSecondary">
        No tax withholding entries yet. Add federal income, Social Security, Medicare, and state lines here.
      </p>
    );
  }
  return (
    <div className="overflow-x-auto rounded-md border border-white/5">
      <table className="min-w-full divide-y divide-white/5 text-sm">
        <thead className="bg-sp-card text-left text-xs uppercase tracking-wide text-sp-textSecondary">
          <tr>
            <th className="px-3 py-2">Kind</th>
            <th className="px-3 py-2">Label</th>
            <th className="hidden px-3 py-2 md:table-cell">Jurisdiction</th>
            <th className="px-3 py-2 text-right">Employee</th>
            <th className="hidden px-3 py-2 text-right md:table-cell">Employer</th>
            {editable && <th className="px-3 py-2"></th>}
          </tr>
        </thead>
        <tbody className="divide-y divide-white/5 bg-sp-card/30">
          {taxes.map((t) => (
            <tr key={t.id}>
              <td className="px-3 py-2 text-sp-textSecondary">{kindLabel(t.kind)}</td>
              <td className="px-3 py-2 text-sp-textPrimary">{t.label}</td>
              <td className="hidden px-3 py-2 text-sp-textSecondary md:table-cell">
                {t.jurisdiction ?? "—"}
              </td>
              <td className="px-3 py-2 text-right text-sp-danger">−{formatCurrency(t.employee_amount)}</td>
              <td className="hidden px-3 py-2 text-right text-sp-textSecondary md:table-cell">
                {formatCurrency(t.employer_amount)}
              </td>
              {editable && (
                <td className="px-3 py-2 text-right">
                  <RemoveLineButton paystubId={paystubId} table="paystub_taxes" lineId={t.id} />
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function AddTaxForm({ paystubId, driver }: { paystubId: string; driver: Driver | null }) {
  const kinds = [
    "federal_income","state_income","local_income",
    "social_security","medicare","medicare_additional",
    "sui","sdi","futa","suta","workers_comp","other",
  ];
  return (
    <form
      action={addTax.bind(null, paystubId)}
      className="grid grid-cols-1 gap-2 rounded-md border border-dashed border-white/10 p-3 md:grid-cols-[180px_1fr_100px_120px_120px_auto]"
    >
      <SelectMini name="kind" defaultValue="federal_income" options={kinds.map((k) => ({ value: k, label: kindLabel(k) }))} />
      <InputMini name="label" placeholder="Label" required />
      <InputMini name="jurisdiction" placeholder="US/TX/…" defaultValue={driver?.state_code ?? "US"} />
      <InputMini name="employee_amount" placeholder="Employee" inputMode="decimal" required />
      <InputMini name="employer_amount" placeholder="Employer (opt)" inputMode="decimal" />
      <button
        type="submit"
        className="rounded-md bg-sp-gold px-3 py-1.5 text-xs font-semibold text-sp-black hover:bg-sp-goldLight"
      >
        Add
      </button>
    </form>
  );
}

// =============================================================================
//  SETTLEMENT ITEMS (1099)
// =============================================================================

function SettlementItemsList({
  items,
  paystubId,
  editable,
}: {
  items: PaystubSettlementItem[];
  paystubId: string;
  editable: boolean;
}) {
  if (items.length === 0) {
    return (
      <p className="rounded-md border border-dashed border-white/10 px-3 py-4 text-center text-xs text-sp-textSecondary">
        No settlement items yet. Add fuel, escrow, factoring, chargebacks, reimbursements, etc.
      </p>
    );
  }
  return (
    <div className="overflow-x-auto rounded-md border border-white/5">
      <table className="min-w-full divide-y divide-white/5 text-sm">
        <thead className="bg-sp-card text-left text-xs uppercase tracking-wide text-sp-textSecondary">
          <tr>
            <th className="px-3 py-2">Kind</th>
            <th className="px-3 py-2">Label</th>
            <th className="px-3 py-2 text-right">Amount</th>
            {editable && <th className="px-3 py-2"></th>}
          </tr>
        </thead>
        <tbody className="divide-y divide-white/5 bg-sp-card/30">
          {items.map((it) => {
            const isAdd = it.direction === "add";
            return (
              <tr key={it.id}>
                <td className="px-3 py-2 text-sp-textSecondary">{kindLabel(it.kind)}</td>
                <td className="px-3 py-2 text-sp-textPrimary">{it.label}</td>
                <td className={`px-3 py-2 text-right ${isAdd ? "text-sp-success" : "text-sp-danger"}`}>
                  {isAdd ? "+" : "−"}{formatCurrency(it.amount)}
                </td>
                {editable && (
                  <td className="px-3 py-2 text-right">
                    <RemoveLineButton
                      paystubId={paystubId}
                      table="paystub_settlement_items"
                      lineId={it.id}
                    />
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function AddSettlementItemForm({ paystubId }: { paystubId: string }) {
  const kinds = [
    "escrow_deposit","escrow_release","advance","advance_repayment","fuel_advance","fuel_deduction",
    "toll","maintenance","tire","permit","eld_lease","truck_lease","trailer_lease","plate",
    "insurance","occupational_accident","cargo_insurance","chargeback","damage","claim",
    "factoring_fee","dispatcher_fee","authority_fee","maintenance_reserve",
    "reimbursement","bonus","detention_pay","layover_pay","other",
  ];
  return (
    <form
      action={addSettlementItem.bind(null, paystubId)}
      className="grid grid-cols-1 gap-2 rounded-md border border-dashed border-white/10 p-3 md:grid-cols-[200px_1fr_110px_120px_auto]"
    >
      <SelectMini name="kind" defaultValue="fuel_deduction" options={kinds.map((k) => ({ value: k, label: kindLabel(k) }))} />
      <InputMini name="label" placeholder="Label" required />
      <SelectMini
        name="direction"
        defaultValue="deduct"
        options={[
          { value: "deduct", label: "Deduct" },
          { value: "add", label: "Add-back" },
        ]}
      />
      <InputMini name="amount" placeholder="Amount" inputMode="decimal" required />
      <button
        type="submit"
        className="rounded-md bg-sp-gold px-3 py-1.5 text-xs font-semibold text-sp-black hover:bg-sp-goldLight"
      >
        Add
      </button>
    </form>
  );
}

// =============================================================================
//  Shared mini-form fields
// =============================================================================

function InputMini({
  name,
  placeholder,
  defaultValue,
  required,
  inputMode,
}: {
  name: string;
  placeholder?: string;
  defaultValue?: string | number;
  required?: boolean;
  inputMode?: "decimal" | "numeric" | "text";
}) {
  return (
    <input
      name={name}
      placeholder={placeholder}
      defaultValue={defaultValue === undefined ? "" : String(defaultValue)}
      required={required}
      inputMode={inputMode}
      className="rounded-md border border-white/10 bg-sp-background px-2 py-1.5 text-xs text-sp-textPrimary placeholder:text-sp-textSecondary/60 focus:border-sp-gold focus:outline-none"
    />
  );
}

function SelectMini({
  name,
  defaultValue,
  options,
}: {
  name: string;
  defaultValue: string;
  options: ReadonlyArray<{ value: string; label: string }>;
}) {
  return (
    <select
      name={name}
      defaultValue={defaultValue}
      className="rounded-md border border-white/10 bg-sp-background px-2 py-1.5 text-xs text-sp-textPrimary focus:border-sp-gold focus:outline-none"
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

function RemoveLineButton({
  paystubId,
  table,
  lineId,
}: {
  paystubId: string;
  table:
    | "paystub_earnings"
    | "paystub_deductions"
    | "paystub_taxes"
    | "paystub_settlement_items";
  lineId: string;
}) {
  const boundRemove = removeLineAction.bind(null, paystubId, table, lineId);
  return (
    <form action={boundRemove}>
      <button
        type="submit"
        title="Remove"
        className="rounded border border-white/10 px-2 py-1 text-[10px] text-sp-textSecondary hover:border-sp-danger/40 hover:text-sp-danger"
      >
        Remove
      </button>
    </form>
  );
}

function kindLabel(k: string): string {
  return k
    .split("_")
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
    .join(" ");
}
