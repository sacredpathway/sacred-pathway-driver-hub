// =============================================================================
//  DRY RUN — legacy pending documents report (NO WRITES)
// -----------------------------------------------------------------------------
//  NOT run as part of development. Requires separate authorization, and the
//  document-automation migration + Edge Function v2 must be live first
//  (persist:false preview mode).
//
//    SUPABASE_URL=https://<ref>.supabase.co \
//    SUPABASE_ANON_KEY=<anon key> \
//    SUPABASE_ACCESS_TOKEN=<signed-in owner's access token> \
//    npx -y tsx scripts/documents-backfill-dry-run.ts [--no-extract] > backfill-report.json
//
//  Runs under the OWNER's JWT (RLS), never the service role. Reads rows,
//  downloads the files to hash them, and calls extract-document with
//  { extraction_version: "v2", persist: false } for unique files only.
//  The repo is read-only (any write throws). Output: JSON on stdout,
//  a human summary on stderr.
// =============================================================================

import { createClient } from "@supabase/supabase-js";
import { createDocumentRepo, AUTOMATION_DOCUMENT_COLUMNS } from "../lib/documents/repo";
import { isLegacyPending, planBackfill } from "../lib/documents/backfill";
import { sha256Hex } from "../lib/documents/upload";
import type { AutomationDocument } from "../lib/documents/types";

async function main() {
  const url = process.env.SUPABASE_URL;
  const anon = process.env.SUPABASE_ANON_KEY;
  const token = process.env.SUPABASE_ACCESS_TOKEN;
  if (!url || !anon || !token) {
    throw new Error("Set SUPABASE_URL, SUPABASE_ANON_KEY and SUPABASE_ACCESS_TOKEN (owner session).");
  }
  const extract = !process.argv.includes("--no-extract");
  const supabase = createClient(url, anon, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: userData, error: userErr } = await supabase.auth.getUser(token);
  if (userErr || !userData.user) throw new Error("Access token is not valid.");
  const owner = userData.user.id;

  const { data, error } = await supabase
    .from("documents")
    .select(AUTOMATION_DOCUMENT_COLUMNS)
    .eq("profile_id", owner)
    .eq("status", "pending")
    .is("source", null)
    .order("created_at", { ascending: true });
  if (error) throw new Error(error.message);
  const docs = ((data ?? []) as unknown as AutomationDocument[]).filter(isLegacyPending);

  const rows = await planBackfill(createDocumentRepo(supabase, owner), docs, {
    async hashDocument(doc) {
      const { data: blob } = await supabase.storage.from("documents").download(doc.storage_path);
      return blob ? sha256Hex(await blob.arrayBuffer()) : null;
    },
    async previewExtract(doc) {
      const { data: body, error: fnErr } = await supabase.functions.invoke("extract-document", {
        body: { document_id: doc.id, extraction_version: "v2", persist: false },
      });
      if (fnErr) return { ok: false, message: fnErr.message };
      const b = body as { success?: boolean; persisted?: boolean; extracted?: unknown; message?: string };
      if (b?.persisted !== false) return { ok: false, message: "Edge Function did not confirm persist:false — aborting this row." };
      return b?.success ? { ok: true, extracted: b.extracted } : { ok: false, message: b?.message ?? "extraction failed" };
    },
  }, { extract });

  process.stdout.write(JSON.stringify({ generated_at: new Date().toISOString(), dry_run: true, count: rows.length, rows }, null, 2) + "\n");
  for (const r of rows) {
    process.stderr.write(
      `${r.document_id.slice(0, 8)}  ${r.duplicate_of ? `dup of ${r.duplicate_of.slice(0, 8)}` : "unique".padEnd(15)}  ` +
        `${r.proposed_type.padEnd(22)} cls=${r.classification_confidence.toFixed(2)} ` +
        `match=${r.match_confidence === null ? "-" : r.match_confidence.toFixed(2)}  ${r.proposed_action}  review=${r.review_required ? "YES" : "NO"}` +
        `${r.error ? `  error=${r.error}` : ""}\n`,
    );
  }
}

main().catch((e) => {
  process.stderr.write(`dry-run failed: ${(e as Error).message}\n`);
  process.exit(1);
});
