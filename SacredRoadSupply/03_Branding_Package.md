# Sacred Road Supply — Branding Package

Parent brand: **Sacred Pathway LLC** (gold tree mark, dark-green identity).
Product brand: **Sacred Road Supply** — inherits the canonical Sacred Pathway palette exactly; no new colors.

**Source of truth for colors:** `BRAND_PALETTE_REFERENCE.md` (this folder) — derived from `BrandColors.swift` and `DESIGN_SYSTEM.md`.

---

## 1. Color Palette — Canonical (no approximations)

### Brand (fixed)

| Role | Token | HEX | Use |
|---|---|---|---|
| Primary green (dark) | `spDarkGreen` | `#1A4D26` | Hero backgrounds, footer, primary dark surfaces |
| Secondary green | `spGreenAccent` | `#2E7340` | Revenue/settled accents, gradient pair with dark green |
| Primary gold | `spGold` | `#CCAD42` | CTAs, accents, big numbers, sale prices, tree mark |
| Light gold | `spGoldLight` | `#E6CC73` | Hover states, gradient stops, secondary accents |
| Deep black | `spBlack` | `#121212` | Button labels over gold, wordmark on light bg |

### Surfaces (light mode)

| Role | Token | HEX | Use |
|---|---|---|---|
| Background | `spBackground` | `#FFFFFF` | Page background |
| Card | `spCardBg` | `#F5F5F5` | Section dividers, product cards |
| Input | `spCardBgLight` | `#EAEAEA` | Form fields, pills |

### Text (light mode)

| Role | Token | HEX |
|---|---|---|
| Primary | `spTextPrimary` | `#1A1A1A` |
| Secondary | `spTextSecondary` | `#6B6B6B` |

### Status (fixed)

| Role | Token | HEX | Use |
|---|---|---|---|
| Success | `spSuccess` | `#2EA659` | Order confirmed, in stock, profit positive |
| Warning | `spWarning` | `#D9A621` | "Low stock", below-target |
| Danger | `spDanger` | `#CC3333` | Error / urgency / "Only 3 left" / delete |

CSS variables (paste into Shopify theme custom CSS if needed):

```css
:root{
  --sp-black:       #121212;
  --sp-gold:        #CCAD42;
  --sp-gold-light:  #E6CC73;
  --sp-dark-green:  #1A4D26;
  --sp-green-accent:#2E7340;
  --sp-bg:          #FFFFFF;
  --sp-card-bg:     #F5F5F5;
  --sp-card-bg-lt:  #EAEAEA;
  --sp-text:        #1A1A1A;
  --sp-text-muted:  #6B6B6B;
  --sp-success:     #2EA659;
  --sp-warning:     #D9A621;
  --sp-danger:      #CC3333;
}
```

---

## 2. Typography

| Use | Font | Weight | Source |
|---|---|---|---|
| Display / H1 | **Playfair Display** (Georgia fallback) | 700 | Google Fonts |
| Headings H2/H3 | **Inter** | 700 | Google Fonts |
| Body | **Inter** | 400 / 500 emphasis | Google Fonts |
| Numbers / prices | **Inter** tabular-nums | 600 | Same family |
| Mono / SKUs / receipts | **JetBrains Mono** | 500 | Google Fonts |

Caps-treatment rule: ALL CAPS for category titles, normal case for product titles. Tracking `0.04em` on caps.

---

## 3. Logo Files Delivered

| File | Use |
|---|---|
| `03_Logo_Primary.svg` | Horizontal lockup — site header, footer, email header |
| `03_Logo_Compact.svg` | Circular medallion — social avatars, favicon, app icon |
| `branding_assets/png_exports/logos/logo_primary_900x320.png` | Shopify header upload |
| `branding_assets/png_exports/logos/logo_compact_1024x1024.png` | Master raster |
| `branding_assets/png_exports/logos/logo_compact_512x512.png` | Social avatar |
| `branding_assets/png_exports/logos/favicon_180x180.png` | Browser favicon / Apple touch |

All logos use canonical `spGold` → `spGoldLight` gradient for gold elements and `spGreenAccent` → `spDarkGreen` for green elements.

---

## 4. Hero Concept

### "Long Haul at Dawn" (Option 2 — paid stock)

- Background: licensed Unsplash+ stock — semi-cab interior or highway dawn POV
- Overlay (Shopify-rendered, not baked):
  - Headline: Playfair Display 700, `#FFFFFF`
  - Subheadline: Inter 500, `#E6CC73`
  - Underline rule: gold gradient (`spGoldLight` → `spGold`)
  - Primary button: solid gold (`#CCAD42`), label `#121212`
  - Secondary button: outline white
  - Trust band: 92% `#1A4D26` → 95% `#121212` overlay

See `branding_assets/hero_mockup.svg` for the composition.

---

## 5. Banner Concepts

| Banner | Use | Copy |
|---|---|---|
| Announcement bar | Sitewide promo | `FREE SHIPPING ON ORDERS $75+ · CODE: ROADREADY $5 OFF FIRST ORDER` |
| Cab Comfort header | Collection page | "Sleep, sit, and survive the next 11 hours." |
| Health & Fitness | Collection page | "11 hours seated takes its toll. Fight back." |
| Electronics | Collection page | "Charge it. Mount it. Record it. Built for 24V." |
| Safety | Collection page | "DOT-compliant. Inspection-ready." |
| Email header | Klaviyo template | Logo centered on dark green band, gold underline |

---

## 6. Trust Badges

Six circular medallions, gold gradient stroke on transparent background, dark-green caption text. Drop-in row above the footer on every page.

| Badge | Caption | Sub-caption |
|---|---|---|
| Truck | FREE U.S. SHIPPING | Orders $75+ |
| Shield | 30-DAY RETURNS | No restocking fees |
| Lock | SECURE CHECKOUT | Shopify Payments + SSL |
| Headset | REAL-PERSON SUPPORT | We answer your email |
| Star | DRIVER FOCUSED | Built for working drivers |
| Flag | FAMILY-OWNED | Greensboro, Alabama |

Files: `branding_assets/trust_badges/*.svg` + `branding_assets/png_exports/trust_badges/*.png` (600×700 each).

---

## 7. Category Tile Graphics

Eight tiles, consistent treatment:
- Background: `spDarkGreen` → `spGreenAccent` gradient
- Corner stripe: gold gradient
- Icon: gold-outlined SVG, 14px stroke
- Label band: bottom 140px, gold gradient, `spDarkGreen` text
- Watermark: "SACRED ROAD SUPPLY" in `spGoldLight` at 70% opacity

Files: `branding_assets/collection_tiles/*.svg` + `branding_assets/png_exports/collection_tiles/*.png` (1080×1080 each).

| Category | Hero icon |
|---|---|
| Cab Comfort | Truck seat with lumbar cushion |
| Health & Fitness | Dumbbell + pulse line |
| Organization & Storage | Grid container with handle |
| Electronics & Mounts | Phone + lightning bolt |
| Safety Equipment | Warning triangle + exclamation |
| Flashlights & Tools | Flashlight with light cone |
| Cleaning | Spray bottle with spray dots |
| CDL Essentials | Binder with rings + bookmark star |

---

## 8. Voice & Tone

**Voice:** A working driver who's seen the wrong end of bad gear. Direct. No corporate filler.
**Do say:** "Built for 11-hour shifts." "Stop idling to stay warm." "Inspection-ready in 10 seconds."
**Don't say:** "Elevate your driving experience." "Luxurious comfort." "Game-changing." Anything ad-agency.

Reading level: 7th grade. Average sentence: 12 words. No question marks in headlines.

---

## 9. Photography Direction

- **Lighting:** Warm, golden hour, or dawn-blue.
- **Backdrops:** Sleeper cab interior, truck stop at night, loading dock, asphalt, dash close-ups.
- **No models in business attire.** Real-world drivers, work jeans, ball caps, hi-vis vests.
- **Crop:** Tight, dramatic, lots of negative space. Product is the hero — never lost in clutter.

For v1 launch, supplier photos + 1 licensed stock hero is enough. Plan to shoot owned photography by month 2.

---

## 10. Brand Integrity Check

Sacred Road Supply must look like it belongs in the same family as:
- Sacred Pathway LLC homepage (Squarespace at `sacredpathway.org`)
- Driver Hub iOS app
- Driver Hub web portal (`app.sacredpathway.org`)
- Private Dispatch portal (`dispatch.sacredpathway.org`)

Test: a customer landing on `shop.sacredpathway.org` should immediately recognize it as part of the same ecosystem. If a tile, badge, or button looks "off-palette," check against `BRAND_PALETTE_REFERENCE.md`. There are no exceptions.
