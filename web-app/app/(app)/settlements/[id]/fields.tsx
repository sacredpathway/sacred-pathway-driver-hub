"use client";

// Small controlled inputs for the settlement editor. Every numeric field shows
// the exact parse error inline (e.g. "at most 2 decimal places") instead of
// silently rounding, so what the carrier types is exactly what gets paid.

import type { ReactNode } from "react";
import type { Parsed } from "@/lib/settlements/input";

export const inputCls =
  "w-full rounded-lg bg-sp-cardLight px-2.5 py-1.5 text-sm text-sp-textPrimary outline-none ring-1 ring-white/5 " +
  "focus:ring-sp-gold disabled:cursor-not-allowed disabled:opacity-60";

export function Label({ children, htmlFor }: { children: ReactNode; htmlFor?: string }) {
  return (
    <label htmlFor={htmlFor} className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-sp-textSecondary">
      {children}
    </label>
  );
}

export function NumField({
  value, onChange, parse, disabled, prefix, suffix, placeholder, ariaLabel, className, id,
}: {
  value: string;
  onChange: (v: string) => void;
  parse: (v: string) => Parsed;
  disabled?: boolean;
  prefix?: string;
  suffix?: string;
  placeholder?: string;
  ariaLabel: string;
  className?: string;
  id?: string;
}) {
  const r = parse(value);
  const bad = !r.ok;
  return (
    <div className={className}>
      <div className={"flex items-center rounded-lg bg-sp-cardLight ring-1 " + (bad ? "ring-sp-danger" : "ring-white/5 focus-within:ring-sp-gold")}>
        {prefix && <span className="pl-2.5 text-xs text-sp-textSecondary">{prefix}</span>}
        <input
          id={id}
          aria-label={ariaLabel}
          aria-invalid={bad}
          inputMode="decimal"
          autoComplete="off"
          value={value}
          placeholder={placeholder}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value)}
          className="w-full min-w-0 bg-transparent px-2 py-1.5 text-right text-sm tabular-nums text-sp-textPrimary outline-none disabled:cursor-not-allowed disabled:opacity-60"
        />
        {suffix && <span className="pr-2.5 text-xs text-sp-textSecondary">{suffix}</span>}
      </div>
      {bad && <p className="mt-0.5 text-[11px] text-red-300">{(r as { error: string }).error}</p>}
    </div>
  );
}

export function TextField({
  value, onChange, disabled, placeholder, ariaLabel, className, id, type = "text",
}: {
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
  placeholder?: string;
  ariaLabel: string;
  className?: string;
  id?: string;
  type?: "text" | "date";
}) {
  return (
    <input
      id={id}
      type={type}
      aria-label={ariaLabel}
      value={value}
      placeholder={placeholder}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value)}
      className={inputCls + (className ? " " + className : "")}
    />
  );
}

export function IconButton({ onClick, label, children, disabled, tone = "neutral" }: {
  onClick: () => void; label: string; children: ReactNode; disabled?: boolean; tone?: "neutral" | "danger";
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      disabled={disabled}
      className={
        "inline-flex h-8 w-8 items-center justify-center rounded-md border border-white/10 text-sm disabled:opacity-40 " +
        (tone === "danger" ? "text-red-300 hover:bg-sp-danger/10" : "text-sp-textSecondary hover:bg-white/5")
      }
    >
      {children}
    </button>
  );
}
