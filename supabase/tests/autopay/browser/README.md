# Browser acceptance (staging, synthetic data)

1. `python3 make_docs.py` — writes the synthetic PDFs into `docs/` (each carries a `KEY:` marker).
2. Build the proxy: `esbuild proxy.ts --bundle --platform=node --format=esm --outfile=proxy.mjs`,
   run `ANON=<staging anon key> node proxy.mjs` (forwards to staging; only answers `extract-document`
   itself, because Edge Function v22 is not deployed on staging).
3. `next build` + `next start -p 3100` with `NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321`,
   `SMART_PAYROLL_CONFIRM=local-only`, `DOCUMENT_EXTRACTION_VERSION=v3`.
4. `AP_ACCOUNTS=accounts.json node journey.mjs` (two synthetic staging accounts; passwords are never committed).
Result 2026-10-25: 18/18 checks.
