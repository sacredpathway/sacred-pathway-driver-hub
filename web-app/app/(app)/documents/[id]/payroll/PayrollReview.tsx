"use client";

// =============================================================================
//  Smart Payroll Upload — review & confirm (client)
//  Every choice is sent back to the server, which rebuilds the proposal from
//  fresh reads; the browser never decides what is payable.
// =============================================================================

import { useState, useTransition } from "react";
import Link from "next/link";
import type { PayrollProposal, ProposalDecisions, FieldRow } from "@/lib/payrollUpload/proposal";
import { GATE_MESSAGE, type ConfirmGate } from "@/lib/payrollUpload/featureFlag";
import { confirmPayrollDraftAction, refreshPayrollProposalAction } from "./actions";

export interface PayrollReviewProps {
  documentId: string;
  initial: PayrollProposal;
  previewUrl: string | null;
  previewMime: string | null;
  gate: ConfirmGate;
}

const STATUS_TEXT: Record<PayrollProposal["status"], string> = {
  ready: "Ready to prepare a draft",
  needs_input: "Your review is needed",
  blocked: "Can't become payroll yet",
  reference_only: "Reference only",
  supporting_document: "Supporting paperwork",
  not_payroll: "Not a payroll document",
};

const COMPARE_TEXT: Record<FieldRow["compare"], string> = {
  match: "Matches", conflict: "Differs", document_only: "Only on document", record_only: "Only on your record", not_compared: "—",
};

const EVIDENCE_TEXT: Record<FieldRow["evidence"], string> = {
  value_in_source: "Found in quoted text",
  value_not_in_source: "Not found in quoted text — check",
  no_source: "No quoted text — check",
  corrected_by_owner: "Corrected by you",
  missing: "Not on the document",
};

function show(kind: string, v: unknown): string {
  if (v === null || v === undefined || v === "") return "—";
  if (Array.isArray(v)) return v.join(", ");
  if (kind === "money" && typeof v === "number") return `$${v.toFixed(2)}`;
  if (kind === "money" && typeof v === "string" && /^-?\d+(\.\d+)?$/.test(v)) return `$${Number(v).toFixed(2)}`;
  if (typeof v === "boolean") return v ? "Yes" : "No";
  return String(v);
}

function localToday(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export default function PayrollReview({ documentId, initial, previewUrl, previewMime, gate }: PayrollReviewProps) {
  const [p, setP] = useState(initial);
  const [decisions, setDecisions] = useState<ProposalDecisions>({});
  const [editing, setEditing] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string; href?: string } | null>(null);
  const [pending, start] = useTransition();

  const update = (next: ProposalDecisions) => {
    setDecisions(next);
    start(async () => {
      const r = await refreshPayrollProposalAction(documentId, next, localToday());
      if (r.ok) setP(r.proposal);
      else setMessage({ kind: "error", text: r.error });
    });
  };
  const toggleAck = (key: string, on: boolean) => {
    const set = new Set(decisions.acknowledged ?? []);
    if (on) set.add(key); else set.delete(key);
    update({ ...decisions, acknowledged: [...set] });
  };
  const saveCorrection = (field: string) => {
    const value = (editing[field] ?? "").trim();
    const corrections = { ...(decisions.corrections ?? {}) };
    if (value === "") delete corrections[field];
    else corrections[field] = { value, note: "Corrected on review screen" };
    setEditing((e) => { const n = { ...e }; delete n[field]; return n; });
    update({ ...decisions, corrections });
  };
  const confirm = () => {
    setMessage(null);
    start(async () => {
      const r = await confirmPayrollDraftAction(documentId, decisions, localToday());
      if (r.ok) {
        const text = r.recovered
          ? "An earlier confirmation was interrupted after its draft was saved. The document is now linked to that draft (no second draft was made). Review it before finalizing."
          : r.created ? "Draft settlement created. Review it before finalizing." : "Load added to the draft settlement.";
        setMessage({ kind: "ok", text, href: `/settlements/${r.settlementId}` });
      }
      else { setMessage({ kind: "error", text: r.error }); if (r.proposal) setP(r.proposal); }
    });
  };

  const isReference = p.status === "reference_only" || p.status === "supporting_document" || p.status === "not_payroll";
  const target = decisions.target ?? null;
  const confirmLabel = p.plan?.kind === "add_to_draft" ? "Add load to draft" : "Prepare draft settlement";

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
      <section aria-label="Original document" className="rounded-xl border border-sp-border bg-sp-card p-3">
        <h2 className="mb-2 text-sm font-semibold text-sp-textPrimary">Original document</h2>
        {previewUrl ? (
          previewMime === "application/pdf"
            ? <iframe src={previewUrl} title="Original document" className="h-[70vh] w-full rounded" />
            // eslint-disable-next-line @next/next/no-img-element
            : <img src={previewUrl} alt="Original document" className="w-full rounded" />
        ) : <p className="text-sm text-sp-textSecondary">Preview unavailable.</p>}
        {previewUrl && <a href={previewUrl} target="_blank" rel="noreferrer" className="mt-2 inline-block text-sm text-sp-gold hover:underline">Open original</a>}
      </section>

      <div className="space-y-5">
        <div className="rounded-xl border border-sp-border bg-sp-card p-4">
          <p className="text-xs uppercase tracking-wide text-sp-textSecondary">Status</p>
          <p data-testid="proposal-status" className="text-lg font-semibold text-sp-textPrimary">{STATUS_TEXT[p.status]}</p>
          {p.extraction && <p className="text-sm text-sp-textSecondary">Read as: {p.extraction.document_type.replace(/_/g, " ")} · model confidence: {p.extraction.model_confidence ?? "not given"}</p>}
          {isReference && (
            <p data-testid="reference-banner" className="mt-2 rounded border border-sp-border p-2 text-sm text-sp-textSecondary">
              This document is kept for reference and comparison only. It is never turned into payroll lines{p.policy?.reasons.length ? ` (${p.policy.reasons.join(", ").replace(/_/g, " ")})` : ""}.
            </p>
          )}
          <p data-testid="gate-banner" className="mt-2 text-xs text-sp-textSecondary">{GATE_MESSAGE[gate.reason]}</p>
        </div>

        {p.blockers.length > 0 && (
          <div data-testid="blockers" className="rounded-xl border border-red-500/40 bg-red-500/5 p-4">
            <h2 className="text-sm font-semibold text-red-300">Needs fixing first</h2>
            <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-sp-textPrimary">
              {p.blockers.map((b, i) => <li key={`${b.code}-${i}`}>{b.message}</li>)}
            </ul>
          </div>
        )}

        <section aria-label="Extracted fields" className="rounded-xl border border-sp-border bg-sp-card p-4">
          <h2 className="mb-2 text-sm font-semibold text-sp-textPrimary">What the document says</h2>
          {p.missingFields.length > 0 && <p data-testid="missing" className="mb-2 text-sm text-amber-300">Missing on the document: {p.missingFields.join(", ").replace(/_/g, " ")}</p>}
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-xs uppercase text-sp-textSecondary">
                <tr><th className="py-1 pr-3">Field</th><th className="py-1 pr-3">On the document</th><th className="py-1 pr-3">Evidence</th><th className="py-1 pr-3">Your load record</th><th className="py-1">Compare</th></tr>
              </thead>
              <tbody>
                {p.fields.map((f) => (
                  <tr key={f.field} data-field={f.field} data-compare={f.compare} className="border-t border-sp-border align-top">
                    <td className="py-2 pr-3 font-medium text-sp-textPrimary">{f.label}</td>
                    <td className="py-2 pr-3">
                      <span>{show(f.kind, f.extracted)}</span>
                      {f.readAs !== undefined && <span className="block text-xs text-sp-textSecondary">read as {show(f.kind, f.readAs)}</span>}
                      {editing[f.field] !== undefined ? (
                        <span className="mt-1 flex gap-1">
                          <input aria-label={`Correct ${f.label}`} value={editing[f.field]} onChange={(e) => setEditing({ ...editing, [f.field]: e.target.value })} className="w-32 rounded border border-sp-border bg-transparent px-1 text-sm" />
                          <button type="button" onClick={() => saveCorrection(f.field)} className="text-xs text-sp-gold">Save</button>
                        </span>
                      ) : (
                        !isReference && <button type="button" onClick={() => setEditing({ ...editing, [f.field]: f.extracted === null ? "" : String(f.extracted) })} className="block text-xs text-sp-gold hover:underline">Correct misread</button>
                      )}
                    </td>
                    <td className="py-2 pr-3 text-xs text-sp-textSecondary">
                      {f.page !== null && <span className="block">Page {f.page}</span>}
                      {f.sourceText && <q className="block italic">{f.sourceText}</q>}
                      <span className="block">{EVIDENCE_TEXT[f.evidence]}</span>
                      <span className="block">Model confidence: {f.modelConfidence ?? "not given"}</span>
                    </td>
                    <td className="py-2 pr-3">{show(f.kind, f.stored)}</td>
                    <td className={`py-2 ${f.compare === "conflict" ? "text-amber-300" : "text-sp-textSecondary"}`}>{COMPARE_TEXT[f.compare]}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        {p.extraction && p.extraction.line_items.length > 0 && (
          <section aria-label="Statement lines" className="rounded-xl border border-sp-border bg-sp-card p-4">
            <h2 className="mb-2 text-sm font-semibold text-sp-textPrimary">Statement lines (reference only)</h2>
            <ul className="space-y-1 text-sm">
              {p.extraction.line_items.map((li, i) => (
                <li key={i} className="flex justify-between gap-3"><span>{li.kind} · {li.description ?? li.load_number ?? "—"}{li.page ? ` · p.${li.page}` : ""}</span><span>${li.amount.toFixed(2)}</span></li>
              ))}
            </ul>
          </section>
        )}

        {!isReference && (
          <section aria-label="Draft" className="space-y-3 rounded-xl border border-sp-border bg-sp-card p-4">
            <h2 className="text-sm font-semibold text-sp-textPrimary">Draft line</h2>
            {p.load.candidates.length > 1 && (
              <fieldset>
                <legend className="text-sm text-sp-textSecondary">Several of your loads carry this number. Choose one:</legend>
                {p.load.candidates.map((l) => (
                  <label key={l.id} className="mt-1 flex items-center gap-2 text-sm">
                    <input type="radio" name="load" checked={decisions.loadId === l.id} onChange={() => update({ ...decisions, loadId: l.id })} />
                    {l.load_number} · {l.broker_name ?? "—"} · {l.delivery_date ?? l.pickup_date ?? "no date"}
                  </label>
                ))}
              </fieldset>
            )}
            {p.load.selected && (
              <p className="text-sm text-sp-textPrimary">
                Load <Link href={`/loads/${p.load.selected.id}`} className="text-sp-gold hover:underline">{p.load.selected.load_number}</Link>
                {p.driver.selected ? ` · driver ${p.driver.selected.name}` : ""}
                {p.load.draftLineGross ? ` · draft line gross $${p.load.draftLineGross} (from your load record)` : ""}
              </p>
            )}
            {p.load.selected && p.driver.selected && (
              <fieldset className="space-y-1">
                <legend className="text-sm text-sp-textSecondary">Put it on</legend>
                {p.target.options.map((s) => (
                  <label key={s.id} className="flex items-center gap-2 text-sm">
                    <input type="radio" name="target" checked={target?.kind === "existing_draft" && target.settlementId === s.id} onChange={() => update({ ...decisions, target: { kind: "existing_draft", settlementId: s.id } })} />
                    Draft {s.settlement_number ?? s.id.slice(0, 8)} ({s.period_start?.slice(0, 10)} – {s.period_end?.slice(0, 10)})
                  </label>
                ))}
                <label className="flex items-center gap-2 text-sm">
                  <input type="radio" name="target" checked={target?.kind === "new_draft"} onChange={() => update({ ...decisions, target: { kind: "new_draft", periodStart: "", periodEnd: "", applyRecurring: true } })} />
                  A new draft settlement
                </label>
                {target?.kind === "new_draft" && (
                  <div className="flex flex-wrap items-center gap-2 pl-6 text-sm">
                    <input aria-label="Period start" type="date" value={target.periodStart} onChange={(e) => update({ ...decisions, target: { ...target, periodStart: e.target.value } })} className="rounded border border-sp-border bg-transparent px-1" />
                    <span>to</span>
                    <input aria-label="Period end" type="date" value={target.periodEnd} onChange={(e) => update({ ...decisions, target: { ...target, periodEnd: e.target.value } })} className="rounded border border-sp-border bg-transparent px-1" />
                    <label className="flex items-center gap-1"><input type="checkbox" checked={target.applyRecurring} onChange={(e) => update({ ...decisions, target: { ...target, applyRecurring: e.target.checked } })} /> Apply recurring deductions</label>
                  </div>
                )}
              </fieldset>
            )}
          </section>
        )}

        {p.warnings.length > 0 && (
          <section data-testid="warnings" aria-label="Please confirm" className="rounded-xl border border-amber-500/40 bg-amber-500/5 p-4">
            <h2 className="text-sm font-semibold text-amber-300">Please confirm</h2>
            {p.warnings.map((w) => (
              <label key={w.key} className="mt-2 flex items-start gap-2 text-sm text-sp-textPrimary">
                <input type="checkbox" disabled={isReference} checked={w.acknowledged} onChange={(e) => toggleAck(w.key, e.target.checked)} className="mt-1" />
                <span>{w.message}</span>
              </label>
            ))}
          </section>
        )}

        {message && (
          <p role="status" className={`rounded p-3 text-sm ${message.kind === "ok" ? "bg-emerald-500/10 text-emerald-300" : "bg-red-500/10 text-red-300"}`}>
            {message.text} {message.href && <Link href={message.href} className="underline">Open settlement</Link>}
          </p>
        )}

        {!isReference && (
          <div className="flex items-center gap-3">
            <button
              type="button"
              data-testid="confirm"
              onClick={confirm}
              disabled={!gate.enabled || !p.canConfirm || pending}
              className="rounded-lg bg-sp-gold px-4 py-2 text-sm font-semibold text-black disabled:cursor-not-allowed disabled:opacity-40"
            >
              {confirmLabel}
            </button>
            <span className="text-xs text-sp-textSecondary">Prepares a draft only. Finalizing and paying stay on the settlement screen.</span>
          </div>
        )}
      </div>
    </div>
  );
}
