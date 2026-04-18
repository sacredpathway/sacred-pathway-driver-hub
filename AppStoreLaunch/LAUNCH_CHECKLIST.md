# Sacred Pathway — App Store Launch Checklist

Work top to bottom. ☐ = not done, ☑ = done.

## A. Xcode signing (5 min — you do this on screen, I'll guide)
- ☐ Open Xcode → click blue `SacredPathway` project icon at top of left sidebar
- ☐ Middle pane → select `SacredPathway` target → **Signing & Capabilities** tab
- ☐ Check **"Automatically manage signing"**
- ☐ Pick your **Team** (your Apple Developer account)
- ☐ Confirm no red errors. Bundle ID `com.sacredpathway.driverhub` should provision automatically. If "already taken" error → change to `com.sacredpathway.driverhub.demarquis`

## B. Host the privacy policy (5 min — see HOSTING_PRIVACY_POLICY.md)
- ☐ Create GitHub account (use demarquishinton@gmail.com)
- ☐ Create public repo `sacred-pathway-legal`
- ☐ Upload `privacy-policy.html` + `terms-of-service.html`
- ☐ Enable GitHub Pages (Settings → Pages → main branch → Save)
- ☐ Copy the live URL — you'll paste it in App Store Connect
- ☐ Tell me your GitHub username so I can update the listing copy

## C. Create the App Store Connect record (10 min — appstoreconnect.apple.com)
- ☐ My Apps → **+** → New App
- ☐ Platform: iOS · Name: Sacred Pathway Driver Hub · Language: English
- ☐ Bundle ID: pick the one from step A
- ☐ SKU: `sacredpathway001`
- ☐ Paste in description, subtitle, keywords from `AppStoreListing.md`
- ☐ Paste privacy policy URL
- ☐ Set category: Business / Productivity
- ☐ Set age rating: 4+
- ☐ Pricing: Free (you'll add IAP later — not required for launch)

## D. Screenshots (we'll do this together — 30 min)
Apple requires screenshots at iPhone 6.7" size (1290 × 2796 pixels). Six is the max, three is the minimum.

- ☐ Run app in iPhone 17 Pro Max simulator
- ☐ Set up sample data (one company, one driver, one load with revenue, one expense)
- ☐ Take 6 screenshots showing the strongest screens:
  1. Dashboard / scan home
  2. Scan or upload screen (with the "Scan it or Upload it" headline overlay)
  3. Load detail with profit calc
  4. Generated paystub PDF preview
  5. Fee settings (showing $/% toggle)
  6. Smart Insights
- ☐ I can build a screenshot-with-headline-overlay generator if you want polished marketing-style shots

## E. Build & upload (15 min — Xcode)
- ☐ In Xcode top bar → device dropdown → choose **"Any iOS Device (arm64)"** (NOT a simulator)
- ☐ Bump build number if needed: target → General → Build = 1
- ☐ Menu: **Product → Archive** (takes 2–5 min)
- ☐ Organizer opens automatically → select archive → **Distribute App**
- ☐ Choose **App Store Connect** → **Upload** → next-next-next
- ☐ Wait ~15 min for Apple to process

## F. Submit (5 min — App Store Connect)
- ☐ In App Store Connect → app → "1.0 Prepare for Submission"
- ☐ Attach the build that just finished processing
- ☐ Fill in "What's New" (already drafted in AppStoreListing.md)
- ☐ Fill in Review Notes (already drafted)
- ☐ Click **Add for Review** → **Submit for Review**
- ☐ Apple takes 1–3 days. Watch your email for approval or rejection notes.

## G. Optional but smart — TestFlight first (1 day)
Before submitting to public review, push the same archive to TestFlight, invite 5 carrier friends, and let them tap around for 24–48 hours. Catches bugs before reviewers do.

---

## What I've already prepared for you (in this folder)
- `privacy-policy.html` — ready to host
- `terms-of-service.html` — ready to host
- `AppStoreListing.md` — every text field for App Store Connect, copy-paste ready
- `HOSTING_PRIVACY_POLICY.md` — step-by-step GitHub Pages instructions
- `LAUNCH_CHECKLIST.md` — this file
