// Fail the build when the Supabase public config is absent.
//
// Why this exists: NEXT_PUBLIC_* values are inlined by Next.js at build time.
// A build produced without them yields a bundle that instead reads
// process.env at runtime. On Cloudflare Pages those names resolve to
// undefined unless the project defines them, so middleware.ts and
// lib/supabase/server.ts throw on every request and the whole site returns
// HTTP 500 -- while the build and the upload both report success.
//
// That is exactly how deployment 9edaf640 shipped a green build that served
// 500 on every route. Failing loudly here makes that bundle impossible to
// produce.
//
// This hook runs as a plain node process before `next build`, so Next has not
// loaded the .env files yet. It reads them itself, in Next's own precedence
// order, so that a machine configured only through web-app/.env.local is not
// falsely rejected.

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const REQUIRED = ["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY"];

// Highest precedence first; a name already resolved is never overwritten.
const ENV_FILES = [
  ".env.production.local",
  ".env.local",
  ".env.production",
  ".env",
];

function parseDotenv(text) {
  const out = {};
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    const key = line.slice(0, eq).replace(/^export\s+/, "").trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"') && value.length > 1) ||
      (value.startsWith("'") && value.endsWith("'") && value.length > 1)
    ) {
      value = value.slice(1, -1);
    }
    if (key) out[key] = value;
  }
  return out;
}

const resolved = { ...process.env };
for (const file of ENV_FILES) {
  const path = resolve(process.cwd(), file);
  if (!existsSync(path)) continue;
  const parsed = parseDotenv(readFileSync(path, "utf8"));
  for (const [key, value] of Object.entries(parsed)) {
    if (resolved[key] === undefined || resolved[key] === "") resolved[key] = value;
  }
}

const missing = REQUIRED.filter((name) => !resolved[name]);

if (missing.length > 0) {
  console.error(
    [
      "",
      "Refusing to build: required public environment variables are missing.",
      "",
      ...missing.map((name) => `  - ${name}`),
      "",
      "These are inlined at build time. Building without them produces a",
      "bundle that returns HTTP 500 on every route once deployed.",
      "",
      "Set them in your shell or in web-app/.env.local before building.",
      `Looked in: process.env, ${ENV_FILES.join(", ")}`,
      "",
    ].join("\n"),
  );
  process.exit(1);
}

console.log(`Required env present: ${REQUIRED.join(", ")}`);
