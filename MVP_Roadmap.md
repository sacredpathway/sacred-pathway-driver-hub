# Sacred Pathway Driver Hub — MVP v1.0 Build Roadmap

**Goal:** Ship a simple, working iOS app to the App Store that does one thing excellently: scan a rate con → extract data with Claude → show a paystub → export it as PDF.

**Target time to ship:** 6–10 weeks of focused work (for a first-time Swift developer).

**What v1.0 does NOT include** (we add these in v1.1, v1.2 after launch):
- ❌ Multi-driver support (v1.0 is single-driver)
- ❌ In-app purchases / subscriptions (v1.0 is free while you validate)
- ❌ Cloud sync / accounts (v1.0 stores data on device only)
- ❌ Document vault with search (v1.0 saves to Files app instead)
- ❌ Factoring/dispatcher/reserve configurability (v1.0 uses fixed defaults you can hardcode)
- ❌ Push notifications
- ❌ iPad-specific layout (v1.0 is iPhone-only)

Ship small. Validate. Then build the rest.

---

## Milestone 1 — Project Setup (1 day)

**Deliverable:** An Xcode project that builds, runs in the iPhone Simulator, and shows a "Sacred Pathway" welcome screen.

Tasks:
- Create new Xcode SwiftUI project
- Set up bundle identifier, signing
- Build a simple welcome screen with the brand colors
- Run it in the Simulator
- Run it on your physical iPhone

---

## Milestone 2 — Camera Scan (3–5 days)

**Deliverable:** Tap a "Scan" button → camera opens → take a photo of a rate con → see the image preview.

Tasks:
- Add camera permission to Info.plist
- Build a camera capture view using VisionKit's `VNDocumentCameraViewController` (Apple's built-in document scanner — auto-detects edges, crops, enhances)
- Display the captured image in a preview
- Handle cancel and retake

---

## Milestone 3 — OpenAI Integration (4–6 days)

**Deliverable:** After scanning, the app sends the image to OpenAI and displays the extracted data (broker, load #, rate, miles, stops).

Tasks:
- Store the OpenAI API key as a Supabase Edge Function secret (never on the device)
- Build a Supabase Edge Function that sends the image + structured-output prompt to gpt-4o vision
- Parse OpenAI's JSON response into Swift structs
- Show a loading spinner during extraction
- Display extracted data in a clean form
- Let user edit any field the model got wrong

---

## Milestone 4 — Settlement Calculator (2–3 days)

**Deliverable:** Below the extracted data, show a live calculation of driver net pay using configurable deductions.

Tasks:
- Build a `Settlement` struct that takes revenue + deductions → returns line items
- Hardcode default deduction % for v1.0 (factoring 3%, dispatcher 5%, reserve 10%, driver pay 28%)
- Show the paystub layout on screen
- Make deduction values editable in a Settings screen

---

## Milestone 5 — PDF Export + Share (2–3 days)

**Deliverable:** Tap "Export Paystub" → generates a branded PDF → opens iOS share sheet → save to Files, AirDrop, email, etc.

Tasks:
- Build a PDF renderer using PDFKit + SwiftUI-to-PDF
- Design the branded paystub layout (navy header, gold accents — matches your App Store screenshots)
- Wire up UIActivityViewController for the share sheet

---

## Milestone 6 — Polish + Submit (3–5 days)

**Deliverable:** App uploaded to App Store Connect, TestFlight beta with 5–10 truckers, then public submission.

Tasks:
- Add app icon (the 1024×1024 we'll create)
- Run through the whole flow 10 times, fix rough edges
- Archive build in Xcode → upload to App Store Connect
- Set up TestFlight, invite beta testers
- Submit for App Store review

---

## Tools & Resources

- **Xcode** — already installed ✅
- **Apple Developer account** — active ✅
- **OpenAI API key** — set as a Supabase Edge Function secret ✅
- **A real iPhone** to test on (Simulator can't use the camera properly)
- **Git/GitHub** — you're set up ✅ (your sacredpathway repo can host the code)

---

## Support Plan

You have zero Swift experience. The plan: I teach Swift and SwiftUI through this app rather than abstract tutorials. Every step will include:
1. *What* we're doing and *why*
2. Where to click in Xcode
3. The full code to paste
4. How to verify it worked before moving on

Expect to feel lost sometimes — that's normal. The signal we need to worry about is not "I don't understand this" (universal), but "this doesn't run" (fixable together).

---

## Next step: Milestone 1 begins now — let's open Xcode.
