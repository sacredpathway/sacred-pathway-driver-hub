// =============================================================================
//  Documents constants — Carrier HQ
// -----------------------------------------------------------------------------
//  Non-server module. Next.js 15 enforces "use server" files to export ONLY
//  async functions, so the document-type taxonomy lives here instead of in
//  actions.ts. The server action file imports from this module the same way
//  the page + UploadCard do.
// =============================================================================

// Document type taxonomy — same labels as the iOS Document Vault picker.
export const DOCUMENT_TYPES: ReadonlyArray<string> = [
  "rate_confirmation",
  "bol",
  "pod",
  "invoice",
  "receipt",
  "lumper",
  "settlement",
  "other",
] as const;
