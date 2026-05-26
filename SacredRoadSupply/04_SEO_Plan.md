# Sacred Road Supply — SEO Plan

Goal: rank for high-intent trucker-buyer queries within 90 days. Strategy = long-tail-first, category-page-first, structured-data-everywhere.

---

## 1. Homepage SEO

**Page title (≤60 chars):**
`Sacred Road Supply | Truck Driver Gear & Owner-Operator Supplies`

**Meta description (≤155 chars):**
`Trucker-tested gear for owner-operators, fleet drivers, and CDL students. Cab comfort, electronics, safety & more. U.S. warehouses, fast shipping, 30-day returns.`

**Open Graph title:** Gear Built for the Long Haul — Sacred Road Supply
**Open Graph image:** og-image.png (1200×630)

**H1:** Gear Built for the Long Haul
**H2s:** Built for Every Mile · This Week's Most-Ordered · Why Drivers Choose Us · Get $5 Off Your First Order

**Schema (JSON-LD in theme.liquid):**
- `Organization` — name, logo, sameAs (FB/IG/TikTok/X), address, contactPoint
- `WebSite` with `SearchAction` (sitelink searchbox)

---

## 2. Category (Collection) SEO

| Collection | Page Title | Meta Description | Primary Keyword |
|---|---|---|---|
| Cab Comfort | Truck Cab Comfort — Seat Cushions, Blankets & Curtains | Beat 11-hour shifts. Lumbar cushions, 12V heated blankets, gel seats & cab curtains built for semi truck sleepers. Free shipping $75+. | truck cab comfort accessories |
| Driver Health & Fitness | Truck Driver Health & Fitness Gear | Compression socks, in-cab resistance bands, massage guns. Fitness gear built for life behind the wheel. Ships from U.S. | truck driver fitness gear |
| Organization & Storage | Truck Cab Organizers & Storage for Drivers | Between-seats consoles, hanging organizers, magnetic dash trays. Keep logs, gear & snacks in reach in any semi. | semi truck organizer |
| Electronics & Mounts | Truck Driver Electronics, Chargers & Phone Mounts | 24V/12V chargers, MagSafe dash mounts, dual dash cams, Bluetooth headsets. Built for semi electrical systems. | truck driver electronics |
| Safety Equipment | DOT Safety Equipment for Truck Drivers | FMCSA-compliant triangle kits, heavy-duty tire gauges, hi-vis vests. Inspection-ready safety gear for working drivers. | dot safety equipment truck |
| Flashlights & Tools | Truck Driver Flashlights & Roadside Tools | Rechargeable magnetic LED lights, work lights, and roadside tools built for pre-trips and breakdowns. | truck driver flashlight |
| Truck Cleaning Supplies | Truck Cleaning Supplies for Owner-Operators | Waterless wash & wax, microfiber towels, interior cleaners. Clean your rig at any truck stop, no hose required. | truck cleaning supplies |
| Travel Accessories | Truck Driver Travel Accessories & Gear | 12V tumblers, packing cubes, sleep masks, toiletry bags built for life on the road. | truck driver travel accessories |
| CDL Essentials | CDL Essentials — Logbooks, Permits & Driver Documents | Logbook binders, DOT document organizers, permit folders. Inspection-ready CDL gear for new and seasoned drivers. | cdl essentials trucker |
| Driver Lifestyle | Trucker Lifestyle Apparel & Accessories | Caps, tumblers, decals, and gear that says you live the road. From Sacred Pathway LLC. | trucker lifestyle apparel |

**H1 = page title minus brand suffix.**
**Collection description (first 80 words above the product grid):** Write 60–90 word benefit-led paragraph, naturally include primary keyword + 2 related terms. Drives intro snippet + topical relevance.

**Schema:** `CollectionPage` with `mainEntity: ItemList` referencing 8–12 products.

---

## 3. Product Page SEO

Use the SEO title + meta from `01_Product_Catalog.xlsx` directly into Shopify product fields.

**On every product page, include:**
- H1 = product name (NOT the SEO title — keep H1 reader-friendly)
- 3–5 bullet points above the fold (benefits, specs, fitment)
- "Built for:" tag block (owner-operator / fleet driver / CDL student) — internal-link the category each tag belongs to
- "Frequently bought with" 3-product carousel (Shopify Recommendations)
- Customer reviews block (Shopify Product Reviews or Judge.me free tier)
- FAQ schema with 3–5 real questions per product page (How does it install? Fits which truck models? Return policy? Warranty?)

**Schema per product (JSON-LD):**
- `Product` — name, image, description, brand:"Sacred Road Supply", sku, gtin if available, offers (price, priceCurrency:"USD", availability, priceValidUntil)
- `AggregateRating` once you have 5+ reviews
- `FAQPage` with on-page Q&A

---

## 4. Target Keywords (Tier 1 — Launch Focus)

| Cluster | Primary KW | Long-Tail Variants | Search Intent | Target Page |
|---|---|---|---|---|
| Trucker comfort | truck driver lumbar support | "best lumbar support semi truck", "lumbar cushion long haul" | Commercial | /products/lumbar-support |
| Heat | 12v heated blanket truck | "12v blanket semi truck", "lighter port heated blanket" | Commercial | /products/12v-heated-blanket |
| Charging | semi truck usb c charger 24v | "24v usb c charger truck", "heavy duty truck phone charger" | Commercial | /products/24v-usb-c-charger |
| Safety | dot reflective triangle kit | "fmcsa triangle kit", "dot warning triangle truck" | Commercial | /products/dot-triangle-kit |
| Dash cam | trucker dash cam front cabin | "best dash cam owner operator", "dual dash cam semi" | Commercial | /products/dual-dash-cam |
| Compression | trucker compression socks | "compression socks truck drivers", "20-30 mmhg socks men" | Commercial | /products/compression-socks |
| Organizer | semi truck organizer between seats | "truck cab console organizer", "freightliner cab organizer" | Commercial | /products/console-organizer |
| Cleaning | waterless truck wash | "truck stop wash and wax", "no hose semi wash" | Commercial | /products/waterless-wash-kit |
| CDL | logbook binder cdl | "dot document organizer", "cdl binder driver" | Commercial | /products/logbook-binder |
| Brand/category | truck driver accessories | "trucker gear", "owner operator supplies" | Navigational/Commercial | /collections/all + homepage |

**Tier 2 (blog content):** "best gifts for truck drivers", "what to keep in a semi truck", "how to fight back pain truck driver", "DOT pre-trip inspection checklist", "trucker health tips long haul".

---

## 5. Internal Linking Plan

Rules:
1. Every product links to its **parent collection** in the breadcrumb (Shopify default).
2. Every product page has a **3-product carousel** to siblings in the same collection.
3. Every product page has a **"Built for" tag block** linking to: `/collections/cab-comfort`, `/collections/electronics-mounts`, etc.
4. Homepage links to all **10 category collections** via shop-by-category grid.
5. Every blog post links to **2 relevant collection pages** + **1 specific product** mentioned in the post.
6. Footer links to **all 10 collections + Help pages + Sacred Pathway LLC homepage** (sacredpathway.org) and **Driver Hub** (app.sacredpathway.org).

External backlinks (Phase 1):
- Get listed on Sacred Pathway LLC's homepage (your own site → trust transfer + traffic).
- Reach out to trucking subreddits (r/Truckers, r/owneroperators) with genuinely useful posts that mention products organically.
- Pitch 3 trucking podcasts: "free product for review" angle.
- Submit to trucker-gear roundup blogs (Trucker Path blog, BigRig Wraps blog, Smart-Trucking guides).

---

## 6. Structured Content Templates

### Product Page Body Template (paste into Shopify product description)

```
<h2>What It Does</h2>
<p>[2–3 sentence benefit paragraph from short_description column]</p>

<h2>Why Truckers Buy It</h2>
<ul>
  <li>[Benefit 1 — concrete and specific]</li>
  <li>[Benefit 2]</li>
  <li>[Benefit 3]</li>
  <li>[Benefit 4]</li>
</ul>

<h2>Specs</h2>
<ul>
  <li>Material: [...]</li>
  <li>Dimensions: [...]</li>
  <li>Fits: [universal / specific cabs]</li>
  <li>Power: [if applicable — 12V/24V]</li>
  <li>What's in the box: [...]</li>
</ul>

<h2>Built For</h2>
<p>Owner-operators · Fleet drivers · OTR · Regional · CDL students</p>

<h2>Shipping & Returns</h2>
<p>Ships from U.S. warehouse, 3–7 business days. Free over $75. 30-day returns on unused items.</p>

<h2>FAQ</h2>
<p><strong>Q: Does this fit [common truck make]?</strong><br>A: [Answer]</p>
<p><strong>Q: What's the warranty?</strong><br>A: [Answer]</p>
<p><strong>Q: How does it install?</strong><br>A: [Answer]</p>
```

### Collection Description Template

```
<p>[60–90 words. Lead benefit. Include primary keyword once, related keywords naturally.
End with: "Every item ships from U.S. warehouses with free shipping over $75."]</p>
```

---

## 7. Technical SEO Checklist

- [ ] Submit `shop.sacredpathway.org/sitemap.xml` to Google Search Console
- [ ] Set canonical = self on every product/collection page (Shopify default — verify)
- [ ] Image alt text on every product image: `"[Product name] for truck drivers"`
- [ ] Robots.txt: ensure `/checkout/`, `/cart/`, `/account/` are disallowed (Shopify default)
- [ ] Page speed: enable image lazy loading (default), use WebP where supplier allows
- [ ] Mobile usability: theme must score 90+ on PageSpeed mobile — test pre-launch
- [ ] HTTPS only (Shopify auto)
- [ ] 301 redirects: nothing yet, but set up redirect tracker for any URL change
- [ ] Google Search Console verified via meta tag in theme.liquid
- [ ] Bing Webmaster Tools — same
- [ ] Add Google Merchant Center feed once you hit 10+ products (Shopify GMC app, free)

---

## 8. 90-Day Ranking Forecast (realistic)

- **Days 1–14:** Indexed in Google. Brand name "Sacred Road Supply" ranks #1. No keyword rankings yet.
- **Days 15–45:** First long-tail rankings (positions 30–80) for product-specific terms with low competition (e.g. "12v heated blanket lighter port semi").
- **Days 46–90:** Top-20 rankings on 5–10 long-tail terms. Category pages start appearing on page 2–3 for medium-competition terms. Real traffic ~150–600 organic visits/mo.
- **Months 4–6:** First page for 3–8 long-tail terms if you publish 1 blog post/week and earn 5+ backlinks.

SEO won't pay rent in month 1. Paid traffic (next file) carries you while this compounds.
