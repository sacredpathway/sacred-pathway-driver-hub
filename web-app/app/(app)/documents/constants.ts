// =============================================================================
//  Documents constants — Carrier HQ
// -----------------------------------------------------------------------------
//  Non-server module ("use server" files may export only async functions).
//  The taxonomy itself lives in lib/documents/taxonomy.ts (a byte-identical
//  copy of the Edge Function's canonical list); nothing here redefines it.
// =============================================================================

import {
  CANONICAL_DOCUMENT_TYPES,
  LEGACY_DOCUMENT_TYPES,
} from "@/lib/documents/taxonomy";

/** Optional upload-time hint. Empty = let the AI decide (recommended). */
export const UPLOAD_TYPE_CHOICES: ReadonlyArray<string> = CANONICAL_DOCUMENT_TYPES.filter(
  (t) => t !== "other",
);

/** Every value the list filter can show: canonical + historical stored values. */
export const DOCUMENT_TYPES: ReadonlyArray<string> = [
  ...CANONICAL_DOCUMENT_TYPES,
  ...LEGACY_DOCUMENT_TYPES,
];
