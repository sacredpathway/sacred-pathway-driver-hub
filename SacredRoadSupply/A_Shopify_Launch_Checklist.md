# A. Shopify Launch Checklist

**Goal:** Shopify account fully configured. Empty store ready to receive products.
**Time:** ~90 minutes total. Do in one sitting.
**Cost:** $29/mo (Basic annual) + sales tax fees only after $100k/yr.

---

## 1. Create Account (10 min)

- [ ] Go to `https://www.shopify.com/free-trial`
- [ ] Email: `demarquishinton@gmail.com`
- [ ] Store name: `Sacred Road Supply`
- [ ] Skip onboarding survey OR answer briefly (B2C, dropshipping, accessories)
- [ ] Confirm shopify-assigned URL: `sacredroadsupply.myshopify.com`

## 2. Pick Plan (3 min)

- [ ] Settings → Plan → Choose plan
- [ ] Select **Basic — Annual**  ($29/mo billed annually = $348/yr)
- [ ] Enter card on file
- [ ] Confirm transaction fees: 2.9% + $0.30 (Shopify Payments)

## 3. Theme Install (5 min)

- [ ] Online Store → Themes → Free themes → Add **Dawn**
- [ ] Click **Customize** (do not Publish until later)
- [ ] Theme settings → Typography:
  - Heading: `Playfair Display` (search Google Fonts)
  - Body: `Inter`
- [ ] Theme settings → Colors → create 3 schemes per `IMPLEMENTATION_01_Homepage.md` §Theme Settings
- [ ] Upload favicon: `branding_assets/png_exports/logos/favicon_180x180.png`

## 4. Shopify Payments (15 min — needs banking)

- [ ] Settings → Payments → **Activate Shopify Payments**
- [ ] Business type: **LLC**
- [ ] Legal name: `Sacred Pathway LLC`
- [ ] EIN: ________________  (have ready)
- [ ] Personal: SSN last 4 + DOB
- [ ] Bank routing + account number: ________________
- [ ] Statement descriptor: `SACRED ROAD SUPPLY`
- [ ] Auto-enable: Apple Pay, Shop Pay, Google Pay
- [ ] Add **PayPal Express** as secondary (Settings → Payments → Add)

## 5. Shopify Tax (5 min)

- [ ] Settings → Taxes and duties → United States
- [ ] Click **Set up Shopify Tax** (free until threshold)
- [ ] Add business address: Greensboro, AL 36744
- [ ] Confirm auto-collection on for AL nexus

## 6. Shipping Zones (10 min)

Settings → Shipping and delivery → General profile → **Manage rates**

- [ ] **Zone 1 — United States (Contiguous 48):**
  - [ ] Standard $5.95 (price-based: $0–$74.99)
  - [ ] Free shipping ($75.00+)
  - [ ] Expedited $14.95 (flat)
- [ ] **Zone 2 — Alaska, Hawaii, U.S. Territories:** Flat $14.95
- [ ] **Zone 3 — APO/FPO/DPO:** Flat $9.95
- [ ] **International:** Disabled

## 7. Policy Pages (15 min)

Settings → Policies → For each, click **Create from template** then paste from `STORE_CONTENT_FOR_REVIEW.md`:

- [ ] Refund/Return policy
- [ ] Privacy policy
- [ ] Terms of service
- [ ] Shipping policy
- [ ] Contact information

## 8. Discount Code (3 min)

- [ ] Discounts → Create discount → Amount off products
- [ ] Code: `ROADREADY`
- [ ] Type: Fixed amount, $5 off
- [ ] Minimum: $20 cart
- [ ] One use per customer
- [ ] Active 30 days from issue
- [ ] Save

## 9. Notification Settings (5 min)

Settings → Notifications:

- [ ] Confirm sender email: `hello@sacredpathway.org`
- [ ] Customer email templates left default for now (refine post-launch)
- [ ] Settings → Checkout → enable **Abandoned checkout email** (auto-fires at 10 hrs)

## 10. Apps to Install (10 min)

Shopify App Store → install (do not configure yet):

- [ ] **Zendrop** (free plan)
- [ ] **CJDropshipping** (free)
- [ ] **Shopify Inbox** (free — chat)
- [ ] **Judge.me Reviews** (free tier)
- [ ] **Shopify Email** (built-in — confirm enabled)
- [ ] Skip Klaviyo (defer to month 2)

## 11. Custom Email Aliases (10 min — optional but recommended)

In your email host (Google Workspace if using `sacredpathway.org`):

- [ ] Confirm `hello@sacredpathway.org` exists
- [ ] Create aliases routing to `hello@`:
  - `returns@sacredpathway.org`
  - `fleet@sacredpathway.org`
  - `partners@sacredpathway.org`
  - `privacy@sacredpathway.org`
  - `legal@sacredpathway.org`

(Squarespace Email or Google Workspace handles this — one inbox, multiple aliases.)

---

## Gate to Next Phase

Before moving on, confirm:

- [ ] Can log into `sacredroadsupply.myshopify.com/admin`
- [ ] Payment processor active (test charge possible)
- [ ] All 5 policy pages exist with real content
- [ ] At least one shipping rate visible at test checkout
- [ ] `ROADREADY` discount code redeemable

If any of the above is ❌, fix before starting Checklist B (DNS).

---

## Items Still Pending (do NOT touch yet)

- [ ] DO NOT add products
- [ ] DO NOT connect Zendrop catalog
- [ ] DO NOT publish theme
- [ ] DO NOT enable buy buttons
- [ ] DO NOT switch primary domain (handled in Checklist B)

Store remains in **development mode** until launch readiness scorecard hits 100%.
