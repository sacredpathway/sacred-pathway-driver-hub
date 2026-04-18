# App Store Connect — Text Fields to Fill

Copy each block into the matching field in App Store Connect. Character limits are noted. Stay under them — Apple will reject anything too long.

---

## 1. App Name (30 char max)

```
Sacred Pathway Driver Hub
```
(25 chars ✅)

---

## 2. Subtitle (30 char max)

```
Scan. Track. Pay. Done.
```
(23 chars ✅)

Alternate options if you want to A/B:
- `Trucking Paystubs in Seconds` (28)
- `Rate Cons to Paystubs Fast` (26)
- `Run Your Trucking Business` (26)

---

## 3. Promotional Text (170 char max — editable anytime without review)

```
New: Upload rate cons from your broker email or Files app — advanced AI reads PDFs and photos the same way. Scan it or upload it. Get paid faster.
```
(146 chars ✅)

---

## 4. Description (4,000 char max)

```
Sacred Pathway Driver Hub turns the chaos of running a trucking business into a clean, simple workflow. Built for owner-operators, small fleets, and dispatchers who are tired of juggling paper rate cons, crumpled fuel receipts, and spreadsheet settlements at 2 AM.

Powered by advanced AI, Sacred Pathway reads any trucking document — instantly.

HERE'S HOW IT WORKS

📸 Scan it — Point your camera at any rate con, fuel receipt, lumper fee, toll, or repair bill. advanced AI extracts everything instantly.

📁 Upload it — Got a PDF emailed from your broker? A rate con saved in your Files? Import it directly — from your photo library, Files app, email, or anywhere on your phone. Our AI reads it the same way.

📊 Track it — Revenue vs. expenses update in real time. Know your profit per load before you finalize anything.

💸 Pay it — Driver settlements calculate automatically. Factoring fees, authority fees, dispatcher cut, maintenance reserve — all configurable to your exact setup.

📤 Send it — Export a branded paystub PDF. Email it, AirDrop it, save it to Files. Done.

FEATURES

✅ AI-powered document scanning (rate cons, BOLs, receipts, invoices)
✅ Upload documents from Files, Photos, or email
✅ PDF & image import — rate cons, BOLs, receipts, invoices
✅ Real-time profit tracking per load
✅ Automatic driver settlement calculations
✅ Configurable factoring, authority, dispatcher, and reserve deductions
✅ Branded paystub PDF export
✅ Multi-driver support
✅ Expense categorization (fuel, tolls, lumpers, maintenance, repairs)
✅ Revenue vs. expense dashboard
✅ Load-by-load profit breakdown
✅ Secure cloud backup
✅ Works offline — syncs when you're back on signal

WHO IT'S FOR

• Owner-operators running 1–3 trucks
• Small fleets (4–20 trucks) who need settlements without hiring a bookkeeper
• Dispatchers managing multiple drivers who want one source of truth
• New authorities getting their financial operation off the ground

Stop losing money on loads you thought were profitable. Stop paying a bookkeeper $400/month to type what your phone can read in 3 seconds. Stop stacking receipts in a shoebox.

Sacred Pathway Driver Hub — run your trucking business like the professional operation it is.

SUBSCRIPTION TIERS

• Free — scan up to 5 documents/month, basic settlement calculator
• Pro ($19/mo) — unlimited scans, paystub export, 1 driver
• Carrier ($49/mo) — up to 10 drivers, full dispatcher features
• Enterprise ($99/mo) — unlimited drivers, QuickBooks export, priority support

Subscriptions auto-renew unless canceled at least 24 hours before the end of the current period. Manage subscriptions in your Apple ID settings.

Privacy Policy: [your URL]
Terms of Service: [your URL]
```

---

## 5. Keywords (100 char max, comma-separated, no spaces after commas)

```
trucking,owner operator,rate con,paystub,settlement,dispatcher,BOL,IFTA,fleet,hotshot,CDL,factoring
```
(99 chars ✅)

---

## 6. Support URL (required)

```
https://sacredpathwayhub.com/support
```
(replace with your real domain once landing page is live)

---

## 7. Marketing URL (optional)

```
https://sacredpathwayhub.com
```

---

## 8. Privacy Policy URL (REQUIRED — Apple will reject without this)

```
https://sacredpathwayhub.com/privacy
```

---

## 9. Category

- **Primary:** Business
- **Secondary:** Productivity

---

## 10. Age Rating

4+ (no objectionable content)

---

## 11. Copyright

```
© 2026 Sacred Pathway LLC
```
(adjust to your actual legal entity)

---

## 12. Version Release Notes (for v1.0, 4,000 char max)

```
Welcome to Sacred Pathway Driver Hub v1.0.

• Scan rate cons, fuel receipts, lumper fees, tolls, and repair bills with your camera
• Upload PDFs and images from Files, Photos, or email
• AI-powered extraction
• Automatic driver settlement calculations
• Configurable deductions (factoring, authority, dispatcher, reserve)
• Branded paystub PDF export
• Real-time profit tracking per load
• Multi-driver support

Built by trucking people, for trucking people. Questions or feedback? support@sacredpathwayhub.com
```

---

## 13. App Review Information (not public — only for Apple reviewer)

**First Name:** Demarquis
**Last Name:** [your last name]
**Phone:** [your phone]
**Email:** demarquishinton@gmail.com

**Demo Account** (required — signup is gated):
- Username: `demarquishinton+appreview@gmail.com`
- Password: `SacredReview!2026`

**Notes for Reviewer:**
```
Thank you for reviewing Sacred Pathway Driver Hub.

Sign in with the demo credentials above. The account has completed onboarding and is ready to use — you'll land on the dashboard.

This app helps trucking owner-operators and small fleets scan business documents (rate confirmations, fuel receipts, bills of lading) using AI to automatically generate driver settlement paystubs.

To test the core flow:
1. Sign in with the demo account
2. Tap the Scan tab on the bottom bar
3. Scan a document with your camera, OR upload a PDF/image from Files
4. The app extracts load details automatically using AI
5. Review the calculated settlement on the Paystub screen
6. Tap Export to generate a PDF

Third-party services used (full disclosure for App Review):
- Supabase — authentication, Postgres database, and private Storage for the user's documents. All access is gated by row-level security so a user can only ever see their own data.
- OpenAI — document text extraction. The user's device uploads the file to a private Supabase Storage bucket. A Supabase Edge Function (server-side) then sends the image to OpenAI's gpt-4o model over HTTPS. The device itself never contacts OpenAI — the OpenAI API key is held only on the backend. OpenAI does not use API content to train its models. The extracted JSON is returned to the device through the Edge Function and persisted in the user's account so they can edit and audit it. The user can delete any document and its extracted data at any time from the in-app Document Vault.

The privacy policy at the URL above describes data collection, third-party processing, and user controls in full.

iPad note: This build fixes the signup flow layout on iPad. Forms are now constrained to a readable width and any save failures show an inline error instead of failing silently.

Contact: demarquishinton@gmail.com
```

---

## Fields you still need to produce before hitting Submit

1. **Privacy policy page live at your URL** (Phase 1 checklist item)
2. **Terms of service page live at your URL**
3. **6 screenshots** (1290x2796 for iPhone 6.9")
4. **App Preview video** (30 sec, 1080x1920)
5. **App icon** (1024x1024, no transparency, no rounded corners)
6. **Demo account credentials** if any feature is gated behind login

---

**Next step:** Once you're at the App Store Connect "App Information" screen, start with #1 (App Name) and work down. Tell me which field you're on and I'll walk you through where to paste, where to click Save, and what to do if the field rejects your input.
