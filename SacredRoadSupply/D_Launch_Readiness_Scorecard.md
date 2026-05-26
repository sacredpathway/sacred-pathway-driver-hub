# D. Launch Readiness Scorecard

**Purpose:** One-page go/no-go gate. Score must hit **100/100** before product imports begin.
**Scoring:** Each line = 1 to 5 points. Total possible = 100.
**Update frequency:** Re-score weekly until launched.

---

## Section 1 — Foundation (25 pts)

| Item | Pts | Status | Notes |
|---|---|---|---|
| Shopify Basic plan active + paid | 5 | ☐ | Checklist A §2 |
| Shopify Payments activated, test charge succeeds | 5 | ☐ | A §4 |
| Shopify Tax configured for AL nexus | 3 | ☐ | A §5 |
| Shipping zones set (US-48 + AK/HI + APO) | 3 | ☐ | A §6 |
| All 5 policy pages populated with real content | 5 | ☐ | A §7 |
| Email aliases routing to hello@ | 2 | ☐ | A §11 |
| All required apps installed (Zendrop, CJ, Inbox, Judge.me) | 2 | ☐ | A §10 |
| **Section 1 subtotal** | **/25** | | |

---

## Section 2 — Domain & SSL (15 pts)

| Item | Pts | Status | Notes |
|---|---|---|---|
| CNAME `shop` → `shops.myshopify.com` live in Squarespace | 5 | ☐ | Checklist B §1 |
| Shopify shows domain "Connected" + SSL active | 5 | ☐ | B §3–4 |
| `https://shop.sacredpathway.org` loads with green padlock | 3 | ☐ | B §5 |
| `sacredpathway.org` + subdomains still resolve correctly | 2 | ☐ | B §6 |
| **Section 2 subtotal** | **/15** | | |

---

## Section 3 — Supplier Verification (20 pts)

| Item | Pts | Status | Notes |
|---|---|---|---|
| All 4 sample orders placed | 2 | ☐ | Checklist C §"Before" |
| All 4 samples arrived + logged in tracker | 2 | ☐ | C "On Arrival" |
| Dual Dash Cam decision logged (LIST/TRY CJ/DROP) | 4 | ☐ | tracker SKU 1 |
| Charger decision logged | 4 | ☐ | tracker SKU 2 |
| Bluetooth Headset decision logged | 4 | ☐ | tracker SKU 3 |
| Waterless Wash decision logged | 4 | ☐ | tracker SKU 4 |
| **Section 3 subtotal** | **/20** | | |

---

## Section 4 — Catalog Final (15 pts)

| Item | Pts | Status | Notes |
|---|---|---|---|
| Final SKU count ≥ 18 after verification | 5 | ☐ | Catalog xlsx |
| All "VERIFY" flags in catalog resolved | 5 | ☐ | xlsx Notes column |
| SEO titles + meta descriptions confirmed (≤60 + ≤155 chars) | 3 | ☐ | xlsx |
| Each SKU has primary + secondary supplier identified | 2 | ☐ | xlsx |
| **Section 4 subtotal** | **/15** | | |

---

## Section 5 — Branding & Assets (15 pts)

| Item | Pts | Status | Notes |
|---|---|---|---|
| Logos uploaded (header SVG + favicon PNG) | 3 | ☐ | PNG exports ready |
| 8 collection tile PNGs ready for upload | 3 | ☐ | png_exports/collection_tiles/ |
| 6 trust badge PNGs ready for upload | 2 | ☐ | png_exports/trust_badges/ |
| Hero candidate URLs submitted by user | 2 | ☐ | Hero workflow Step 3 |
| Hero image licensed + downloaded | 3 | ☐ | Workflow Step 5 |
| Hero exports built (desktop / mobile / OG / about) | 2 | ☐ | Workflow Step 6 |
| **Section 5 subtotal** | **/15** | | |

---

## Section 6 — Theme & Pages (10 pts)

| Item | Pts | Status | Notes |
|---|---|---|---|
| Dawn theme installed, color schemes + fonts set | 2 | ☐ | Homepage impl §Theme |
| Header logo + nav menu built | 2 | ☐ | Homepage impl §Nav |
| All 12 homepage sections placed (still hidden/draft) | 3 | ☐ | Homepage impl §Sections |
| About / Contact / FAQ pages created | 2 | ☐ | Store content doc |
| Footer 4-column menus built | 1 | ☐ | Homepage impl §Footer |
| **Section 6 subtotal** | **/10** | | |

---

## Final Tally

| Section | Subtotal |
|---|---|
| 1. Foundation | __/25 |
| 2. Domain & SSL | __/15 |
| 3. Supplier Verification | __/20 |
| 4. Catalog Final | __/15 |
| 5. Branding & Assets | __/15 |
| 6. Theme & Pages | __/10 |
| **TOTAL** | **__/100** |

---

## Gate Rules

| Score | Status | Action |
|---|---|---|
| **100/100** | 🟢 GREEN — go for product import | Start importing the 18–20 approved SKUs via Zendrop |
| **85–99** | 🟡 YELLOW — close, fix gaps | Don't skip the remaining items. List what's missing, finish, re-score. |
| **70–84** | 🟠 ORANGE — partial — do not import | Major work remaining. Stay in pre-launch phase. |
| **< 70** | 🔴 RED — not ready | Identify blocker (usually verification or DNS) and concentrate on it. |

**No partial launches.** Either the score hits 100 and we ship, or we keep building. Half-built dropship stores leak refunds.

---

## Items NOT in the scorecard (intentional — defer to post-launch)

- Klaviyo migration (defer to month 2)
- Branded apparel via Trendsi (Phase 2)
- Original product photography (Phase 2)
- Influencer outreach (week 2 post-launch)
- Blog content publication (month 2+)
- Meta / Google Ads campaigns (launch day + week 1)
- iOS Driver Hub "Sacred Road Supply" link (next iOS submission, non-blocking)
- Push notification / SMS marketing (Phase 2)

These are growth levers, not launch blockers.

---

## Current Score (as of 2026-05-25)

```
1. Foundation:           0/25  — Shopify account not yet created
2. Domain & SSL:         0/15  — CNAME not yet added
3. Supplier Verification: 0/20 — samples not yet ordered
4. Catalog Final:        15/15 — locked at 20 SKUs (subject to verification adjustments)
5. Branding & Assets:    10/15 — logos + tiles + badges done; hero pending
6. Theme & Pages:         0/10 — no theme installed yet
─────────────────────────
TOTAL:                   25/100 → 🔴 RED
```

**Path to 100:**
1. Run Checklist A → +25 pts (Shopify built)
2. Run Checklist B → +15 pts (domain live)
3. Run hero workflow → +5 pts (image set)
4. Run Checklist C → +20 pts (verification complete)
5. Run theme + pages build (Implementation 01 + 02) → +10 pts
6. Update catalog after verification → catalog stays at 15 pts (or drops if SKUs removed)

Estimated total active time: **~12 hours of your work over ~2 weeks** (most of that is waiting for samples + DNS propagation).

---

## How to Use This Scorecard

1. Print or copy this file
2. As each item completes, mark the box ☐ → ☑
3. Re-tally weekly
4. When you hit 100, send me a screenshot — I'll greenlight product import phase
5. Do not import a single product until that screenshot says 100/100
