# 💻 Test Sacred Pathway on Your Mac (iOS Simulator)

**Goal:** Run the app on a fake iPhone that lives inside your Mac. See it work end-to-end, then iterate fast.

**Time needed:** ~5 minutes first time. ~30 seconds every time after.

**Cost:** $0. No iPhone, no Apple ID signing, no Developer Mode, no cable.

---

## ⚠️ One thing the simulator can't do

**The simulator has no camera.** So the "📸 Scan" button (camera capture) won't work here. That's fine — you can still test the **📁 Upload** button, which covers most of the scan flow anyway. For real camera testing, use the iPhone guide.

---

## PART 1 — Open the project in Xcode

1. Open **Finder**.
2. Go to: `Documents → Claude → Projects → Sacred Pathway trucker tool → SacredPathway`.
3. Double-click **`SacredPathway.xcodeproj`** (blue icon). Xcode opens.
4. Top of the Xcode window, you may see **"Resolving Swift Packages…"** — let it finish (30–60 seconds, first time only).

---

## PART 2 — Pick a simulator

1. Look at the top-center of the Xcode window. You'll see a pill that looks like: **`SacredPathway > [some device]`**.
2. Click the right side (the device name).
3. A dropdown appears. Scroll to the **iOS Simulators** section.
4. Pick **iPhone 15 Pro** (or iPhone 16 Pro, or any "Pro" model from the last few years — they all work).
5. If no simulators show up, pick **Add Additional Simulators…** → click **+** → pick iPhone 15 Pro → click Create. Then redo step 2.

---

## PART 3 — Build and run 🚀

1. Press **⌘R** (or click the big **▶︎** button top-left of Xcode).
2. Progress bar: *"Building SacredPathway…"* → *"Installing…"* → *"Launching…"*
3. First build: **2–4 minutes**. Next build: **15–30 seconds**.
4. A window called **Simulator** opens showing a fake iPhone. The Sacred Pathway app launches inside it.

**If you get a red error "Build failed":** screenshot the error text from the left sidebar's issue navigator (the ⚠️ icon) and send it to me.

---

## PART 4 — Using the Simulator (quick tips)

The simulator acts like a real iPhone, but you use your Mac's mouse and keyboard:

| Action | How |
|--------|-----|
| Tap | Click |
| Swipe | Click + drag |
| Type | Just type on your keyboard |
| Home button | **⌘⇧H** |
| Lock / sleep | **⌘L** |
| Rotate | **⌘→** or **⌘←** |
| Screenshot | **⌘S** (saves to your Desktop) |

**To upload a PDF for the scan test** — you'll need to get a sample PDF into the simulator first. Here's how:

1. Find any rate confirmation PDF on your Mac (or any PDF — a fuel receipt, an invoice, whatever).
2. **Drag the PDF file from Finder directly onto the simulator window.**
3. The simulator opens it in the Files app and saves it under **On My iPhone → Downloads**.
4. Now when the app asks you to pick a file, it'll be there.

**For image scans:** same thing — drag a PNG or JPG onto the simulator. It asks if you want to save it to Photos. Say yes. Now the app can pick it from the photo library.

---

## PART 5 — End-to-end test

### Test 1 — Onboarding & sign up

1. App launches → intro screens. Click through.
2. Sign-up screen: use a real email you can check (e.g., your Gmail).
3. Password: anything 6+ characters.
4. ✅ **Success:** you land on the Dashboard (Home tab) with empty states.
5. ❌ **If it hangs:** check Xcode's bottom pane (press **⌘⇧Y** if you don't see it). Screenshot any red text and send it.

### Test 2 — Complete your company profile

1. Fill in Company Name, MC #, DOT # (real or fake — just for testing).
2. Add a truck or driver if it asks.
3. ✅ **Success:** you're back on the Dashboard, your company name showing.

### Test 3 — Upload a document (the scan flow)

1. Drag a rate confirmation PDF from Finder onto the simulator window. It saves to Files.
2. Tap the **Scan** tab (camera icon at bottom).
3. Tap **Upload** (not "Scan Document" — that needs a camera).
4. Pick the PDF you just dropped in.
5. Wait ~5–15 seconds. This is Claude AI reading the document.
6. ✅ **Success:** a review screen shows, with Load #, Broker, Rate, Origin, Destination, etc. pre-filled.
7. Tap **Save**.

### Test 4 — Dashboard updates

1. Tap **Home** tab.
2. ✅ **Success:** the load you saved shows up. Revenue number updates.

### Test 5 — Generate a paystub PDF

1. Tap the **Settlements** or **Paystubs** tab.
2. Tap **New Settlement** / **Generate Paystub**.
3. Pick a driver, date range, and the loads to include.
4. Tap **Generate**.
5. ✅ **Success:** a branded PDF preview appears.
6. Tap **Share** → you can save it to the simulator's Files. (In the simulator, AirDrop/Email don't really work — just save to Files to verify the PDF looks right.)

---

## 🔄 The fast inner loop

Once the simulator is running, to test a code change:

1. Save the file in Xcode (**⌘S**).
2. Press **⌘R**.
3. App rebuilds and relaunches in ~15 seconds.

You can leave the simulator open between runs.

---

## 🚨 Common issues and fixes

**"Failed to resolve Swift packages"**
→ Top menu: **File → Packages → Reset Package Caches**. Wait, then try again.

**"Signing failed" or similar**
→ For the simulator, you usually don't need signing. If Xcode demands a team anyway: click the project in the sidebar → Signing & Capabilities → Team → pick your personal team.

**Build succeeds but simulator is blank or stuck**
→ Close the simulator entirely (**⌘Q** with the Simulator app focused), then press **⌘R** in Xcode again.

**Claude API errors in the console (red text when scanning)**
→ Usually means API key issue or no internet. Your key is already in `Config.swift` — we can check it if this happens.

**"No such module 'Supabase'"**
→ **File → Packages → Resolve Package Versions**. Wait 1 minute.

---

## ✅ Report back with

After you do the end-to-end test, tell me:

1. Did the app launch in the simulator? (y/n)
2. Did sign-up succeed and you reached the Dashboard? (y/n)
3. Did the Upload flow extract load details from a PDF? (y/n)
4. Did the Dashboard update with the load revenue? (y/n)
5. Did the paystub PDF generate? (y/n)
6. Any red errors in the Xcode console — screenshot or paste them.

I'll fix whatever breaks based on what you hit.
