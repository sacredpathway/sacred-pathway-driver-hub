#!/usr/bin/env node
// Black-box check of the sign-in gate against a running build.
//
//   node scripts/smoke-auth-gate.mjs http://127.0.0.1:8787
//
// Read-only: issues GET requests without credentials and asserts that every
// protected route redirects to /auth/signin — including requests that carry
// the headers used by known Next.js middleware-bypass advisories
// (GHSA-f82v-jwr5-mffw: x-middleware-subrequest). Never point this at a
// server you do not own.

const base = (process.argv[2] || "http://127.0.0.1:8787").replace(/\/$/, "");

const PROTECTED = [
  "/dashboard", "/loads", "/loads/00000000-0000-0000-0000-000000000000",
  "/loads/new", "/drivers", "/payroll", "/payroll/new", "/settlements",
  "/fleet", "/brokers", "/broker-contacts", "/expenses", "/documents",
  "/reports", "/reports/revenue/csv", "/settings", "/team",
];

const BYPASS_HEADERS = [
  {},
  { "x-middleware-subrequest": "middleware" },
  { "x-middleware-subrequest": "src/middleware" },
  { "x-middleware-subrequest": "middleware:middleware:middleware:middleware:middleware" },
  { "x-middleware-subrequest": "pages/_middleware" },
  { "x-nextjs-data": "1" },
  { "x-now-route-matches": "1" },
  { rsc: "1" },
  { "next-router-prefetch": "1" },
];

let failed = 0;
let checks = 0;
function check(ok, msg) {
  checks++;
  if (ok) console.log(`PASS ${msg}`);
  else { failed++; console.log(`FAIL ${msg}`); }
}

for (const path of PROTECTED) {
  for (const headers of BYPASS_HEADERS) {
    const res = await fetch(base + path, { redirect: "manual", headers });
    const loc = res.headers.get("location") || "";
    const target = loc ? new URL(loc, base) : null;
    const ok = res.status >= 300 && res.status < 400 && target?.pathname === "/auth/signin" &&
      target.searchParams.get("next") === path;
    check(ok, `${path} ${JSON.stringify(headers)} -> ${res.status} ${loc}`);
  }
}

// Variants that must not slip past the prefix match. Redirects are followed
// (e.g. trailing-slash normalisation 308 /dashboard/ -> /dashboard); the
// chain must end at sign-in or a 404 — never at a rendered app page.
for (const path of ["/dashboard/", "/DASHBOARD", "/dashboard%2F", "/%64ashboard", "//dashboard"]) {
  let url = base + path;
  let res;
  const hops = [];
  for (let i = 0; i < 5; i++) {
    res = await fetch(url, { redirect: "manual" });
    const loc = res.headers.get("location");
    hops.push(`${res.status}${loc ? " " + loc : ""}`);
    if (!(res.status >= 300 && res.status < 400 && loc)) break;
    const next = new URL(loc, url);
    if (next.origin !== new URL(base).origin) break;
    if (next.pathname === "/auth/signin") break;
    url = next.href;
  }
  const lastLoc = res.headers.get("location") || "";
  const endsAtSignin = res.status >= 300 && res.status < 400 && new URL(lastLoc, base).pathname === "/auth/signin";
  const body = res.status === 200 ? await res.text() : "";
  const ok = endsAtSignin || res.status === 404 || (res.status === 200 && !body.includes("Recent loads"));
  check(ok, `variant ${path} -> ${hops.join(" -> ")}`);
}

// Public routes stay reachable without a session.
for (const path of ["/", "/auth/signin"]) {
  const res = await fetch(base + path, { redirect: "manual" });
  check(res.status === 200, `public ${path} -> ${res.status}`);
}
{
  const res = await fetch(base + "/join/SMOKETEST", { redirect: "manual" });
  const loc = res.headers.get("location") || "";
  check(!loc.includes("/auth/signin"), `public /join/<code> not gated by middleware -> ${res.status} ${loc}`);
}

console.log(`\n${checks - failed}/${checks} passed`);
process.exit(failed ? 1 : 0);
