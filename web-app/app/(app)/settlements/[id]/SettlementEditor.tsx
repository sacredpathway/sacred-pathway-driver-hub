"use client";

// =============================================================================
//  Settlement editor — the web payroll workspace
// -----------------------------------------------------------------------------
//  One screen: details → pay terms → loads → additions → deductions, with a
//  live, cent-exact summary on the right. The summary runs the SAME engine
//  the server (and the iPhone) uses, so the number on screen is the number
//  that gets saved. Approved / paid / voided settlements render read-only
//  until explicitly reopened.
//
//  Autosave (draft / ready for review only): every change is saved to the
//  server a few seconds after the user stops typing, and immediately when they
//  switch tabs, lock the phone or leave the page. A copy is also kept in this
//  browser until the server has it; reopening the settlement offers to
//  restore unsaved work when browser storage is available. Approved, paid and
//  voided settlements are never autosaved (they are read-only until reopened).
// =============================================================================

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ADDITION_CATEGORY_LABEL, DEDUCTION_CATEGORY_LABEL, RESPONSIBILITY_LABEL, SETTLEMENT_TYPES,
  SETTLEMENT_TYPE_LABEL, STATUS_LABEL, EMPTY_RULE, lineGross, money,
  type Addition, type CustomCategory, type Deduction, type LoadLine, type PayRule,
  type RecurringDeductionRule, type Responsibility, type SettlementBundle, type SettlementStatus,
} from "@/lib/settlements/model";
import { cryptoId } from "@/lib/settlements/payrule";
import { recalculate, validate, lineFromLoad, type LoadRow, type Issue } from "@/lib/settlements/workflow";
import { snapToStoredPrecision } from "@/lib/settlements/rows";
import { parseHours, parseMiles, parseMoney, parseShare } from "@/lib/settlements/input";
import { applyRowIdMap, sanitizePayload, storedPercents, type EditPayload } from "@/lib/settlements/payload";
import { saveSettlementAction, transitionSettlementAction } from "../actions";
import PayRuleEditor from "./PayRuleEditor";
import CategoryPicker from "./CategoryPicker";
import { IconButton, Label, NumField, TextField, inputCls } from "./fields";

export interface AuditRow {
  id: string;
  action: string;
  summary: string;
  actor_name: string | null;
  timestamp: string;
}

export interface EditorProps {
  initial: SettlementBundle;
  updatedAt: string | null;
  driverName: string;
  canEdit: boolean;
  customs: { available: boolean; categories: CustomCategory[]; suggestions: { addition: string[]; deduction: string[] } };
  eligible: LoadRow[];
  rules: RecurringDeductionRule[];
  otherNumbers: string[];
  alreadyPaid: Array<[string, string]>;
  auditTrail: AuditRow[];
}

const STATUS_TONE: Record<SettlementStatus, string> = {
  draft: "bg-white/[0.06] text-sp-textSecondary ring-white/10",
  ready_for_review: "bg-sky-400/10 text-sky-300 ring-sky-400/25",
  approved: "bg-sp-gold/10 text-sp-goldLight ring-sp-gold/30",
  paid: "bg-sp-success/10 text-emerald-300 ring-sp-success/30",
  voided: "bg-sp-danger/10 text-red-300 ring-sp-danger/30",
};

export function StatusPill({ status }: { status: SettlementStatus }) {
  return (
    <span className={"inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ring-inset " + STATUS_TONE[status]}>
      {STATUS_LABEL[status]}
    </span>
  );
}

export default function SettlementEditor(props: EditorProps) {
  const router = useRouter();
  const { initial, canEdit } = props;
  const status = initial.header.status;
  const locked = status === "approved" || status === "paid" || status === "voided";
  const readOnly = !canEdit || locked || initial.header.isEstimate;

  const [b, setB] = useState<SettlementBundle>(initial);
  const [customs, setCustoms] = useState<CustomCategory[]>(props.customs.categories);
  const [message, setMessage] = useState<{ tone: "ok" | "err"; text: string; list?: string[] } | null>(null);
  const [openLine, setOpenLine] = useState<string | null>(null);

  // ---- autosave state ----
  // `version` is the server's updated_at this editor last saw or wrote;
  // `savedKey` is the payload the server holds. Dirty = what's on screen
  // differs from what's saved (not from the page's first render, which no
  // longer reloads after each save).
  const [version, setVersion] = useState<string | null>(props.updatedAt);
  const [savedKey, setSavedKey] = useState(() => JSON.stringify(toPayload(initial)));
  const [saving, setSaving] = useState(false);
  const [saveAttempt, setSaveAttempt] = useState(0);
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const [conflict, setConflict] = useState(false);
  const [restore, setRestore] = useState<LocalBackup | null>(null);
  const ownVersions = useRef(new Set<string | null>([props.updatedAt]));
  const inFlight = useRef(false);
  const [backupReady, setBackupReady] = useState(false);
  const autosaveOn = !readOnly && !conflict && !restore;
  const backupKey = `sph.settlementDraft.v1.${initial.header.id}`;

  // ---- live, exact calculation (same engine as server + iPhone) ----
  const live = useMemo(() => recalculate(snapToStoredPrecision(b), props.rules), [b, props.rules]);
  const r = live.result;
  const issues: Issue[] = useMemo(
    () => validate(live.bundle, { otherSettlementNumbers: props.otherNumbers, alreadyPaidLoads: new Map(props.alreadyPaid) }, r),
    [live, props.otherNumbers, props.alreadyPaid, r],
  );
  const payload = useMemo(() => toPayload(b), [b]);
  const payloadKey = useMemo(() => JSON.stringify(payload), [payload]);
  const dirty = payloadKey !== savedKey;
  const gate = useMemo(() => sanitizePayload(payload, {
    existing: initial,
    allowedNewLoadIds: new Set(props.eligible.map((l) => l.id)),
    customCategoryIds: new Set(customs.map((c) => c.id)),
  }), [payload, initial, props.eligible, customs]);
  const fieldErrors = gate.errors.length;

  // ---- mutators ----
  const setHeader = (patch: Partial<SettlementBundle["header"]>) => setB((x) => ({ ...x, header: { ...x.header, ...patch } }));
  const setLine = (id: string, patch: Partial<LoadLine>) => setB((x) => ({ ...x, loadLines: x.loadLines.map((l) => (l.id === id ? { ...l, ...patch } : l)) }));
  const setAdd = (id: string, patch: Partial<Addition>) => setB((x) => ({ ...x, additions: x.additions.map((a) => (a.id === id ? { ...a, ...patch } : a)) }));
  const setDed = (id: string, patch: Partial<Deduction>) => setB((x) => ({ ...x, deductions: x.deductions.map((d) => (d.id === id ? { ...d, ...patch } : d)) }));

  const rule: PayRule = b.header.payRule ?? EMPTY_RULE;
  const stored = useMemo(() => storedPercents(initial), [initial]);
  const onLoadIds = new Set(b.loadLines.map((l) => l.loadId).filter(Boolean));
  const addable = props.eligible.filter((l) => !onLoadIds.has(l.id));

  // Latest values for the save loop (timers and unload handlers run outside render).
  const latest = useRef({ bundle: b, payload, payloadKey, savedKey, version, fieldErrors, autosaveOn });
  useEffect(() => { latest.current = { bundle: b, payload, payloadKey, savedKey, version, fieldErrors, autosaveOn }; });

  const flush = useCallback(async (manual = false): Promise<void> => {
    const cur = latest.current;
    if (!cur.autosaveOn || cur.payloadKey === cur.savedKey) return;
    if (cur.fieldErrors > 0) return; // invalid input stays in the browser backup until fixed
    if (inFlight.current) return;
    inFlight.current = true;
    setSaving(true);
    try {
      const res = await saveSettlementAction(initial.header.id, cur.version, cur.payload);
      if (!res.ok) {
        if (/changed somewhere else/i.test(res.error)) { latest.current.autosaveOn = false; setConflict(true); }
        setMessage({ tone: "err", text: res.error, list: res.errors });
        return;
      }
      const map = res.idMap ?? {};
      ownVersions.current.add(res.updatedAt);
      setVersion(res.updatedAt);
      // Adopt the ids the server gave new lines so the next save updates them.
      const sentKey = JSON.stringify(remapPayload(cur.payload, map));
      const currentBundle = applyRowIdMap(latest.current.bundle, map);
      const currentPayload = remapPayload(latest.current.payload, map);
      latest.current = { ...latest.current, bundle: currentBundle, payload: currentPayload,
        payloadKey: JSON.stringify(currentPayload), version: res.updatedAt, savedKey: sentKey };
      // A request can finish after navigation unmounts us. Keep the backup's
      // row ids/version current even when React can no longer run effects.
      try {
        if (latest.current.payloadKey === sentKey) localStorage.removeItem(backupKey);
        else localStorage.setItem(backupKey, JSON.stringify({ base: res.updatedAt, at: Date.now(), bundle: currentBundle } satisfies LocalBackup));
      } catch { /* storage unavailable */ }
      setSavedKey(sentKey);
      if (Object.keys(map).length > 0) {
        setB((x) => applyRowIdMap(x, map));
        setOpenLine((o) => (o && map[o] ? map[o] : o));
      }
      setSavedAt(new Date());
      setMessage(manual ? { tone: "ok", text: `Saved. Net pay ${money(res.netPay).format()}.` } : null);
    } catch (e) {
      setMessage({ tone: "err", text: `Couldn't save (${(e as Error).message || "network"}). Your changes are kept in this browser and will retry.` });
    } finally {
      inFlight.current = false;
      setSaving(false);
      setSaveAttempt((n) => n + 1);
    }
  }, [initial.header.id, backupKey]);

  const save = () => { setMessage(null); void flush(true); };

  // The paystub prints what is SAVED. Save pending edits (waiting for any save
  // already running), then open it; explain instead of doing nothing.
  const openPaystubAfterSave = async () => {
    const url = `/settlements/${initial.header.id}/statement`;
    const unsaved = (text: string) => setMessage({ tone: "err", text });
    if (latest.current.fieldErrors > 0) return unsaved("Fix the highlighted fields first — the paystub only shows saved changes.");
    if (restore) return unsaved("Restore or discard your unsaved edits first, then open the paystub.");
    if (!latest.current.autosaveOn) return unsaved("This settlement changed elsewhere — reload it first so the paystub matches what you see.");
    for (let i = 0; i < 3 && latest.current.payloadKey !== latest.current.savedKey; i++) {
      for (let w = 0; inFlight.current && w < 50; w++) await new Promise((r) => setTimeout(r, 200));
      await flush(true);
    }
    if (latest.current.payloadKey === latest.current.savedKey) router.push(url);
    else unsaved("Couldn’t save your latest changes, so the paystub would be missing them. Try “Save now”.");
  };

  // Debounced autosave after the user stops editing.
  useEffect(() => {
    if (!autosaveOn || !dirty || fieldErrors > 0 || saving) return;
    const t = window.setTimeout(() => { void flush(); }, AUTOSAVE_DELAY_MS);
    return () => window.clearTimeout(t);
  }, [payloadKey, dirty, autosaveOn, fieldErrors, saving, saveAttempt, flush]);

  // Save right away when the tab is hidden / the phone locks / the page is
  // left (in-app navigation unmounts the editor).
  useEffect(() => {
    const now = () => { void flush(); };
    const onVis = () => { if (document.visibilityState === "hidden") now(); };
    document.addEventListener("visibilitychange", onVis);
    window.addEventListener("pagehide", now);
    return () => {
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("pagehide", now);
      now();
    };
  }, [flush]);

  // Browser copy until the server has it (closing the tab, offline, or a
  // field that must be fixed before it can save).
  useEffect(() => {
    if (readOnly || !backupReady || restore) return;
    try {
      if (dirty) localStorage.setItem(backupKey, JSON.stringify({ base: version, at: Date.now(), bundle: b } satisfies LocalBackup));
      else localStorage.removeItem(backupKey);
    } catch { /* storage unavailable: server autosave still runs */ }
  }, [b, dirty, version, readOnly, backupKey, backupReady, restore]);

  // On open: offer to restore edits that never reached the server.
  useEffect(() => {
    if (readOnly) return;
    try {
      const raw = localStorage.getItem(backupKey);
      if (!raw) return;
      const bk = JSON.parse(raw) as LocalBackup;
      const differs = JSON.stringify(toPayload(bk.bundle)) !== JSON.stringify(toPayload(initial));
      if (differs) setRestore({ ...bk, stale: bk.base !== props.updatedAt }); else localStorage.removeItem(backupKey);
    } catch { /* ignore a corrupt or blocked backup */ }
    finally { setBackupReady(true); }
    // run once per settlement
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [backupKey]);

  // Warn only while something is genuinely unsaved.
  useEffect(() => {
    if (!dirty && !saving) return;
    const h = (e: BeforeUnloadEvent) => { void flush(); e.preventDefault(); e.returnValue = ""; };
    window.addEventListener("beforeunload", h);
    return () => window.removeEventListener("beforeunload", h);
  }, [dirty, saving, flush]);

  // The page re-renders after every save. Our own saves keep what's on screen;
  // anything else (status change, iPhone edit, reload) shows the server copy.
  useEffect(() => {
    if (ownVersions.current.has(props.updatedAt) || inFlight.current) return;
    if (dirty) {
      latest.current.autosaveOn = false;
      setConflict(true);
      return;
    }
    ownVersions.current.add(props.updatedAt);
    setB(initial);
    setCustoms(props.customs.categories);
    setVersion(props.updatedAt);
    setSavedKey(JSON.stringify(toPayload(initial)));
    setConflict(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.updatedAt]);

  return (
    <div className="space-y-5">
      <header className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div className="min-w-0">
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-sp-gold/90">Settlement</p>
          <h1 className="mt-1 flex flex-wrap items-center gap-2 text-2xl font-bold tracking-tight text-sp-textPrimary">
            {b.header.settlementNumber ?? "New settlement"} <span className="text-sp-textSecondary">·</span> {props.driverName}
            <StatusPill status={status} />
          </h1>
          <p className="mt-1 text-sm text-sp-textSecondary">
            {initial.header.periodStart ?? "—"} → {initial.header.periodEnd ?? "—"}
            {initial.header.engineVersion ? ` · ${initial.header.engineVersion}` : ""}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href="/settlements" className="rounded-md border border-white/10 px-3 py-1.5 text-xs text-sp-textPrimary hover:bg-white/5">← Settlements</Link>
          <Link href="/payroll" className="rounded-md border border-white/10 px-3 py-1.5 text-xs text-sp-textPrimary hover:bg-white/5">Payroll history</Link>
          <Link href={`/settlements/${initial.header.id}/statement`} data-testid="open-paystub"
            onClick={(e) => {
              // The paystub prints what is SAVED: save pending edits first.
              if (readOnly || (!dirty && !restore && !conflict && !saving)) return;
              e.preventDefault();
              void openPaystubAfterSave();
            }}
            className="rounded-md border border-sp-gold/40 px-3 py-1.5 text-xs font-semibold text-sp-gold hover:bg-sp-gold/10">Paystub / PDF</Link>
          <button type="button" onClick={() => window.print()} className="rounded-md border border-white/10 px-3 py-1.5 text-xs text-sp-textPrimary hover:bg-white/5">Print</button>
        </div>
      </header>

      {locked && canEdit && (
        <div className="rounded-lg border border-sp-gold/30 bg-sp-gold/10 px-3 py-2 text-sm text-sp-goldLight">
          {status === "voided" ? "This settlement is voided." : `This settlement is ${STATUS_LABEL[status].toLowerCase()} and locked.`} Use “Reopen” on the right to make changes — the reason is saved in the audit trail.
        </div>
      )}
      {!canEdit && (
        <div className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-sp-textSecondary">View only — this settlement belongs to your carrier’s account.</div>
      )}
      {restore && !readOnly && (
        <div data-testid="restore-banner" className="flex flex-wrap items-center gap-2 rounded-lg border border-sky-400/30 bg-sky-400/10 px-3 py-2 text-sm text-sky-100">
          <span className="min-w-0 flex-1">You have edits from {new Date(restore.at).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" })} that weren’t saved yet.{restore.stale ? " This settlement changed elsewhere since then — restoring puts your version back over it." : ""}</span>
          <button type="button" onClick={() => { setB(restore.bundle); setRestore(null); }} className="rounded-md bg-sky-400/20 px-3 py-1 text-xs font-semibold hover:bg-sky-400/30">Restore my edits</button>
          <button type="button" onClick={() => { try { localStorage.removeItem(backupKey); } catch { /* */ } setRestore(null); }} className="rounded-md border border-white/10 px-3 py-1 text-xs hover:bg-white/5">Discard</button>
        </div>
      )}
      {conflict && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-orange-300/30 bg-orange-300/10 px-3 py-2 text-sm text-orange-100">
          <span className="min-w-0 flex-1">This settlement was changed on another device or tab, so autosave paused. Your edits are kept in this browser.</span>
          <button type="button" onClick={() => window.location.reload()} className="rounded-md bg-orange-300/20 px-3 py-1 text-xs font-semibold hover:bg-orange-300/30">Reload latest</button>
        </div>
      )}

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="min-w-0 space-y-5">
          {/* ---------------- Details ---------------- */}
          <Card title="Details">
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              <div><Label htmlFor="ps">Period start</Label><TextField id="ps" type="date" ariaLabel="Period start" value={b.header.periodStart ?? ""} onChange={(v) => setHeader({ periodStart: v || null })} disabled={readOnly} /></div>
              <div><Label htmlFor="pe">Period end</Label><TextField id="pe" type="date" ariaLabel="Period end" value={b.header.periodEnd ?? ""} onChange={(v) => setHeader({ periodEnd: v || null })} disabled={readOnly} /></div>
              <div><Label htmlFor="sn">Settlement #</Label><TextField id="sn" ariaLabel="Settlement number" value={b.header.settlementNumber ?? ""} onChange={(v) => setHeader({ settlementNumber: v })} disabled={readOnly} /></div>
              <div><Label htmlFor="tn">Truck #</Label><TextField id="tn" ariaLabel="Truck number" value={b.header.truckNumber ?? ""} onChange={(v) => setHeader({ truckNumber: v })} disabled={readOnly} /></div>
              <div className="col-span-2">
                <Label htmlFor="st">Settlement type</Label>
                <select id="st" aria-label="Settlement type" disabled={readOnly} value={b.header.settlementType ?? "company_driver"} onChange={(e) => setHeader({ settlementType: e.target.value as typeof SETTLEMENT_TYPES[number] })} className={inputCls}>
                  {SETTLEMENT_TYPES.map((t) => <option key={t} value={t}>{SETTLEMENT_TYPE_LABEL[t]}</option>)}
                </select>
              </div>
              <div className="col-span-2">
                <Label htmlFor="hw">Hours worked (hourly pay)</Label>
                <NumField id="hw" ariaLabel="Hours worked" value={b.header.hoursWorked ?? ""} onChange={(v) => setHeader({ hoursWorked: v === "" ? null : v })} parse={(v) => parseHours(v, "Hours", { allowEmpty: true })} disabled={readOnly} />
              </div>
              <div className="col-span-2 md:col-span-4">
                <Label htmlFor="nt">Notes</Label>
                <textarea id="nt" aria-label="Notes" rows={2} value={b.header.notes ?? ""} disabled={readOnly} onChange={(e) => setHeader({ notes: e.target.value })} className={inputCls} />
              </div>
            </div>
          </Card>

          {/* ---------------- Pay terms ---------------- */}
          <Card title="Driver pay" description="Frozen on this settlement — changing the driver’s default rate later never re-prices it.">
            <PayRuleEditor rule={rule} onChange={(nr) => setHeader({ payRule: nr })} disabled={readOnly} storedPercents={stored} />
            <div className="mt-3 max-w-sm">
              <Label htmlFor="basis">Percentage pays on</Label>
              <select id="basis" aria-label="Percentage basis" disabled={readOnly} value={b.header.payOnGrossRevenue === false ? "net" : "gross"} onChange={(e) => setHeader({ payOnGrossRevenue: e.target.value === "gross" })} className={inputCls}>
                <option value="gross">Gross load revenue</option>
                <option value="net">Net (revenue − company-paid costs)</option>
              </select>
            </div>
          </Card>

          {/* ---------------- Loads ---------------- */}
          <Card title={`Loads (${b.loadLines.length})`} description="Values are frozen as paid. Editing a load here does not change the load record.">
            {b.loadLines.length === 0 ? <p className="text-sm text-sp-textSecondary">No loads on this settlement.</p> : (
              <div className="overflow-x-auto">
                <table className="min-w-full text-sm">
                  <thead className="text-left text-[11px] uppercase tracking-wide text-sp-textSecondary">
                    <tr><th className="py-2 pr-2">Load</th><th className="py-2 pr-2">Delivered</th><th className="py-2 pr-2">Route</th><th className="py-2 pr-2 text-right">Gross</th><th className="py-2 pr-2 text-right">Miles</th><th className="py-2 pr-2 text-right">Driver pay</th><th className="py-2" /></tr>
                  </thead>
                  <tbody className="divide-y divide-white/5">
                    {b.loadLines.map((l) => {
                      const earn = r.loadEarnings.get(l.id);
                      const open = openLine === l.id;
                      return (
                        <LoadRowView key={l.id} l={l} open={open} readOnly={readOnly} stored={stored}
                          earn={earn ? earn.format() : "—"} basis={r.loadPayBasis.get(l.id) ?? ""}
                          onToggle={() => setOpenLine(open ? null : l.id)}
                          onChange={(p) => setLine(l.id, p)}
                          onRemove={() => setB((x) => ({ ...x, loadLines: x.loadLines.filter((y) => y.id !== l.id) }))} />
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
            {!readOnly && (
              <div className="mt-3 flex flex-wrap items-center gap-2">
                {addable.length > 0 && (
                  <select aria-label="Add a load" value="" onChange={(e) => {
                    const load = props.eligible.find((x) => x.id === e.target.value);
                    if (!load) return;
                    setB((x) => ({ ...x, loadLines: [...x.loadLines, lineFromLoad(load, x.loadLines.length)] }));
                  }} className={inputCls + " max-w-xs"}>
                    <option value="">+ Add a delivered load ({addable.length})</option>
                    {addable.map((l) => <option key={l.id} value={l.id}>#{l.load_number ?? "—"} · {(l.delivery_date ?? l.pickup_date ?? "").slice(0, 10)} · {money(l.total_revenue ?? 0).format()}</option>)}
                  </select>
                )}
                <button type="button" onClick={() => {
                  const id = cryptoId();
                  setB((x) => ({ ...x, loadLines: [...x.loadLines, { ...blankLine(id), sortOrder: x.loadLines.length }] }));
                  setOpenLine(id);
                }} className="text-xs font-semibold text-sp-gold hover:underline">+ Add manual line</button>
              </div>
            )}
          </Card>

          {/* ---------------- Additions ---------------- */}
          <Card title={`Additions (${b.additions.length})`} description="Credits to the driver — bonus, detention, reimbursements, or your own categories.">
            <LineTable empty="No additions." rows={b.additions.map((a) => (
              <div key={a.id} className="grid grid-cols-12 items-start gap-2 py-2">
                <div className="col-span-12 sm:col-span-4">
                  <CategoryPicker kind="addition" category={a.category} customCategoryId={a.customCategoryId} customs={customs}
                    suggestions={props.customs.suggestions.addition} available={props.customs.available} disabled={readOnly}
                    onCreated={(c) => setCustoms((cs) => [...cs, c])}
                    onPick={(c) => setAdd(a.id, {
                      category: c.category as Addition["category"], customCategoryId: c.customCategoryId,
                      description: c.name && (!a.description || isAutoDescription(a.description, customs)) ? c.name : a.description,
                    })} />
                </div>
                <div className="col-span-7 sm:col-span-5"><TextField ariaLabel="Addition description" value={a.description} onChange={(v) => setAdd(a.id, { description: v })} disabled={readOnly} placeholder="Description" /></div>
                <div className="col-span-4 sm:col-span-2"><NumField ariaLabel="Addition amount" value={a.amount} onChange={(v) => setAdd(a.id, { amount: v })} parse={(v) => parseMoney(v, "Amount", { allowNegative: true })} prefix="$" disabled={readOnly} /></div>
                <div className="col-span-1 flex justify-end"><IconButton label="Remove addition" tone="danger" disabled={readOnly} onClick={() => setB((x) => ({ ...x, additions: x.additions.filter((y) => y.id !== a.id) }))}>✕</IconButton></div>
              </div>
            ))} />
            {!readOnly && <button type="button" className="mt-2 text-xs font-semibold text-sp-gold hover:underline" onClick={() => setB((x) => ({ ...x, additions: [...x.additions, blankAddition()] }))}>+ Add addition</button>}
          </Card>

          {/* ---------------- Deductions ---------------- */}
          <Card title={`Deductions (${b.deductions.length})`} description="Only the driver’s share comes off the check; the company share is a company expense.">
            <LineTable empty="No deductions." rows={b.deductions.map((d) => (
              <div key={d.id} className="grid grid-cols-12 items-start gap-2 py-2">
                <div className="col-span-12 sm:col-span-3">
                  <CategoryPicker kind="deduction" category={d.category} customCategoryId={d.customCategoryId} customs={customs}
                    suggestions={props.customs.suggestions.deduction} available={props.customs.available} disabled={readOnly}
                    onCreated={(c) => setCustoms((cs) => [...cs, c])}
                    onPick={(c) => setDed(d.id, {
                      category: c.category as Deduction["category"], customCategoryId: c.customCategoryId,
                      description: c.name && (!d.description || isAutoDescription(d.description, customs)) ? c.name : d.description,
                      ...(c.responsibility ? { responsibility: c.responsibility, driverSharePercent: c.driverSharePercent ?? d.driverSharePercent } : {}),
                    })} />
                  {(d.recurringDeductionId || d.advanceId) && <p className="mt-1 text-[10px] text-sp-textSecondary">{d.recurringDeductionId ? "Recurring" : "Advance recovery"}</p>}
                </div>
                <div className="col-span-12 sm:col-span-3"><TextField ariaLabel="Deduction description" value={d.description} onChange={(v) => setDed(d.id, { description: v })} disabled={readOnly} placeholder="Description" /></div>
                <div className="col-span-4 sm:col-span-2"><NumField ariaLabel="Deduction amount" value={d.amount} onChange={(v) => setDed(d.id, { amount: v })} parse={(v) => parseMoney(v, "Amount", { allowNegative: true })} prefix="$" disabled={readOnly} /></div>
                <div className="col-span-4 sm:col-span-2">
                  <select aria-label="Who pays" disabled={readOnly} value={d.responsibility} onChange={(e) => {
                    const v = e.target.value as Responsibility;
                    setDed(d.id, { responsibility: v, driverSharePercent: v === "driver" ? "100" : v === "company" ? "0" : (d.responsibility === "split" ? d.driverSharePercent : "50") });
                  }} className={inputCls}>
                    {(["driver", "company", "split"] as const).map((x) => <option key={x} value={x}>{RESPONSIBILITY_LABEL[x]}</option>)}
                  </select>
                </div>
                <div className="col-span-3 sm:col-span-1">
                  {d.responsibility === "split" && <NumField ariaLabel="Driver share percent" value={d.driverSharePercent} onChange={(v) => setDed(d.id, { driverSharePercent: v })} parse={(v) => parseShare(v)} suffix="%" disabled={readOnly} />}
                </div>
                <div className="col-span-1 flex justify-end"><IconButton label="Remove deduction" tone="danger" disabled={readOnly} onClick={() => setB((x) => ({ ...x, deductions: x.deductions.filter((y) => y.id !== d.id) }))}>✕</IconButton></div>
              </div>
            ))} />
            {!readOnly && <button type="button" className="mt-2 text-xs font-semibold text-sp-gold hover:underline" onClick={() => setB((x) => ({ ...x, deductions: [...x.deductions, blankDeduction()] }))}>+ Add deduction</button>}
            {r.feeDeductions.length > 0 && (
              <div className="mt-3 rounded-lg border border-white/5 p-2.5 text-xs text-sp-textSecondary">
                <p className="mb-1 font-semibold uppercase tracking-wide">Company fees (from pay terms)</p>
                {r.feeDeductions.map((f) => (
                  <div key={f.id} className="flex justify-between"><span>{f.description} · {RESPONSIBILITY_LABEL[f.responsibility]}</span><span className="tabular-nums">{money(f.amount).format()}</span></div>
                ))}
              </div>
            )}
          </Card>

          {/* ---------------- Audit ---------------- */}
          <Card title="Audit trail" description="Every change, who made it, and when — from the web and the iPhone.">
            {props.auditTrail.length === 0 ? <p className="text-sm text-sp-textSecondary">No changes recorded yet.</p> : (
              <ol className="space-y-2 text-sm">
                {props.auditTrail.map((e) => (
                  <li key={e.id} className="flex flex-col gap-0.5 border-l-2 border-sp-gold/30 pl-3">
                    <span className="text-sp-textPrimary">{e.summary}</span>
                    <span className="text-[11px] text-sp-textSecondary">{new Date(e.timestamp).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" })}{e.actor_name ? ` · ${e.actor_name}` : ""}</span>
                  </li>
                ))}
              </ol>
            )}
          </Card>
        </div>

        {/* ---------------- Summary + actions (sticky) ---------------- */}
        <aside className="space-y-4 lg:sticky lg:top-4 lg:self-start">
          <div className="rounded-2xl border border-sp-gold/20 bg-sp-card p-4">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-sp-textSecondary">Net driver pay</p>
            <p className={"mt-1 text-3xl font-bold tabular-nums " + (r.netDriverPay.isNegative() ? "text-red-300" : "text-sp-gold")}>{r.netDriverPay.format()}</p>
            <dl className="mt-3 space-y-1.5 text-sm">
              <SumRow label="Gross load revenue" value={r.grossLoadRevenue.format()} />
              <SumRow label="Driver earnings" value={r.driverBaseEarnings.format()} />
              <SumRow label="+ Additions" value={r.totalAdditions.format()} />
              <SumRow label="− Driver deductions" value={r.totalDriverDeductions.format()} />
              <div className="my-2 border-t border-white/10" />
              <SumRow label="Company expenses" value={r.companyExpenses.format()} muted />
              <SumRow label="Company retained" value={r.companyRetained.format()} muted />
              <SumRow label="Total miles" value={r.totalMiles.toFixed()} muted />
              <SumRow label="Revenue / mile" value={r.totalMiles.gt(0) ? `$${r.revenuePerMile.amount.toFixed(3)}` : "—"} muted />
            </dl>
            <details className="mt-3 text-xs text-sp-textSecondary">
              <summary className="cursor-pointer select-none">Statement lines ({r.lineItems.length})</summary>
              <ul className="mt-2 space-y-1">
                {r.lineItems.map((li) => (
                  <li key={li.id + li.kind} className="flex justify-between gap-2">
                    <span className="min-w-0 truncate" title={li.basis}>{li.label} <span className="opacity-60">· {li.basis}</span></span>
                    <span className="shrink-0 tabular-nums">{li.kind === "driverDeduction" || li.kind === "companyExpense" ? "−" : "+"}{li.amount.abs().format()}</span>
                  </li>
                ))}
              </ul>
            </details>
          </div>

          <Issues issues={issues} warnings={r.warnings} />

          {!readOnly && (
            <div className="rounded-2xl border border-white/10 bg-sp-card p-4">
              {message && <Msg m={message} />}
              <p data-testid="autosave-status" aria-live="polite" className="mb-2 text-[11px] text-sp-textSecondary">
                {conflict ? "Autosave paused — reload to continue."
                  : saving ? "Saving…"
                  : dirty && fieldErrors > 0 ? "Not saved yet — fix the field below. Kept in this browser meanwhile."
                  : dirty ? "Autosave on · saving shortly…"
                  : savedAt ? `Autosave on · all changes saved ${savedAt.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}`
                  : "Autosave on · you can leave and come back any time."}
              </p>
              <button type="button" onClick={save} disabled={!dirty || saving || fieldErrors > 0 || conflict}
                className="w-full rounded-md bg-sp-gold px-4 py-2 text-sm font-semibold text-sp-black hover:bg-sp-goldLight disabled:opacity-50">
                {saving ? "Saving…" : dirty ? "Save now" : "All changes saved"}
              </button>
              {fieldErrors > 0 && (
                <div className="mt-1 text-[11px] text-red-300">
                  <p>Fix {fieldErrors} field{fieldErrors === 1 ? "" : "s"} to save:</p>
                  <ul className="list-disc pl-4">{gate.errors.slice(0, 4).map((e) => <li key={e}>{e}</li>)}</ul>
                </div>
              )}
            </div>
          )}
          {readOnly && message && <Msg m={message} />}

          {canEdit && !initial.header.isEstimate && (
            <StatusActions id={initial.header.id} status={status} dirty={dirty || saving} updatedAt={version}
              blockers={issues.filter((i) => i.severity === "error").length}
              onDone={(m) => { setMessage(m); router.refresh(); }} />
          )}
        </aside>
      </div>
    </div>
  );
}

// =============================================================================
//  Pieces
// =============================================================================

function Card({ title, description, children }: { title: string; description?: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-white/[0.06] bg-sp-card/80">
      <header className="border-b border-white/[0.06] px-4 py-3 sm:px-5">
        <h2 className="text-sm font-semibold text-sp-textPrimary">{title}</h2>
        {description && <p className="mt-0.5 text-xs text-sp-textSecondary">{description}</p>}
      </header>
      <div className="px-4 py-4 sm:px-5">{children}</div>
    </section>
  );
}

function LineTable({ rows, empty }: { rows: React.ReactNode[]; empty: string }) {
  if (rows.length === 0) return <p className="text-sm text-sp-textSecondary">{empty}</p>;
  return <div className="divide-y divide-white/5">{rows}</div>;
}

function SumRow({ label, value, muted }: { label: string; value: string; muted?: boolean }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className={muted ? "text-sp-textSecondary" : "text-sp-textPrimary"}>{label}</dt>
      <dd className={"tabular-nums " + (muted ? "text-sp-textSecondary" : "text-sp-textPrimary")}>{value}</dd>
    </div>
  );
}

function Msg({ m }: { m: { tone: "ok" | "err"; text: string; list?: string[] } }) {
  return (
    <div role="status" className={"mb-3 rounded-md px-3 py-2 text-xs " + (m.tone === "ok" ? "border border-sp-success/40 bg-sp-success/10 text-emerald-200" : "border border-sp-danger/40 bg-sp-danger/10 text-red-200")}>
      {m.text}
      {m.list && m.list.length > 1 && <ul className="mt-1 list-disc pl-4">{m.list.slice(1, 6).map((x) => <li key={x}>{x}</li>)}</ul>}
    </div>
  );
}

function Issues({ issues, warnings }: { issues: Issue[]; warnings: string[] }) {
  const errs = issues.filter((i) => i.severity === "error");
  const warns = [...new Set([...issues.filter((i) => i.severity === "warning").map((i) => i.message), ...warnings])];
  if (errs.length === 0 && warns.length === 0) return null;
  return (
    <div className="space-y-2 text-xs">
      {errs.length > 0 && (
        <div className="rounded-lg border border-sp-danger/40 bg-sp-danger/10 p-3 text-red-200">
          <p className="mb-1 font-semibold">Must fix before finalizing</p>
          <ul className="list-disc space-y-0.5 pl-4">{errs.map((e) => <li key={e.code + e.message}>{e.message}</li>)}</ul>
        </div>
      )}
      {warns.length > 0 && (
        <div className="rounded-lg border border-sp-warning/40 bg-sp-warning/10 p-3 text-orange-200">
          <ul className="list-disc space-y-0.5 pl-4">{warns.map((w) => <li key={w}>{w}</li>)}</ul>
        </div>
      )}
    </div>
  );
}

function LoadRowView({ l, open, readOnly, earn, basis, onToggle, onChange, onRemove, stored }: {
  stored: Set<string>;
  l: LoadLine; open: boolean; readOnly: boolean; earn: string; basis: string;
  onToggle: () => void; onChange: (p: Partial<LoadLine>) => void; onRemove: () => void;
}) {
  const g = lineGross(l);
  const m = (key: keyof LoadLine, label: string) => (
    <div>
      <Label>{label}</Label>
      <NumField ariaLabel={label} value={(l[key] as string) ?? ""} onChange={(v) => onChange({ [key]: v } as Partial<LoadLine>)} parse={(v) => parseMoney(v, label, { allowNegative: l.isAdjustment })} prefix="$" disabled={readOnly} />
    </div>
  );
  return (
    <>
      <tr className="align-top">
        <td className="py-2 pr-2 font-medium text-sp-textPrimary">#{l.loadNumber ?? "—"}{l.isAdjustment && <span className="ml-1 text-[10px] text-orange-300">ADJ</span>}</td>
        <td className="py-2 pr-2 text-sp-textSecondary">{l.deliveryDate ?? l.pickupDate ?? "—"}</td>
        <td className="py-2 pr-2 text-sp-textSecondary">{[l.origin, l.destination].filter(Boolean).join(" → ") || "—"}</td>
        <td className="py-2 pr-2 text-right tabular-nums">{g.format()}</td>
        <td className="py-2 pr-2 text-right tabular-nums text-sp-textSecondary">{l.loadedMiles}</td>
        <td className="py-2 pr-2 text-right tabular-nums text-sp-gold" title={basis}>{earn}</td>
        <td className="py-2 text-right whitespace-nowrap">
          <button type="button" onClick={onToggle} className="rounded-md border border-white/10 px-2 py-1 text-[11px] text-sp-textPrimary hover:bg-white/5">{open ? "Close" : readOnly ? "View" : "Edit"}</button>
          {!readOnly && <span className="ml-1 inline-block align-middle"><IconButton label="Remove load" tone="danger" onClick={onRemove}>✕</IconButton></span>}
        </td>
      </tr>
      {open && (
        <tr>
          <td colSpan={7} className="pb-4">
            <div className="grid grid-cols-2 gap-3 rounded-lg border border-white/5 bg-black/10 p-3 md:grid-cols-4">
              <div><Label>Load #</Label><TextField ariaLabel="Load number" value={l.loadNumber ?? ""} onChange={(v) => onChange({ loadNumber: v })} disabled={readOnly} /></div>
              <div><Label>Pickup</Label><TextField type="date" ariaLabel="Pickup date" value={l.pickupDate ?? ""} onChange={(v) => onChange({ pickupDate: v || null })} disabled={readOnly} /></div>
              <div><Label>Delivered</Label><TextField type="date" ariaLabel="Delivery date" value={l.deliveryDate ?? ""} onChange={(v) => onChange({ deliveryDate: v || null })} disabled={readOnly} /></div>
              <div><Label>Broker</Label><TextField ariaLabel="Broker" value={l.brokerName ?? ""} onChange={(v) => onChange({ brokerName: v })} disabled={readOnly} /></div>
              <div><Label>Origin</Label><TextField ariaLabel="Origin" value={l.origin ?? ""} onChange={(v) => onChange({ origin: v })} disabled={readOnly} /></div>
              <div><Label>Destination</Label><TextField ariaLabel="Destination" value={l.destination ?? ""} onChange={(v) => onChange({ destination: v })} disabled={readOnly} /></div>
              <div><Label>Loaded miles</Label><NumField ariaLabel="Loaded miles" value={l.loadedMiles} onChange={(v) => onChange({ loadedMiles: v })} parse={(v) => parseMiles(v, "Loaded miles")} disabled={readOnly} /></div>
              <div><Label>Deadhead miles</Label><NumField ariaLabel="Deadhead miles" value={l.deadheadMiles} onChange={(v) => onChange({ deadheadMiles: v })} parse={(v) => parseMiles(v, "Deadhead miles")} disabled={readOnly} /></div>
              {m("linehaul", "Linehaul")}
              {m("fuelSurcharge", "Fuel surcharge")}
              {m("accessorials", "Accessorials")}
              {m("detention", "Detention")}
              {m("layover", "Layover")}
              {m("tonu", "TONU")}
              {m("lumperReimbursement", "Lumper")}
              <div>
                <Label>Gross override</Label>
                <NumField ariaLabel="Gross override" value={l.grossRateOverride ?? ""} placeholder="Use components"
                  onChange={(v) => onChange({ grossRateOverride: v === "" ? null : v })}
                  parse={(v) => parseMoney(v, "Gross override", { allowEmpty: true, allowNegative: l.isAdjustment })} prefix="$" disabled={readOnly} />
              </div>
              <div className="col-span-2 md:col-span-4">
                <Label>Pay for this load</Label>
                {l.payRuleOverride ? (
                  <>
                    <PayRuleEditor rule={l.payRuleOverride} onChange={(nr) => onChange({ payRuleOverride: nr })} disabled={readOnly} showFees={false} compact storedPercents={stored} />
                    {!readOnly && <button type="button" onClick={() => onChange({ payRuleOverride: null })} className="mt-1 text-xs text-sp-textSecondary hover:underline">Use the settlement pay rule</button>}
                  </>
                ) : (
                  <p className="text-xs text-sp-textSecondary">Settlement pay rule · {basis || "—"}{!readOnly && <> · <button type="button" className="text-sp-gold hover:underline" onClick={() => onChange({ payRuleOverride: { components: [], feeTerms: null } })}>Custom pay for this load</button></>}</p>
                )}
              </div>
              <div className="col-span-2 md:col-span-4"><Label>Notes</Label><TextField ariaLabel="Load notes" value={l.notes ?? ""} onChange={(v) => onChange({ notes: v })} disabled={readOnly} /></div>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

function StatusActions({ id, status, dirty, updatedAt, blockers, onDone }: {
  id: string; status: SettlementStatus; dirty: boolean; updatedAt: string | null; blockers: number;
  onDone: (m: { tone: "ok" | "err"; text: string; list?: string[] }) => void;
}) {
  const [pending, start] = useTransition();
  const [mode, setMode] = useState<null | "paid" | "reopen" | "void">(null);
  const [reason, setReason] = useState("");
  const [method, setMethod] = useState("ACH");
  const [ref, setRef] = useState("");

  const go = (target: SettlementStatus, extra: { reason?: string; paymentMethod?: string; paymentReference?: string } = {}) =>
    start(async () => {
      const res = await transitionSettlementAction(id, { target, expectedUpdatedAt: updatedAt, ...extra });
      if (!res.ok) onDone({ tone: "err", text: res.error, list: res.errors });
      else { setMode(null); setReason(""); onDone({ tone: "ok", text: `Settlement is now ${STATUS_LABEL[target]}.` }); }
    });

  const btn = "w-full rounded-md px-3 py-2 text-sm font-semibold disabled:opacity-50";
  const reopenTarget: SettlementStatus | null = status === "approved" ? "draft" : status === "paid" ? "approved" : status === "voided" ? "draft" : null;

  return (
    <div className="space-y-2 rounded-2xl border border-white/10 bg-sp-card p-4">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-sp-textSecondary">Status</p>
      {dirty && <p className="text-[11px] text-orange-200">Saving your changes — status actions unlock once they’re saved.</p>}
      {(status === "draft" || status === "ready_for_review") && (
        <>
          <button type="button" disabled={pending || dirty || blockers > 0} onClick={() => go("approved")} className={btn + " bg-sp-gold text-sp-black hover:bg-sp-goldLight"}>
            Finalize (approve)
          </button>
          {blockers > 0 && <p className="text-[11px] text-red-300">Fix the {blockers} issue{blockers === 1 ? "" : "s"} above to finalize.</p>}
          <button type="button" disabled={pending || dirty} onClick={() => go(status === "draft" ? "ready_for_review" : "draft")} className={btn + " border border-white/10 text-sp-textPrimary hover:bg-white/5"}>
            {status === "draft" ? "Mark ready for review" : "Back to draft"}
          </button>
        </>
      )}
      {status === "approved" && (
        <button type="button" disabled={pending || dirty} onClick={() => setMode(mode === "paid" ? null : "paid")} className={btn + " bg-sp-success/90 text-white hover:bg-sp-success"}>Mark paid…</button>
      )}
      {mode === "paid" && (
        <div className="space-y-2 rounded-lg border border-white/10 p-2.5">
          <select aria-label="Payment method" value={method} onChange={(e) => setMethod(e.target.value)} className={inputCls}>
            {["ACH", "Direct deposit", "Check", "Zelle", "Cash", "Other"].map((m) => <option key={m}>{m}</option>)}
          </select>
          <input aria-label="Payment reference" placeholder="Reference / check # (optional)" value={ref} onChange={(e) => setRef(e.target.value)} className={inputCls} />
          <button type="button" disabled={pending} onClick={() => go("paid", { paymentMethod: method, paymentReference: ref })} className={btn + " bg-sp-success/90 text-white"}>Confirm paid</button>
        </div>
      )}
      {reopenTarget && (
        <button type="button" disabled={pending || dirty} onClick={() => setMode(mode === "reopen" ? null : "reopen")} className={btn + " border border-sp-gold/40 text-sp-goldLight hover:bg-sp-gold/10"}>
          Reopen{status === "paid" ? " (back to approved)" : " to edit"}…
        </button>
      )}
      {status !== "voided" && (
        <button type="button" disabled={pending || dirty} onClick={() => setMode(mode === "void" ? null : "void")} className={btn + " border border-sp-danger/40 text-red-300 hover:bg-sp-danger/10"}>Void…</button>
      )}
      {(mode === "reopen" || mode === "void") && (
        <div className="space-y-2 rounded-lg border border-white/10 p-2.5">
          <textarea aria-label="Reason" rows={2} placeholder={mode === "void" ? "Why is this settlement being voided?" : "Why does this settlement need to change?"} value={reason} onChange={(e) => setReason(e.target.value)} className={inputCls} />
          <button type="button" disabled={pending || (!reason.trim() && (mode === "reopen" || status === "approved" || status === "paid"))}
            onClick={() => go(mode === "void" ? "voided" : reopenTarget!, { reason })}
            className={btn + (mode === "void" ? " bg-sp-danger text-white" : " bg-sp-gold text-sp-black")}>
            {pending ? "Working…" : mode === "void" ? "Confirm void" : "Confirm reopen"}
          </button>
          <p className="text-[11px] text-sp-textSecondary">Recorded in the audit trail with your name and time.</p>
        </div>
      )}
      {pending && <p className="text-[11px] text-sp-textSecondary">Working…</p>}
    </div>
  );
}

// =============================================================================
//  Helpers
// =============================================================================

function blankLine(id: string): LoadLine {
  return {
    id, loadId: null, loadNumber: "", brokerName: null, brokerMcNumber: null, pickupDate: null, deliveryDate: null,
    origin: null, destination: null, loadedMiles: "0", deadheadMiles: "0", linehaul: "0.00", fuelSurcharge: "0.00",
    accessorials: "0.00", detention: "0.00", layover: "0.00", tonu: "0.00", lumperReimbursement: "0.00",
    grossRateOverride: null, payRuleOverride: null, hoursWorked: null, driverEarnings: "0", payBasisDescription: "",
    notes: null, isAdjustment: false, correctsSettlementId: null, sortOrder: 0,
    rateConfirmationDocumentId: null, proofOfDeliveryDocumentId: null, createdAt: null,
  };
}

function blankAddition(): Addition {
  return { id: cryptoId(), category: "bonus", customCategoryId: null, description: ADDITION_CATEGORY_LABEL.bonus, amount: "0.00", date: null, relatedLoadId: null, documentId: null, notes: null, sortOrder: 0, createdAt: null };
}

function blankDeduction(): Deduction {
  return { id: cryptoId(), category: "other", customCategoryId: null, description: "", amount: "0.00", date: null, relatedLoadId: null, relatedExpenseId: null, documentId: null, notes: null, responsibility: "driver", driverSharePercent: "100", recurringDeductionId: null, advanceId: null, sortOrder: 0, createdAt: null };
}

/** A description that is just a category name may be replaced when the category changes. */
function isAutoDescription(desc: string, customs: CustomCategory[]): boolean {
  const all = new Set<string>([
    ...Object.values(ADDITION_CATEGORY_LABEL), ...Object.values(DEDUCTION_CATEGORY_LABEL), ...customs.map((c) => c.name),
  ]);
  return all.has(desc);
}

function toPayload(b: SettlementBundle): EditPayload {
  return {
    header: {
      periodStart: b.header.periodStart ?? "", periodEnd: b.header.periodEnd ?? "",
      settlementNumber: b.header.settlementNumber ?? "", settlementType: b.header.settlementType ?? "company_driver",
      truckNumber: b.header.truckNumber ?? "", payRule: b.header.payRule, payOnGrossRevenue: b.header.payOnGrossRevenue !== false,
      hoursWorked: b.header.hoursWorked ?? "", notes: b.header.notes ?? "",
    },
    loadLines: b.loadLines, additions: b.additions, deductions: b.deductions,
  };
}

const AUTOSAVE_DELAY_MS = 2500;

interface LocalBackup { base: string | null; at: number; bundle: SettlementBundle; stale?: boolean }

/** The payload as the server now holds it: new lines under their stored ids. */
function remapPayload(p: EditPayload, map: Record<string, string>): EditPayload {
  const re = <T extends { id: string }>(xs: T[]) => xs.map((x) => (map[x.id] ? { ...x, id: map[x.id] } : x));
  return { ...p, loadLines: re(p.loadLines), additions: re(p.additions), deductions: re(p.deductions) };
}
