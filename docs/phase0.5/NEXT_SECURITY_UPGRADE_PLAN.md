# Next.js security upgrade plan (NOT performed) — 2026-09-30

Current: `next@15.0.7`, React 18.3.1, `@cloudflare/next-on-pages@1.13.16`,
Cloudflare **Pages** project `driver-hub-web`, 52 routes, auth gate in
`middleware.ts`, `images.unoptimized: true`, every route `runtime = "edge"`.

## What the advisory data says

`npm audit` against an isolated install of each candidate (React 18.3.1):

| next | open Next.js advisories |
|---|---|
| 15.0.7 (today) | 32 — incl. **critical middleware authorization bypass** (<15.2.3) and several middleware/proxy bypasses (<15.5.16, <15.5.18) |
| 15.5.2 (highest `@cloudflare/next-on-pages` allows) | 31 |
| **15.5.24** | **0** |
| 15.5.26 (latest 15.x) | 0 |

**Smallest version that clears every current Next.js advisory: `15.5.24`.**
The last two fixed there (<15.5.24) are RCE issues in the image optimizer
(AVIF) and on Windows hosts — neither applies here (`images.unoptimized`,
Linux/edge), but the middleware-bypass fixes below them do apply, because
`middleware.ts` is this app's sign-in gate. (Data access stays protected by
RLS regardless — a bypass exposes page shells, not other carriers' rows.)

## The blocker: the Cloudflare adapter

- `@cloudflare/next-on-pages` (deprecated upstream) declares
  **`next >=14.3.0 <=15.5.2`**. Every fixed version is outside its supported
  range. Installing 15.5.24 would need `--legacy-peer-deps` and an unsupported
  adapter — builds may work, but nobody supports that combination.
- The supported adapter is **`@opennextjs/cloudflare`** (latest 1.20.7), which
  requires **`next >=15.5.26`** and `wrangler ^4.125`, and deploys to
  **Cloudflare Workers**, not Pages.

## Recommendation

Upgrade in one separately authorized change to **`next@15.5.26` +
`@opennextjs/cloudflare`**, keeping React 18.3.1 (supported by 15.5.x).

Fallback if a Workers migration isn't wanted yet: `next@15.5.24` with
next-on-pages under `--legacy-peer-deps`, clearly labelled unsupported, and
only after a full preview-deploy smoke test.

## Compatibility risks to check in that change

1. **Hosting move Pages → Workers**: new `wrangler.jsonc`, `open-next.config.ts`,
   env vars re-created as Worker vars/secrets, custom domain
   `app.sacredpathway.org` re-pointed. Deploy to a preview URL first.
2. **`export const runtime = "edge"`** on routes: OpenNext runs the Node
   runtime on Workers; edge-runtime declarations must be removed or verified.
3. **Middleware**: 15.x middleware semantics unchanged for this app's usage,
   but re-test: signed-out redirect, `?next=` round-trip, cookie refresh
   propagation (`propagateCookies`), `/join/[code]` staying public.
4. **`@supabase/ssr` cookies** under the Node runtime on Workers.
5. **`eslint-config-next`** must move to the same version; ESLint 8 still
   supported by 15.5.
6. **Build tooling advisories** (`wrangler` 3 → 4 clears the `esbuild`,
   `miniflare`, `undici`, `sharp`, `ws` findings) — part of the same change.
7. **Route count**: expect the same 52 app routes; OpenNext adds no app routes.
8. **Tests/CI**: `npm ci`, lint, typecheck, 94 unit tests, `next build`, plus
   the OpenNext build (`opennextjs-cloudflare build`) and a preview deploy.

Not upgrading to Next 16 — out of scope, bigger breaking surface.
