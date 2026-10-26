// =============================================================================
//  Payroll from documents — what automatic payroll did with each upload
// -----------------------------------------------------------------------------
//  Drafts link straight to the paystub; anything waiting says exactly why and
//  offers the payroll review (fix the cause) or "Try again" (after fixing it,
//  e.g. setting a driver's pay rule). Nothing here approves or pays.
// =============================================================================

"use client";

import Link from "next/link";
import { useActionState } from "react";
import { runAutoPayrollAction, type ReviewActionState } from "./actions";

export interface PayrollActivityItem {
  id: string;
  typeLabel: string;
  loadLabel: string | null;
  state: string;
  holds: { code: string; message: string }[];
  settlementId: string | null;
  at: string | null;
}

const LABEL: Record<string, string> = {
  drafted: "Payroll draft created",
  added_to_draft: "Added to payroll draft",
  deduction_added: "Deduction added to draft",
  noted: "Note",
  held: "Waiting for you",
  error: "Couldn't finish",
};

function Row({ item }: { item: PayrollActivityItem }) {
  const [state, retry, pending] = useActionState<ReviewActionState, FormData>(async () => runAutoPayrollAction(item.id), undefined);
  const waiting = item.state === "held" || item.state === "error";
  return (
    <li data-testid="payroll-activity" data-state={item.state} data-document={item.id} className="flex flex-col gap-1 rounded-lg border border-white/5 bg-sp-cardLight/40 px-3 py-2 text-xs">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="text-sp-textPrimary">
          <span className="font-semibold">{item.typeLabel}</span>
          {item.loadLabel ? <span className="text-sp-textSecondary"> · {item.loadLabel}</span> : null}
        </span>
        <span className={waiting ? "font-semibold text-sp-warning" : item.state === "noted" ? "font-semibold text-sp-textSecondary" : "font-semibold text-sp-success"}>{LABEL[item.state] ?? item.state}</span>
      </div>
      {item.state === "noted" && item.holds[0] && <p className="text-sp-textSecondary">{item.holds[0].message}</p>}
      {waiting && item.holds.length > 0 && (
        <ul className="list-inside list-disc text-sp-warning">
          {item.holds.slice(0, 4).map((h, i) => <li key={i}>{h.message}</li>)}
        </ul>
      )}
      <div className="flex flex-wrap items-center gap-3">
        {item.settlementId && (
          <>
            <Link href={`/settlements/${item.settlementId}/statement`} className="font-semibold text-sp-gold hover:underline">Open paystub</Link>
            <Link href={`/settlements/${item.settlementId}`} className="text-sp-gold hover:underline">Settlement</Link>
          </>
        )}
        {waiting && <Link href={`/documents/${item.id}/payroll`} className="text-sp-gold hover:underline">Payroll review</Link>}
        {waiting && (
          <form action={retry}>
            <button type="submit" disabled={pending} className="rounded-md bg-white/10 px-2.5 py-1 font-semibold text-sp-textPrimary hover:bg-white/15 disabled:opacity-50">
              {pending ? "Checking…" : "Try again"}
            </button>
          </form>
        )}
        {state && <span className={state.ok ? "text-sp-success" : "text-sp-warning"}>{state.message}</span>}
      </div>
    </li>
  );
}

export function PayrollActivity({ items, enabledMessage }: { items: PayrollActivityItem[]; enabledMessage: string | null }) {
  if (items.length === 0 && !enabledMessage) return null;
  return (
    <section className="space-y-2 rounded-xl border border-white/5 bg-sp-card p-5" data-testid="payroll-panel">
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-base font-semibold text-sp-textPrimary">Payroll from documents</h2>
        <Link href="/settlements" className="text-xs text-sp-gold hover:underline">All settlements</Link>
      </header>
      {enabledMessage && <p className="text-xs text-sp-textSecondary">{enabledMessage}</p>}
      {items.length === 0 ? (
        <p className="text-xs text-sp-textSecondary">Upload a rate confirmation for a load and its payroll draft and paystub appear here.</p>
      ) : (
        <ul className="space-y-2">{items.map((i) => <Row key={i.id} item={i} />)}</ul>
      )}
    </section>
  );
}
