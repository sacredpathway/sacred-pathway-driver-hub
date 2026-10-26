// Form parsing helpers shared by the load server actions and their tests.
// (Moved verbatim out of app/(app)/loads/actions.ts so payload building is
// testable — a "use server" file can only export async actions.)

export class FieldError extends Error {
  constructor(public readonly field: string, message: string) {
    super(`${field}: ${message}`);
  }
}

export function s(formData: FormData, name: string): string | null {
  const raw = formData.get(name);
  if (typeof raw !== "string") return null;
  const t = raw.trim();
  return t === "" ? null : t;
}

export function num(
  formData: FormData,
  name: string,
  opts?: { nonNegative?: boolean; label?: string }
): number | null {
  const raw = s(formData, name);
  if (raw === null) return null;
  const cleaned = raw.replace(/[$,%\s]/g, "");
  const n = Number(cleaned);
  if (!Number.isFinite(n)) {
    throw new FieldError(name, `${opts?.label ?? name} must be a number.`);
  }
  if (opts?.nonNegative && n < 0) {
    throw new FieldError(name, `${opts?.label ?? name} cannot be negative.`);
  }
  return n;
}

export function date(formData: FormData, name: string): string | null {
  const raw = s(formData, name);
  if (!raw) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    throw new FieldError(name, "Date must be YYYY-MM-DD.");
  }
  return raw;
}

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function maybeUuid(formData: FormData, name: string, label: string): string | null {
  const raw = s(formData, name);
  if (raw === null) return null;
  if (!UUID_RE.test(raw)) {
    throw new FieldError(name, `${label} is invalid.`);
  }
  return raw.toLowerCase();
}
