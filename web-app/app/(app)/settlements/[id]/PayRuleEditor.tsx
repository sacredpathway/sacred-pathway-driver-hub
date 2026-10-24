"use client";

// Edits a PayRule (driver pay method, possibly a combination) and the frozen
// company fee terms. Same vocabulary and JSON as the iPhone pay terms screen.

import {
  MILE_BASES, MILE_BASIS_LABEL, NO_FEES, PAY_KINDS, PAY_KIND_LABEL,
  type CompanyFeeTerms, type PayComponent, type PayKind, type PayRule,
} from "@/lib/settlements/model";
import { blankComponent } from "@/lib/settlements/payrule";
import { parseHours, parseMoney, parsePercent, parseRate } from "@/lib/settlements/input";
import { IconButton, Label, NumField, inputCls } from "./fields";

export default function PayRuleEditor({
  rule, onChange, disabled, showFees = true, compact = false, storedPercents,
}: {
  rule: PayRule;
  onChange: (r: PayRule) => void;
  disabled?: boolean;
  showFees?: boolean;
  compact?: boolean;
  /** Exact stored / iPhone-computed percents, accepted unchanged. */
  storedPercents?: Set<string>;
}) {
  const pct = (v: string) => (storedPercents?.has(v) ? { ok: true as const, value: v } : parsePercent(v, "Driver %"));
  const set = (i: number, patch: Partial<PayComponent>) =>
    onChange({ ...rule, components: rule.components.map((c, j) => (j === i ? { ...c, ...patch } : c)) });

  const fees = rule.feeTerms ?? NO_FEES;
  const setFee = (patch: Partial<CompanyFeeTerms>) => onChange({ ...rule, feeTerms: { ...fees, ...patch } });

  return (
    <div className="space-y-3">
      {rule.components.length === 0 && (
        <p className="rounded-md border border-sp-warning/40 bg-sp-warning/10 px-3 py-2 text-xs text-orange-200">
          No pay method — load earnings calculate as $0.00. Add one below.
        </p>
      )}
      {rule.components.map((c, i) => (
        <div key={c.id} className="grid grid-cols-1 gap-2 rounded-lg border border-white/5 bg-black/10 p-2.5 sm:grid-cols-12 sm:items-end">
          <div className="sm:col-span-4">
            <Label>Pay method</Label>
            <select
              aria-label="Pay method"
              disabled={disabled}
              value={c.kind}
              onChange={(e) => {
                const nb = blankComponent(e.target.value as PayKind);
                set(i, { ...nb, id: c.id });
              }}
              className={inputCls}
            >
              {PAY_KINDS.map((k) => <option key={k} value={k}>{PAY_KIND_LABEL[k]}</option>)}
            </select>
          </div>
          {c.kind === "percent_of_gross" && (
            <div className="sm:col-span-3">
              <Label>Driver %</Label>
              <NumField ariaLabel="Driver percentage" value={c.percent ?? ""} onChange={(v) => set(i, { percent: v })} parse={pct} suffix="%" disabled={disabled} />
              {c.percent && storedPercents?.has(c.percent) && /\.\d{5,}/.test(c.percent) && (
                <p className="mt-0.5 text-[11px] text-sp-textSecondary">Exact value the iPhone uses for this older settlement — kept so pay matches to the cent.</p>
              )}
            </div>
          )}
          {(c.kind === "flat_per_load" || c.kind === "per_mile" || c.kind === "weekly_salary" || c.kind === "hourly") && (
            <div className="sm:col-span-3">
              <Label>{c.kind === "per_mile" ? "Rate / mile" : c.kind === "hourly" ? "Rate / hour" : c.kind === "weekly_salary" ? "Salary" : "Per load"}</Label>
              <NumField ariaLabel="Rate" value={c.rate ?? ""} onChange={(v) => set(i, { rate: v })} parse={(v) => parseRate(v, "Rate")} prefix="$" disabled={disabled} />
            </div>
          )}
          {c.kind === "per_mile" && (
            <div className="sm:col-span-3">
              <Label>Miles</Label>
              <select aria-label="Mile basis" disabled={disabled} value={c.mileBasis} onChange={(e) => set(i, { mileBasis: e.target.value as PayComponent["mileBasis"] })} className={inputCls}>
                {MILE_BASES.map((m) => <option key={m} value={m}>{MILE_BASIS_LABEL[m]}</option>)}
              </select>
            </div>
          )}
          {c.kind === "hourly" && (
            <div className="sm:col-span-3">
              <Label>Hours (blank = settlement hours)</Label>
              <NumField ariaLabel="Hours" value={c.hours ?? ""} onChange={(v) => set(i, { hours: v === "" ? null : v })} parse={(v) => parseHours(v, "Hours", { allowEmpty: true })} disabled={disabled} />
            </div>
          )}
          {c.kind === "manual" && (
            <div className="sm:col-span-3">
              <Label>Amount</Label>
              <NumField ariaLabel="Fixed amount" value={c.fixedAmount ?? ""} onChange={(v) => set(i, { fixedAmount: v })} parse={(v) => parseMoney(v, "Amount")} prefix="$" disabled={disabled} />
            </div>
          )}
          <div className="flex justify-end sm:col-span-2 sm:col-start-11">
            <IconButton label="Remove pay method" tone="danger" disabled={disabled} onClick={() => onChange({ ...rule, components: rule.components.filter((_, j) => j !== i) })}>✕</IconButton>
          </div>
        </div>
      ))}
      {!disabled && rule.components.length < 6 && (
        <button type="button" onClick={() => onChange({ ...rule, components: [...rule.components, blankComponent("percent_of_gross")] })}
          className="text-xs font-semibold text-sp-gold hover:underline">
          + Add pay method {rule.components.length > 0 ? "(combination pay)" : ""}
        </button>
      )}

      {showFees && !compact && (
        <div className="mt-2 rounded-lg border border-white/5 p-3">
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-sp-textSecondary">Company fees on this settlement</p>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <FeeRow label="Dispatcher fee" value={fees.dispatcherFeePercent} suffix="%" parse={(v) => parsePercent(v, "Dispatcher fee")}
              onValue={(v) => setFee({ dispatcherFeePercent: v })} who={fees.dispatcherFeeResponsibility}
              onWho={(w) => setFee({ dispatcherFeeResponsibility: w })} disabled={disabled} />
            <FeeRow label="Factoring fee" value={fees.factoringFeePercent} suffix="%" parse={(v) => parsePercent(v, "Factoring fee")}
              onValue={(v) => setFee({ factoringFeePercent: v })} who={fees.factoringFeeResponsibility}
              onWho={(w) => setFee({ factoringFeeResponsibility: w })} disabled={disabled} />
            <FeeRow label="Authority fee" value={fees.authorityFee} prefix="$" parse={(v) => parseMoney(v, "Authority fee")}
              onValue={(v) => setFee({ authorityFee: v })} who={fees.authorityFeeResponsibility}
              onWho={(w) => setFee({ authorityFeeResponsibility: w })} disabled={disabled} />
            <FeeRow label="Maintenance reserve" value={fees.maintenanceReserve} prefix="$" parse={(v) => parseMoney(v, "Maintenance reserve")}
              onValue={(v) => setFee({ maintenanceReserve: v })} who={fees.maintenanceReserveResponsibility}
              onWho={(w) => setFee({ maintenanceReserveResponsibility: w })} disabled={disabled} />
          </div>
          <p className="mt-2 text-[11px] text-sp-textSecondary">
            Percent fees are taken from gross load revenue. “Company pays” fees never touch the driver’s check.
          </p>
        </div>
      )}
    </div>
  );
}

function FeeRow({
  label, value, parse, onValue, who, onWho, disabled, prefix, suffix,
}: {
  label: string; value: string; parse: (v: string) => ReturnType<typeof parseMoney>;
  onValue: (v: string) => void; who: "driver" | "company" | "split"; onWho: (w: "driver" | "company") => void;
  disabled?: boolean; prefix?: string; suffix?: string;
}) {
  return (
    <div className="grid grid-cols-2 gap-2">
      <div>
        <Label>{label}</Label>
        <NumField ariaLabel={label} value={value} onChange={onValue} parse={parse} prefix={prefix} suffix={suffix} disabled={disabled} />
      </div>
      <div>
        <Label>Who pays</Label>
        <select aria-label={`${label} paid by`} disabled={disabled} value={who === "driver" ? "driver" : "company"}
          onChange={(e) => onWho(e.target.value as "driver" | "company")} className={inputCls}>
          <option value="company">Company</option>
          <option value="driver">Driver</option>
        </select>
      </div>
    </div>
  );
}
