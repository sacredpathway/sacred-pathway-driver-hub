# B. Squarespace → Shopify DNS Verification Checklist

**Goal:** `https://shop.sacredpathway.org` resolves to Shopify store with valid SSL.
**Time:** 10 min active + 5 min – 48 hr DNS propagation wait.
**Rule:** Touch ONLY the `shop` subdomain. Root `sacredpathway.org` and `www` stay on Squarespace.

---

## 1. Add CNAME in Squarespace (3 min)

- [ ] Log into Squarespace at `squarespace.com/login`
- [ ] Home → **Settings** → **Domains**
- [ ] Click `sacredpathway.org` → **DNS Settings**
- [ ] Scroll to **Custom Records** → click **Add Record**
- [ ] Enter exactly:

| Host | Type | Data |
|---|---|---|
| `shop` | `CNAME` | `shops.myshopify.com` |

- [ ] Click **Save**
- [ ] **DO NOT** modify root A records, www, or any existing record

## 2. Connect Domain in Shopify (2 min)

- [ ] Shopify admin → **Settings** → **Domains**
- [ ] Click **Connect existing domain**
- [ ] Enter: `shop.sacredpathway.org`
- [ ] Click **Next**
- [ ] Shopify begins CNAME verification (status shows "Verifying…")
- [ ] **If Shopify asks for an extra TXT record:** copy it, go back to Squarespace → Custom Records, add a new TXT record with the values shown, save, return to Shopify and retry.

## 3. Wait for Verification (5 min – 1 hr typical, up to 48 hr worst case)

- [ ] Refresh Shopify Domains page every ~10 min
- [ ] Watch for status: "Connected" with green checkmark
- [ ] If still "Verifying" after 1 hr, re-check Squarespace CNAME has zero typos
- [ ] If 24 hr pass with no verification, use `whatsmydns.net` → enter `shop.sacredpathway.org` → check global CNAME propagation

## 4. SSL Certificate Auto-Provision (5–60 min after verification)

- [ ] After domain shows "Connected", wait for **"SSL active"** status
- [ ] Shopify auto-provisions Let's Encrypt SSL — no action needed
- [ ] If 60 min pass without SSL, click the domain → **Renew SSL** button (or contact Shopify support — sometimes a manual nudge needed)

## 5. Live Verification Tests (5 min)

Open a private/incognito browser window (clears DNS cache):

- [ ] Visit `https://shop.sacredpathway.org`
- [ ] Confirm:
  - [ ] Page loads (currently empty/dev — that's expected)
  - [ ] Browser shows green padlock (SSL valid)
  - [ ] No "Not Secure" warning
  - [ ] No certificate mismatch error
- [ ] Visit `http://shop.sacredpathway.org` (note: HTTP not HTTPS)
  - [ ] Auto-redirects to `https://` ✅

## 6. Squarespace Site Health Check (2 min)

Confirm the parent site is untouched:

- [ ] Visit `https://sacredpathway.org` → should still load Squarespace site
- [ ] Visit `https://www.sacredpathway.org` → should still load Squarespace site
- [ ] Visit `https://app.sacredpathway.org` → Driver Hub portal still loads
- [ ] Visit `https://dispatch.sacredpathway.org` → Private Dispatch still loads

If any of the above is broken, your CNAME change is fine — but Squarespace DNS may have cached unrelated records. Wait 10 min and retry.

## 7. Switch Primary Domain (only after store is fully built — defer to launch day)

For now:
- [ ] **DO NOT** set `shop.sacredpathway.org` as primary domain yet
- [ ] Keep `sacredroadsupply.myshopify.com` primary during build

Later (on actual launch day):
- [ ] Shopify admin → Settings → Domains → click `shop.sacredpathway.org` → **Set as primary**
- [ ] Shopify auto-301's the `.myshopify.com` to the primary

## 8. Verify Customer Account / Checkout URLs Use Subdomain (post-primary-switch only)

After primary domain switch:
- [ ] Test add-to-cart → URL bar shows `shop.sacredpathway.org/cart`
- [ ] Test checkout flow → URL shows `shop.sacredpathway.org/checkouts/...`
- [ ] Confirm no leaks to `.myshopify.com`

---

## Gate to Next Phase

Before moving on:

- [ ] `https://shop.sacredpathway.org` loads with valid SSL
- [ ] `https://sacredpathway.org` still loads Squarespace freight site
- [ ] `https://app.sacredpathway.org` still loads Driver Hub
- [ ] No DNS errors on `whatsmydns.net` global check

If anything fails, debug here before placing sample orders or building catalog.

---

## Troubleshooting Quick Reference

| Symptom | Likely Cause | Fix |
|---|---|---|
| Shopify stuck on "Verifying" | CNAME not propagated | Wait 10 more min, then check `whatsmydns.net` |
| "Domain in use" error | Old DNS record points elsewhere | Squarespace → DNS → remove any other `shop` records |
| SSL never activates | DNS not fully propagated | Wait 1 hr after "Connected" then click Renew SSL |
| Squarespace site stopped loading | Wrong record edited | Squarespace → DNS → confirm A records and www CNAME untouched |
| `sacredpathway.org` redirects to Shopify | Root A records changed | Revert immediately — only `shop` CNAME should point at Shopify |

---

## What Should NOT Have Changed

Confirm in Squarespace DNS panel — these stay as-is:

- [ ] `@` (root) A records → still Squarespace IPs
- [ ] `www` CNAME → still Squarespace
- [ ] `app` records → still pointing to Driver Hub host
- [ ] `dispatch` records → still pointing to dispatch host
- [ ] MX records (email) → unchanged
- [ ] TXT records (other than what Shopify asked for, if any) → unchanged

Only **one new record** added: `shop` CNAME → `shops.myshopify.com`.
