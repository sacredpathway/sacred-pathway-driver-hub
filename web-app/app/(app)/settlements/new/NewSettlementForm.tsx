"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { money } from "@/lib/settlements/model";
import { parseHours } from "@/lib/settlements/input";
import { createSettlementAndOpenAction, previewEligibleLoadsAction, type PickerLoad } from "../actions";

const field = "w-full rounded-lg bg-sp-cardLight px-3 py-2 text-sm text-sp-textPrimary outline-none ring-1 ring-white/5 focus:ring-sp-gold";
const lab = "mb-1 block text-[11px] font-semibold uppercase tracking-wide text-sp-textSecondary";

/** Last full Monday–Sunday week, local time. */
function localToday(): string {
  const x = new Date();
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}-${String(x.getDate()).padStart(2, "0")}`;
}

function lastWeek(): { start: string; end: string } {
  const d = new Date();
  const dow = (d.getDay() + 6) % 7; // Mon=0
  const end = new Date(d.getFullYear(), d.getMonth(), d.getDate() - dow - 1);
  const start = new Date(end.getFullYear(), end.getMonth(), end.getDate() - 6);
  const f = (x: Date) => `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}-${String(x.getDate()).padStart(2, "0")}`;
  return { start: f(start), end: f(end) };
}

export default function NewSettlementForm({ drivers, initialDriverId }: { drivers: Array<{ id: string; name: string }>; initialDriverId: string }) {
  const lw = useMemo(lastWeek, []);
  const [driverId, setDriverId] = useState(initialDriverId);
  const [start, setStart] = useState(lw.start);
  const [end, setEnd] = useState(lw.end);
  const [hours, setHours] = useState("");
  const [applyRecurring, setApplyRecurring] = useState(true);
  const [loads, setLoads] = useState<PickerLoad[] | null>(null);
  const [rule, setRule] = useState("");
  const [hasRecurring, setHasRecurring] = useState(false);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [loading, startLoad] = useTransition();
  const [creating, startCreate] = useTransition();

  useEffect(() => {
    if (!driverId || !start || !end || end < start) { setLoads([]); return; }
    startLoad(async () => {
      const r = await previewEligibleLoadsAction(driverId, start, end, localToday());
      if (!r.ok) { setError(r.error); setLoads([]); return; }
      setError(null);
      setLoads(r.loads);
      setRule(r.payRuleSummary);
      setHasRecurring(r.hasRecurring);
      setPicked(new Set(r.loads.filter((l) => l.completed && !l.alreadyPaidOn).map((l) => l.id)));
    });
  }, [driverId, start, end]);

  const chosen = (loads ?? []).filter((l) => picked.has(l.id));
  const gross = chosen.reduce((acc, l) => acc.plus(money(l.gross)), money("0"));
  const hoursOk = parseHours(hours, "Hours", { allowEmpty: true });

  const create = () => {
    setError(null);
    startCreate(async () => {
      const r = await createSettlementAndOpenAction({ driverId, periodStart: start, periodEnd: end, loadIds: chosen.map((l) => l.id), applyRecurring, hoursWorked: hours, clientToday: localToday() });
      if (r && !r.ok) setError(r.error);
    });
  };

  return (
    <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
      <div className="space-y-4 rounded-2xl border border-white/[0.06] bg-sp-card/80 p-4 sm:p-5">
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <div className="col-span-2">
            <label className={lab} htmlFor="drv">Driver</label>
            <select id="drv" value={driverId} onChange={(e) => setDriverId(e.target.value)} className={field}>
              {drivers.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
            {rule && <p className="mt-1 text-[11px] text-sp-textSecondary">Pay: {rule}</p>}
          </div>
          <div><label className={lab} htmlFor="ps">Period start</label><input id="ps" type="date" value={start} onChange={(e) => setStart(e.target.value)} className={field} /></div>
          <div><label className={lab} htmlFor="pe">Period end</label><input id="pe" type="date" value={end} onChange={(e) => setEnd(e.target.value)} className={field} /></div>
        </div>

        <div>
          <div className="mb-2 flex items-baseline justify-between">
            <h2 className="text-sm font-semibold text-sp-textPrimary">Loads delivered in this period</h2>
            {loads && loads.length > 0 && (
              <button type="button" className="text-xs text-sp-gold hover:underline" onClick={() => setPicked(new Set(loads.filter((l) => !l.alreadyPaidOn && l.completed).map((l) => l.id)))}>Select all payable</button>
            )}
          </div>
          {loading || loads === null ? <p className="text-sm text-sp-textSecondary">Loading loads…</p> : loads.length === 0 ? (
            <p className="text-sm text-sp-textSecondary">No loads for this driver in that period. You can still create the settlement and add lines manually.</p>
          ) : (
            <ul className="divide-y divide-white/5 rounded-lg border border-white/5">
              {loads.map((l) => {
                // iPhone rule: only delivered (completed) loads go on a settlement.
                const blocked = !!l.alreadyPaidOn || !l.completed;
                return (
                  <li key={l.id}>
                    <label className={"flex items-center gap-3 px-3 py-2 text-sm " + (blocked ? "opacity-50" : "cursor-pointer hover:bg-white/5")}>
                      <input type="checkbox" disabled={blocked} checked={picked.has(l.id)} onChange={(e) => {
                        const n = new Set(picked);
                        if (e.target.checked) n.add(l.id); else n.delete(l.id);
                        setPicked(n);
                      }} className="h-4 w-4 accent-[#D4AF37]" />
                      <span className="w-24 shrink-0 font-medium">#{l.loadNumber ?? "—"}</span>
                      <span className="w-24 shrink-0 text-sp-textSecondary">{l.date ?? "—"}</span>
                      <span className="min-w-0 flex-1 truncate text-sp-textSecondary">{l.route || "—"}</span>
                      <span className="shrink-0 tabular-nums">{money(l.gross).format()}</span>
                      {blocked ? <span className="shrink-0 text-[11px] text-orange-300">Paid on {l.alreadyPaidOn}</span>
                        : !l.completed ? <span className="shrink-0 text-[11px] text-sky-300" title="Delivery date is after today. It can be paid once delivered.">Not delivered yet</span> : null}
                    </label>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <label className={lab} htmlFor="hrs">Hours worked (only for hourly pay)</label>
            <input id="hrs" inputMode="decimal" value={hours} onChange={(e) => setHours(e.target.value)} className={field + (hoursOk.ok ? "" : " ring-sp-danger")} />
            {!hoursOk.ok && <p className="mt-0.5 text-[11px] text-red-300">{hoursOk.error}</p>}
          </div>
          {hasRecurring && (
            <label className="flex items-center gap-2 self-end pb-2 text-sm text-sp-textPrimary">
              <input type="checkbox" checked={applyRecurring} onChange={(e) => setApplyRecurring(e.target.checked)} className="h-4 w-4 accent-[#D4AF37]" />
              Apply this driver’s recurring deductions
            </label>
          )}
        </div>
      </div>

      <aside className="space-y-3 lg:sticky lg:top-4 lg:self-start">
        <div className="rounded-2xl border border-sp-gold/20 bg-sp-card p-4">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-sp-textSecondary">Selected</p>
          <p className="mt-1 text-2xl font-bold tabular-nums text-sp-gold">{gross.format()}</p>
          <p className="text-xs text-sp-textSecondary">{chosen.length} load{chosen.length === 1 ? "" : "s"} · gross revenue</p>
          {error && <p className="mt-3 rounded-md border border-sp-danger/40 bg-sp-danger/10 px-3 py-2 text-xs text-red-200">{error}</p>}
          <button type="button" onClick={create} disabled={creating || !hoursOk.ok || !driverId || end < start}
            className="mt-4 w-full rounded-md bg-sp-gold px-4 py-2 text-sm font-semibold text-sp-black hover:bg-sp-goldLight disabled:opacity-50">
            {creating ? "Creating…" : "Create draft settlement"}
          </button>
          <p className="mt-2 text-[11px] text-sp-textSecondary">Saved as a draft. Nothing is paid until you finalize and mark it paid.</p>
        </div>
      </aside>
    </div>
  );
}
