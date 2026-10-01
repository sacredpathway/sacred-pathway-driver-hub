# Next.js security upgrade + Cloudflare Workers (OpenNext) — local only

Branch `security/nextjs-cloudflare-workers-upgrade`, based on `7be759e`
(the source of production deployment `cfd0b541`, build `UUr70QOPgsQt1_wIkFrcL`).
Nothing in this change has been deployed. Production still runs `7be759e` on
Cloudflare Pages.

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
