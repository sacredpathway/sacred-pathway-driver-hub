"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  ADDITION_CATEGORIES, ADDITION_CATEGORY_LABEL, DEDUCTION_CATEGORIES, DEDUCTION_CATEGORY_LABEL,
  RESPONSIBILITY_LABEL, type CustomCategory, type Responsibility,
} from "@/lib/settlements/model";
import { createCustomCategoryAction, updateCustomCategoryAction } from "../../settlements/actions";

const field = "w-full rounded-lg bg-sp-cardLight px-3 py-2 text-sm text-sp-textPrimary outline-none ring-1 ring-white/5 focus:ring-sp-gold";

export default function CategoriesManager({ initial }: { initial: CustomCategory[] }) {
  const router = useRouter();
  const [kind, setKind] = useState<"addition" | "deduction">("deduction");
  const [name, setName] = useState("");
  const [base, setBase] = useState("other");
  const [resp, setResp] = useState<Responsibility>("driver");
  const [share, setShare] = useState("50");
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [editing, setEditing] = useState<{ id: string; name: string } | null>(null);

  const std = kind === "addition" ? ADDITION_CATEGORIES : DEDUCTION_CATEGORIES;
  const labels: Record<string, string> = kind === "addition" ? ADDITION_CATEGORY_LABEL : DEDUCTION_CATEGORY_LABEL;
  const baseLabel = (c: CustomCategory) => (c.kind === "addition" ? (ADDITION_CATEGORY_LABEL as Record<string, string>) : (DEDUCTION_CATEGORY_LABEL as Record<string, string>))[c.baseCategory] ?? c.baseCategory;

  const add = () => start(async () => {
    setMsg(null);
    const r = await createCustomCategoryAction({ kind, name, baseCategory: base, defaultResponsibility: resp, defaultDriverSharePercent: share });
    if (!r.ok) { setMsg(r.error); return; }
    setName("");
    router.refresh();
  });
  const patch = (id: string, p: { name?: string; isArchived?: boolean }) => start(async () => {
    setMsg(null);
    const r = await updateCustomCategoryAction(id, p);
    if (!r.ok) setMsg(r.error); else { setEditing(null); router.refresh(); }
  });

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 gap-3 rounded-xl border border-white/5 bg-sp-card p-4 md:grid-cols-6">
        <label className="block text-[11px] font-semibold uppercase tracking-wide text-sp-textSecondary">Type
          <select value={kind} onChange={(e) => { setKind(e.target.value as "addition" | "deduction"); setBase("other"); }} className={field + " mt-1"}>
            <option value="deduction">Deduction</option>
            <option value="addition">Addition</option>
          </select>
        </label>
        <label className="block text-[11px] font-semibold uppercase tracking-wide text-sp-textSecondary md:col-span-2">Name
          <input value={name} maxLength={60} onChange={(e) => setName(e.target.value)} placeholder="e.g. ELD subscription" className={field + " mt-1"} />
        </label>
        <label className="block text-[11px] font-semibold uppercase tracking-wide text-sp-textSecondary">Report under
          <select value={base} onChange={(e) => setBase(e.target.value)} className={field + " mt-1"}>
            {std.map((c) => <option key={c} value={c}>{labels[c]}</option>)}
          </select>
        </label>
        {kind === "deduction" ? (
          <label className="block text-[11px] font-semibold uppercase tracking-wide text-sp-textSecondary">Default who pays
            <select value={resp} onChange={(e) => setResp(e.target.value as Responsibility)} className={field + " mt-1"}>
              {(["driver", "company", "split"] as const).map((r) => <option key={r} value={r}>{RESPONSIBILITY_LABEL[r]}</option>)}
            </select>
            {resp === "split" && <input value={share} onChange={(e) => setShare(e.target.value)} inputMode="decimal" aria-label="Driver share %" className={field + " mt-1"} />}
          </label>
        ) : <div />}
        <div className="flex items-end">
          <button type="button" onClick={add} disabled={pending || !name.trim()} className="w-full rounded-md bg-sp-gold px-4 py-2 text-xs font-semibold text-sp-black hover:bg-sp-goldLight disabled:opacity-50">Add category</button>
        </div>
      </div>
      {msg && <p className="rounded-md border border-sp-danger/40 bg-sp-danger/10 px-3 py-2 text-xs text-red-200">{msg}</p>}

      {(["deduction", "addition"] as const).map((k) => {
        const list = initial.filter((c) => c.kind === k);
        return (
          <div key={k} className="space-y-2">
            <h2 className="text-sm font-semibold">{k === "deduction" ? "Deduction categories" : "Addition categories"}</h2>
            {list.length === 0 ? <p className="text-sm text-sp-textSecondary">None yet.</p> : (
              <ul className="divide-y divide-white/5 rounded-xl border border-white/5 bg-sp-card/40">
                {list.map((c) => (
                  <li key={c.id} className="flex flex-wrap items-center gap-3 px-4 py-2.5 text-sm">
                    {editing?.id === c.id ? (
                      <input autoFocus value={editing.name} maxLength={60} onChange={(e) => setEditing({ id: c.id, name: e.target.value })}
                        onKeyDown={(e) => { if (e.key === "Enter") patch(c.id, { name: editing.name }); if (e.key === "Escape") setEditing(null); }}
                        className={field + " max-w-xs"} aria-label="Category name" />
                    ) : (
                      <span className={"font-medium " + (c.isArchived ? "text-sp-textSecondary line-through" : "text-sp-textPrimary")}>{c.name}</span>
                    )}
                    <span className="text-xs text-sp-textSecondary">reports as {baseLabel(c)}{c.kind === "deduction" ? ` · ${RESPONSIBILITY_LABEL[c.defaultResponsibility]}` : ""}</span>
                    <span className="ml-auto flex gap-2">
                      {editing?.id === c.id ? (
                        <button type="button" disabled={pending} onClick={() => patch(c.id, { name: editing.name })} className="text-xs text-sp-gold hover:underline">Save</button>
                      ) : (
                        <button type="button" onClick={() => setEditing({ id: c.id, name: c.name })} className="text-xs text-sp-textSecondary hover:text-sp-textPrimary">Rename</button>
                      )}
                      <button type="button" disabled={pending} onClick={() => patch(c.id, { isArchived: !c.isArchived })} className="text-xs text-sp-textSecondary hover:text-sp-textPrimary">
                        {c.isArchived ? "Restore" : "Archive"}
                      </button>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        );
      })}
      <p className="text-[11px] text-sp-textSecondary">Archiving hides a category from new lines. Lines already saved keep their name and amount — nothing paid is changed.</p>
    </div>
  );
}
