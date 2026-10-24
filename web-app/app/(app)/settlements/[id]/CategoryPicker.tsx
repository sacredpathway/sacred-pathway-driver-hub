"use client";

// Category dropdown for additions / deductions with "+ New category…".
//
// iPhone-safe by construction: picking a custom category stores the standard
// base category the carrier mapped it to (default "Other") plus the custom
// category id. Before the categories migration is applied, a new category
// still works on the line — it saves as an "Other" line carrying that name —
// and past names are offered again as suggestions.

import { useState, useTransition } from "react";
import {
  ADDITION_CATEGORIES, ADDITION_CATEGORY_LABEL, DEDUCTION_CATEGORIES, DEDUCTION_CATEGORY_LABEL,
  RESPONSIBILITY_LABEL, type CustomCategory, type Responsibility,
} from "@/lib/settlements/model";
import { parseShare } from "@/lib/settlements/input";
import { createCustomCategoryAction } from "../actions";
import { NumField, inputCls } from "./fields";

export interface CategoryChoice {
  category: string;
  customCategoryId: string | null;
  /** Set when the choice should also fill an empty description. */
  name?: string;
  responsibility?: Responsibility;
  driverSharePercent?: string;
}

export default function CategoryPicker({
  kind, category, customCategoryId, customs, suggestions, available, disabled, onPick, onCreated,
}: {
  kind: "addition" | "deduction";
  category: string;
  customCategoryId: string | null;
  customs: CustomCategory[];
  suggestions: string[];
  available: boolean;
  disabled?: boolean;
  onPick: (c: CategoryChoice) => void;
  onCreated: (c: CustomCategory) => void;
}) {
  const [creating, setCreating] = useState(false);
  const std = kind === "addition" ? ADDITION_CATEGORIES : DEDUCTION_CATEGORIES;
  const labels: Record<string, string> = kind === "addition" ? ADDITION_CATEGORY_LABEL : DEDUCTION_CATEGORY_LABEL;
  const mine = customs.filter((c) => c.kind === kind && (!c.isArchived || c.id === customCategoryId));
  const value = customCategoryId ? `custom:${customCategoryId}` : `std:${category}`;

  return (
    <div className="min-w-0">
      <select
        aria-label={`${kind === "addition" ? "Addition" : "Deduction"} category`}
        disabled={disabled}
        value={value}
        onChange={(e) => {
          const v = e.target.value;
          if (v === "__new") { setCreating(true); return; }
          if (v.startsWith("std:")) onPick({ category: v.slice(4), customCategoryId: null });
          else if (v.startsWith("custom:")) {
            const c = mine.find((x) => x.id === v.slice(7));
            if (c) onPick({ category: c.baseCategory, customCategoryId: c.id, name: c.name, responsibility: c.defaultResponsibility, driverSharePercent: c.defaultDriverSharePercent });
          } else if (v.startsWith("name:")) {
            onPick({ category: "other", customCategoryId: null, name: v.slice(5) });
          }
        }}
        className={inputCls}
      >
        {mine.length > 0 && (
          <optgroup label="Your categories">
            {mine.map((c) => <option key={c.id} value={`custom:${c.id}`}>{c.name}{c.isArchived ? " (archived)" : ""}</option>)}
          </optgroup>
        )}
        <optgroup label="Standard">
          {std.map((c) => <option key={c} value={`std:${c}`}>{labels[c]}</option>)}
        </optgroup>
        {!available && suggestions.length > 0 && (
          <optgroup label="Used before (saved as Other)">
            {suggestions.map((s) => <option key={s} value={`name:${s}`}>{s}</option>)}
          </optgroup>
        )}
        {!disabled && <option value="__new">+ New category…</option>}
      </select>
      {creating && (
        <NewCategoryForm
          kind={kind}
          available={available}
          onCancel={() => setCreating(false)}
          onDone={(created, fallbackName, resp, share) => {
            setCreating(false);
            if (created) {
              onCreated(created);
              onPick({ category: created.baseCategory, customCategoryId: created.id, name: created.name, responsibility: created.defaultResponsibility, driverSharePercent: created.defaultDriverSharePercent });
            } else if (fallbackName) {
              onPick({ category: "other", customCategoryId: null, name: fallbackName, responsibility: resp, driverSharePercent: share });
            }
          }}
        />
      )}
    </div>
  );
}

function NewCategoryForm({
  kind, available, onCancel, onDone,
}: {
  kind: "addition" | "deduction";
  available: boolean;
  onCancel: () => void;
  onDone: (created: CustomCategory | null, fallbackName: string | null, resp?: Responsibility, share?: string) => void;
}) {
  const [name, setName] = useState("");
  const [base, setBase] = useState("other");
  const [resp, setResp] = useState<Responsibility>("driver");
  const [share, setShare] = useState("50");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const std = kind === "addition" ? ADDITION_CATEGORIES : DEDUCTION_CATEGORIES;
  const labels: Record<string, string> = kind === "addition" ? ADDITION_CATEGORY_LABEL : DEDUCTION_CATEGORY_LABEL;

  const submit = () => {
    const n = name.trim().replace(/\s+/g, " ");
    if (!n) { setError("Name the category."); return; }
    if (resp === "split" && !parseShare(share).ok) { setError("Driver share must be 0–100 with up to 3 decimals."); return; }
    const shareOut = resp === "driver" ? "100" : resp === "company" ? "0" : share;
    if (!available) { onDone(null, n, kind === "deduction" ? resp : undefined, kind === "deduction" ? shareOut : undefined); return; }
    start(async () => {
      const r = await createCustomCategoryAction({ kind, name: n, baseCategory: base, defaultResponsibility: resp, defaultDriverSharePercent: shareOut });
      if (!r.ok) { setError(r.error); return; }
      onDone({ id: r.id, kind, name: n, baseCategory: base, defaultResponsibility: resp, defaultDriverSharePercent: shareOut, isArchived: false }, null);
    });
  };

  return (
    <div className="mt-2 space-y-2 rounded-lg border border-sp-gold/30 bg-black/30 p-2.5" role="group" aria-label="New category">
      <input autoFocus aria-label="Category name" placeholder="e.g. ELD subscription" maxLength={60} value={name}
        onChange={(e) => setName(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); submit(); } if (e.key === "Escape") onCancel(); }}
        className={inputCls} />
      {available && (
        <label className="block text-[11px] text-sp-textSecondary">
          Report it under (iPhone shows this)
          <select aria-label="Report under" value={base} onChange={(e) => setBase(e.target.value)} className={inputCls + " mt-1"}>
            {std.map((c) => <option key={c} value={c}>{labels[c]}</option>)}
          </select>
        </label>
      )}
      {kind === "deduction" && (
        <div className="grid grid-cols-2 gap-2">
          <label className="block text-[11px] text-sp-textSecondary">
            Default who pays
            <select aria-label="Default who pays" value={resp} onChange={(e) => setResp(e.target.value as Responsibility)} className={inputCls + " mt-1"}>
              {(["driver", "company", "split"] as const).map((r) => <option key={r} value={r}>{RESPONSIBILITY_LABEL[r]}</option>)}
            </select>
          </label>
          {resp === "split" && (
            <label className="block text-[11px] text-sp-textSecondary">
              Driver share
              <NumField ariaLabel="Default driver share" value={share} onChange={setShare} parse={(v) => parseShare(v)} suffix="%" className="mt-1" />
            </label>
          )}
        </div>
      )}
      {!available && (
        <p className="text-[11px] text-sp-textSecondary">Saves on this line as an “Other” item named “{name.trim() || "…"}”. Saved, reusable categories turn on once the database update is approved.</p>
      )}
      {error && <p className="text-[11px] text-red-300">{error}</p>}
      <div className="flex gap-2">
        <button type="button" onClick={submit} disabled={pending} className="rounded-md bg-sp-gold px-3 py-1 text-xs font-semibold text-sp-black hover:bg-sp-goldLight disabled:opacity-50">
          {pending ? "Saving…" : available ? "Create category" : "Use on this line"}
        </button>
        <button type="button" onClick={onCancel} className="rounded-md border border-white/10 px-3 py-1 text-xs text-sp-textPrimary hover:bg-white/5">Cancel</button>
      </div>
    </div>
  );
}
