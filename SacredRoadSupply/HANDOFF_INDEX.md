# Sacred Road Supply — Handoff Index

**Purpose:** Single entry point for every deliverable in this folder. If you only read one file, read this one.
**Status:** Branding A−, content launch-ready, Shopify not yet built. iOS Settings link coded + gated.
**Live storefront:** `https://shop.sacredpathway.org` (DNS + SSL verified; theme not yet customized).

---

## 1. Where to Start

| Goal | Read first |
|---|---|
| Build the Shopify storefront | `SHOPIFY_IMPLEMENTATION_PLAYBOOK.md` |
| Understand the brand palette | `BRAND_PALETTE_REFERENCE.md` |
| Score launch readiness | `D_Launch_Readiness_Scorecard.md` |
| Run a supplier sample test | `SUPPLIER_VERIFICATION_TRACKER.xlsx` |
| License a hero photo | `HERO_CANDIDATE_REVIEW_WORKFLOW.md` |
| Copy product descriptions into Shopify | `PRODUCT_DESCRIPTIONS_HTML.md` |
| Configure email automations | `EMAIL_WELCOME_SERIES.html` + `EMAIL_ABANDONED_CART.html` |
| Publish first blog post | `blog/01-owner-operator-cab-essentials.md` |

---

## 2. Complete File Map

### Strategy & Reports (read once, reference often)
| File | Where it's used |
|---|---|
| `07_Final_Report.md` | The original audit + recommendation that locked the project direction |
| `REPORT_1_Supplier_and_Shopify_Setup.md` | Supplier comparison + Shopify settings + DNS guide |
| `REPORT_2_Product_Validation.md` | Per-SKU validation with Amazon competitor pricing |
| `BRAND_AUDIT_V2_GRADING.md` | Creative-director grading report for v2 asset refinement |

### Brand Standards (canonical — never override)
| File | Where it's used |
|---|---|
| `BRAND_PALETTE_REFERENCE.md` | **Source of truth.** Tier 1 canonical (`sp*`) + Tier 2 marketing (`srs*`) tokens. Cite this anywhere palette comes up. |
| `03_Branding_Package.md` | Voice, typography, hero direction, logo file map |
| `03_Logo_Primary.svg` | Horizontal lockup with two-tone tree (gold trunk + green canopy + roots) |
| `03_Logo_Compact.svg` | Circular medallion mark for favicon / social avatar / app icon |

### Catalog
| File | Where it's used |
|---|---|
| `01_Product_Catalog_FINAL.xlsx` | **CANONICAL.** 20 approved SKUs with supplier, cost, sell, margin, SEO, notes. Use this — not the earlier `01_Product_Catalog.xlsx` (kept for history). |
| `PRODUCT_DESCRIPTIONS_HTML.md` | Drop-in HTML body for every Shopify product page. One block per SKU. |

### Store Content
| File | Where it's used |
|---|---|
| `02_Store_Content.docx` | Master copy for About/Contact/FAQ/Policies in Word format |
| `STORE_CONTENT_FOR_REVIEW.md` | Same content in markdown form — easier to copy-paste into Shopify |

### Shopify Build (sequential execution path)
| File | When you use it |
|---|---|
| `SHOPIFY_IMPLEMENTATION_PLAYBOOK.md` | **Primary build doc.** Sequential phases 0–21 + QA. Every Dawn field pre-decided. |
| `A_Shopify_Launch_Checklist.md` | Sub-checklist for Phases 1–10 of the playbook (account, payments, tax, shipping, policies, apps) |
| `IMPLEMENTATION_01_Homepage.md` | Detail reference for homepage section settings |
| `IMPLEMENTATION_02_Categories.md` | Detail reference for collection setup |
| `IMPLEMENTATION_03_Image_Sizing_Specs.md` | Every image asset size + format + weight target |
| `06_Setup_Runbook.md` | Original setup walkthrough (now superseded by playbook; kept for context) |

### DNS + Verification
| File | When you use it |
|---|---|
| `B_DNS_Verification_Checklist.md` | Squarespace CNAME → Shopify domain connect. **Already executed; DNS live.** |
| `C_Sample_Arrival_Testing_Checklist.md` | Per-SKU sample test procedure |
| `SUPPLIER_VERIFICATION_CHECKLIST.md` | Detailed sample-test plan for the 4 VERIFY SKUs |
| `SUPPLIER_VERIFICATION_TRACKER.xlsx` | **Active tracking sheet.** 5 sheets, dropdowns, fill in as samples arrive. |
| `D_Launch_Readiness_Scorecard.md` | 100-point gate to publish theme. Re-score weekly. |

### Hero Image (Unsplash+ workflow)
| File | When you use it |
|---|---|
| `HERO_CANDIDATE_REVIEW_WORKFLOW.md` | 7-step path: search → paste URLs → I pick → you license → I prep exports |
| `branding_assets/HERO_CONCEPT_AND_STOCK_LICENSE_GUIDE.md` | Composition brief + license site comparison |
| `branding_assets/hero_mockup.svg` | Placeholder mockup with overlay structure — replace background scene after licensing |

### Branding Asset Library

**SVG masters** in `branding_assets/`:
| File | Use |
|---|---|
| `hero_mockup.svg` | Desktop hero comp (placeholder scene) |
| `hero_mobile.svg` | Vertical mobile hero crop (1080×1350) |
| `og_share.svg` | Social-share preview (1200×630, baked logo + tagline) |
| `logo_footer_variant.svg` | Monochrome lockup for dark footer |
| `collection_tiles/*.svg` (×8) | Per-category tile (1080×1080) |
| `trust_badges/*.svg` (×6) | Circular badge (gold ring + icon + caption) |

**PNG exports** (Shopify-ready, retina-compatible) in `branding_assets/png_exports/`:
| Folder | Contents | Use |
|---|---|---|
| `logos/` | logo_primary, logo_footer, logo_compact (1024+512), favicon (16/32/48/180 + ICO) | Theme settings + favicon |
| `collection_tiles/` | 8 tiles at 1080×1080 | Each Shopify collection → Image |
| `trust_badges/` | 6 badges at 600×740 | Multicolumn sections (trust strip + Why Drivers Choose) |
| (root of png_exports) | `og_share_1200x630.png`, `hero_mockup_preview_1440x600.png`, `hero_mobile_1080x1350.png` | OG image + hero placeholders |

### Marketing Assets
| File | When you use it |
|---|---|
| `04_SEO_Plan.md` | Title/meta for homepage/categories/products; keyword clusters; internal linking |
| `05_Marketing_Kit.md` | Long-form: email sequences, ad copy, blog calendar, promo calendar, influencer outreach |
| `EMAIL_WELCOME_SERIES.html` | **Drop-in HTML** — 5 emails styled with brand tokens, ready for Shopify Email / Klaviyo |
| `EMAIL_ABANDONED_CART.html` | **Drop-in HTML** — 3-email cart-recovery series |
| `blog/01-owner-operator-cab-essentials.md` | First blog post (~1,800 words), ready to publish |

---

## 3. Copy-Paste Checklists

### A. Product Descriptions Workflow

When you start importing the 20 SKUs from Zendrop into Shopify:

- [ ] Open `PRODUCT_DESCRIPTIONS_HTML.md` in your editor
- [ ] For each SKU in `01_Product_Catalog_FINAL.xlsx`, find the matching `### SRS-XX-NNN` section in the descriptions file
- [ ] Copy the HTML between ` ```html ` and ` ``` ` markers (do NOT include the markers themselves)
- [ ] In Shopify, open the product → Description field
- [ ] Click the **`<>`** (source code) icon — switches the editor to HTML mode
- [ ] Paste
- [ ] Repeat for all 20 SKUs
- [ ] Spot-check 2-3 products in the Shopify preview to confirm rendering

### B. Email Automations Workflow

When you're ready to configure email flows (after Shopify built):

**Shopify Email (v1, free up to 10k sends/mo):**
- [ ] Marketing → Automations → Create automation → "Welcome new subscribers"
- [ ] For each of the 5 emails in `EMAIL_WELCOME_SERIES.html`:
  - [ ] Open the file in a text editor
  - [ ] Copy the HTML between `<!-- EMAIL X START -->` and `<!-- EMAIL X END -->`
  - [ ] In Shopify Email, switch to HTML source mode
  - [ ] Paste
  - [ ] Set send delay per the file's footer notes (0 / 2d / 4d / 7d / 10d)
- [ ] Marketing → Automations → "Recover abandoned checkouts" → use Email 1 from `EMAIL_ABANDONED_CART.html` (Shopify Email built-in only supports 1 cart email; the 3-email flow lands when you migrate to Klaviyo at 500+ subs)

**Klaviyo (Phase 2, at 500+ subs):**
- [ ] Migrate the 5 welcome emails + the full 3-email cart-recovery series
- [ ] All HTML in both files is Klaviyo-compatible

### C. Blog Publishing Workflow

When you launch the blog (Phase 2, can wait until after store goes live):

- [ ] Online Store → Blog posts → Add blog post (or first: Add blog → "News" or "Driver Resources")
- [ ] Title: `The 11 Things Every Owner-Operator Should Keep in the Cab`
- [ ] URL handle: `owner-operator-cab-essentials`
- [ ] Author: `The Sacred Pathway Family`
- [ ] Tags (from file footer): `owner operator, trucker essentials, cab gear, long haul, DOT compliance, truck driver safety`
- [ ] Copy body from `blog/01-owner-operator-cab-essentials.md` (skip the YAML-style frontmatter at top — that's metadata, not body)
- [ ] Paste into Shopify rich-text editor (or HTML source mode for cleanest paste)
- [ ] Set SEO title + meta from the top of the file
- [ ] Set featured image: pick a truck-cab shot from your Sacred Pathway photo library (or wait for the Phase 2 paid stock pack)
- [ ] Confirm all 10 internal product links resolve (may 404 until imports complete — fine; re-verify after import)

---

## 4. Blocked Until User Action

These items cannot advance without you. Listed in priority order:

| Blocker | Owner | Effort | Unblocks |
|---|---|---|---|
| **Shopify admin login + execute `SHOPIFY_IMPLEMENTATION_PLAYBOOK.md`** | You | ~3 hr 20 min | The entire store theme + collections + pages |
| **Unsplash+ subscription + paste 3-5 candidate URLs** | You | 15 min | Real hero image (currently placeholder mockup) |
| **Generate Shopify Admin API token (optional)** | You | 5 min | Could let me drive theme via API instead of manual clicks |
| **Place 4 supplier sample orders via Zendrop** | You (~$96) | 5 min order + 7 days wait | Catalog launch |
| **Run physical sample tests using `SUPPLIER_VERIFICATION_TRACKER.xlsx`** | You | ~3 hr active | Final approve/drop decisions |
| **Activate Shopify Payments (EIN + bank)** | You | 15 min | Real checkout |
| **Add CNAME OR nav link from `sacredpathway.org`** | You (Squarespace) | 10 min | Discoverability from main site |
| **Build + submit iOS Driver Hub with new Settings row** | You (Xcode) | 30 min build + Apple Review wait | Cross-product traffic |
| **Flip `Config.Store.storeLive = true` in iOS code** | Me, once store is live | 30 sec edit | iOS Settings row appears for users |

---

## 5. What's Already Done (verified)

- ✅ Brand palette (canonical `sp*` + marketing `srs*`) locked in `BRAND_PALETTE_REFERENCE.md`
- ✅ 20-product catalog finalized + economics validated against current Amazon pricing
- ✅ All 20 product description HTML bodies ready
- ✅ 9 store pages of copy written (About, Contact, FAQ, all policies, homepage sections)
- ✅ Logos (primary + compact + footer variant) with two-tone tree + organic canopy + roots + metallic finish
- ✅ 8 collection tiles + 6 trust badges + OG share + mobile hero (all SVG + PNG)
- ✅ Multi-size favicon ICO (16/32/48/64/128/256 embedded)
- ✅ 5-email welcome series + 3-email cart recovery series (drop-in HTML)
- ✅ Blog post #1 (~1,800 words) written
- ✅ Driver Hub iOS Settings link coded (gated by `Config.Store.storeLive = false`)
- ✅ DNS for `shop.sacredpathway.org` live + SSL verified
- ✅ Shopify domain verification TXT record placed
- ✅ `SHOPIFY_IMPLEMENTATION_PLAYBOOK.md` — full sequential build doc, every field pre-decided
- ✅ Supplier verification framework + tracker with dropdowns
- ✅ Launch readiness scorecard (100-point gate)

---

## 6. Tool Reference

| Tool | Use |
|---|---|
| Shopify admin | https://sacredroadsupply.myshopify.com/admin |
| Squarespace admin | https://account.squarespace.com (for DNS only — do NOT change anything except the existing CNAME) |
| Zendrop | https://app.zendrop.com (supplier — install + sample orders only) |
| Photopea | https://www.photopea.com (free Photoshop-alternative, for hero color grading) |
| Squoosh | https://squoosh.app (image compression to hit Shopify weight targets) |
| Facebook Sharing Debugger | https://developers.facebook.com/tools/debug/ (OG image preview) |
| Google Search Console | https://search.google.com/search-console (submit sitemap after launch) |

---

## 7. File-Tree Summary

```
SacredRoadSupply/
├── HANDOFF_INDEX.md                  ← you are here
├── SHOPIFY_IMPLEMENTATION_PLAYBOOK.md  ← primary execution doc
├── BRAND_PALETTE_REFERENCE.md           ← canonical palette source of truth
├── PRODUCT_DESCRIPTIONS_HTML.md         ← 20 SKU HTML bodies
├── EMAIL_WELCOME_SERIES.html            ← 5-email drop-in
├── EMAIL_ABANDONED_CART.html            ← 3-email drop-in
├── 01_Product_Catalog_FINAL.xlsx        ← 20 SKUs catalog
├── SUPPLIER_VERIFICATION_TRACKER.xlsx   ← active sample-test log
├── D_Launch_Readiness_Scorecard.md      ← 100-point publish gate
├── A_Shopify_Launch_Checklist.md
├── B_DNS_Verification_Checklist.md
├── C_Sample_Arrival_Testing_Checklist.md
├── HERO_CANDIDATE_REVIEW_WORKFLOW.md
├── BRAND_AUDIT_V2_GRADING.md
├── 03_Branding_Package.md
├── 03_Logo_Primary.svg
├── 03_Logo_Compact.svg
├── 02_Store_Content.docx
├── STORE_CONTENT_FOR_REVIEW.md
├── 04_SEO_Plan.md
├── 05_Marketing_Kit.md
├── 06_Setup_Runbook.md
├── 07_Final_Report.md
├── REPORT_1_Supplier_and_Shopify_Setup.md
├── REPORT_2_Product_Validation.md
├── IMPLEMENTATION_01_Homepage.md
├── IMPLEMENTATION_02_Categories.md
├── IMPLEMENTATION_03_Image_Sizing_Specs.md
├── SUPPLIER_VERIFICATION_CHECKLIST.md
├── 01_Product_Catalog.xlsx               (historical — superseded by FINAL)
├── blog/
│   └── 01-owner-operator-cab-essentials.md
└── branding_assets/
    ├── hero_mockup.svg
    ├── hero_mobile.svg
    ├── og_share.svg
    ├── logo_footer_variant.svg
    ├── HERO_CONCEPT_AND_STOCK_LICENSE_GUIDE.md
    ├── collection_tiles/   (8 SVGs)
    ├── trust_badges/       (6 SVGs)
    └── png_exports/
        ├── logos/          (10 files incl. favicon.ico)
        ├── collection_tiles/ (8 PNGs)
        ├── trust_badges/   (6 PNGs)
        ├── og_share_1200x630.png
        ├── hero_mockup_preview_1440x600.png
        └── hero_mobile_1080x1350.png
```

**Total: 75 files, 2.8 MB.**

---

## 8. Cross-Repo iOS Change

In addition to `SacredRoadSupply/`, the following files in the nested iOS repo were edited to add the (gated) Sacred Road Supply link in Driver Hub Settings:

- `SacredPathway/SacredPathway/Config.swift` — added `enum Store { storeURL, storeLive }`
- `SacredPathway/SacredPathway/Views/Settings/SettingsView.swift` — added `Section("Shop Trucker Gear")` block

`storeLive = false` by default — feature hidden in current build. Flip to `true` after Shopify launches and ship the next iOS build.

---

**Last updated:** 2026-05-26 (handoff bundle commit)
