// Tiny formatting helpers — pure functions, edge-safe.

export function formatCurrency(amount: number | null | undefined): string {
  if (amount === null || amount === undefined || Number.isNaN(amount)) return "—";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  }).format(amount);
}

export function formatNumber(value: number | null | undefined, fractionDigits = 0): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  return new Intl.NumberFormat("en-US", {
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  }).format(value);
}

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  // Plain YYYY-MM-DD strings (Postgres DATE columns) are date-only — building
  // them via `new Date("2026-05-13")` puts the value at midnight UTC and then
  // toLocaleDateString may roll the day back in US time zones. Parse the
  // components directly to avoid the off-by-one.
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (m) {
    const y = Number(m[1]);
    const mo = Number(m[2]) - 1;
    const da = Number(m[3]);
    const d = new Date(y, mo, da);
    return d.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
  }
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
}

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function dollarsPerMile(revenue: number | null | undefined, miles: number | null | undefined): number {
  if (!revenue || !miles || miles <= 0) return 0;
  return revenue / miles;
}
