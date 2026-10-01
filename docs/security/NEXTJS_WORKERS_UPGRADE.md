# Next.js security upgrade + Cloudflare Workers (OpenNext) — local only

Branch `security/nextjs-cloudflare-workers-upgrade`, based on `7be759e`
(the source of production deployment `cfd0b541`, build `UUr70QOPgsQt1_wIkFrcL`).
Production has not been changed: `app.sacredpathway.org` still runs `7be759e` on
Cloudflare Pages (`cfd0b541`). This branch exists only as a preview Worker on workers.dev
(see "Preview QA" and "Reliability retest — Workers Paid").

Implements the recommendation in `docs/phase0.5/NEXT_SECURITY_UPGRADE_PLAN.md`.

## Versions

| Package | 7be759e | This branch |
|---|---|---|
| next | 15.0.7 | **15.5.26** (exact) |
| eslint-config-next | 15.0.7 | 15.5.26 (exact) |
| @cloudflare/next-on-pages | ^1.13.0 (1.13.16) | **removed** (deprecated; supports next ≤15.5.2 only) |
| @opennextjs/cloudflare | — | **1.20.7** (exact) |
| wrangler | ^3.78.0 (3.114.17) | 4.145.0 (exact) |
| react / react-dom | 18.3.1 | 18.3.1 (unchanged) |
| @supabase/ssr / supabase-js | 0.5.2 / 2.x | unchanged |

## Why 15.5.26

GitHub Advisory Database, via `npm audit` against isolated installs (2026-10-01):

- `next@15.0.7`: 32 Next.js advisories, including **critical GHSA-f82v-jwr5-mffw**
  (authorization bypass in middleware, fixed in 15.2.3). This app's sign-in gate
  is `middleware.ts`.
- 15.5.24 is the first version with 0 Next.js advisories. The last two fixed
  there (GHSA-p293-qw3h-jr36, GHSA-2xp9-vwfh-vxw4) concern Windows hosts and
  the AVIF image optimizer and do not apply here.
- `@opennextjs/cloudflare@1.20.7` requires `next >=15.5.26 <16`.
- **15.5.26 is therefore the minimum version that is advisory-free *and*
  supported by the Workers adapter.** 15.5.27 (released 2026-09-30) also has 0
  advisories; it was not chosen because 15.5.26 is the minimum that meets both
  requirements and has been out for a week.

Remaining `npm audit` findings (9, none critical, none new versus `7be759e`)
are build/dev tooling only: postcss bundled inside next, browserslist,
js-yaml, nanoid, vitest/@vitest/mocker. None ships in the Worker.

### Local reproduction of the bypass

`scripts/smoke-auth-gate.mjs` sends unauthenticated requests to every
protected route, with and without known bypass headers.

| Target | Result |
|---|---|
| `7be759e` under `next start` (next 15.0.7) | **127/161** — `x-middleware-subrequest: middleware:middleware:middleware:middleware:middleware` returns **200 and renders the dashboard shell** for every protected route |
| this branch under `next start` (next 15.5.26) | **161/161** |
| this branch as the OpenNext Worker under `wrangler dev` (local) | **161/161** |
| production (Pages + next-on-pages), unauthenticated read-only GETs | 307 → `/auth/signin` with and without the bypass header — next-on-pages runs middleware itself, so this specific bypass was **not** reproducible in production |

Data was never exposed in any case: queries run as the anon key and RLS
returns no rows without a session. The other 15.0.7 advisories (DoS, cache
poisoning, SSRF in rewrites, Server Actions issues) remain reasons to upgrade.

## Changes

| File | Change | Why |
|---|---|---|
| `web-app/package.json`, `package-lock.json` | versions above; `pages:*` scripts replaced by `cf:build`, `cf:preview`, `cf:upload`, `cf:deploy` | upgrade + new adapter |
| `web-app/wrangler.jsonc` (new) | Worker `driver-hub-web-worker`, `.open-next/worker.js`, assets binding, self-reference service binding, `nodejs_compat` | OpenNext requirement. **No routes, custom domains or account ID** |
| `web-app/wrangler.toml` (removed) | was the Pages config | wrangler 4 must not see two configs |
| `web-app/open-next.config.ts` (new) | `defineCloudflareConfig({})` | no ISR/R2 cache — every route is dynamic |
| `web-app/public/_headers` (new) | immutable caching for `/_next/static/*` | OpenNext guide; Pages did this implicitly |
| `web-app/.gitignore` | `.open-next/`, `.dev.vars*` | build output / local Worker vars |
| `web-app/next.config.mjs` | comments only (Pages wording) | — |
| 52 route files under `web-app/app/` | removed `export const runtime = "edge";` | OpenNext does not support the edge runtime for routes; it runs them in the Worker's Node-compatible runtime |
| `web-app/app/page.tsx` | `export const dynamic = "force-dynamic"` | without the edge runtime `/` became static; keeps it per-request as before, so all 52 routes keep the same static/dynamic type as `7be759e` |
| `web-app/middleware.ts` | comment only | logic unchanged |
| `web-app/lib/supabase/server.ts` | error text no longer says "Cloudflare Pages" | message accuracy |
| `web-app/middleware.test.ts` (new), `vitest.config.ts` | 41 gate regression tests | see below |
| `web-app/scripts/smoke-auth-gate.mjs` (new) | black-box gate check for any running build | used above; reuse on the preview URL |

## Verification (local)

- `npm ci` from the new lockfile: OK (723 packages)
- vitest: **257/257** (216 existing + 41 new middleware tests). The 41 new tests also pass against the `7be759e` middleware, so the gate logic is unchanged.
- `tsc --noEmit`: clean. `next lint`: the same single `<img>` warning as before.
- `next build`: OK, 52 routes, same static/dynamic type per route as `7be759e`.
- `opennextjs-cloudflare build`: OK. No prerendered HTML in `.open-next/assets`, so middleware runs before every page.
- Worker under `wrangler dev` (local, placeholder Supabase): smoke 161/161; `/`, `/auth/signin`, `/join/<code>` return 200; unknown route 404; static assets carry the immutable header.
- Database integrity suite (SQL unchanged): all passed (PG16).

## Behaviour differences vs 7be759e

1. Hosting target changes from Pages to Workers (only once deployed).
2. Routes run on the Workers Node-compatible runtime instead of edge.
3. Middleware bundle 87.6 kB → 89.9 kB. Shared First Load JS 100 kB → 103 kB; `/auth/signin` 175 kB → 172 kB.
4. Under `wrangler dev` the sign-in redirect `Location` was relative (`/auth/signin?next=…`) when called with the production Host header; Pages sends an absolute URL. Both are valid HTTP; confirm on the preview.
5. `next lint` is deprecated in 15.5 (still works); migrate to the ESLint CLI later.

## Not verified locally (needs the preview)

- Signed-in flows against real Supabase: sign-in, session refresh cookies, sign-out, server actions (loads, payroll issue/void, documents upload), CSV routes, print pages, `/join/<code>` accept.
- Runtime env vars on the Worker (`RESEND_API_KEY`, `RESEND_FROM_EMAIL`, `NEXT_PUBLIC_APP_URL`).
- Real `app.sacredpathway.org` behaviour behind Cloudflare's edge.

## External steps (owner approval required; none performed)

1. Build with the real public Supabase values in `web-app/.env.local`: `npm run cf:build`.
2. Upload a preview version without routing traffic: `npx opennextjs-cloudflare upload` (creates Worker `driver-hub-web-worker` and a preview URL; requires `wrangler login` or an API token).
3. Set Worker vars/secrets (`RESEND_*`, `NEXT_PUBLIC_APP_URL`) in the dashboard if invite email is wanted.
4. Run `node scripts/smoke-auth-gate.mjs <preview-url>` and a signed-in manual smoke on the preview.
5. Cut-over: detach `app.sacredpathway.org` from Pages project `driver-hub-web` and attach it as a Worker custom domain (brief DNS/cert switch).
6. Rollback: re-attach the domain to Pages, where deployment `cfd0b541` still exists. Keep the Pages project until the Worker has run cleanly.
7. Afterwards: push the branch / open a PR.

## Preview QA — 2026-10-01 (Worker preview, no cut-over)

- Worker `driver-hub-web-worker`, URL `https://driver-hub-web-worker.jamie-9c0.workers.dev`,
  version `12abe18b-c5ac-4943-844f-d6616abd4024` (100% of the Worker's traffic), built from `45a2721`.
- Isolation: no custom domains, no routes, workers.dev only. No Worker variables/secrets; only binding is
  `WORKER_SELF_REFERENCE`. Pages project `driver-hub-web` unchanged; `cfd0b541` still serves app.sacredpathway.org.
- Signed out: `scripts/smoke-auth-gate.mjs` 161/161. Bypass header on 10 protected routes: 307 to sign-in,
  empty body. 24-route status/redirect matrix identical to production (Location is relative on the Worker,
  absolute on Pages).
- Signed in (owner's existing account, read-only): dashboard, loads, load detail/edit forms, drivers,
  driver detail/edit forms, payroll list, draft paystub (only Issue + Delete draft offered), settlements,
  expenses, documents, fleet, brokers, reports (5), settings, team all rendered 200 with no error boundary.
  CSV routes (revenue, expenses, drivers, payroll, cpa): 200 `text/csv` attachment. Print pages: 200 when paced.
  `/join/<invalid>`: "invite link is invalid" (no accept offered). Sign-out cleared Supabase cookies; protected
  routes redirect again.
- **BLOCKER — Workers Free plan CPU limit.** _(Cleared 2026-10-01 by the Workers Paid upgrade — see
  "Reliability retest — Workers Paid" below.)_ The account is on Workers Free (10 ms CPU per request). Bursts of
  signed-in requests return **503 Error 1102 "Worker exceeded resource limits"**. Ordinary navigation (Next.js
  link prefetch) produced 503 on ~10 of 53 RSC requests, including `/loads`, `/payroll`, `/drivers`,
  `/settlements`, and showed the route error boundary. Paced requests succeed. Signed-out routes unaffected.
  Fix options (owner decision): Workers Paid ($5/mo, 5 min CPU) before any cut-over; and/or reduce per-request
  CPU (disable link prefetch). Do not cut over on the Free plan.
- Not executed (would mutate production data): every server action — create/edit/delete loads, drivers,
  expenses, fleet; paystub create/lines/issue/void/mark-paid/delete; legacy settlement convert; document
  upload/delete; company profile/logo/paystub prefs; team invites/revoke/remove; join accept. Wiring verified
  only (forms carry server-action references). Invite email: not configured, not tested.

## Worker CPU reliability — characterization (2026-10-01)

- Account plan (dashboard, Workers plans): **Workers Free — 10 ms CPU per request**, 100k requests/day.
- Preview Worker `driver-hub-web-worker` version `12abe18b`, last 24 h (dashboard Metrics): 460 invocations,
  error rate 10.2 %, **CPU time P50 12.76 ms, P90 80.57 ms, P99 193 ms, P99.9 234 ms**.
- Pages production `driver-hub-web`, last 24 h: 809 success / 6 errors (all "Script Threw Exception",
  0 "Exceeded CPU Time Limits"), CPU P50 5.66 ms, P75 12.9 ms, P99 104.7 ms. The OpenNext Worker uses roughly
  twice the median CPU of the next-on-pages build, and its median is already above the Free limit.
- Local causes investigated (no change made):
  - Middleware: one `auth.getUser()` call — network I/O, negligible CPU. No loops, no logging.
  - `(app)/layout.tsx`: `getUser()` + `resolveAccess()` (second `getUser()`, profiles, carrier_members) +
    branding profile + signed logo URL on every render. Mostly I/O; small CPU.
  - Link prefetch: each signed-in page view prefetches ~10 sidebar routes, each re-rendering the dynamic
    `(app)` layout. Same behaviour on production (Next 15.0.7). Turning it off would cut request volume
    but not the per-render cost (P50 > 10 ms), so it would not make the Worker reliable on Free.
  - No accidental static->dynamic change (route types identical to 7be759e), no debug code.
- Conclusion: **no safe local optimization fixes this**. The Worker needs **Workers Paid**
  (checkout shown 2026-10-01: Workers Paid Plan, $5/month base fee charged today; includes 10M requests and
  30M CPU-ms per month, 30 s CPU per request; overage $0.30 per million requests, $0.02 per million CPU-ms).
  Not purchased at the time of this characterization — owner decision. _(Later 2026-10-01: owner upgraded
  to Workers Paid; see "Reliability retest — Workers Paid" below.)_
- Reliability retest not run at that point: the blocker was unchanged, so it would only have reproduced the
  Free-plan failures. Retest completed after the upgrade (next section).

## Reliability retest — Workers Paid (2026-10-01)

**Status: CPU/resource-limit blocker CLEARED.** The owner upgraded the Cloudflare account to Workers Paid.
That resolved the Error 1102 "Worker exceeded resource limits" failures seen on Workers Free.

- No redeploy was required. The preview Worker `driver-hub-web-worker` remains version `12abe18b`
  (`12abe18b-c5ac-4943-844f-d6616abd4024`, built from `45a2721`), workers.dev only.
- No Worker code, routes, custom domains, DNS, or other Cloudflare settings were changed for the retest.

| Test | Workers Free (before) | Workers Paid (after) |
|---|---|---|
| Signed-out smoke (`node scripts/smoke-auth-gate.mjs <preview-url>`) | 161/161 | 161/161 |
| Signed-in burst (parallel, RSC prefetch + full page) | ~10 of 53 requests failed with 503 / Error 1102 | 120/120 HTTP 200, 0 x Error 1102, 0 x 503 |
| Signed-in full-page burst (parallel) | not run | 48/48 HTTP 200, no error screens, no redirects/kicks back to sign-in |

- Coverage: dashboard, loads, payroll, drivers, settlements, and reports (plus expenses, documents, fleet,
  brokers, settings, team). The 120-request burst sent each route 5 times as both an RSC prefetch request
  and a full-page request. The 48-request burst sent 4 full-page requests per route.
- Method: owner's signed-in Chrome session on the preview URL; same-origin `fetch` with `redirect: "manual"`,
  so any redirect to sign-in would have shown as a non-200. Response bodies were checked for Error 1102
  and the route error boundary.
- All requests were read-only GETs. No server actions were invoked and no application data was written.

### Deployment boundary (unchanged)

- `app.sacredpathway.org` is still served by Cloudflare Pages project `driver-hub-web`, production
  deployment `cfd0b541` (build `UUr70QOPgsQt1_wIkFrcL`, Next 15.0.7).
- Production cut-over to the Worker has **not** occurred. The domain has not been migrated.
- Production cut-over (External steps 5–7 above) requires separate, explicit owner approval.

## Option B proxy rehearsal — Pages → Worker service binding (2026-10-01)

Why Option B: `sacredpathway.org` DNS is on Google Cloud DNS (registrar Squarespace), not Cloudflare. The
Cloudflare account has no zones, so a Worker custom domain or route for `app.sacredpathway.org` is not
possible without moving DNS. Instead, the existing Pages project `driver-hub-web` (which owns the custom
domain) forwards every request to the Worker through a service binding.

- Proxy: `~/Developer/cutover-proxy/_worker.js` (outside this repo), one line:
  `export default { fetch: (req, env) => env.APP.fetch(req) };` — no `wrangler.toml`, no static files.
- Pages Preview binding: `APP` → `driver-hub-web-worker` (entrypoint default). Production bindings: empty.
- Preview deployment: branch `cutover-rehearsal`, deployment `674e01eb` (alias
  `https://cutover-rehearsal.driver-hub-web.pages.dev`). First deploy `fa9189ff` predates the binding and
  returned 500 / Error 1101 (`env.APP` undefined) until redeployed.
- Worker reached: `12abe18b`, unchanged, no redeploy. Served build ID `inJSNIeGwHBPgu9GrZDdH` is identical
  direct and through the proxy.

Results through the proxy (read-only; no application data written):

| Test | Result |
|---|---|
| Signed-out smoke (`scripts/smoke-auth-gate.mjs`) | 161/161 |
| Signed-in burst (12 routes x 5, RSC prefetch + full page) | 120/120 HTTP 200, 0 x 1102, 0 x 503, 0 auth kicks, 120/120 `x-opennext: 1` |
| Signed-in full-page burst | 48/48 HTTP 200, no error boundary, no auth kicks |
| Session cookies (`sb-…-auth-token.0/.1`) | PASS |
| Redirects / query strings / `//dashboard` 308 | identical to direct Worker |
| RSC request headers (`text/x-component`, `Vary: rsc, …`) | PASS |
| Hostname preserved (absolute redirects use the requesting host) | PASS |
| `x-middleware-subrequest` bypass header | still blocked (307 to sign-in) |
| CSV exports revenue / expenses / drivers / payroll / cpa | 5/5 HTTP 200 attachment |
| Load detail, draft paystub (Issue only, no Mark Paid) | PASS |

No behavioural difference found between direct Worker and proxied requests. Not tested: sign-out
(see below) and magic-link sign-in (preview host is not a Supabase redirect URL; verify on production).

### Findings to handle separately (pre-existing on production `cfd0b541` too; not cut-over blockers)

1. Global sign-out. `app/auth/signout/route.ts` calls `supabase.auth.signOut()`. Installed
   `@supabase/auth-js` 2.106.0 (`GoTrueClient.signOut(options = { scope: 'global' })` →
   `POST /logout?scope=global`) revokes every session for the user, including other browsers and the iPhone
   app if it uses the same login. Proposed follow-up patch (requires a new Worker build/deploy, so it is NOT
   part of this cut-over):
   ```diff
   -  await supabase.auth.signOut();
   +  await supabase.auth.signOut({ scope: "local" });
   ```
2. Unvalidated `next` in `app/auth/callback/route.ts`: `new URL(next, request.url)` accepts absolute URLs,
   so a crafted `next=https://…` redirects off-site after a successful sign-in. Follow-up: accept only paths
   that start with a single `/`.

## Session-renewal bug (result B) and auth fixes (2026-10-01)

### Root cause
Signed-in session test on the proxied preview: after the access token's natural refresh, every request was
redirected to sign-in (168/168). Supabase auth logs showed `token_refreshed` succeeding, but the browser was
left with chunks `sb-…-auth-token.0/.1` whose combined value no longer decoded. The middleware used the
deprecated per-cookie `get` / `set` / `remove` adapter, under which `@supabase/ssr` 0.5.2 can write the
chunks of one refreshed session onto different response objects (each `set` rebuilt `NextResponse.next()`),
so only some chunks reached the browser. `git diff 7be759e 45a2721` shows this middleware is unchanged apart
from comments, so the bug is pre-existing on production `cfd0b541`, not introduced by the Worker.

### Fixes (uncommitted on `security/nextjs-cloudflare-workers-upgrade`)
- `middleware.ts`, `lib/supabase/server.ts`, `app/auth/callback/route.ts`, `app/auth/signout/route.ts`:
  switched to the `getAll()` / `setAll()` cookie adapter; all chunks of one refresh land on the same response
  and are forwarded to downstream server components.
- `app/auth/signout/route.ts`: `signOut({ scope: "local" })` — signs out this browser only (was global).
- `lib/auth/safeNext.ts` (new): same-origin path validation for `next`; used by the callback and the
  sign-in page. Rejects `//host`, absolute URLs, `/\host`, control characters, `javascript:`.
- Tests: `middleware.test.ts` (chunk-set tests), `lib/auth/safeNext.test.ts` (23),
  `app/auth/callback/route.test.ts` (9), `app/auth/signout/route.test.ts`.
- Local gates: vitest 28 files / 292 tests pass; `tsc --noEmit` 0; `next lint` pass (one pre-existing
  `<img>` warning in `settings/LogoCard.tsx`); `next build` compiles.

### Auth-fix Worker
- `npm run cf:deploy` → Worker `driver-hub-web-worker` version **`b241b631-a157-406f-ad4a-5ea86bd05dce`**
  (100%), build ID **`iXrwYWh3RJwxZA6FxVpSF`**, deployed 2026-10-01 19:50 UTC.
- Previous version `12abe18b` (build `inJSNIeGwHBPgu9GrZDdH`) retained in version history (rollback target).
- Production unchanged: `app.sacredpathway.org` → Pages `cfd0b541` (`x-edge-runtime: 1`), Production
  services empty.
- Proxy now carries `wrangler.toml` (`[[services]] APP → driver-hub-web-worker`); preview deployment
  `76e79373` (branch `cutover-rehearsal`). The binding resolves the Worker's active version, so the new
  version is live on the preview without a proxy redeploy.

### Preview rehearsal on `b241b631` (read-only)

| Test | Result |
|---|---|
| Preview serves new build | `x-opennext: 1`, build `iXrwYWh3RJwxZA6FxVpSF` |
| Signed-out smoke (`scripts/smoke-auth-gate.mjs`) | 161/161 (incl. `x-middleware-subrequest`, path variants) |
| `next` validation (`/auth/signin?next=//evil.example`) | form receives `nextPath: "/dashboard"` |
| Signed-in full-page burst (10 routes x 12) | 120/120 HTTP 200, 0 kicks |
| Signed-in RSC prefetch burst (6 routes x 8) | 48/48 HTTP 200 |
| CSV exports revenue / expenses / drivers / payroll / cpa | 5/5 HTTP 200 |
| Load detail, draft paystub, paystub print | 200 / 200 / 200 |
| 1101 / 1102 / 503 | 0 / 0 / 0 |
| Session cookie after sign-in | 2 chunks, combined value decodes |
| Natural-expiry renewal (access token exp 20:59:29 UTC, tested 21:09:20 UTC) | **PASS** — see below |
| Local sign-out | not verified live (no disposable account); unit-tested only |
| Magic link | post-cut-over production check (preview host not a Supabase redirect URL) |

### Natural-expiry session-renewal gate — PASS (2026-10-01)

Same browser session as the rehearsal above (signed in 19:59 UTC on the preview); no re-sign-in, no cookie
edits, no data writes. Only read-only GETs.

- Original access-token expiry: **20:59:29 UTC**. Renewal check started **21:09:20 UTC** (~10 min after expiry).
- Cookie before the first request: 2 chunks, decodes, `expires_at` 20:59:29 (expired).
- First protected request (`/dashboard`) refreshed the session server-side. Cookie afterwards: 2 chunks,
  decodes, new `expires_at` **22:09:21 UTC** (new access + refresh token pair; token values not recorded).
- Supabase auth logs (20:55–21:15 UTC): exactly one `POST /token grant_type=refresh_token` → **200** at
  21:09:21 (old refresh token rotated/revoked as normal), then 48 × `GET /user` → 200. No failed auth calls,
  no refresh storm, no sign-in.
- Renewal sequence `/dashboard, /loads, /payroll, /drivers, /reports, /dashboard`: 6/6 HTTP 200, 0 redirects
  to `/auth/signin`, no sign-in form, `x-opennext: 1` on all.
- Post-renewal regression (x2): `/dashboard, /loads, /payroll, /drivers, /settlements, /reports,
  /reports/revenue, /reports/payroll` 16/16 HTTP 200, plus settlement detail 200; no error screens. Cookie
  still decodes with expiry 22:09:21 after the regression (session stable, no repeated refresh).
- Errors during renewal and regression: 0 × 1101, 0 × 1102, 0 × 500, 0 × 503.
- Contrast with result B on the old adapter: same flow left an undecodable chunk pair and 168/168 kicks.

**Final preview QA: PASS.** Worker `b241b631` / build `iXrwYWh3RJwxZA6FxVpSF` is ready for an owner
cut-over decision. Cut-over is NOT authorized by this result.

### Current state and approved architecture (2026-10-01)

- Before cut-over: `app.sacredpathway.org` → Pages `driver-hub-web` deployment `cfd0b541` (old app,
  `x-edge-runtime: 1`). Now: proxy `ab4973d3` → Worker `b241b631`.
- DNS: Google Cloud DNS, `app` CNAME → `driver-hub-web.pages.dev`. Unchanged and stays unchanged.
- Approved future architecture (execution requires explicit owner authorization):
  `app.sacredpathway.org` → existing Pages custom domain → thin Pages proxy → Worker
  `driver-hub-web-worker` version `b241b631`. The custom domain stays on Pages; no DNS or nameserver change;
  no direct Worker custom domain.
- Rollback: Pages → `cfd0b541` (immediate). Worker-level rollback version: `12abe18b` (retained; would
  reintroduce the session bug).
- Production cut-over: DONE 2026-10-01 21:46:53 UTC (see "PRODUCTION CUT-OVER — PASS").

## PRODUCTION CUT-OVER — PASS (2026-10-01)

Owner-authorized. Performed exactly as documented below; no Worker rebuild/redeploy, no code change, no DNS,
nameserver, custom-domain or Supabase change.

- Pre-checks 21:42 UTC: production `cfd0b541` (`x-edge-runtime: 1`), Worker `b241b631` 100%, preview
  `x-opennext: 1` + build `iXrwYWh3RJwxZA6FxVpSF`, preview `APP` → `driver-hub-web-worker`, production config
  had no env vars and the same compatibility date/flags as the proxy, DNS CNAME → `driver-hub-web.pages.dev`,
  Google Cloud DNS nameservers. All PASS.
- Cut-over: owner ran `npx wrangler pages deploy --branch main --commit-dirty=true` from
  `~/Developer/cutover-proxy`. New production Pages deployment **`ab4973d3-bf04-4d5a-bc7c-1049759db349`**,
  created **2026-10-01 21:46:53 UTC**, stage success, alias `https://app.sacredpathway.org`. Production
  services now `APP` → `driver-hub-web-worker`; env vars none.
- Production architecture: `app.sacredpathway.org` → Pages custom domain → proxy `ab4973d3` → Worker
  `driver-hub-web-worker` **`b241b631-a157-406f-ad4a-5ea86bd05dce`** (100%), build **`iXrwYWh3RJwxZA6FxVpSF`**.

Production QA (read-only):

| Gate | Result |
|---|---|
| Header | `x-opennext: 1` (was `x-edge-runtime: 1`); build `iXrwYWh3RJwxZA6FxVpSF` served |
| Anonymous smoke (`scripts/smoke-auth-gate.mjs https://app.sacredpathway.org`, 21:47 UTC) | **161/161** |
| Unsafe `next` | `/auth/signin?next=//evil.example` → `nextPath: "/dashboard"`; callback with `//`, `https://`, `/\` `next` and no/invalid code → `/auth/signin?error=…` on app host |
| Sign-out | GET → 405 (POST-only); `scope: "local"` (unit-tested; not exercised on the real account) |
| Critical routes | dashboard, loads, payroll, drivers, settlements, reports, revenue report, payroll report, expenses, documents, fleet, settings, team: 13/13 200 |
| Detail pages | load detail, settlement detail, draft paystub, paystub print: 200 |
| CSV exports | revenue / expenses / drivers / payroll / cpa: 5/5 200 (row counts identical to preview) |
| Signed-in full-page burst (10 routes x 12) | **120/120** 200, 0 kicks, 0 error screens |
| Signed-in RSC prefetch (6 routes x 8) | **48/48** 200 |
| Session cookie | 2 chunks, decodes, stable through all tests (exp 22:49:57 UTC) |
| Supabase auth logs 21:45–22:05 UTC | 2 × `/token grant_type=password` 200 (owner sign-in), 663 × `/user` 200, 0 failures |
| Worker analytics since 21:46 UTC | 567 requests, all `success`, 0 errors |
| 1101 / 1102 / 500 / 503 | 0 / 0 / 0 / 0 |

Production-only auth findings:
- Magic link (`signInWithOtp`) and password reset (`resetPasswordForEmail`) build their redirect from
  `window.location.origin` → `https://app.sacredpathway.org/auth/callback?next=…` — same origin and path as
  `cfd0b541`, so the existing Supabase redirect allow-list applies unchanged. Not sent (no extra emails to the
  real account); first real magic-link/reset use should be watched.
- Callback reaches Supabase from the Worker: an invalid code is exchanged and fails safely back to sign-in.
- The owner's browser held an undecodable `.0/.1` cookie pair (3180 + 1081 chars) left over from the
  pre-fix result-B test; it was redirected to sign-in once (expected) and replaced by signing in.

Rollback: not required. Pages rollback target **`cfd0b541`** retained (preview URL 200). Worker `12abe18b`
retained (contains the session bug). DNS unchanged: `app` CNAME → `driver-hub-web.pages.dev`, Google Cloud
DNS nameservers. No deployments deleted.

### Production cut-over (Option B) — owner approval required; performed 2026-10-01, see above

The Pages project's Production bindings are locked to `wrangler.toml` ("Bindings for this project are being
managed through wrangler.toml"), so the binding is supplied by the proxy's `wrangler.toml`, not the dashboard.

1. From `~/Developer/cutover-proxy` (contains `dist/_worker.js` + `wrangler.toml` with `APP` →
   `driver-hub-web-worker`): `npx wrangler pages deploy --branch main`.
   This creates a new Pages production deployment containing only the proxy. The custom domain stays on
   Pages; DNS does not change; Worker `b241b631` is reused as is.
2. Verify: `curl -sI https://app.sacredpathway.org/` → `x-opennext: 1`; smoke 161/161; signed-in spot checks;
   magic-link sign-in on production.
3. Rollback: Pages → Deployments → `cfd0b541` → Rollback to this deployment (instant). Worker rollback, if
   ever needed: `wrangler rollback 12abe18b` (would reintroduce the session bug).
