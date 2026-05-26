# Homepage Implementation Package — Shopify Dawn Build

**Theme:** Dawn (latest, official Shopify free theme)
**Page:** Online Store → Themes → Customize → Home page
**Goal:** Section-by-section paste-in instructions. Build top-to-bottom in this exact order.

---

## Pre-Build: Theme Settings (one-time, applies sitewide)

Path: Online Store → Themes → Customize → **Theme settings** (gear icon, bottom of left rail).

### Colors — Premium Marketing Tier (4 schemes)

Click **Colors** in Theme settings. Dawn lets you create multiple color schemes. Add 4 schemes total. Pull every hex from `BRAND_PALETTE_REFERENCE.md` exactly. Primary CTA gold stays `spGold #CCAD42` across all schemes — the ecosystem anchor.

**Scheme 1 — `Brand Light` (product pages, FAQ, About, policies)**
- Background: `#FFFFFF` (`spBackground`)
- Text: `#1A1A1A` (`spTextPrimary`)
- Solid button background: `#CCAD42` (`spGold` — primary CTA)
- Solid button label: `#0A2F1F` (`srsEmeraldDeep`)
- Outline button: `#0A2F1F`
- Outline button text: `#0A2F1F`
- Links: `#0A2F1F`

**Scheme 2 — `Brand Dark` (hero, footer, premium feature sections)**
- Background: `#0A2F1F` (`srsEmeraldDeep`)
- Text: `#F5F0E1` (`srsCream`)
- Solid button background: `#CCAD42` (`spGold` — primary CTA)
- Solid button label: `#0A2F1F`
- Outline button: `#F0D87C` (`srsGoldHighlight` — sheen border for premium feel)
- Outline button text: `#F0D87C`
- Links: `#F0D87C`

**Scheme 3 — `Accent` (announcement bar, trust strip)**
- Background: `#051B12` (`srsEmeraldBlack`)
- Text: `#F0D87C` (`srsGoldHighlight`)
- Solid button background: `#CCAD42` (`spGold`)
- Solid button label: `#0A2F1F`

**Scheme 4 — `Card Inset` (collection cards on dark hero, secondary CTAs)**
- Background: `#1A4D26` (`spDarkGreen` — bridge to iOS Driver Hub)
- Text: `#F5F0E1` (`srsCream`)
- Solid button background: `#CCAD42` (`spGold`)
- Solid button label: `#0A2F1F`
- Accent: `#F0D87C` (`srsGoldHighlight`)

⚠️ **Use `srsGoldHighlight #F0D87C` only for hover states, gradient sheen, and outline accents — never as the default CTA color.** `spGold #CCAD42` remains the ecosystem primary across every scheme so Sacred Road Supply matches Driver Hub, Sacred Bill Tracker, and iSacred Cal.

### Typography

Theme settings → **Typography**:
- Heading: **Playfair Display** (search "Playfair") · Size: Default · Weight: 700
- Body: **Inter** · Size: Default · Weight: 400 (with 600 for emphasis)

### Layout

Theme settings → **Layout**:
- Page width: 1600 px
- Spacing → Section vertical padding: Default

### Social Media

Theme settings → **Social media** — paste these URLs (Sacred Pathway accounts):
- Facebook: `https://www.facebook.com/share/17ZJr3uZPR/?mibextid=wwXIfr`
- Instagram: `https://www.instagram.com/sacredpathwayapp`
- TikTok: `https://www.tiktok.com/@sacredpathwayapp`
- X (Twitter): `https://x.com/SacredPathwayap`

### Favicon

Theme settings → **Favicon**:
- Upload `03_Logo_Compact.svg` (export to 180×180 PNG first if Shopify requires raster)

---

## Header (sitewide, edit once)

Path: Customize → click on header at top of page preview.

| Field | Value |
|---|---|
| Logo image | Upload `03_Logo_Primary.svg` |
| Custom logo width | **220** |
| Menu | `Main menu` (you'll build below in Navigation step) |
| Color scheme | Scheme 1 — Brand |
| Sticky header | ✅ On scroll up |
| Show line separator | ✅ |
| Enable country/region selector | ❌ |
| Enable language selector | ❌ |

---

## Announcement Bar (above header)

Customize → click the announcement bar.

| Field | Value |
|---|---|
| Color scheme | Scheme 3 — Accent |
| Auto-rotate | ✅ Every 5 seconds |
| Show social media icons | ❌ |

**Announcement messages (add 3 — they rotate):**

1. Text: `FREE SHIPPING ON ORDERS $75+`
2. Text: `USE CODE ROADREADY FOR $5 OFF YOUR FIRST ORDER` · Link: `/collections/all`
3. Text: `SHIPS FROM U.S. WAREHOUSES · 30-DAY RETURNS`

---

## Section 1 — Image Banner (Hero)

Customize → home page → click "Image banner" section (or Add section → Image banner).

| Field | Value |
|---|---|
| Image | **Upload your licensed hero image** (2880×1200 desktop after color grade) |
| Image (mobile, if Dawn shows option) | Mobile crop 1080×1350 |
| Image height | Large |
| Image overlay opacity | **25%** |
| Color scheme | Scheme 2 — Inverse |
| Image behavior | Fixed (parallax disabled — better mobile perf) |
| Desktop content position | Bottom left |
| Desktop content alignment | Left |
| Show text box | ✅ |
| Mobile content alignment | Center |

**Blocks (in order):**

**Block 1 — Heading:**
- Heading: `Gear Built for the Long Haul.`
- Heading size: **XL**

**Block 2 — Subheading:**
- Text: `Trucker-tested supplies, fast U.S. shipping, and prices that respect what you actually take home.`

**Block 3 — Button:**
- Button label: `Shop Now`
- Button link: `/collections/all`
- Style: Solid (gold)
- Open in new tab: ❌

**Block 4 — Button:**
- Button label: `New Driver? Start Here`
- Button link: `/collections/cdl-essentials`
- Style: Outline (white)
- Open in new tab: ❌

---

## Section 2 — Multi-Column (Trust Strip)

Customize → home page → Add section → **Multicolumn**.

| Field | Value |
|---|---|
| Heading | (leave blank) |
| Image width | Half-width |
| Column alignment | Center |
| Background | ✅ Background color (scheme 2 — Inverse) |
| Color scheme | Scheme 2 — Inverse |
| Columns per row (desktop) | 3 |
| Columns per row (mobile) | 1 |
| Section padding top | Small |
| Section padding bottom | Small |

**Columns (add 3):**

**Column 1:**
- Image: `branding_assets/trust_badges/badge_free_shipping.svg` (export PNG if needed)
- Heading: `Free U.S. Shipping`
- Description: `Orders $75 and up. Ships from U.S. warehouses in 3–7 days.`

**Column 2:**
- Image: `badge_returns.svg`
- Heading: `30-Day Returns`
- Description: `No restocking fees on unused gear. Real-person email support.`

**Column 3:**
- Image: `badge_driver_focused.svg`
- Heading: `Driver Focused`
- Description: `Built for owner-operators, fleet drivers, and CDL students. Picked by working trucking people.`

---

## Section 3 — Collection List (Shop by Category)

Customize → Add section → **Collection list**.

| Field | Value |
|---|---|
| Heading | `Built for Every Mile` |
| Heading size | Large |
| Color scheme | Scheme 1 — Brand |
| Image ratio | Square |
| Show "View all" button | ✅ |
| View all button link | `/collections` |
| Columns per row (desktop) | 4 |
| Columns per row (mobile) | 2 |

**Collections (add 8 in this order — each gets the tile image you uploaded to that collection):**

1. Cab Comfort
2. Driver Health & Fitness
3. Organization & Storage
4. Electronics & Mounts
5. Safety Equipment
6. Flashlights & Tools
7. Truck Cleaning Supplies
8. CDL Essentials

(Each collection's tile image comes from `branding_assets/collection_tiles/`. You'll upload each tile inside the collection itself — see `IMPLEMENTATION_02_Categories.md`. Once uploaded there, the Collection list on the homepage pulls those images automatically.)

---

## Section 4 — Featured Collection (This Week's Most-Ordered)

Customize → Add section → **Featured collection**.

| Field | Value |
|---|---|
| Heading | `This Week's Most-Ordered` |
| Description | `Real gear pulling its weight on real rigs.` |
| Collection | Create a new manual collection called `Featured` and add: 12V Heated Blanket, Lumbar Cushion, Sleeper Mattress Topper, Dual Dash Cam |
| Color scheme | Scheme 1 — Brand |
| Products to show | 4 |
| Columns per row (desktop) | 4 |
| Columns per row (mobile) | 2 |
| Show "View all" if more available | ❌ |
| Enable swipe on mobile | ✅ |
| Enable quick add | ✅ |
| Image ratio | Adapt to image |
| Show vendor | ❌ |
| Show rating | ✅ (once you have reviews) |

---

## Section 5 — Multi-Column (Why Drivers Choose Us)

Customize → Add section → **Multicolumn**.

| Field | Value |
|---|---|
| Heading | `Why Drivers Choose Sacred Road Supply` |
| Heading size | Medium |
| Image width | One-third width |
| Column alignment | Center |
| Color scheme | Scheme 1 — Brand |
| Columns per row (desktop) | 3 |
| Columns per row (mobile) | 1 |

**Columns:**

**Column 1:**
- Image: `badge_family_owned.svg`
- Heading: `Built by Trucking People`
- Description: `Sacred Pathway LLC is a working dry-van carrier in Alabama. We carry what works because we drive what works.`

**Column 2:**
- Image: `badge_free_shipping.svg`
- Heading: `Ships from U.S. Warehouses`
- Description: `Most orders ship the same or next business day. No 20-day China waits.`

**Column 3:**
- Image: `badge_support.svg`
- Heading: `Real-Person Support`
- Description: `30-day returns. No restocking fees on unopened gear. Real humans answer your email.`

---

## Section 6 — Image with Text (About / Origin Story)

Customize → Add section → **Image with text**.

| Field | Value |
|---|---|
| Image | A photo of a Sacred Pathway LLC truck (use one already on sacredpathway.org — the red Freightliner shot works) |
| Image height | Medium |
| Desktop image width | 50% |
| Desktop image position | Image first (left) |
| Content layout | Standard |
| Color scheme | Scheme 1 — Brand |

**Blocks:**

**Heading:** `Built by a Family Carrier in Alabama`
**Heading size:** Medium

**Text:**
```
Sacred Pathway LLC is a working dry-van freight carrier in Greensboro, Alabama (USDOT 4250348 / MC 1647441). Sacred Road Supply is our store — built so you stop overpaying $40 at a truck stop for gear that breaks in a week.

If it isn't useful at 3 a.m. in a rest area outside Amarillo, it isn't in this store.
```

**Button label:** `Read Our Story`
**Button link:** `/pages/about`
**Style:** Outline

---

## Section 7 — Email Signup

Customize → Add section → **Email signup**.

| Field | Value |
|---|---|
| Heading | `Get $5 Off Your First Order` |
| Description | `Join the Sacred Road Supply driver list. Gear drops, restock alerts, and a $5 code in your inbox right now.` |
| Color scheme | Scheme 2 — Inverse |
| Show separator | ❌ |
| Section padding top | Large |
| Section padding bottom | Large |

**Note:** The signup form submits to Shopify Customers → Newsletter subscribers automatically. To attach the $5 discount automatically, set up a Shopify Email automation: Marketing → Automations → "Welcome new subscribers" → use the email content from `05_Marketing_Kit.md` §1 Email 1.

---

## Section 8 — Featured Collection (CDL Essentials promo)

Customize → Add section → **Featured collection**.

| Field | Value |
|---|---|
| Heading | `New CDL? Start Here.` |
| Description | `Logbooks, permits, and the gear every new driver needs.` |
| Collection | `CDL Essentials` |
| Color scheme | Scheme 1 — Brand |
| Products to show | 3 (it's a 1-product collection at launch, so just show 1; alternative: change to "Multicolumn" linking to 3 starter products from across categories) |

**Recommended alternative for v1 (since CDL only has 1 SKU):** Use **Multicolumn** instead, with 3 manually-picked "starter pack" products:
1. CDL Logbook Binder ($29.95)
2. DOT Reflective Triangle Kit ($29.95)
3. 24V/12V USB-C Charger ($24.95)

Heading per column = product name. Each column links to the product page.

---

## Section 9 — Rich Text (Closing Tagline)

Customize → Add section → **Rich text**.

| Field | Value |
|---|---|
| Color scheme | Scheme 3 — Accent |
| Desktop content position | Center |
| Section padding top | Small |
| Section padding bottom | Small |

**Heading:** (leave blank)
**Text:**
> *From the truck stop to the loading dock — built for the long haul.*

Text style: Italic, size Medium, color gold (`#E6CC73` — `spGoldLight`).

---

## Footer

Customize → click footer.

| Field | Value |
|---|---|
| Color scheme | Scheme 2 — Inverse |
| Show email signup | ❌ (already have one in section 7) |
| Show payment icons | ✅ |
| Show country/region selector | ❌ |
| Show language selector | ❌ |
| Show social media icons | ✅ |

**Menu blocks (add 4):**

**Column 1 — Heading:** `Shop` · Menu: `Footer Shop` (build in nav)
**Column 2 — Heading:** `Help` · Menu: `Footer Help`
**Column 3 — Heading:** `About` · Menu: `Footer About`
**Column 4 — Heading:** `Legal` · Menu: `Footer Legal`

**Text block (above social row):**
```
From the truck stop to the loading dock — built for the long haul.

© 2026 Sacred Pathway LLC. Sacred Road Supply is a brand of Sacred Pathway LLC.
USDOT 4250348 · MC 1647441 · Greensboro, Alabama
```

---

## Final Page Section Order Summary

```
1. Announcement bar (sitewide)
2. Header (sitewide, logo + nav)
3. Image banner (Hero)
4. Multicolumn (Trust strip — 3 badges)
5. Collection list (Shop by Category — 8 tiles)
6. Featured collection (Most-Ordered — 4 products)
7. Multicolumn (Why drivers choose us — 3 columns)
8. Image with text (Origin story → /pages/about)
9. Email signup ($5 off)
10. Multicolumn (CDL starter pack — 3 products) OR Featured collection
11. Rich text (Closing tagline)
12. Footer (sitewide)
```

---

## Navigation Build

Path: Online Store → **Navigation**.

### Main Menu

Click `Main menu` → add items in this order:

```
Home → /
Shop → /collections/all
  └── Cab Comfort → /collections/cab-comfort
  └── Health & Fitness → /collections/health-fitness
  └── Organization → /collections/organization-storage
  └── Electronics → /collections/electronics-mounts
  └── Safety → /collections/safety
  └── Flashlights & Tools → /collections/flashlights-tools
  └── Cleaning → /collections/cleaning
  └── CDL Essentials → /collections/cdl-essentials
About → /pages/about
Driver Hub ↗ → https://app.sacredpathway.org  (check "Open in new tab" if Dawn supports)
Contact → /pages/contact
```

### Footer Shop

```
All Products → /collections/all
Cab Comfort → /collections/cab-comfort
Health & Fitness → /collections/health-fitness
Organization → /collections/organization-storage
Electronics → /collections/electronics-mounts
Safety → /collections/safety
Flashlights & Tools → /collections/flashlights-tools
Cleaning → /collections/cleaning
CDL Essentials → /collections/cdl-essentials
```

### Footer Help

```
Contact Us → /pages/contact
Shipping Policy → /policies/shipping-policy
Return Policy → /policies/refund-policy
FAQ → /pages/faq
```

### Footer About

```
About Us → /pages/about
Sacred Pathway LLC → https://sacredpathway.org  (external)
Driver Hub App → https://app.sacredpathway.org  (external)
```

### Footer Legal

```
Privacy Policy → /policies/privacy-policy
Terms of Service → /policies/terms-of-service
Refund Policy → /policies/refund-policy
```

---

## Pre-Publish QA Checklist (for THIS page only — full QA later in runbook)

- [ ] Hero loads in under 2 seconds on mobile
- [ ] All 8 collection tiles appear in correct order
- [ ] "This Week's Most-Ordered" shows 4 real products
- [ ] Trust badges render at correct size (not stretched)
- [ ] Email signup form submits to a real test address
- [ ] Footer payment icons display
- [ ] No layout shift / overlap on iPhone 14 / iPhone SE viewport
- [ ] All CTAs link to correct destinations (test every button)

---

## What's Already Done vs What Needs You

| Done by me | Needs you to click |
|---|---|
| All section copy | Paste into Shopify Customize |
| Theme color/font specs | Set in Theme settings |
| Asset files (logo SVGs, tile SVGs, badge SVGs) | Upload via Shopify image picker |
| Section order + field-by-field config | Build in Customize panel |
| Nav structure | Create in Navigation panel |
| Discount code logic | Create code `ROADREADY` in Discounts |
| Hero image | Pending — Option A workflow (you paste Unsplash+ URLs, I pick) |

No imports, no live deployment until verification gate clears.
