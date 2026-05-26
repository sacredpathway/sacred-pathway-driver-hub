# Sacred Pathway / Sacred Road Supply — Brand Palette Reference

**Architecture:** Two-tier palette.
- **Tier 1 — Canonical Ecosystem Tokens** (`sp*`) — shared across Driver Hub iOS, Sacred Bill Tracker, iSacred Cal, Driver Hub web portal, and Sacred Road Supply. Source of truth: `BrandColors.swift` + `DESIGN_SYSTEM.md`.
- **Tier 2 — Sacred Road Supply Marketing Tier** (`srs*`) — additive premium presentation layer, used ONLY in the Sacred Road Supply storefront for hero, marketing surfaces, and luxury treatment.

**Hard rule:** `spGold #CCAD42` remains the ecosystem primary brand gold. Driver Hub, Sacred Bill Tracker, iSacred Cal, and Sacred Road Supply all share this base. The new `srsGoldHighlight #F0D87C` is used ONLY for metallic sheen, hover states, glow accents, and premium effects — never as a default CTA color.

---

## Tier 1 — Canonical Ecosystem Tokens (DO NOT CHANGE)

### Brand colors (fixed)

| Token | HEX | Role |
|---|---|---|
| `spBlack` | **`#121212`** | Deep black, button labels over gold, wordmark on light bg |
| `spGold` | **`#CCAD42`** | **ECOSYSTEM PRIMARY** — CTAs, headers, big totals, gold tree mark |
| `spGoldLight` | **`#E6CC73`** | Secondary gold, gradient mid-stops, hover-state accents |
| `spDarkGreen` | **`#1A4D26`** | Dark green — net-profit-positive, success icons, bridge color |
| `spGreenAccent` | **`#2E7340`** | Secondary green — revenue/settled accents, gradient pairs |

### Surfaces (dynamic)

| Token | Light HEX | Dark HEX | Role |
|---|---|---|---|
| `spBackground` | `#FFFFFF` | `#0D0D0D` | App-wide background |
| `spCardBg` | `#F5F5F5` | `#1C1C1C` | Card surfaces |
| `spCardBgLight` | `#EAEAEA` | `#292929` | Inputs, pills, insets |

### Text (dynamic)

| Token | Light HEX | Dark HEX |
|---|---|---|
| `spTextPrimary` | `#1A1A1A` | `#F2EBD1` |
| `spTextSecondary` | `#6B6B6B` | `#A69E8C` |

### Status (fixed)

| Token | HEX | Role |
|---|---|---|
| `spSuccess` | `#2EA659` | Positive |
| `spWarning` | `#D9A621` | Caution |
| `spDanger` | `#CC3333` | Negative/delete |

---

## Tier 2 — Sacred Road Supply Marketing Tier (ADDITIVE)

These tokens live ONLY in Sacred Road Supply's branding files and Shopify theme. They do NOT change anything in the iOS Driver Hub app or other ecosystem products.

| Token | HEX | Role |
|---|---|---|
| `srsEmeraldDeep` | **`#0A2F1F`** | Premium hero backdrop, footer base, collection-tile background |
| `srsEmeraldBlack` | **`#051B12`** | Trust strip, announcement bar, extreme dark overlay base |
| `srsLeafGreen` | **`#4A9D3F`** | Leaf highlight on two-tone tree, gradient pair with leafLight |
| `srsLeafLight` | **`#7CC355`** | Top-leaf highlight, "SUPPLY" wordmark gradient end |
| `srsGlowGreen` | **`#1F7A3A`** | Ambient halo / inner medallion glow (use at 18–45% opacity) |
| `srsCream` | **`#F5F0E1`** | Premium serif text on dark backgrounds (vs. flat white) |
| `srsGoldHighlight` | **`#F0D87C`** | **SHEEN ONLY** — metallic specular highlight, hover states, glow accents. **NEVER** a default CTA color. |

### Gold gradient stack (corrected)

The three-stop gold gradient used in logos, ring frames, and trust badges:
```
0%   #F0D87C   srsGoldHighlight   (top sheen / specular)
40%  #E6CC73   spGoldLight        (mid)
100% #CCAD42   spGold             (base — ecosystem primary)
```

The flat 2-stop gold (CTAs, label bands — no sheen):
```
0%   #E6CC73   spGoldLight
100% #CCAD42   spGold
```

This keeps `spGold` as the visual anchor while letting Sacred Road Supply add metallic depth via the sheen highlight at the top of the gradient.

---

## Shopify Theme Color Schemes (Dawn — 4 schemes)

### Scheme 1 — `Brand Light` (product pages, FAQ, About, policies)
| Setting | Value | Token |
|---|---|---|
| Background | `#FFFFFF` | spBackground |
| Text | `#1A1A1A` | spTextPrimary |
| Solid button bg | `#CCAD42` | **spGold** ← primary CTA |
| Solid button label | `#0A2F1F` | srsEmeraldDeep |
| Outline button | `#0A2F1F` | srsEmeraldDeep |
| Links | `#0A2F1F` | srsEmeraldDeep |

### Scheme 2 — `Brand Dark` (hero, footer, premium feature sections)
| Setting | Value | Token |
|---|---|---|
| Background | `#0A2F1F` | srsEmeraldDeep |
| Text | `#F5F0E1` | srsCream |
| Solid button bg | `#CCAD42` | **spGold** ← primary CTA |
| Solid button label | `#0A2F1F` | srsEmeraldDeep |
| Outline button | `#F0D87C` | srsGoldHighlight (sheen border) |
| Links | `#F0D87C` | srsGoldHighlight |

### Scheme 3 — `Accent` (announcement bar, trust strip)
| Setting | Value | Token |
|---|---|---|
| Background | `#051B12` | srsEmeraldBlack |
| Text | `#F0D87C` | srsGoldHighlight (sheen for premium feel) |
| Solid button bg | `#CCAD42` | **spGold** |
| Solid button label | `#0A2F1F` | srsEmeraldDeep |

### Scheme 4 — `Card Inset` (collection cards on dark hero sections)
| Setting | Value | Token |
|---|---|---|
| Background | `#1A4D26` | spDarkGreen (bridge to iOS) |
| Text | `#F5F0E1` | srsCream |
| Accent | `#CCAD42` | spGold |
| Highlight | `#F0D87C` | srsGoldHighlight |

---

## CSS Variables (for Shopify custom CSS)

```css
:root {
  /* Tier 1 — Ecosystem (shared with iOS Driver Hub) */
  --sp-black:        #121212;
  --sp-gold:         #CCAD42;
  --sp-gold-light:   #E6CC73;
  --sp-dark-green:   #1A4D26;
  --sp-green-accent: #2E7340;
  --sp-bg:           #FFFFFF;
  --sp-card-bg:      #F5F5F5;
  --sp-card-bg-lt:   #EAEAEA;
  --sp-text:         #1A1A1A;
  --sp-text-muted:   #6B6B6B;
  --sp-success:      #2EA659;
  --sp-warning:      #D9A621;
  --sp-danger:       #CC3333;

  /* Tier 2 — Sacred Road Supply marketing */
  --srs-emerald-deep:   #0A2F1F;
  --srs-emerald-black:  #051B12;
  --srs-leaf-green:     #4A9D3F;
  --srs-leaf-light:     #7CC355;
  --srs-glow-green:     #1F7A3A;
  --srs-cream:          #F5F0E1;
  --srs-gold-highlight: #F0D87C;  /* sheen only */
}
```

---

## Token Usage Rules

| Use case | Use this token |
|---|---|
| Primary CTA button background | `spGold` `#CCAD42` ← never `srsGoldHighlight` |
| CTA hover state (button gets brighter) | `srsGoldHighlight` `#F0D87C` |
| Logo wordmark "SACRED ROAD" | 3-stop gold gradient (`srsGoldHighlight → spGoldLight → spGold`) |
| Logo wordmark "SUPPLY" | 2-stop green gradient (`srsLeafLight → srsLeafGreen`) |
| Tree trunk + roots in logo | `spGold` flat gradient |
| Tree leaves in logo | 2-stop green leaf gradient (`srsLeafLight → srsLeafGreen`) |
| Hero backdrop | `srsEmeraldDeep` |
| Footer | `srsEmeraldBlack` to `srsEmeraldDeep` gradient |
| Body text on dark sections | `srsCream` `#F5F0E1` |
| Body text on light sections | `spTextPrimary` `#1A1A1A` |
| Collection tile background | `srsEmeraldDeep` |
| Collection tile label band | `spGold` flat gradient |
| Trust badge ring | 3-stop gold gradient with sheen |
| Inner glow / halo on medallion | `srsGlowGreen` at 18–45% opacity |
| Announcement bar text | `srsGoldHighlight` (premium sheen) |
| Standard body links on light bg | `srsEmeraldDeep` (luxury feel vs. blue) |
| Standard body links on dark bg | `srsGoldHighlight` |

---

## What Was Removed from Earlier Approximated Palette

| Old (wrong) | Canonical replacement |
|---|---|
| `#C9A227` | `#CCAD42` (`spGold`) |
| `#E6C76A` | `#E6CC73` (`spGoldLight`) |
| `#0B3D2E` | `#1A4D26` (`spDarkGreen`) |
| `#062118` | `#121212` (`spBlack`) |
| `#0F4A38` | `#2E7340` (`spGreenAccent`) |
| `#C0392B` | `#CC3333` (`spDanger`) |
| `#2E8B57` | `#2EA659` (`spSuccess`) |

---

**This file is the source of truth for any future palette question. The canonical `sp*` tokens are shared across the Sacred Pathway ecosystem and never change without coordinated cross-product release. The `srs*` marketing tier extends Sacred Road Supply's visual presence without breaking ecosystem unity.**
