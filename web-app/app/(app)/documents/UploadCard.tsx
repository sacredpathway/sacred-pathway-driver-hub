// =============================================================================
//  UploadCard — Carrier HQ Phase W5
// -----------------------------------------------------------------------------
//  Multi-file picker + optional type hint + optional link-to-load. POSTs to
//  uploadDocumentsAction via useActionState so inline errors render without
//  a full page reload. After a successful upload, every new non-duplicate
//  document is sent to processDocumentAction (extract -> route) one at a
//  time, with per-file status. Nothing waits on a bucket watcher.
//
//  Drag-and-drop is implemented in client JS — when files are dropped onto
//  the card, they're pushed into the underlying <input type="file"> via
//  DataTransfer so the form's FormData picks them up normally on submit.
// =============================================================================

"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import type { Load } from "@/lib/supabase/types";
import {
  processDocumentAction,
  uploadDocumentsAction,
  type DocumentActionState,
} from "./actions";
import { UPLOAD_TYPE_CHOICES } from "./constants";
import { documentTypeLabel } from "@/lib/documents/taxonomy";

type ProcessingRow = {
  id: string; name: string; status: "queued" | "reading" | "done" | "review" | "failed"; message: string;
  payroll?: { state: string; message: string; settlementId?: string };
};

export default function UploadCard({
  loads,
}: {
  loads: ReadonlyArray<
    Pick<Load, "id" | "load_number" | "broker_name" | "pickup_date">
  >;
}) {
  const [state, formAction, pending] = useActionState<
    DocumentActionState | undefined,
    FormData
  >(uploadDocumentsAction, undefined);

  const inputRef = useRef<HTMLInputElement | null>(null);
  const [processing, setProcessing] = useState<ProcessingRow[]>([]);

  // Upload succeeded -> read each new document now (sequentially, so one slow
  // or failing file never blocks the others and costs stay predictable).
  useEffect(() => {
    const docs = state?.documents ?? [];
    if (docs.length === 0) return;
    let cancelled = false;
    const rows: ProcessingRow[] = docs.map((d) => ({
      id: d.id,
      name: d.name,
      status: d.duplicateOf ? "review" : "queued",
      message: d.duplicateOf ? "Uploaded before — in review, not read again." : "Waiting…",
    }));
    setProcessing(rows);
    (async () => {
      for (const row of rows) {
        if (cancelled || row.status !== "queued") continue;
        setProcessing((cur) => cur.map((r) => (r.id === row.id ? { ...r, status: "reading", message: "Reading…" } : r)));
        let next: ProcessingRow;
        try {
          const res = await processDocumentAction(row.id);
          next = res.ok
            ? {
                ...row,
                status: res.state === "auto_routed" ? "done" : res.state === "failed" ? "failed" : "review",
                message: res.message,
                ...(res.payroll ? { payroll: res.payroll } : {}),
              }
            : { ...row, status: "failed", message: res.error };
        } catch {
          next = { ...row, status: "failed", message: "Could not read — use Retry in the review list." };
        }
        if (!cancelled) setProcessing((cur) => cur.map((r) => (r.id === row.id ? next : r)));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [state]);
  const [picked, setPicked] = useState<string[]>([]);
  const [dragOver, setDragOver] = useState(false);

  function updatePickedFromInput() {
    const files = inputRef.current?.files;
    if (!files) {
      setPicked([]);
      return;
    }
    setPicked(Array.from(files).map((f) => `${f.name} · ${formatBytes(f.size)}`));
  }

  function onDrop(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setDragOver(false);
    if (!inputRef.current) return;
    const dt = new DataTransfer();
    // Preserve any previously-picked files, then append dropped files
    if (inputRef.current.files) {
      for (const f of Array.from(inputRef.current.files)) dt.items.add(f);
    }
    for (const f of Array.from(e.dataTransfer.files)) dt.items.add(f);
    inputRef.current.files = dt.files;
    updatePickedFromInput();
  }

  return (
    <form action={formAction} className="rounded-xl border border-white/5 bg-sp-card p-5">
      <header className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h2 className="text-base font-semibold text-sp-textPrimary">Upload documents</h2>
          <p className="mt-1 text-xs text-sp-textSecondary">
            Rate cons, BOLs, PODs, fuel/lumper/toll/repair receipts, scale tickets, detention proof, CDLs, medical cards, MVRs.
            Each file is read and filed automatically, and a payroll draft is prepared when everything checks out.
            Anything uncertain waits for your review — nothing is ever paid automatically.
          </p>
        </div>
      </header>

      {state && !state.ok && (
        <div className="mb-3 whitespace-pre-line rounded-md border border-sp-danger/40 bg-sp-danger/10 px-3 py-2 text-xs text-sp-danger">
          {state.error}
        </div>
      )}
      {state && state.ok && (
        <div className="mb-3 rounded-md border border-sp-success/40 bg-sp-success/10 px-3 py-2 text-xs text-sp-success">
          Uploaded {state.uploaded} {state.uploaded === 1 ? "file" : "files"}.
        </div>
      )}
      {state && state.ok && state.warning && (
        <div className="mb-3 whitespace-pre-line rounded-md border border-sp-warning/40 bg-sp-warning/10 px-3 py-2 text-xs text-sp-warning">
          {state.warning}
        </div>
      )}
      {processing.length > 0 && (
        <ul className="mb-3 space-y-1 rounded-lg bg-sp-cardLight px-3 py-2 text-xs" aria-live="polite">
          {processing.map((r) => (
            <li key={r.id} data-testid="upload-row" data-state={r.status} className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
              <span className="truncate text-sp-textPrimary">{r.name}</span>
              <span
                className={
                  r.status === "done"
                    ? "text-sp-success"
                    : r.status === "failed"
                    ? "text-sp-danger"
                    : r.status === "review"
                    ? "text-sp-warning"
                    : "text-sp-textSecondary"
                }
              >
                {r.message}
              </span>
              {r.payroll && (
                <span data-testid="upload-payroll" data-state={r.payroll.state} className={"basis-full text-[11px] " + (r.payroll.state === "held" || r.payroll.state === "error" ? "text-sp-warning" : r.payroll.state === "noted" ? "text-sp-textSecondary" : "text-sp-success")}>
                  {r.payroll.message}
                  {r.payroll.settlementId && (
                    <>
                      {" "}
                      <a href={`/settlements/${r.payroll.settlementId}/statement`} className="font-semibold text-sp-gold hover:underline">Open paystub</a>
                      {" · "}
                      <a href={`/settlements/${r.payroll.settlementId}`} className="text-sp-gold hover:underline">Settlement</a>
                    </>
                  )}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}

      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        {/* ---------- Document type ---------- */}
        <label className="block space-y-1">
          <span className="text-xs font-semibold uppercase tracking-wide text-sp-textSecondary">
            Document type (optional)
          </span>
          <select
            name="document_type"
            defaultValue=""
            className="w-full rounded-lg bg-sp-cardLight px-3 py-2 text-sm text-sp-textPrimary outline-none ring-1 ring-white/5 focus:ring-sp-gold"
          >
            <option value="">Auto-detect (recommended)</option>
            {UPLOAD_TYPE_CHOICES.map((t) => (
              <option key={t} value={t}>
                {documentTypeLabel(t)}
              </option>
            ))}
          </select>
        </label>

        {/* ---------- Link to load ---------- */}
        <label className="block space-y-1 md:col-span-2">
          <span className="text-xs font-semibold uppercase tracking-wide text-sp-textSecondary">
            Link to load (optional)
          </span>
          <select
            name="load_id"
            defaultValue=""
            className="w-full rounded-lg bg-sp-cardLight px-3 py-2 text-sm text-sp-textPrimary outline-none ring-1 ring-white/5 focus:ring-sp-gold"
          >
            <option value="">— Unlinked —</option>
            {loads.map((l) => (
              <option key={l.id} value={l.id}>
                {loadOptionLabel(l)}
              </option>
            ))}
          </select>
        </label>
      </div>

      {/* ---------- File drop zone ---------- */}
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={onDrop}
        className={
          "mt-4 flex flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed px-6 py-8 text-center transition " +
          (dragOver
            ? "border-sp-gold bg-sp-gold/5"
            : "border-white/15 bg-sp-cardLight/40")
        }
      >
        <div className="text-sm text-sp-textPrimary">
          Drop files here, or
        </div>
        <label className="cursor-pointer rounded-md bg-sp-gold px-4 py-2 text-xs font-semibold text-sp-black hover:bg-sp-goldLight">
          <span>Choose files</span>
          <input
            ref={inputRef}
            type="file"
            name="files"
            multiple
            accept="application/pdf,image/png,image/jpeg,image/webp,image/heic,image/heif"
            className="hidden"
            onChange={updatePickedFromInput}
          />
        </label>
        <p className="text-[11px] text-sp-textSecondary">
          PDFs, JPG, PNG, WebP, HEIC. Up to 20 MB each. Multiple files OK. HEIC photos are
          stored but can&apos;t be read automatically — export them as JPEG for auto-filing.
        </p>
      </div>

      {picked.length > 0 && (
        <ul className="mt-3 space-y-1 rounded-lg bg-sp-cardLight px-3 py-2 text-xs text-sp-textPrimary">
          {picked.map((p, i) => (
            <li key={i} className="truncate">• {p}</li>
          ))}
        </ul>
      )}

      <div className="mt-4 flex items-center justify-end">
        <button
          type="submit"
          disabled={pending || picked.length === 0}
          className="rounded-lg bg-sp-gold px-5 py-2.5 text-sm font-semibold text-sp-black transition disabled:opacity-50 hover:brightness-110"
        >
          {pending
            ? "Uploading…"
            : picked.length > 0
            ? `Upload ${picked.length} ${picked.length === 1 ? "file" : "files"}`
            : "Upload"}
        </button>
      </div>
    </form>
  );
}

// -----------------------------------------------------------------------------
// Helpers (intentionally tiny — no shared util module yet)
// -----------------------------------------------------------------------------


function loadOptionLabel(
  l: Pick<Load, "id" | "load_number" | "broker_name" | "pickup_date">
): string {
  const parts: string[] = [];
  if (l.load_number) parts.push(`#${l.load_number}`);
  if (l.broker_name) parts.push(l.broker_name);
  if (l.pickup_date) parts.push(l.pickup_date);
  return parts.length ? parts.join(" · ") : l.id.slice(0, 8);
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
