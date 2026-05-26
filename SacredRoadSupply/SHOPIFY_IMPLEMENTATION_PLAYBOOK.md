# Sacred Road Supply — Shopify Implementation Playbook

**Mode:** Sequential execution. Every decision pre-made.
**Theme:** Dawn (latest free official Shopify theme).
**Working theme name:** `Sacred Road Supply Brand Refresh` (duplicate — never published until launch).
**Time:** ~3 hours active clicking, in one sitting or split across 2 days.

This playbook supersedes earlier IMPLEMENTATION_* docs. Follow top to bottom. Tick boxes as you go.

---

## PHASE 0 — PRE-FLIGHT (5 min)

- [ ] Confirm `https://shop.sacredpathway.org` resolves (DNS verified)
- [ ] Confirm logged into `sacredroadsupply.myshopify.com/admin`
- [ ] Bookmark this doc + open `/Users/demarquishinton/Documents/Claude/Projects/Sacred Pathway trucker tool/SacredRoadSupply/branding_assets/png_exports/` in Finder for fast asset access

---

## PHASE 1 — THEME SAFETY (5 min)

- [ ] Online Store → **Themes**
- [ ] Find the active theme (whatever is "Live" — likely Dawn already installed)
- [ ] Click the **`…`** (three-dot menu) → **Duplicate**
- [ ] Once duplicated, click the new duplicate's `…` → **Rename** → enter: `Sacred Road Supply Brand Refresh`
- [ ] **CONFIRM:** Live theme is unchanged (still shows "Current theme")
- [ ] **CONFIRM:** New theme appears in "Theme library" labeled `Sacred Road Supply Brand Refresh`

🛑 **All subsequent work happens on the duplicate.** Never click "Publish" on it until Phase 27 says you may.

---

## PHASE 2 — BULK ASSET UPLOAD (15 min)

Settings → **Files** → drag-drop these files in batches:

### Logos (4 files)
From `branding_assets/png_exports/logos/`:
- [ ] `logo_primary_900x320.png`
- [ ] `logo_footer_variant_900x280.png`
- [ ] `logo_compact_512x512.png`
- [ ] `favicon.ico`

### Collection tiles (8 files)
From `branding_assets/png_exports/collection_tiles/`:
- [ ] `tile_cab-comfort.png`
- [ ] `tile_health-fitness.png`
- [ ] `tile_organization-storage.png`
- [ ] `tile_electronics-mounts.png`
- [ ] `tile_safety.png`
- [ ] `tile_flashlights-tools.png`
- [ ] `tile_cleaning.png`
- [ ] `tile_cdl-essentials.png`

### Trust badges (6 files)
From `branding_assets/png_exports/trust_badges/`:
- [ ] `badge_free_shipping.png`
- [ ] `badge_returns.png`
- [ ] `badge_secure_checkout.png`
- [ ] `badge_support.png`
- [ ] `badge_driver_focused.png`
- [ ] `badge_family_owned.png`

### Hero + social (3 files)
- [ ] `hero_mockup_preview_1440x600.png` (placeholder until Unsplash+ photo licensed)
- [ ] `hero_mobile_1080x1350.png` (placeholder)
- [ ] `og_share_1200x630.png`

**Total: 21 files. Upload all, then verify count in Files panel.**

---

## PHASE 3 — THEME SETTINGS (15 min)

Online Store → Themes → on `Sacred Road Supply Brand Refresh`, click **Customize**. Left rail bottom: **Theme settings** (gear icon).

### 3a. Logo

- [ ] **Logo image:** select uploaded `logo_primary_900x320.png`
- [ ] **Logo width (desktop):** `220`
- [ ] **Favicon:** select `favicon.ico`

### 3b. Colors — 4 schemes

Click **Colors**. Dawn ships with 5 default schemes. Edit the first 4 with these exact values; leave Scheme 5 untouched as a fallback.

**Scheme 1 — `Background 1` (rename to "Brand Light" if Dawn allows):**
- Background: `#FFFFFF`
- Background gradient: leave blank
- Text: `#1A1A1A`
- Solid button background: `#CCAD42`
- Solid button label: `#121212`
- Outline button: `#1A4D26`
- Solid button label hover: `#121212`
- Secondary button label: `#1A4D26`
- Links: `#1A4D26`

**Scheme 2 — `Background 2` (rename "Brand Dark"):**
- Background: `#1A4D26`
- Background gradient: leave blank
- Text: `#F5F0E1`
- Solid button background: `#CCAD42`
- Solid button label: `#121212`
- Outline button: `#E6CC73`
- Secondary button label: `#E6CC73`
- Links: `#E6CC73`

**Scheme 3 — `Inverse` (rename "Accent Dark"):**
- Background: `#121212`
- Text: `#E6CC73`
- Solid button background: `#CCAD42`
- Solid button label: `#121212`
- Outline button: `#E6CC73`
- Secondary button label: `#E6CC73`
- Links: `#E6CC73`

**Scheme 4 — `Accent 1` (rename "Card Inset"):**
- Background: `#0A2F1F`
- Text: `#F5F0E1`
- Solid button background: `#CCAD42`
- Solid button label: `#121212`
- Outline button: `#E6CC73`
- Links: `#E6CC73`

**Scheme 5 — `Accent 2`** — leave Dawn defaults (won't be used).

### 3c. Typography

- **Headings:**
  - Click **Change** under Headings
  - Search: `Playfair Display`
  - Select → variant **700** (Bold)
- **Body:**
  - Click **Change** under Body
  - Search: `Inter`
  - Select → variant **400** (Regular)

### 3d. Layout

- **Page width:** `1600`
- **Spacing → Section vertical spacing:** Default
- **Animations:**
  - Reveal sections on scroll: ✅ ON
  - Hover effects: ✅ ON

### 3e. Buttons

- **Border thickness:** `1`
- **Border opacity:** `100`
- **Corner radius:** `4`
- **Shadow horizontal offset:** `0`
- **Shadow vertical offset:** `0`
- **Shadow blur:** `0`
- **Shadow opacity:** `0`

### 3f. Inputs

- **Border thickness:** `1`
- **Border opacity:** `55`
- **Corner radius:** `4`

### 3g. Variant pills

- **Border thickness:** `1`
- **Border opacity:** `55`
- **Corner radius:** `40`

### 3h. Cards (Product cards)

- **Card style:** Standard
- **Image padding:** `0`
- **Corner radius:** `0`
- **Border thickness:** `0`
- **Shadow opacity:** `0`

### 3i. Cards (Collection cards)

- **Card style:** Card
- **Image padding:** `0`
- **Corner radius:** `4`
- **Border thickness:** `0`
- **Shadow opacity:** `12`
- **Shadow blur:** `8`

### 3j. Cards (Blog cards) — Phase 2 use

- Same as Product cards

### 3k. Content containers

- **Corner radius:** `4`
- **Border thickness:** `0`
- **Shadow opacity:** `0`

### 3l. Media

- **Corner radius:** `0`
- **Border thickness:** `0`
- **Shadow opacity:** `0`

### 3m. Drawers (cart drawer)

- **Border thickness:** `1`
- **Border opacity:** `35`
- **Shadow opacity:** `40`

### 3n. Badges (sale / out-of-stock badges)

- **Corner radius:** `4`
- **Position:** Bottom left

### 3o. Social media

Paste these URLs:
- **Facebook:** `https://www.facebook.com/share/17ZJr3uZPR/?mibextid=wwXIfr`
- **Instagram:** `https://www.instagram.com/sacredpathwayapp`
- **TikTok:** `https://www.tiktok.com/@sacredpathwayapp`
- **X (Twitter):** `https://x.com/SacredPathwayap`
- **YouTube:** (leave blank)
- **Other:** (leave blank)

### 3p. Search behavior

- **Enable search suggestions:** ✅ ON
- **Show products:** ✅ ON
- **Show pages:** ✅ ON
- **Show articles:** ❌ (no blog yet)

### 3q. Cart

- **Cart type:** Drawer
- **Show vendor:** ❌
- **Cart note:** ✅ ON (lets customers add gift note)

### 3r. Checkout (Settings → Checkout)

Online Store → Themes → Customize → top-left dropdown → switch from "Home page" to **Checkout**:
- **Logo:** select `logo_compact_512x512.png`
- **Logo position:** Center
- **Logo size:** Medium
- **Banner image:** leave blank for v1
- **Background:** `#FFFFFF`
- **Body:** `#1A1A1A`
- **Accent color:** `#CCAD42`
- **Buttons:** `#CCAD42`
- **Errors:** `#CC3333`

### 3s. Social sharing image (Open Graph)

Theme settings → scroll down to **Social media sharing image**:
- Select uploaded `og_share_1200x630.png`

### 3t. Currency format

- **Currency code:** USD (default)
- **Show currency codes:** ❌
- **HTML with currency:** `${{amount}} USD`

**CLICK SAVE at top right.**

---

## PHASE 4 — HEADER (5 min)

In Customize, click the header at the top of the page preview. Left rail switches to header settings.

- **Color scheme:** `Brand Light` (Scheme 1)
- **Logo position desktop:** Middle left
- **Logo width:** `220` (already set in Theme Settings)
- **Menu:** `Main menu` (we'll populate in Phase 16)
- **Show line separator:** ✅ ON
- **Enable sticky header:** ✅ "On scroll up"
- **Show country/region selector:** ❌
- **Show language selector:** ❌

**Save.**

---

## PHASE 5 — ANNOUNCEMENT BAR (5 min)

Click the announcement bar at the very top.

- **Color scheme:** `Accent Dark` (Scheme 3)
- **Show social media icons:** ❌
- **Auto-rotate messages:** ✅ Every `5` seconds

Click **Add block** → **Announcement**. Add 3 announcements:

**Announcement 1:**
- Text: `FREE SHIPPING ON ORDERS $75+`
- Link: leave blank

**Announcement 2:**
- Text: `USE CODE ROADREADY FOR $5 OFF YOUR FIRST ORDER`
- Link: `/collections/all`

**Announcement 3:**
- Text: `SHIPS FROM U.S. WAREHOUSES · 30-DAY RETURNS`
- Link: leave blank

**Save.**

---

## PHASE 6 — HOMEPAGE SECTION 1: HERO (10 min)

In Customize, ensure top-left dropdown shows "Home page". Dawn ships with a default homepage; we'll edit/replace its sections in order.

Click on the **Image banner** section. (If not present, Add section → Image banner.)

- **Image:** select `hero_mockup_preview_1440x600.png` (placeholder until Unsplash+ photo licensed)
- **Image (mobile):** select `hero_mobile_1080x1350.png`
- **Image height:** `Large`
- **Image overlay opacity:** `35` (boosted per audit)
- **Color scheme:** `Brand Dark` (Scheme 2)
- **Image behavior:** `Ambient movement` OFF (better mobile perf) — use `None`
- **Desktop content position:** `Bottom left`
- **Desktop content alignment:** `Left`
- **Show container:** ❌
- **Mobile content alignment:** `Center`

**Blocks (add in this order):**

**Block 1 — Heading:**
- Heading: `Gear Built for the Long Haul.`
- Heading size: `XL`

**Block 2 — Caption:**
- Caption: `Trucker-tested supplies, fast U.S. shipping, and prices that respect what you actually take home.`
- Caption size: `Medium`
- Caption style: `Subtitle`

**Block 3 — Button:**
- Button label: `Shop Now`
- Button link: `/collections/all`
- Use outline button style: ❌ (this is primary)
- Open in new tab: ❌

**Block 4 — Button:**
- Button label: `New Driver? Start Here`
- Button link: `/collections/cdl-essentials`
- Use outline button style: ✅ (secondary)
- Open in new tab: ❌

**Save.**

---

## PHASE 7 — SECTION 2: TRUST STRIP (10 min)

Below Image banner, **Add section** → **Multicolumn**.

- **Heading:** (leave blank)
- **Heading size:** Medium
- **Image width:** `Third width of column`
- **Column alignment:** `Center`
- **Background:** ✅ ON
- **Color scheme:** `Brand Dark` (Scheme 2)
- **Columns per row (desktop):** `3`
- **Columns per row (mobile):** `1`
- **Enable swipe on mobile:** ❌
- **Section padding top:** `20`
- **Section padding bottom:** `20`

**Columns (add 3):**

**Column 1:**
- Image: `badge_free_shipping.png`
- Heading: `Free U.S. Shipping`
- Description: `Orders $75 and up. Ships from U.S. warehouses in 3–7 days.`
- Link label: (blank)

**Column 2:**
- Image: `badge_returns.png`
- Heading: `30-Day Returns`
- Description: `No restocking fees on unused gear. Real-person email support.`

**Column 3:**
- Image: `badge_driver_focused.png`
- Heading: `Driver Focused`
- Description: `Built for owner-operators, fleet drivers, and CDL students. Picked by working trucking people.`

**Save.**

---

## PHASE 8 — SECTION 3: COLLECTION GRID (15 min — depends on Phase 17 for collections to exist)

⚠️ **Skip this section for now. Return after Phase 17 creates the 8 collections.**

When you return: **Add section** → **Collection list**.

- **Heading:** `Built for Every Mile`
- **Heading size:** `Large`
- **Color scheme:** `Brand Light` (Scheme 1)
- **Image ratio:** `Square`
- **Show "View all" if more available:** ✅ ON
- **Columns per row (desktop):** `4`
- **Columns per row (mobile):** `2`
- **Enable swipe on mobile:** ❌
- **Section padding top:** `40`
- **Section padding bottom:** `40`

**Add collections (in this order):**

1. Cab Comfort
2. Driver Health & Fitness
3. Organization & Storage
4. Electronics & Mounts
5. Safety Equipment
6. Flashlights & Tools
7. Truck Cleaning Supplies
8. CDL Essentials

(The tile images come from each collection's own Image field — set during Phase 17.)

**Save.**

---

## PHASE 9 — SECTION 4: FEATURED COLLECTION (skip until Phase 17)

⚠️ **Skip for now.** Return after creating a manual collection called `Featured` containing the 4 launch picks.

When you return: **Add section** → **Featured collection**.

- **Heading:** `This Week's Most-Ordered`
- **Description:** `Real gear pulling its weight on real rigs.`
- **Heading size:** `Large`
- **Color scheme:** `Brand Light` (Scheme 1)
- **Collection:** `Featured`
- **Products to show:** `4`
- **Columns per row (desktop):** `4`
- **Columns per row (mobile):** `2`
- **Show "View all" if more available:** ❌
- **Enable swipe on mobile:** ✅
- **Enable quick add:** ✅
- **Image ratio:** `Adapt to image`
- **Show vendor:** ❌
- **Show rating:** ✅
- **Show second image on hover:** ✅
- **Section padding top:** `40`
- **Section padding bottom:** `40`

**Save.**

---

## PHASE 10 — SECTION 5: WHY DRIVERS CHOOSE US (5 min)

**Add section** → **Multicolumn**.

- **Heading:** `Why Drivers Choose Sacred Road Supply`
- **Heading size:** `Medium`
- **Image width:** `Half width of column`
- **Column alignment:** `Center`
- **Background:** ❌
- **Color scheme:** `Brand Light` (Scheme 1)
- **Columns per row (desktop):** `3`
- **Columns per row (mobile):** `1`

**Columns:**

**Column 1:**
- Image: `badge_family_owned.png`
- Heading: `Built by Trucking People`
- Description: `Sacred Pathway LLC is a working dry-van carrier in Alabama. We carry what works because we drive what works.`

**Column 2:**
- Image: `badge_free_shipping.png`
- Heading: `Ships from U.S. Warehouses`
- Description: `Most orders ship the same or next business day. No 20-day China waits.`

**Column 3:**
- Image: `badge_support.png`
- Heading: `Real-Person Support`
- Description: `30-day returns. No restocking fees on unopened gear. Real humans answer your email.`

**Save.**

---

## PHASE 11 — SECTION 6: ABOUT TEASER (5 min)

**Add section** → **Image with text**.

- **Image:** for v1, use one of Sacred Pathway LLC's existing truck photos. Save the red Freightliner shot from `https://images.squarespace-cdn.com/content/v1/68b6b66576617a5c0e13de55/7eb391f1-9639-4c87-8bb1-5356bb81fc81/722702-Freightliner-Trucks-Trucks.jpg` to your computer, then upload to Shopify Files first, then select here.
- **Image height:** `Medium`
- **Desktop image width:** `Medium`
- **Desktop image position:** `Image first`
- **Content layout:** `No overlap`
- **Color scheme:** `Brand Light` (Scheme 1)

**Blocks:**

**Block 1 — Heading:**
- Heading: `Built by a Family Carrier in Alabama`
- Heading size: `Medium`

**Block 2 — Text:**
```
Sacred Pathway LLC is a working dry-van freight carrier in Greensboro, Alabama (USDOT 4250348 / MC 1647441). Sacred Road Supply is our store — built so you stop overpaying $40 at a truck stop for gear that breaks in a week.

If it isn't useful at 3 a.m. in a rest area outside Amarillo, it isn't in this store.
```

**Block 3 — Button:**
- Button label: `Read Our Story`
- Button link: `/pages/about`
- Use outline button style: ✅

**Save.**

---

## PHASE 12 — SECTION 7: EMAIL SIGNUP (5 min)

**Add section** → **Email signup**.

- **Heading:** `Get $5 Off Your First Order`
- **Heading size:** `Medium`
- **Description:** `Join the Sacred Road Supply driver list. Gear drops, restock alerts, and a $5 code in your inbox right now.`
- **Color scheme:** `Card Inset` (Scheme 4)
- **Section padding top:** `60`
- **Section padding bottom:** `60`

**Save.**

---

## PHASE 13 — SECTION 8: CDL STARTER PACK (5 min)

**Add section** → **Multicolumn** (using Multicolumn instead of Featured collection since CDL Essentials only has 1 SKU at launch).

- **Heading:** `New CDL? Start Here.`
- **Heading size:** `Medium`
- **Image width:** `Full width of column`
- **Column alignment:** `Center`
- **Background:** ❌
- **Color scheme:** `Brand Light` (Scheme 1)
- **Columns per row (desktop):** `3`
- **Columns per row (mobile):** `1`

**Columns** (image = product hero from Zendrop import; for now use the matching collection tile as placeholder):

**Column 1:**
- Image: `tile_cdl-essentials.png` (placeholder until product import)
- Heading: `CDL Logbook Binder`
- Description: `Inspection-ready in 10 seconds.`
- Link label: `View product →`
- Link: `/products/cdl-logbook-binder` (will exist after import; fine as a 404 in dev)

**Column 2:**
- Image: `tile_safety.png` (placeholder)
- Heading: `DOT Triangle Kit`
- Description: `FMCSA Section 393.95 compliant.`
- Link: `/products/dot-reflective-triangle-kit-3-pack`

**Column 3:**
- Image: `tile_electronics-mounts.png` (placeholder)
- Heading: `24V/12V USB-C Charger`
- Description: `One charger for any rig.`
- Link: `/products/24v-12v-heavy-duty-usb-c-charger`

**Save.** (Replace with real product images during Phase 2 import workflow.)

---

## PHASE 14 — SECTION 9: CLOSING TAGLINE (3 min)

**Add section** → **Rich text**.

- **Color scheme:** `Accent Dark` (Scheme 3)
- **Desktop content position:** `Center`
- **Section padding top:** `30`
- **Section padding bottom:** `30`

**Blocks:**

**Block 1 — Heading:** (leave blank)
**Block 2 — Text:**
- Text (in Shopify rich-text editor, italic): `From the truck stop to the loading dock — built for the long haul.`
- Text style: `Body`

**Save.**

---

## PHASE 15 — FOOTER (10 min)

Click the footer at the bottom of the homepage preview.

- **Color scheme:** `Card Inset` (Scheme 4)
- **Show email signup:** ❌ (already have one in Section 7)
- **Email signup heading:** (blank)
- **Show country/region selector:** ❌
- **Show language selector:** ❌
- **Show social media icons:** ✅ ON
- **Show payment icons:** ✅ ON

**Blocks (add 4 menu blocks + 1 image block + 1 text block):**

**Block 1 — Image (footer logo):**
- Image: `logo_footer_variant_900x280.png`
- Image width: `200px`

**Block 2 — Menu — Shop:**
- Heading: `Shop`
- Menu: `Footer Shop` (created in Phase 16)

**Block 3 — Menu — Help:**
- Heading: `Help`
- Menu: `Footer Help`

**Block 4 — Menu — About:**
- Heading: `About`
- Menu: `Footer About`

**Block 5 — Menu — Legal:**
- Heading: `Legal`
- Menu: `Footer Legal`

**Block 6 — Text (above social row):**
```
From the truck stop to the loading dock — built for the long haul.

© 2026 Sacred Pathway LLC. Sacred Road Supply is a brand of Sacred Pathway LLC.
USDOT 4250348 · MC 1647441 · Greensboro, Alabama
```

**Save.**

---

## PHASE 16 — NAVIGATION MENUS (15 min)

Online Store → **Navigation**. Build these 5 menus.

### Main menu

Click `Main menu` → add items:

1. `Home` → `/`
2. `Shop` → `/collections/all`
   - `Cab Comfort` → `/collections/cab-comfort`
   - `Health & Fitness` → `/collections/health-fitness`
   - `Organization` → `/collections/organization-storage`
   - `Electronics` → `/collections/electronics-mounts`
   - `Safety` → `/collections/safety`
   - `Flashlights & Tools` → `/collections/flashlights-tools`
   - `Cleaning` → `/collections/cleaning`
   - `CDL Essentials` → `/collections/cdl-essentials`
3. `About` → `/pages/about`
4. `Driver Hub` → `https://app.sacredpathway.org`
5. `Contact` → `/pages/contact`

**Save.**

### Footer Shop

Add menu → name: `Footer Shop`:
1. `All Products` → `/collections/all`
2. `Cab Comfort` → `/collections/cab-comfort`
3. `Health & Fitness` → `/collections/health-fitness`
4. `Organization` → `/collections/organization-storage`
5. `Electronics` → `/collections/electronics-mounts`
6. `Safety` → `/collections/safety`
7. `Flashlights & Tools` → `/collections/flashlights-tools`
8. `Cleaning` → `/collections/cleaning`
9. `CDL Essentials` → `/collections/cdl-essentials`

### Footer Help

1. `Contact Us` → `/pages/contact`
2. `Shipping Policy` → `/policies/shipping-policy`
3. `Return Policy` → `/policies/refund-policy`
4. `FAQ` → `/pages/faq`

### Footer About

1. `About Us` → `/pages/about`
2. `Sacred Pathway LLC` → `https://sacredpathway.org`
3. `Driver Hub App` → `https://app.sacredpathway.org`

### Footer Legal

1. `Privacy Policy` → `/policies/privacy-policy`
2. `Terms of Service` → `/policies/terms-of-service`
3. `Refund Policy` → `/policies/refund-policy`

---

## PHASE 17 — COLLECTIONS (30 min)

Online Store → **Products** → **Collections** → **Create collection** (×8).

For each collection, set:
- **Title** (per table below)
- **Description** (paste HTML from `STORE_CONTENT_FOR_REVIEW.md` § Collection meta descriptions — wrap each in an `<h2>` + `<p>`)
- **Collection type:** **Manual**
- **Image:** the matching tile PNG
- **Theme template:** `collection`
- **Search engine listing → Edit:** paste SEO title + meta description from the table

| # | Title | URL handle | Image | SEO Title (≤60) |
|---|---|---|---|---|
| 1 | Cab Comfort | `cab-comfort` | `tile_cab-comfort.png` | Truck Cab Comfort — Seat Cushions, Blankets & Toppers |
| 2 | Driver Health & Fitness | `health-fitness` | `tile_health-fitness.png` | Truck Driver Health & Fitness Gear |
| 3 | Organization & Storage | `organization-storage` | `tile_organization-storage.png` | Truck Cab Organizers & Storage for Drivers |
| 4 | Electronics & Mounts | `electronics-mounts` | `tile_electronics-mounts.png` | Truck Driver Electronics, Chargers & Dash Cams |
| 5 | Safety Equipment | `safety` | `tile_safety.png` | DOT Safety Equipment for Truck Drivers |
| 6 | Flashlights & Tools | `flashlights-tools` | `tile_flashlights-tools.png` | Truck Driver Flashlights & Roadside Tools |
| 7 | Truck Cleaning Supplies | `cleaning` | `tile_cleaning.png` | Truck Cleaning Supplies — Waterless Wash |
| 8 | CDL Essentials | `cdl-essentials` | `tile_cdl-essentials.png` | CDL Essentials — Logbooks, Permits & Documents |

**Also create one extra:**
- **9. Featured** (manual, no image, used by homepage Featured collection section)
- Will populate with 4 SKUs (12V Heated Blanket, Lumbar Cushion, Mattress Topper, Dual Dash Cam) **after product import**.

🔁 **Now return to Phase 8 and Phase 9** to wire up the Collection list + Featured collection sections that were waiting for these collections to exist.

---

## PHASE 18 — STATIC PAGES (15 min)

Online Store → **Pages** → **Add page**. Create these 3:

| Title | Handle | Content source |
|---|---|---|
| About Us | `about` | `STORE_CONTENT_FOR_REVIEW.md` § §7 ABOUT US |
| Contact | `contact` | `STORE_CONTENT_FOR_REVIEW.md` § §8 CONTACT |
| Frequently Asked Questions | `faq` | `STORE_CONTENT_FOR_REVIEW.md` § §6 FAQ |

For each:
- Paste content into the rich-text editor
- **Search engine listing → Edit:** Title + meta description per content doc
- **Theme template:** default (`page`)
- **Visibility:** Visible (online store)

---

## PHASE 19 — POLICY PAGES (10 min)

Settings → **Policies**. For each, click **Create from template** then **replace** the template body with the content from `STORE_CONTENT_FOR_REVIEW.md`:

- [ ] **Refund policy** → § §5 RETURN POLICY
- [ ] **Privacy policy** → from `02_Store_Content.docx` (Privacy Policy section)
- [ ] **Terms of service** → from `02_Store_Content.docx` (Terms of Service section)
- [ ] **Shipping policy** → § §4 SHIPPING POLICY
- [ ] **Contact information** → same content as Contact page (Phase 18)

**Save each.** These auto-link in the footer's Legal column once Phase 16 footer menus reference them.

---

## PHASE 20 — DISCOUNT CODE (3 min)

**Discounts** → **Create discount** → **Amount off products**.

- Method: `Discount code`
- Code: `ROADREADY`
- Discount value: **Fixed amount**, `$5.00`
- Applies to: All products
- Minimum purchase requirements: Minimum purchase amount `$20.00`
- Customer eligibility: All customers
- Maximum discount uses: ✅ Limit to **one use per customer**
- Combinations: Don't combine with other discounts
- Active dates: Start now, no end date

**Save discount.**

---

## PHASE 21 — APPS (DO NOT FULLY CONFIGURE YET)

Shopify App Store. Install these — leave configuration for Phase 2:

- [ ] **Zendrop** (Free plan) — do NOT import products yet
- [ ] **CJDropshipping** (free)
- [ ] **Shopify Inbox** (built-in chat)
- [ ] **Judge.me Reviews** (free tier)
- [ ] **Shopify Email** (built-in)

Do NOT install Klaviyo (defer to month 2).

---

## ASSET PLACEMENT MAP (reference card)

| Asset | Where it goes | Shopify path |
|---|---|---|
| `logo_primary_900x320.png` | Site header | Theme settings → Logo |
| `logo_footer_variant_900x280.png` | Footer | Footer → Image block |
| `logo_compact_512x512.png` | Checkout header | Customize → Checkout → Logo |
| `favicon.ico` | Browser tab + Apple touch icon | Theme settings → Favicon |
| `og_share_1200x630.png` | Social media share preview | Theme settings → Social media sharing image |
| `hero_mockup_preview_1440x600.png` | Hero desktop (PLACEHOLDER) | Image banner → Image |
| `hero_mobile_1080x1350.png` | Hero mobile (PLACEHOLDER) | Image banner → Image (mobile) |
| `tile_cab-comfort.png` | Collection: Cab Comfort | Collection → Image |
| `tile_health-fitness.png` | Collection: Driver Health & Fitness | Collection → Image |
| `tile_organization-storage.png` | Collection: Organization & Storage | Collection → Image |
| `tile_electronics-mounts.png` | Collection: Electronics & Mounts | Collection → Image |
| `tile_safety.png` | Collection: Safety Equipment | Collection → Image |
| `tile_flashlights-tools.png` | Collection: Flashlights & Tools | Collection → Image |
| `tile_cleaning.png` | Collection: Truck Cleaning Supplies | Collection → Image |
| `tile_cdl-essentials.png` | Collection: CDL Essentials | Collection → Image |
| `badge_free_shipping.png` | Trust strip + Why Us | Multicolumn → Image |
| `badge_returns.png` | Trust strip | Multicolumn → Image |
| `badge_secure_checkout.png` | Available for footer use (Phase 2) | Files (no placement yet) |
| `badge_support.png` | Why Us | Multicolumn → Image |
| `badge_driver_focused.png` | Trust strip | Multicolumn → Image |
| `badge_family_owned.png` | Why Us | Multicolumn → Image |

---

## MOBILE OPTIMIZATION SETTINGS (reference)

Already encoded in section settings above. Reference only:

| Section | Desktop cols | Mobile cols | Notes |
|---|---|---|---|
| Trust Strip (Section 2) | 3 | 1 | stacked vertically |
| Collection grid (Section 3) | 4 | 2 | 4×2 grid mobile |
| Featured collection (Section 4) | 4 | 2 | with swipe-on-mobile ON |
| Why Drivers Choose (Section 5) | 3 | 1 | stacked |
| Image with text (Section 6) | image+text side-by-side | stacked | image first |
| CDL Starter (Section 8) | 3 | 1 | stacked |

**Mobile image rules:**
- Hero — Dawn auto-switches between desktop and mobile images based on viewport
- Collection tiles — Shopify auto-serves WebP at appropriate size
- Badges — Shopify auto-scales PNG; no special mobile asset needed
- Logo — Dawn auto-resizes; tagline visibility on mobile depends on header logo width (220px keeps tagline visible down to ~480px viewport)

**Section spacing on mobile:**
- Dawn auto-reduces section padding ~30% on mobile breakpoints. No manual override needed unless QA flags overflow.

---

## QA CHECKLIST

Run this AFTER Phases 1–21 are complete. Use the theme preview URL: in Themes panel, click the duplicate theme's eye icon → opens preview in new tab.

### Desktop (1440×900 — standard MacBook viewport)

- [ ] Homepage loads in under 3 seconds
- [ ] Logo renders crisply (not blurry) in header
- [ ] Announcement bar rotates 3 messages
- [ ] Hero image fills viewport, headline + CTAs readable
- [ ] Trust strip shows 3 columns with badges
- [ ] Collection grid shows 8 tiles in 4×2 layout
- [ ] Featured collection shows 4 product cards (will be placeholder until import — that's expected)
- [ ] Why Drivers Choose shows 3 columns
- [ ] About teaser shows image left, text right
- [ ] Email signup form submits to a real test address (try: `you+test@gmail.com`)
- [ ] CDL Starter shows 3 columns
- [ ] Closing tagline displays in italic gold
- [ ] Footer shows 4 menu columns + social icons + payment icons
- [ ] All footer links resolve (no 404s except product links, which 404 until import)

### Tablet (768×1024)

- [ ] Header collapses to hamburger menu OR keeps full menu depending on Dawn responsive rules — verify acceptable
- [ ] Hero image scales without crop loss
- [ ] Trust strip remains 3 columns (or 2-column at 768px breakpoint — both acceptable)
- [ ] Collection grid: 2 or 3 columns
- [ ] No horizontal scroll on body

### Mobile (375×667 — iPhone SE / 14)

- [ ] Hamburger menu opens, shows all 8 collections + About + Driver Hub + Contact
- [ ] Hero mobile image loads (vertical 1080×1350 crop) — vanishing point centered
- [ ] Headline at ~48pt readable
- [ ] Both CTAs are tappable (44pt minimum target)
- [ ] Trust strip stacks vertically, 3 rows
- [ ] Collection grid shows 2 columns × 4 rows, all 8 tiles visible
- [ ] Badge captions remain readable (≥12pt rendered)
- [ ] Footer columns stack, links remain tappable

### Product pages (after import — placeholder check only for now)

- [ ] Default product template renders
- [ ] Add to Cart button uses Brand Light gold (#CCAD42)
- [ ] Quick add works on collection cards

### Collection pages

- [ ] `/collections/cab-comfort` opens (will be empty until import)
- [ ] Collection description shows above product grid
- [ ] Sort + filter UI present (empty state for now)

### Cart

- [ ] Add a placeholder product (free $0 test product if you create one)
- [ ] Cart drawer slides in
- [ ] Cart total formats correctly with USD
- [ ] Checkout button uses gold #CCAD42

### Checkout branding

- [ ] Open checkout (after add-to-cart) — verify:
- [ ] Logo `logo_compact_512x512.png` shows center top
- [ ] Background `#FFFFFF`, accent `#CCAD42`
- [ ] No leftover Shopify-default purple/blue accents

### Accessibility contrast

- [ ] All text on dark green backgrounds is `#F5F0E1` cream or `#E6CC73` light gold — both pass WCAG AA on `#1A4D26` and AAA on `#0A2F1F`
- [ ] All text on white backgrounds is `#1A1A1A` — passes AAA
- [ ] Gold buttons (`#CCAD42`) with `#121212` labels — passes AA
- [ ] No `srsGoldHighlight #F0D87C` used as body text anywhere

### Social sharing preview

- [ ] Open Facebook Sharing Debugger: `https://developers.facebook.com/tools/debug/`
- [ ] Enter `https://shop.sacredpathway.org`
- [ ] Confirm OG image, title, description display correctly
- [ ] Repeat with Twitter Card Validator: `https://cards-dev.twitter.com/validator`

### Favicon

- [ ] Open `https://shop.sacredpathway.org` in browser
- [ ] Confirm gold-tree medallion appears in browser tab
- [ ] Confirm if you "Add to home screen" on iOS, the Apple touch icon shows the medallion

---

## FINAL LAUNCH CHECKLIST

### Must be verified BEFORE publishing the theme

- [ ] All 21 assets uploaded to Shopify Files
- [ ] Theme `Sacred Road Supply Brand Refresh` exists and is NOT the live theme
- [ ] 4 color schemes set per Phase 3b
- [ ] Header logo renders correctly
- [ ] All 8 collections created with correct tile images
- [ ] All static pages (About, Contact, FAQ) populated
- [ ] All 5 policy pages populated (Refund, Privacy, Terms, Shipping, Contact)
- [ ] Main menu + 4 footer menus built
- [ ] Discount code `ROADREADY` active
- [ ] Shopify Payments activated with EIN + bank
- [ ] Shopify Tax configured for AL
- [ ] Shipping zones set (US-48 + AK/HI + APO)
- [ ] Open theme preview, run desktop + mobile + tablet QA
- [ ] No console errors on any page (right-click → Inspect → Console)
- [ ] Social share OG preview correct (Facebook Debugger test)
- [ ] Favicon shows in browser tab
- [ ] Test order placed + Zendrop fulfillment fires (after 4 sample verifications complete)
- [ ] All 4 supplier verification SKUs PASS in `SUPPLIER_VERIFICATION_TRACKER.xlsx`
- [ ] Launch readiness scorecard hits 100/100 in `D_Launch_Readiness_Scorecard.md`

### What CAN wait until Phase 2 (post-launch polish)

- [ ] Licensed Unsplash+ hero photo (currently placeholder mockup)
- [ ] Real product photography for collection tiles (currently silhouette hints)
- [ ] Bespoke iconography for collection tiles (Phase 2 designer pass)
- [ ] Klaviyo migration (defer to month 2 / 500+ subscribers)
- [ ] Trendsi branded apparel
- [ ] Blog post calendar publishing
- [ ] Meta + Google ad accounts setup
- [ ] Branded apparel via Trendsi
- [ ] iOS Driver Hub "Sacred Road Supply" link (next iOS submission)
- [ ] Email template designer (use Shopify Email defaults for v1)
- [ ] Custom 404 page

---

## EXTERNAL VERIFICATION POINTS

After each major phase, you can ping me with "Phase N done" and I'll externally verify by:

| Phase | What I verify externally |
|---|---|
| 1 — Theme duplicate | (can't verify — Shopify-admin-only) |
| 3 — Theme settings | (can't verify — admin-only) |
| 6–14 — Homepage sections | Fetch theme preview URL, check rendered DOM for section presence + correct image refs |
| 16 — Navigation | Fetch theme preview, check nav HTML structure |
| 17 — Collections | Fetch `/collections/cab-comfort` etc. on theme preview, verify 200 OK + title + image |
| 18–19 — Pages + Policies | Fetch each `/pages/X` and `/policies/X` |
| QA Final | Multi-viewport fetches via curl with user-agent variations |
| Pre-publish | Full audit of preview URL + social-share preview check |

To get a theme-preview URL (won't affect live theme):
- Themes → on duplicate → … → **Preview**
- Shopify generates a URL like `https://shop.sacredpathway.org/?preview_theme_id=123456789`
- Send me that URL anytime for live verification

---

## RECOVERY / ROLLBACK PLAN

If anything goes wrong during the build:

- **Bad theme edit:** Themes → duplicate theme has full history. Click `…` → **Older versions** → restore any prior state.
- **Bad collection:** Products → Collections → edit or delete the offending one. Doesn't affect other collections.
- **Bad page:** Pages → edit or set to "Hidden".
- **Bad menu:** Navigation → edit menu items.
- **Worst case — abandon the entire duplicate:** Themes → … → **Delete theme**. Live theme remains unchanged. Start over with a fresh duplicate. Zero data loss.

The live storefront is never affected because the duplicate is never published until Phase 27.

---

## EXECUTION ORDER SUMMARY

```
Phase 0  Pre-flight                            5 min
Phase 1  Duplicate theme                       5 min
Phase 2  Bulk asset upload                     15 min
Phase 3  Theme settings                        15 min
Phase 4  Header                                5 min
Phase 5  Announcement bar                      5 min
Phase 6  Hero (Image banner)                   10 min
Phase 7  Trust strip (Multicolumn)             10 min
Phase 8  Collection grid                       (wait for Phase 17 — return after)
Phase 9  Featured collection                   (wait for Phase 17 — return after)
Phase 10 Why Drivers Choose (Multicolumn)      5 min
Phase 11 About teaser (Image with text)        5 min
Phase 12 Email signup                          5 min
Phase 13 CDL Starter (Multicolumn)             5 min
Phase 14 Closing tagline (Rich text)           3 min
Phase 15 Footer                                10 min
Phase 16 Navigation menus                      15 min
Phase 17 Collections (×9 incl Featured)        30 min
         ↩ return to Phase 8 + Phase 9         15 min
Phase 18 Static pages                          15 min
Phase 19 Policy pages                          10 min
Phase 20 Discount code                         3 min
Phase 21 Apps install (no config)              10 min
QA       Desktop + tablet + mobile + a11y      30 min
─────────────────────────────────────────────────
TOTAL                                          ~3h 20min
```

---

## YOU ARE DONE BUILDING WHEN

1. The duplicate theme `Sacred Road Supply Brand Refresh` is fully built
2. Theme preview URL renders the homepage with all 9 sections + populated nav + footer
3. All 8 collections exist with correct tile images (products will be empty — that's expected)
4. All static pages + 5 policy pages populated
5. QA checklist passed

**At that point, send me the preview URL and I'll do an external pass: render check, social-share OG check, multi-viewport curl, contrast spot-checks.**

**DO NOT click "Publish" until I confirm Phase 22 verification passes AND your sample verification tracker shows all 4 SKUs APPROVED.**

The theme stays unpublished. The live storefront remains the empty default. Nothing customer-facing changes until your explicit publish click — which only happens after the launch readiness scorecard hits 100/100.

— End of playbook —
