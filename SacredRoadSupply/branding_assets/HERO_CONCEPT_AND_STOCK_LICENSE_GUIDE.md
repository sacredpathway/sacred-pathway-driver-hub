# Hero Concept — "Long Haul at Dawn" + Stock License Guide

**Option chosen:** Option 2 — Paid stock photography ($15–$30 license)
**Mockup file:** `hero_mockup.svg` (in this folder) — shows final layout with placeholder scene
**Approval needed:** Concept + chosen stock photo source

---

## 1. The Concept

**Mood:** Quiet, just-before-the-day-starts. Premium-but-blue-collar. Tells a working driver immediately: *"this is for me."*

**Composition that works:**
- **Foreground:** Sleeper-cab interior shot from the driver's POV. Dash gauges glowing. Steering wheel partially in frame OR distant horizon visible through windshield.
- **Background:** Highway at dawn — golden horizon, road stretching to vanishing point, slight haze.
- **Color:** Cool shadows (cobalt/navy), warm highlights (amber/gold) — matches our brand palette naturally.
- **Composition rule:** Keep the LEFT THIRD relatively clean — that's where headline + CTA stack lives.

**What to avoid:**
- Bright midday shots (too generic, no mood)
- Stock-cliché golden-hour-with-model-in-cowboy-hat shots
- Truck driving away from camera (front of truck reads stronger)
- Multiple trucks (visual confusion)
- Anything with a recognizable carrier logo on the truck (legal risk)

---

## 2. Asset Specs

| File | Size | Format | Max Weight |
|---|---|---|---|
| Desktop hero | 2880 × 1200 px | JPG (or WebP) | < 400 KB |
| Mobile hero | 1080 × 1350 px | JPG (or WebP) | < 250 KB |
| Open Graph share | 1200 × 630 px | JPG | < 300 KB |

Shopify Dawn theme will render the headline + CTA overlay on top of the image automatically. **Do NOT bake text into the image** — keep the JPG clean. Editable later.

---

## 3. Stock Photo Search Plan

Three sites in priority order. Verify license terms before using.

### A. Unsplash+ (recommended — best value)

- **URL:** https://unsplash.com/plus
- **Cost:** $7/mo or $5.83/mo annual ($69.96/yr) — unlimited downloads
- **License:** Royalty-free, commercial use, no attribution required
- **Strategy:** Pay one month ($7), download 2–3 candidate hero images + 5–6 alternates for blog/social, cancel
- **Best search terms (use these exact strings):**
  - `semi truck dashboard sunrise`
  - `truck driver dawn highway`
  - `american trucker sleeper cab`
  - `freightliner dashboard dawn`
  - `kenworth interior highway sunset`
  - `truck stop dawn`
- **Skip results that show:** branded carriers, fleet logos, people in the shot (we want gear-focused, not face-focused)

### B. Shutterstock

- **URL:** https://www.shutterstock.com
- **Cost:** Single image on-demand: $14.50–$29 (Pack of 5: $49 = $9.80/image)
- **License:** Royalty-free, commercial use
- **Recommended:** Buy the 5-pack so you have ammo for blog posts + ads later
- **Search terms:** same as Unsplash

### C. Adobe Stock

- **URL:** https://stock.adobe.com
- **Cost:** Standard image: $9.99 (with a free 1-month trial of 10 images)
- **License:** Royalty-free, commercial use
- **If you already use Creative Cloud:** images may be included free
- **Search terms:** same as Unsplash

### Quick decision rule

- Need **one** hero image and you're not subscribed to Adobe: → **Unsplash+ at $7/mo**, cancel after 1 month, done.
- Want hero + 5 backup images for future use: → **Shutterstock 5-pack at $49**.
- Already on Adobe Creative Cloud: → **Adobe Stock**, no extra cost.

---

## 4. Pre-Vetted Search Targets (a starting list — verify each license before use)

Since I can't license photos for you, here are exact search URLs and what to look for in the result grid.

### Unsplash+ search URLs (free-tier preview, paid for hi-res download)
- https://unsplash.com/s/photos/semi-truck-dashboard
- https://unsplash.com/s/photos/truck-driver-dawn
- https://unsplash.com/s/photos/highway-sunrise
- https://unsplash.com/s/photos/sleeper-cab

### Photographer names that consistently shoot what you want (search by name)
- **Quintin Gellar** — multiple semi-truck POV and highway dawn shots
- **Vitpho** (Shutterstock) — cab interior + dashboard close-ups
- **Caleb Ruiter** — American trucker lifestyle

### Recommendation if you want me to pick

If you license one of the Unsplash+ "semi truck dashboard sunrise" top-12 results that matches the composition described in §1 (dark cab, glowing dash, road ahead, no people, no branded carrier), it will work. I can review and approve the specific shot before you finalize the license. Just paste the Unsplash URL in chat after browsing.

---

## 5. Image Prep Workflow (after license)

1. Download the original at max resolution.
2. Crop to **2880 × 1200** (desktop hero ratio = 2.4:1). Pull crop slightly to favor the left third being uncluttered.
3. **Color grade in Photopea (free, web-based) or any image editor:**
   - Highlights: warm +10 (amber)
   - Shadows: cool −10 (blue)
   - Saturation: −5 to −10 (premium look, not Instagram)
   - Contrast: +10
4. Export as **JPG quality 75–82%** — should land under 400 KB. If over, export as WebP at quality 80 (Shopify supports it).
5. Create mobile crop: **1080 × 1350** (4:5 ratio). Recenter the crop so the road takes up bottom half, sky top.
6. Upload to Shopify: **Online Store → Customize → Image banner section** → "Image" (desktop) + "Image (mobile)" if Dawn supports both.

---

## 6. Overlay Copy — Exactly As It Renders

Shopify Dawn renders these as theme-editable text fields. Use these exact strings:

| Field | Content |
|---|---|
| **Heading** | Gear Built for the Long Haul. |
| **Subheading** | Trucker-tested supplies, fast U.S. shipping, and prices that respect what you actually take home. |
| **Primary button** | `Shop Now` → `/collections/all` |
| **Secondary button** | `New Driver? Start Here` → `/collections/cdl-essentials` |
| **Heading size** | XL (Dawn default for hero) |
| **Text color** | White (#FFFFFF) |
| **Subheading color** | Gold (#E6CC73) — Dawn lets you set custom in advanced settings |
| **Image overlay opacity** | 25% (darkens image so white text reads) |
| **Content position** | Bottom-left |

---

## 7. Trust Strip (Bottom of Hero)

Render as a separate Shopify "Multi-column" section directly below the hero banner, OR as a fixed band built into the theme's announcement bar (slightly slower to edit later — recommend first option).

| Column 1 | Column 2 | Column 3 |
|---|---|---|
| Icon: truck (gold) | Icon: warehouse box (gold) | Icon: shield (gold) |
| **FREE SHIPPING $75+** | **SHIPS FROM U.S. WAREHOUSES** | **30-DAY RETURNS** |

Use the trust badge SVGs from `trust_badges/` folder for these icons.

---

## 8. Mobile Considerations

Dawn renders mobile by:
- Stacking headline + subhead at smaller size
- CTA buttons stack vertically
- Trust strip becomes 3-stacked rows

**Mobile hero image rules:**
- Use the 1080×1350 vertical crop
- Make sure the road's vanishing point lands roughly center-vertical (visual anchor)
- Headline overlays bottom 40% of image (theme default)

---

## 9. Approval Decision Points

Tell me:

1. **License path:** Unsplash+ / Shutterstock 5-pack / Adobe Stock / "I'll handle licensing"
2. **Image selection:** "I'll pick from search and send you a URL" / "Pick for me" (you'd paste 3–5 candidate URLs and I'll recommend one)
3. **Color grading:** "I'll edit it" / "I'll send raw, you spec the grade"

Once a specific licensed image is in hand, I'll:
- Confirm crop coordinates for desktop + mobile
- Generate the exact JPG file specs you need to upload to Shopify
- Verify file weight stays under 400 KB / 250 KB
- Produce the OG (1200×630) share image with logo + tagline overlay (this one IS baked, since social previews don't render theme overlays)

**No image is bought yet.** Awaiting your sign-off on license path before you spend a dollar.
