# 📱 Test Sacred Pathway on Your iPhone — Full Walkthrough

**Goal:** Get the app running on your actual iPhone, then do an end-to-end test (sign up → scan a doc → see dashboard → generate a paystub).

**Time needed:** ~20 minutes first time. ~2 minutes every time after.

**Cost:** $0. You can install on your own iPhone with a free Apple ID — no $99 developer account needed yet. That's for App Store / TestFlight later.

---

## ✅ What you need before you start

1. Your Mac (with Xcode installed — you already have this).
2. Your iPhone.
3. A USB cable to connect iPhone → Mac (Lightning or USB-C depending on phone).
4. A free Apple ID (same one you use on your iPhone is fine).
5. Wi-Fi on both devices.

---

## PART 1 — Open the project in Xcode

1. Open **Finder**.
2. Navigate to: `Documents → Claude → Projects → Sacred Pathway trucker tool → SacredPathway`.
3. Double-click the file named **`SacredPathway.xcodeproj`** — the blue Xcode icon. Xcode will open.
4. In the left sidebar (the file tree), make sure you see folders called **Views**, **Services**, **Models**. If yes, you opened the right project.

**If Xcode shows "Resolving Swift Packages…" — let it finish.** It's downloading Supabase. This takes 30–60 seconds the first time.

---

## PART 2 — Sign in with your Apple ID (one time only)

Xcode needs your Apple ID to put your app on your iPhone.

1. Top menu bar → click **Xcode → Settings…** (or press `⌘,`).
2. Click the **Accounts** tab at the top.
3. If your Apple ID isn't listed, click the **+** in the bottom-left → **Apple ID** → **Continue**.
4. Enter your Apple ID email and password.
5. Close the Settings window.

---

## PART 3 — Tell Xcode which Apple ID to sign the app with

1. In the left sidebar, click the **blue project icon** at the very top — it's labeled **SacredPathway** and looks like a little blueprint.
2. A big settings panel opens in the center.
3. Near the top of that panel, click the tab **Signing & Capabilities**.
4. Under **Team**, click the dropdown. Pick your name followed by **(Personal Team)**. Example: *Demarquis Hinton (Personal Team)*.
5. Look at the **Bundle Identifier** field. It probably says something like `com.sacredpathway.SacredPathway`. If Xcode shows a red error here that says the bundle ID is already in use, change it to something unique like `com.demarquis.sacredpathway` and press Tab.
6. Wait a few seconds. The red error should disappear and you should see a message like *"Provisioning Profile: Xcode Managed Profile"*. ✅

---

## PART 4 — Prep your iPhone

1. Plug your iPhone into your Mac with the cable.
2. On your iPhone, you'll see a popup: **"Trust This Computer?"** — tap **Trust** and enter your passcode.
3. On your iPhone: **Settings → Privacy & Security → Developer Mode → On**. Your phone will restart. (You only do this once, ever.)
4. When it boots back up, unlock it, go back to Developer Mode, and tap **Turn On** when it asks to confirm.

---

## PART 5 — Pick your iPhone as the run target

1. Back in Xcode, look at the top-center of the window. You'll see a little pill that says something like **"SacredPathway > iPhone 15 Pro"** (a simulator).
2. Click the part that says "iPhone 15 Pro" (or whatever simulator is shown).
3. A dropdown appears. Near the top you'll see a section called **iOS Device** — your iPhone's name should be there (for example "Demarquis's iPhone").
4. Click your iPhone's name.

**If your iPhone isn't listed** — unplug and replug the cable, make sure the phone is unlocked, and make sure you tapped "Trust" earlier.

---

## PART 6 — Build and run 🚀

1. Press the big **▶︎ Play button** in the top-left of Xcode (or press `⌘R`).
2. You'll see a progress bar at the top: *"Building SacredPathway…"* → *"Installing on iPhone…"* → *"Running…"*.
3. First build takes 2–4 minutes. Future builds take 15–30 seconds.
4. **The first time the app launches on your phone, it will fail with this error: "Untrusted Developer"**. That's expected. Close the error.

### Trust yourself as a developer on your phone

1. On your iPhone: **Settings → General → VPN & Device Management**.
2. Under **Developer App**, tap your Apple ID email.
3. Tap **Trust "[Your Apple ID]"** → **Trust** in the popup.
4. Go back to your home screen. You'll now see the **Sacred Pathway** icon.
5. Tap it. The app launches. 🎉

---

## PART 7 — End-to-end test on the phone

Now walk through the real flow your future carrier customers will do.

### Test 1 — Onboarding & sign up

1. First screen: Sacred Pathway welcome / onboarding. Tap through the intro screens.
2. On the sign-up screen, create an account:
   - Email: use a real email you can check (Supabase will send a confirmation link depending on your setup)
   - Password: anything 6+ chars
3. ✅ **Success looks like:** you land on the Dashboard (Home tab) with empty states.
4. ❌ **If it hangs or crashes:** go back to Xcode, look at the bottom pane — that's the console. Screenshot any red errors and send them to me.

### Test 2 — Set up your company

1. If prompted, fill in your Company Name, MC number, DOT number (real or fake for now — just testing).
2. Add a truck/driver if asked.
3. ✅ **Success looks like:** you return to the Dashboard with your company name showing.

### Test 3 — Scan a rate confirmation

1. Tap the **Scan** tab at the bottom (camera icon).
2. Tap **Scan Document** (uses camera) — point it at any rate con, fuel receipt, or even a printed doc. Try scanning something clear.
3. Or tap **Upload** — pick a PDF from Files or Photos. This is the feature we just added.
4. Wait ~5–15 seconds for Claude AI to extract the data.
5. ✅ **Success looks like:** a review screen appears with the load number, broker, rate, origin, destination, etc. pre-filled. Tap **Save**.
6. ❌ **If extraction fails:** check the Xcode console (bottom pane in Xcode) for a Claude API error. Common causes: bad API key, no internet, or the document was too blurry.

### Test 4 — Check the dashboard

1. Tap **Home** tab.
2. ✅ **Success looks like:** the load you just saved appears. Revenue and expenses update.

### Test 5 — Generate a paystub

1. Tap the **Settlements** or **Paystubs** tab (depending on what's showing).
2. Tap **New Settlement** or **Generate Paystub**.
3. Pick a driver, pick a date range, confirm the loads to include.
4. Tap **Generate**.
5. ✅ **Success looks like:** a PDF preview of a branded paystub. You can tap Share → AirDrop, Email, or Save to Files.

---

## 🚨 If something breaks — how to read Xcode

1. In Xcode, look at the bottom of the window. There's a **Debug Area** (press `⌘⇧Y` to toggle if you don't see it).
2. The right pane shows console output from the app.
3. Errors appear in **red text**. Warnings in yellow.
4. Screenshot the red errors. Send them to me. I'll tell you exactly what to fix.

---

## 🔁 Every time after the first install

Once the app is on your phone, to test a new change:

1. Plug phone in (only if it fell off Wi-Fi).
2. Open Xcode.
3. Press `⌘R`.
4. Done — 15 seconds.

You can also enable **Wi-Fi debugging** later so you don't need the cable. Ask me when you're ready for that.

---

## ✅ What to report back

After you do the end-to-end test, tell me:

1. Did you reach the Dashboard? (y/n)
2. Did scan or upload extract a document? (y/n — and which one worked)
3. Did the dashboard update with the load's revenue? (y/n)
4. Did the paystub PDF generate? (y/n)
5. Any red errors in the Xcode console — screenshot or paste them.

That tells me exactly what's working and what to fix next.
