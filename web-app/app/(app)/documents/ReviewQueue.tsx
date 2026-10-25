// =============================================================================
//  Review queue + recently filed — Documents page (client)
// -----------------------------------------------------------------------------
//  Shows what the AI READ (never presented as verified), why the document is
//  waiting, and what WOULD happen. Every consequential change is an explicit
//  button: Approve, Create load, Undo. "Save corrections" only re-proposes.
// =============================================================================

"use client";

import { useActionState } from "react";
import {
  approveDocumentAction,
  createLoadFromDocumentAction,
  dismissDocumentAction,
  retryDocumentAction,
  reviseDocumentAction,
  undoDocumentAction,
  type ReviewActionState,
} from "./actions";
import { CANONICAL_DOCUMENT_TYPES, documentTypeLabel } from "@/lib/documents/taxonomy";
import { REVIEW_REASON_TEXT, type AppliedAction, type ProposedAction, type RoutingRecord } from "@/lib/documents/types";

export interface ReviewItem {
  id: string;
  url: string | null;
  createdAt: string | null;
  status: string;
  errorMessage: string | null;
  duplicateOf: string | null;
  typeLabel: string;
  type: string;
  routing: RoutingRecord | null;
  /** AI-read values (sanitised) — shown as unverified. */
  aiFields: Record<string, string | number | boolean | string[]>;
  corrections: Record<string, string | number | boolean>;
  editableFields: string[];
  linkedLoadLabel: string | null;
  /** Driver printed on a rate con that exactly matches one of yours (owner confirms). */
  suggestedDriverId?: string | null;
}

export interface Option {
  id: string;
  label: string;
}

const input =
  "w-full rounded-md bg-sp-cardLight px-2 py-1.5 text-xs text-sp-textPrimary outline-none ring-1 ring-white/5 focus:ring-sp-gold";
const btn = "rounded-md px-3 py-1.5 text-xs font-semibold transition disabled:opacity-50";

function fieldLabel(k: string): string {
  return k.replace(/_/g, " ");
}

function show(v: unknown): string {
  if (v === undefined || v === null || v === "") return "—";
  if (Array.isArray(v)) return v.join(", ");
  if (typeof v === "boolean") return v ? "yes" : "no";
  return String(v);
}

function describeProposal(p: ProposedAction | null, loads: Option[], drivers: Option[]): string {
  if (!p) return "No action proposed — choose a load or driver, or dismiss.";
  switch (p.kind) {
    case "attach_load":
      return `Attach to load ${loads.find((l) => l.id === p.load_id)?.label ?? p.load_id.slice(0, 8)}.`;
    case "create_expense":
      return `Create ${p.expense.category} expense $${p.expense.amount.toFixed(2)}${p.expense.vendor_name ? ` · ${p.expense.vendor_name}` : ""} · ${p.expense.receipt_date}${p.expense.load_id ? ` on load ${loads.find((l) => l.id === p.expense.load_id)?.label ?? ""}` : " (no load)"}.`;
    case "attach_driver_document":
      return `File as ${documentTypeLabel(p.compliance.document_kind)} for ${drivers.find((d) => d.id === p.compliance.driver_id)?.label ?? "driver"}${p.compliance.expiration_date ? ` · expires ${p.compliance.expiration_date}` : ""}.`;
    case "create_load":
      return "No matching load. Create one below only if this load is real.";
  }
}

function Msg({ state }: { state: ReviewActionState }) {
  if (!state) return null;
  return <p className={`text-xs ${state.ok ? "text-sp-success" : "text-sp-danger"}`}>{state.message}</p>;
}

function ReviewCard({ item, loads, drivers }: { item: ReviewItem; loads: Option[]; drivers: Option[] }) {
  const [reviseState, revise, revising] = useActionState(reviseDocumentAction.bind(null, item.id), undefined);
  const [approveState, approve, approving] = useActionState(async () => approveDocumentAction(item.id), undefined);
  const [dismissState, dismiss, dismissing] = useActionState(async () => dismissDocumentAction(item.id), undefined);
  const [retryState, retry, retrying] = useActionState(async () => retryDocumentAction(item.id), undefined);
  const [createState, createLoad, creating] = useActionState(createLoadFromDocumentAction.bind(null, item.id), undefined);

  const r = item.routing;
  const notRead = item.status !== "processed";
  const proposal = r?.proposed ?? null;
  const isDriverDoc = ["cdl", "medical_card", "mvr"].includes(item.type);
  const ai = item.aiFields;
  const current = (k: string) => (item.corrections[k] ?? ai[k]) as unknown;

  return (
    <li className="space-y-3 rounded-xl border border-sp-warning/30 bg-sp-card p-4">
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <div className="space-x-2">
          <span className="text-sm font-semibold text-sp-textPrimary">{item.duplicateOf && notRead ? "Duplicate upload" : item.typeLabel}</span>
          {!notRead && (
            <span className="rounded bg-sp-warning/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-sp-warning">
              AI suggestion · not verified
            </span>
          )}
          {item.linkedLoadLabel && <span className="text-xs text-sp-textSecondary">Linked: {item.linkedLoadLabel}</span>}
        </div>
        <div className="flex items-center gap-3 text-xs">
          {item.type === "rate_confirmation" && item.status === "processed" && (
            <a href={`/documents/${item.id}/payroll`} className="text-sp-gold hover:underline">Payroll review</a>
          )}
          {item.url && (
            <a href={item.url} target="_blank" rel="noreferrer" className="text-sp-gold hover:underline">
              Open file
            </a>
          )}
          <span className="text-sp-textSecondary">{item.createdAt?.slice(0, 10)}</span>
        </div>
      </header>

      {notRead ? (
        <p className="text-xs text-sp-textSecondary">
          {item.duplicateOf
            ? `Same file as a document you already uploaded (${item.duplicateOf.slice(0, 8)}) — not read again, so it can't be paid twice. Dismiss it.`
            : item.status === "failed"
            ? `Could not read this file${item.errorMessage ? `: ${item.errorMessage.slice(0, 160)}` : "."}`
            : item.status === "processing"
            ? "Being read…"
            : "Not read yet."}
        </p>
      ) : (
        <>
          {r && (
            <div className="grid gap-2 text-xs md:grid-cols-3">
              <div>
                <span className="text-sp-textSecondary">Classification: </span>
                <span className="text-sp-textPrimary">
                  {r.classification.band} ({Math.round(r.classification.score * 100)}%)
                </span>
              </div>
              {r.match && r.match.kind !== "none" && (
                <div>
                  <span className="text-sp-textSecondary">{r.match.kind === "load" ? "Load" : "Driver"} match: </span>
                  <span className="text-sp-textPrimary">
                    {Math.round(r.match.score * 100)}% · {r.match.evidence.join(", ").replace(/_/g, " ")}
                  </span>
                </div>
              )}
              <div className="md:col-span-3">
                <span className="text-sp-textSecondary">Proposed: </span>
                <span className="text-sp-textPrimary">{describeProposal(proposal, loads, drivers)}</span>
              </div>
            </div>
          )}
          {r && r.reasons.length > 0 && (
            <ul className="list-inside list-disc text-xs text-sp-warning">
              {r.reasons.map((reason) => (
                <li key={reason}>{REVIEW_REASON_TEXT[reason] ?? reason}</li>
              ))}
            </ul>
          )}
          {item.duplicateOf && <p className="text-xs text-sp-warning">Same file as document {item.duplicateOf.slice(0, 8)}.</p>}

          <form action={revise} className="space-y-2 rounded-lg bg-sp-cardLight/40 p-3">
            <div className="grid gap-2 md:grid-cols-3">
              <label className="space-y-1 text-[11px] text-sp-textSecondary">
                Type
                <select name="document_type" defaultValue={item.type} className={input}>
                  {CANONICAL_DOCUMENT_TYPES.map((t) => (
                    <option key={t} value={t}>{documentTypeLabel(t)}</option>
                  ))}
                </select>
              </label>
              {!isDriverDoc && (
                <label className="space-y-1 text-[11px] text-sp-textSecondary">
                  Load
                  <select name="load_id" defaultValue="" className={input}>
                    <option value="">{proposal?.kind === "attach_load" ? "Keep proposed load" : "— choose —"}</option>
                    {loads.map((l) => <option key={l.id} value={l.id}>{l.label}</option>)}
                  </select>
                </label>
              )}
              {isDriverDoc && (
                <label className="space-y-1 text-[11px] text-sp-textSecondary">
                  Driver
                  <select name="driver_id" defaultValue="" className={input}>
                    <option value="">{proposal?.kind === "attach_driver_document" ? "Keep proposed driver" : "— choose —"}</option>
                    {drivers.map((d) => <option key={d.id} value={d.id}>{d.label}</option>)}
                  </select>
                </label>
              )}
            </div>
            {item.editableFields.length > 0 && (
              <table className="w-full text-xs">
                <thead className="text-left text-[10px] uppercase tracking-wide text-sp-textSecondary">
                  <tr><th className="py-1">Field</th><th className="py-1">AI read (unverified)</th><th className="py-1">Your value</th></tr>
                </thead>
                <tbody>
                  {item.editableFields.map((k) => (
                    <tr key={k}>
                      <td className="py-1 pr-2 text-sp-textSecondary">{fieldLabel(k)}</td>
                      <td className="py-1 pr-2 text-sp-textPrimary">{show(ai[k])}</td>
                      <td className="py-1">
                        <input name={`field_${k}`} defaultValue={item.corrections[k] !== undefined ? String(item.corrections[k]) : ""} placeholder={show(ai[k]) === "—" ? "" : "keep AI value"} className={input} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            <div className="flex items-center justify-between gap-2">
              <Msg state={reviseState} />
              <button type="submit" disabled={revising} className={`${btn} bg-white/10 text-sp-textPrimary hover:bg-white/15`}>
                {revising ? "Saving…" : "Save corrections"}
              </button>
            </div>
          </form>

          {proposal?.kind === "create_load" && (
            <form action={createLoad} className="space-y-2 rounded-lg border border-white/10 p-3">
              <p className="text-xs text-sp-textSecondary">
                Create a new load from this rate confirmation. An entered load counts as delivered revenue — confirm every value.
              </p>
              <div className="grid gap-2 md:grid-cols-3">
                {[
                  "load_number", "broker_name", "broker_mc_number", "origin", "destination", "pickup_date",
                  "delivery_date", "total_miles", "line_haul_rate", "fuel_surcharge", "accessorial_charges", "total_revenue",
                ].map((k) => (
                  <label key={k} className="space-y-1 text-[11px] text-sp-textSecondary">
                    {fieldLabel(k)}
                    <input
                      name={k}
                      type={k.endsWith("_date") ? "date" : "text"}
                      defaultValue={current(k) === undefined ? "" : String(current(k))}
                      className={input}
                    />
                  </label>
                ))}
                <label className="space-y-1 text-[11px] text-sp-textSecondary">
                  driver (who gets paid)
                  <select name="driver_id" defaultValue={item.suggestedDriverId ?? ""} className={input} data-testid="create-load-driver">
                    <option value="">— no driver yet —</option>
                    {drivers.map((d) => <option key={d.id} value={d.id}>{d.label}</option>)}
                  </select>
                </label>
              </div>
              <div className="flex items-center justify-between gap-2">
                <Msg state={createState} />
                <button type="submit" disabled={creating} className={`${btn} bg-sp-gold text-sp-black hover:brightness-110`}>
                  {creating ? "Creating…" : "Create load"}
                </button>
              </div>
            </form>
          )}
        </>
      )}

      <div className="flex flex-wrap items-center justify-end gap-2">
        <Msg state={approveState ?? dismissState ?? retryState} />
        {!notRead && proposal && proposal.kind !== "create_load" && (
          <form action={approve}>
            <button type="submit" disabled={approving} className={`${btn} bg-sp-gold text-sp-black hover:brightness-110`}>
              {approving ? "Applying…" : "Approve"}
            </button>
          </form>
        )}
        {item.status !== "processing" && !item.duplicateOf && (
          <form action={retry}>
            <button type="submit" disabled={retrying} className={`${btn} bg-white/10 text-sp-textPrimary hover:bg-white/15`}>
              {retrying ? "Reading…" : notRead ? (item.status === "failed" ? "Retry" : "Extract now") : "Re-extract"}
            </button>
          </form>
        )}
        <form action={dismiss}>
          <button type="submit" disabled={dismissing} className={`${btn} text-sp-textSecondary hover:text-sp-danger`}>
            {dismissing ? "…" : "Dismiss"}
          </button>
        </form>
      </div>
    </li>
  );
}

export function ReviewQueue({ items, loads, drivers }: { items: ReviewItem[]; loads: Option[]; drivers: Option[] }) {
  if (items.length === 0) return null;
  return (
    <section className="space-y-3" aria-labelledby="review-heading">
      <h2 id="review-heading" className="text-base font-semibold text-sp-textPrimary">
        Needs review <span className="text-sp-warning">({items.length})</span>
      </h2>
      <ul className="space-y-3">
        {items.map((i) => (
          <ReviewCard key={i.id} item={i} loads={loads} drivers={drivers} />
        ))}
      </ul>
    </section>
  );
}

// -----------------------------------------------------------------------------
//  Recently filed (automatic or approved) with Undo
// -----------------------------------------------------------------------------

export interface FiledItem {
  id: string;
  typeLabel: string;
  routedAt: string | null;
  actions: Array<{ index: number; action: AppliedAction; label: string }>;
}

function UndoButton({ documentId, index }: { documentId: string; index: number }) {
  const [state, undo, pending] = useActionState(async () => undoDocumentAction(documentId, index), undefined);
  return (
    <form action={undo} className="flex items-center gap-2">
      <Msg state={state} />
      <button type="submit" disabled={pending} className={`${btn} bg-white/10 text-sp-textPrimary hover:bg-white/15`}>
        {pending ? "Undoing…" : "Undo"}
      </button>
    </form>
  );
}

export function RecentlyFiled({ items }: { items: FiledItem[] }) {
  if (items.length === 0) return null;
  return (
    <section className="space-y-2" aria-labelledby="filed-heading">
      <h2 id="filed-heading" className="text-base font-semibold text-sp-textPrimary">Recently filed</h2>
      <ul className="divide-y divide-white/5 rounded-xl border border-white/5 bg-sp-card">
        {items.map((i) =>
          i.actions.map((a) => (
            <li key={`${i.id}-${a.index}`} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2 text-xs">
              <span className="text-sp-textPrimary">
                {i.typeLabel}: {a.label}{" "}
                <span className="text-sp-textSecondary">
                  · {a.action.mode === "automatic" ? "automatic" : "approved by you"} · {a.action.applied_at.slice(0, 16).replace("T", " ")}
                </span>
              </span>
              {a.action.kind !== "create_load" && <UndoButton documentId={i.id} index={a.index} />}
            </li>
          )),
        )}
      </ul>
    </section>
  );
}
