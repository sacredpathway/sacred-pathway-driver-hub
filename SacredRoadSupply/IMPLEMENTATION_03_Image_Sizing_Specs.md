# Shopify Image Sizing Specifications

**Goal:** Single reference for every image asset uploaded to the store. Get sizing right once → no rendering bugs, no slow page loads, no rejected uploads.

**General rules (Shopify Dawn):**
- Max upload size: **20 MB per image** (Shopify hard limit). Target: ≤ **400 KB** for hero, ≤ **150 KB** for everything else.
- Preferred format: **WebP** if your editor supports it (better compression). Otherwise **JPG** for photos, **PNG** for logos/transparent.
- Color profile: **sRGB**. Strip EXIF on export (privacy + smaller files).
- 2x retina rule: design upload at 2x the displayed size so it stays sharp on high-DPI devices.

---

## Master Reference Table

| Asset | Recommended Upload Size | Displayed Size (Dawn) | Format | Target File Weight | Where it goes | Status |
|---|---|---|---|---|---|---|
| Primary logo (header) | 900 × 320 px | 220 × 78 px | PNG or SVG | < 30 KB | Theme settings → Header → Logo | ✅ Delivered: `logos/logo_primary_900x320.png` + `03_Logo_Primary.svg` |
| Logo (footer, light on dark) | 900 × 320 px | 200 × 70 px | PNG (white version) | < 30 KB | Theme settings → Footer | ⚠ Same primary logo works on dark; if contrast issue, request a monochrome white variant |
| Favicon | 180 × 180 px | 32 × 32 px | PNG | < 15 KB | Theme settings → Favicon | ✅ Delivered: `logos/favicon_180x180.png` |
| Apple touch icon | 1024 × 1024 px | 180 × 180 px | PNG | < 80 KB | Auto-derived from favicon | ✅ Delivered: `logos/logo_compact_1024x1024.png` |
| Social avatar (FB/IG/TikTok/X) | 512 × 512 px | varies | PNG | < 80 KB | Each social profile | ✅ Delivered: `logos/logo_compact_512x512.png` |
| Hero — desktop | 2880 × 1200 px | 1600 × 668 px | JPG or WebP | < 400 KB | Customize → Image banner → Image | ⏳ Pending (Option A workflow) |
| Hero — mobile | 1080 × 1350 px | 380 × 475 px | JPG or WebP | < 250 KB | Customize → Image banner → Mobile image | ⏳ Pending (Option A workflow) |
| Open Graph share image | 1200 × 630 px | 1200 × 630 px | JPG | < 300 KB | Customize → Theme settings → Social sharing image | ⏳ Will build after hero is licensed |
| Collection tile (8 total) | 1080 × 1080 px | 270 × 270 px (desktop) | PNG | < 80 KB each | Each collection → Image | ✅ Delivered: `png_exports/collection_tiles/` |
| Trust badge (6 total) | 600 × 700 px | 150 × 175 px | PNG (transparent) | < 30 KB each | Multicolumn sections | ✅ Delivered: `png_exports/trust_badges/` |
| Product image (primary) | 2048 × 2048 px | 600 × 600 px | JPG or WebP | < 200 KB each | Each product → Media | ⏳ Comes from supplier (Zendrop) at import time |
| Product image (additional) | 1500 × 1500 px | 600 × 600 px | JPG | < 150 KB each | Each product → Media (up to 8) | ⏳ Same — supplier-provided |
| About page banner | 2400 × 1000 px | 1600 × 667 px | JPG | < 300 KB | About page (Image with text block) | ⏳ Use Sacred Pathway truck photo |
| Email header (Klaviyo / Shopify Email) | 1200 × 400 px | 600 × 200 px | PNG | < 100 KB | Email templates | ⏳ Build once email platform is chosen |
| Blog post featured image | 1200 × 800 px | 600 × 400 px | JPG | < 200 KB | Each blog post → Featured image | ⏳ Per-post |

---

## Hero Image — Detailed Spec (the one that matters most)

When the Unsplash+ candidate is approved, the file you upload to Shopify must meet these specs exactly:

**Desktop hero (`hero_desktop.jpg`):**
- Exact pixel size: **2880 × 1200** (ratio 2.4:1)
- Format: JPG (or WebP)
- JPG quality: **78–82%** (sweet spot for photos)
- Color profile: sRGB
- Max file weight: **400 KB** — if larger, re-export at 75% quality
- No baked-in text overlay (Shopify renders headline + CTAs on top)
- Color graded: cool shadows / warm highlights / saturation −5

**Mobile hero (`hero_mobile.jpg`):**
- Exact pixel size: **1080 × 1350** (ratio 4:5)
- Same format/quality/weight rules
- Different crop: keep the road and dashboard in frame; sky can be smaller

**OG share image (`og_share.jpg`):**
- Exact pixel size: **1200 × 630** (Facebook/Twitter standard)
- Format: JPG
- Max weight: 300 KB
- **This one IS baked** — social platforms don't render theme overlays
- Required overlay elements:
  - Sacred Road Supply logo (horizontal, top-left)
  - Headline: *Gear Built for the Long Haul.* (Playfair, white)
  - Tagline strip across bottom: *Free Shipping $75+ · U.S. Warehouses · 30-Day Returns*

---

## Product Image Standards (when supplier images arrive)

When you import from Zendrop, the supplier provides product images. Quality is usually OK but inconsistent. Pre-publish, audit each product image against this rubric:

**Accept the image if:**
- ≥ 1500 × 1500 px (square crop)
- Plain white or near-white background (true product shots)
- Product fills 70–90% of the frame
- No watermarks, no text overlays, no Amazon-style "AS SEEN ON" badges
- Sharp focus on the product
- File weight < 300 KB after Shopify's auto-optimization

**Reject and re-source if:**
- < 1200 × 1200 px (will look soft on retina)
- Cluttered lifestyle background (use as a *secondary* image only)
- Watermarked with another brand
- Visible JPEG compression artifacts
- Image stretched or distorted

**Fallback if supplier images are bad:**
1. Try CJ-USA's version of the same SKU — often better photography
2. Use one of the supplier's lifestyle shots as primary, supplier's product-only shot as secondary
3. Defer the SKU until you can shoot it yourself (Phase 2)

---

## Image Optimization Workflow (before upload to Shopify)

Free tools that get you to weight targets:

**Option 1 — Browser-based (zero install):**
- **Squoosh.app** (https://squoosh.app) — Google's open-source tool. Drag in any image, slide quality down to 80%, download. Best WebP/JPG converter.

**Option 2 — Bulk processing:**
- **TinyPNG.com** — drag-drop up to 20 PNG/JPG, automatic optimization, downloads as ZIP

**Option 3 — In Shopify (automatic):**
- Shopify auto-compresses uploaded images and serves them as WebP to compatible browsers. So even an un-optimized JPG gets some benefit. But: start with a clean file or Shopify's compression amplifies existing problems.

**Recommended pre-upload pipeline for any photo:**
1. Open in Squoosh
2. Settings: MozJPEG, quality 78
3. Compare side-by-side to original — if no visible loss, ship it
4. If file > 400 KB at quality 78, drop to 72 and try again

---

## File Naming Convention (so future you can find them)

Inside Shopify Files (Settings → Files), there's no folder structure. Names matter.

Use this format: `srs_<category>_<purpose>_<size>.<ext>`

Examples:
- `srs_hero_desktop_2880x1200.jpg`
- `srs_hero_mobile_1080x1350.jpg`
- `srs_tile_cab-comfort_1080x1080.png`
- `srs_badge_free-shipping_600x700.png`
- `srs_logo_primary_900x320.png`
- `srs_about_truck-banner_2400x1000.jpg`

This keeps assets findable by search later when you have 200+ files.

---

## What's Delivered vs. What's Pending

✅ **Delivered as both SVG (master) + PNG (Shopify-ready):**
- Logo primary (horizontal)
- Logo compact (medallion)
- Favicon 180×180
- 8 collection tiles (1080×1080 PNG)
- 6 trust badges (600×700 PNG)
- Apple touch + social avatar variants of compact logo

⏳ **Pending — depends on next steps:**
- Hero desktop image (waiting on Unsplash+ license)
- Hero mobile image (same)
- OG share image (built after hero is in hand)
- About page banner (re-crop existing Sacred Pathway truck photo)
- Email header graphics (after email platform chosen)
- Product images (auto-flow in from Zendrop at import time)

All delivered PNGs are in `branding_assets/png_exports/`. Drag-drop ready into Shopify Files.
