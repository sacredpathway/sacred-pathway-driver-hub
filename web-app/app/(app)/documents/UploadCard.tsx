// =============================================================================
//  UploadCard — Carrier HQ Phase W5
// -----------------------------------------------------------------------------
//  Multi-file picker + document-type + optional link-to-load. POSTs to
//  uploadDocumentsAction via useActionState so inline errors render without
//  a full page reload.
//
//  Drag-and-drop is implemented in client JS — when files are dropped onto
//  the card, they're pushed into the underlying <input type="file"> via
//  DataTransfer so the form's FormData picks them up normally on submit.
// =============================================================================

"use client";

import { useActionState, useRef, useState } from "react";
import type { Load } from "@/lib/supabase/types";
import {
  uploadDocumentsAction,
  type DocumentActionState,
} from "./actions";
import { DOCUMENT_TYPES } from "./constants";

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
            Rate cons, BOLs, PODs, receipts, invoices. PDFs or images up to 20&nbsp;MB each.
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

      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        {/* ---------- Document type ---------- */}
        <label className="block space-y-1">
          <span className="text-xs font-semibold uppercase tracking-wide text-sp-textSecondary">
            Document type
          </span>
          <select
            name="document_type"
            defaultValue=""
            className="w-full rounded-lg bg-sp-cardLight px-3 py-2 text-sm text-sp-textPrimary outline-none ring-1 ring-white/5 focus:ring-sp-gold"
          >
            <option value="">— Auto / Unknown —</option>
            {DOCUMENT_TYPES.map((t) => (
              <option key={t} value={t}>
                {labelize(t)}
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
          PDFs, JPG, PNG, WebP, HEIC. Up to 20 MB each. Multiple files OK.
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

function labelize(slug: string): string {
  // "rate_confirmation" → "Rate Confirmation"; preserves trailing words
  return slug.split("_").map((p) => p[0]?.toUpperCase() + p.slice(1)).join(" ");
}

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
