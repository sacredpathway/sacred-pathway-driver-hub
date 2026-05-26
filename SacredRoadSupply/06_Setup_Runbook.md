# Sacred Road Supply — Platform Setup Runbook

End-to-end Shopify build at `shop.sacredpathway.org`. Estimated time start-to-launch: **6–10 hours of active work over 3–5 days**.

---

## STEP 1 — Shopify Account (15 min)

1. Go to `https://www.shopify.com/free-trial`
2. Sign up with `demarquishinton@gmail.com`
3. Store name: `Sacred Road Supply`
4. Default URL Shopify gives you: `sacredroadsupply.myshopify.com` (we'll add the custom subdomain later)
5. Plan: **Basic Shopify** — `$29/mo` if you commit to annual, `$39/mo` monthly. Pick annual.
6. Skip the "what kind of business" questions or answer truthfully (B2C, dropshipping, accessories).

---

## STEP 2 — Domain Connect (10 min — needs your login)

In Squarespace (where `sacredpathway.org` is registered):

1. Squarespace Home → Settings → Domains → `sacredpathway.org` → DNS Settings → Custom Records → **Add Record**
2. Add this **one** record (do not touch anything else):

| Host | Type | Data |
|---|---|---|
| `shop` | `CNAME` | `shops.myshopify.com` |

In Shopify:

1. Shopify admin → Settings → Domains → **Connect existing domain**
2. Type `shop.sacredpathway.org`
3. Shopify verifies the CNAME (5 min–1 hr typical, up to 48 hr worst case)
4. After verification, Shopify auto-provisions SSL (Let's Encrypt) within 30 minutes
5. Leave `sacredroadsupply.myshopify.com` as the primary domain for now (so admin works during DNS propagation). Once verified, switch primary to `shop.sacredpathway.org`.

Verification — visit `https://shop.sacredpathway.org` — should redirect to your store with the green padlock.

---

## STEP 3 — Theme + Branding (45 min)

1. Online Store → Themes → install **Dawn** (free, official Shopify, fastest, cleanest base).
2. Customize → Theme settings:
   - Colors: paste from `03_Branding_Package.md` palette
   - Typography:  Heading = "Playfair Display", Body = "Inter"
   - Logo: upload `03_Logo_Primary.svg` (header) + `03_Logo_Compact.svg` (favicon)
   - Logo max width: 220px
3. Customize → Theme settings → Buttons:
   - Primary button: solid `#CCAD42` text `#1A4D26`
   - Secondary button: outline `#CCAD42` text `#1A4D26`
4. Header: pin sticky on scroll. Show search icon. Show cart count badge.
5. Footer: enable email signup, social links (FB/IG/TikTok/X — same as parent brand).

---

## STEP 4 — Install Apps (15 min)

Install in this order:

1. **Shopify Inbox** (free) — built-in chat widget. Settings → Apps → install.
2. **Shopify Email** (free up to 10k sends/mo) — for welcome + cart emails until you graduate to Klaviyo.
3. **Zendrop** — Shopify App Store → install → Free plan. Will set up products in Step 6.
4. **CJDropshipping** — Shopify App Store → install → Free.
5. **Judge.me Reviews** (free tier) — for product reviews. Enables AggregateRating schema once you have reviews.
6. **Klaviyo** — skip for now. Install at month 2 when subscriber list > 500.

---

## STEP 5 — Collections (Categories) (20 min)

Online Store → Products → Collections → Create collection. Make all 10 **manual** collections (NOT smart — easier for v1).

For each, paste collection title, description, SEO title and meta from `04_SEO_Plan.md` section 2.

| Order | Collection | URL Handle |
|---|---|---|
| 1 | Cab Comfort | `cab-comfort` |
| 2 | Driver Health & Fitness | `health-fitness` |
| 3 | Organization & Storage | `organization-storage` |
| 4 | Electronics & Mounts | `electronics-mounts` |
| 5 | Safety Equipment | `safety` |
| 6 | Flashlights & Tools | `flashlights-tools` |
| 7 | Truck Cleaning Supplies | `cleaning` |
| 8 | Travel Accessories | `travel-accessories` |
| 9 | CDL Essentials | `cdl-essentials` |
| 10 | Driver Lifestyle | `lifestyle` |

For each collection, upload a category tile image (see `03_Branding_Package.md` § 7 for direction). Quick path: use Canva 1080×1080 templates with green bg + supplier product photo.

---

## STEP 6 — Add 20 Products via Zendrop (90 min)

1. In Zendrop, search each product from `01_Product_Catalog.xlsx` column "Product Name" — filter "Ship From: United States."
2. Pick the highest-rated US-warehouse match for each.
3. Click **Import to Shopify** → set:
   - Title: use the SEO Title from the catalog
   - Description: paste the Short Description + the structured product body template from `04_SEO_Plan.md` § 6
   - Product type: matches the collection name
   - Vendor: `Sacred Road Supply`
   - Tags: `[category-slug]`, `owner-operator`, `fleet`, `cdl`, `dropship`
   - Price: from Sell Price column
   - Cost per item: from Est Cost column (for margin tracking)
   - Compare-at price (optional): set ~25% higher than sell to show savings
   - SEO title / meta description: paste from catalog
   - URL handle: kebab-case version of SEO title
4. Add to the matching collection.
5. Set inventory: leave Zendrop-managed (auto-syncs).
6. Verify first 3 products in a private browser tab — does the page render right, does add-to-cart work, does the checkout estimator show the right tax/shipping?

If a product isn't on Zendrop US, fall back to CJDropshipping → filter "Warehouse: USA."

---

## STEP 7 — Pages (Store Content) (30 min)

Online Store → Pages → Add page. Paste from `02_Store_Content.docx`:

| Page | URL Handle | Title |
|---|---|---|
| About Us | `about` | About Us |
| Shipping Policy | `shipping-policy` | Shipping Policy |
| Return Policy | `return-policy` | Return Policy |
| FAQ | `faq` | Frequently Asked Questions |
| Contact | `contact` | Contact |

For Privacy / Terms / Refund Policy:
1. Settings → Policies → click each.
2. Click **Create from template** → replace placeholder content with the version in `02_Store_Content.docx`.
3. Save. These auto-link in your footer.

---

## STEP 8 — Navigation (10 min)

Online Store → Navigation:

**Main menu:**
```
Home → /
Shop → /collections/all
  Cab Comfort → /collections/cab-comfort
  Health & Fitness → /collections/health-fitness
  Organization → /collections/organization-storage
  Electronics → /collections/electronics-mounts
  Safety → /collections/safety
  Flashlights & Tools → /collections/flashlights-tools
  Cleaning → /collections/cleaning
  Travel → /collections/travel-accessories
  CDL Essentials → /collections/cdl-essentials
  Lifestyle → /collections/lifestyle
About → /pages/about
Driver Hub → https://app.sacredpathway.org
Contact → /pages/contact
```

**Footer menu:**
```
Help: Contact, Shipping Policy, Return Policy, FAQ
About: About Us, Sacred Pathway LLC, Driver Hub
Legal: Privacy Policy, Terms of Service, Refund Policy
```

---

## STEP 9 — Shipping (10 min)

Settings → Shipping and delivery → General profile → **Edit**.

**Zone 1 — United States (contiguous 48):**
- Rate 1: `Standard Shipping`, Price-based, $0–$74.99 = **$5.95**
- Rate 2: `Standard Shipping`, Price-based, $75.00+ = **Free**
- Rate 3: `Expedited (2–3 day)`, Flat **$14.95**

**Zone 2 — AK / HI / U.S. Territories:**
- Rate: `Standard`, Flat **$14.95**
- Or — disable entirely until you have a US-warehouse supplier that covers AK/HI without surcharge.

**Zone 3 — APO/FPO/DPO:**
- Rate: `Military`, Flat **$9.95**

Disable international shipping for v1.

---

## STEP 10 — Tax (5 min)

Settings → Taxes and duties → United States → **Set up Shopify Tax** (free under $100k/yr revenue).
Add your business address (Greensboro, AL) → Shopify auto-detects nexus → calculates state/local at checkout. Done.

---

## STEP 11 — Payments (10 min — needs your login + banking)

Settings → Payments:

1. **Shopify Payments** → Activate → enter:
   - Business type: LLC
   - EIN: [Sacred Pathway LLC EIN]
   - Bank account: routing + account where payouts deposit
   - Statement descriptor: `SACRED ROAD SUPPLY`
2. **PayPal Express** → Activate → connect existing PayPal or create new.
3. Enable Apple Pay + Shop Pay + Google Pay (toggle on — auto-enabled with Shopify Payments).

---

## STEP 12 — Email Capture + Notifications (10 min)

1. Online Store → Themes → Customize → add **Newsletter section** to homepage footer (or use a popup app — Shopify Forms is free).
2. Settings → Notifications → enable "Abandoned checkout" email (auto-fires at 10 hours).
3. Customize the **Order confirmation** + **Shipping confirmation** templates with brand colors + tagline footer ("Built for the long haul").

---

## STEP 13 — Search + Filters (10 min)

1. Online Store → Themes → Customize → Collections page → enable filters.
2. Filters to expose:
   - Price (auto)
   - Vendor (auto)
   - Tags: `owner-operator`, `fleet`, `cdl`, `safety`, `electronics`, `comfort`
3. Search: Dawn theme has built-in. For better fuzzy search, install **Searchanise** (free tier) at month 2.

---

## STEP 14 — Email Auto-Sequences (20 min)

In **Shopify Email**:

1. Automations → Welcome series → use template → paste 5 emails from `05_Marketing_Kit.md` § 1.
2. Automations → Abandoned cart → enable. (Shopify default = 1 email at 10hr. To get the 3-email sequence you need Klaviyo — defer to month 2.)
3. Create the `ROADREADY` discount code: Discounts → Create → Code `ROADREADY` → $5 off → minimum $20 cart → one-time use per customer → expires 30 days after issued.

---

## STEP 15 — Pre-Launch QA (60 min)

Test on a real iPhone AND desktop browser:

- [ ] Homepage loads on mobile in <3 sec
- [ ] All 10 collections show 1+ product
- [ ] Each product page: title, image, price, description render
- [ ] Add to cart works
- [ ] Checkout flows: card payment, Apple Pay, PayPal
- [ ] Order confirmation email arrives
- [ ] Tracking shows in customer account
- [ ] Mobile menu opens correctly
- [ ] Footer links all resolve (no 404s)
- [ ] Search returns relevant results for "lumbar", "dash cam", "blanket"
- [ ] Sales tax calculates at checkout for AL address
- [ ] Free shipping triggers at $75 cart
- [ ] $5 code ROADREADY applies correctly
- [ ] Abandoned cart email arrives after intentional abandonment
- [ ] Privacy / Terms / Shipping / Return pages all show populated content
- [ ] SSL padlock shows on every page
- [ ] Favicon shows in browser tab

Place a real $5–$20 test order to yourself. Verify the Zendrop fulfillment fires automatically.

---

## STEP 16 — Marketing Activation (Launch Day)

1. **Sacred Pathway LLC homepage:** add a top nav link "Sacred Road Supply" → `https://shop.sacredpathway.org`. (Edit in Squarespace.)
2. **Driver Hub iOS app:** in next release, add a Settings row → "Sacred Road Supply Store" linking to the same URL. (Future iOS submission — not gating launch.)
3. **Social media bios:** swap link in IG/FB/TikTok/X bios to the shop URL with UTM tag: `https://shop.sacredpathway.org/?utm_source=instagram&utm_medium=bio`.
4. **Email blast:** if Sacred Pathway has any existing newsletter list (Squarespace), send the launch announcement.
5. **Meta ad:** launch Ad #1 (lumbar cushion) at $10/day. Let it run 5 days before judging.
6. **Google Search Console:** verify ownership of `shop.sacredpathway.org`, submit sitemap.

---

## STEP 17 — Day-2 / Week-1 Checks

- Day 1: 5 sessions, 0 orders is fine.
- Day 3: if any ad has >100 link clicks and 0 add-to-carts, swap creative.
- Day 7: review GA/Shopify analytics — best-clicked product, conversion rate, AOV. Kill underperformers in ads, double winners.
- Week 2: Klaviyo install if email list > 100 subs.
- Week 4: First retargeting campaign (viewers + add-to-carts).

---

## STEP 18 — Known Limitations & Manual Items

Items I can't complete from this environment:

1. **Shopify account creation** — needs your email + payment method
2. **Squarespace DNS edits** — needs your Squarespace login
3. **Shopify Payments / PayPal setup** — needs your banking + EIN
4. **Zendrop product import** — needs your Shopify login + Zendrop account
5. **Real product photography** — supplier photos for launch; brand-shot photography is a Phase-2 project
6. **Test purchase + Zendrop fulfillment test** — needs a live charge on your card
7. **Email marketing platform connect** — needs your account creation
8. **Meta / Google Ads accounts + payment** — needs your accounts and billing

All the COPY, BRANDING, CATALOG, POLICIES, EMAILS, AD COPY, SEO is delivered as files you can paste in. The setup steps above translate directly to clicks once you're logged in.
