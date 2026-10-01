// Validate a post-auth `next` redirect target.
//
// Only same-origin application paths are allowed: a single leading "/",
// no "//" or "/\" (protocol-relative), no backslashes or control characters,
// and nothing that resolves to a different origin. Anything else falls back
// to /dashboard. Used by the auth callback and the sign-in page so a crafted
// `?next=https://…` link cannot send a freshly signed-in user off-site.

export const DEFAULT_NEXT = "/dashboard";

const BASE = "https://next-check.invalid";

export function safeNext(
  raw: string | null | undefined,
  fallback: string = DEFAULT_NEXT,
): string {
  if (typeof raw !== "string" || raw.length === 0 || raw.length > 2048) return fallback;
  if (!raw.startsWith("/") || raw.startsWith("//") || raw.startsWith("/\\")) return fallback;
  // Backslashes and control/whitespace characters can be normalised by
  // browsers into "//host" — reject them outright.
  if (/[\\\u0000- \u007f]/.test(raw)) return fallback;
  try {
    const u = new URL(raw, BASE);
    if (u.origin !== BASE) return fallback;
    return u.pathname + u.search + u.hash;
  } catch {
    return fallback;
  }
}
