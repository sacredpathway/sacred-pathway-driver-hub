# Step 1: Create Your Xcode Project

**Time needed:** 15 minutes  
**What you'll have when done:** A brand new iOS app running on your iPhone simulator

---

## 1.1 — Open Xcode

1. On your Mac, open **Finder**
2. Go to **Applications**
3. Double-click **Xcode** (the blue hammer icon)
   - If you don't have Xcode: Open the **App Store**, search "Xcode", click **Get** (it's free but ~12GB)
   - Wait for it to install, then open it

## 1.2 — Create a New Project

1. When Xcode opens, you'll see a welcome screen
2. Click **"Create New Project"** (or go to menu: **File → New → Project**)
3. A template picker appears. Make sure **iOS** is selected at the top
4. Click **"App"** (it should already be highlighted)
5. Click **Next**

## 1.3 — Configure Your Project

Fill in these fields exactly:

| Field | What to type |
|-------|-------------|
| **Product Name** | `SacredPathway` |
| **Team** | Select your Apple Developer account (if you have one). If not, select "None" for now |
| **Organization Identifier** | `com.sacredpathway` |
| **Interface** | Make sure **SwiftUI** is selected (NOT Storyboard) |
| **Language** | Make sure **Swift** is selected |
| **Storage** | Select **None** |
| **Include Tests** | Leave checked (it's fine either way) |

6. Click **Next**
7. Choose where to save it (Desktop is fine for now)
8. Click **Create**

## 1.4 — Understand What You're Looking At

Xcode just created your project. Here's what you see:

```
LEFT SIDE (Navigator):
  📁 SacredPathway/
    📄 SacredPathwayApp.swift    ← This is your app's entry point
    📄 ContentView.swift          ← This is your first screen
    📁 Assets.xcassets            ← This is where images/colors go
    📄 Preview Content/           ← Ignore this for now

MIDDLE (Editor):
  Whatever file you click on the left shows here

RIGHT SIDE (Inspector):
  Properties of whatever you selected — ignore this for now

TOP BAR:
  ▶ Play button (top left) — this RUNS your app
  Device selector — shows "iPhone 16 Pro" or similar
```

## 1.5 — Run Your App for the First Time

1. At the very top of Xcode, find the **device selector** (next to the play button). It probably says something like "iPhone 16 Pro"
   - If it says "Any iOS Device", click it and pick **iPhone 16 Pro** from the list
2. Click the **▶ Play button** (or press **Cmd + R**)
3. Wait 30-60 seconds — the iPhone Simulator will open
4. You should see a white screen that says **"Hello, world!"**

**Congratulations — your app is running!** Everything from here is just adding features to this app.

## 1.6 — Add Your Dependencies (Supabase + TPPDF)

Your app needs two external libraries. Here's how to add them:

1. In Xcode, go to the menu: **File → Add Package Dependencies...**
2. In the search bar at the top right, paste this URL:
   ```
   https://github.com/supabase/supabase-swift
   ```
3. Wait for Xcode to find the package (5-10 seconds)
4. You'll see "supabase-swift" appear. Make sure **"Up to Next Major Version"** is selected
5. Click **Add Package**
6. A screen asks which libraries to add. Check these boxes:
   - ✅ **Supabase** (this is the main one — it includes Auth, PostgREST, Storage, Functions)
   - Uncheck anything else you see
7. Click **Add Package**
8. Wait for it to download (30-60 seconds)

Now add the PDF library:

9. Go to menu: **File → Add Package Dependencies...** again
10. Paste this URL:
    ```
    https://github.com/techprimate/TPPDF
    ```
11. Wait for it to appear, keep **"Up to Next Major Version"**
12. Click **Add Package**
13. Check ✅ **TPPDF**
14. Click **Add Package**

## 1.7 — Create Your Folder Structure

Let's organize the project properly. In the left sidebar (Navigator):

1. **Right-click** on the yellow **SacredPathway** folder (the top-level one under the project)
2. Select **New Group**
3. Name it `Models` and press Enter
4. Repeat to create these groups (folders):
   - `Models`
   - `Views`
   - `Services`
   - `Utilities`

5. Now **right-click** on the `Views` folder
6. Select **New Group**
7. Create these sub-folders inside Views:
   - `Auth`
   - `Dashboard`
   - `Scanner`
   - `Loads`
   - `Settlement`
   - `Settings`

Your left sidebar should now look like:

```
📁 SacredPathway
  📄 SacredPathwayApp.swift
  📄 ContentView.swift
  📁 Models/
  📁 Views/
    📁 Auth/
    📁 Dashboard/
    📁 Scanner/
    📁 Loads/
    📁 Settlement/
    📁 Settings/
  📁 Services/
  📁 Utilities/
  📁 Assets.xcassets
  📁 Preview Content
```

## 1.8 — Set Your App's Minimum iOS Version

1. In the left sidebar, click the very top item — the **blue project icon** that says "SacredPathway"
2. In the middle area, you'll see project settings
3. Find **"Minimum Deployments"** (under the General tab)
4. Set it to **iOS 17.0** (this gives us access to all modern SwiftUI features)

## 1.9 — Add Camera & Photo Library Permissions

Your app needs permission to use the camera and access photos:

1. In the left sidebar, click the **blue project icon** (top item)
2. Click the **Info** tab at the top of the settings area
3. You'll see a list called "Custom iOS Target Properties"
4. Hover over any row and click the **+** button that appears
5. Add these three entries:

| Key | Value |
|-----|-------|
| `Privacy - Camera Usage Description` | Sacred Pathway needs camera access to scan your documents |
| `Privacy - Photo Library Usage Description` | Sacred Pathway needs photo access to import your documents |
| `Privacy - Photo Library Additions Usage Description` | Sacred Pathway needs to save generated paystubs to your photos |

To add each one:
- Click **+** to add a new row
- Start typing the key name (e.g., "Privacy - Camera") and it will autocomplete
- Tab to the Value column and type the description

---

## ✅ Checkpoint

At this point you should have:
- A new Xcode project called SacredPathway
- SwiftUI selected as the interface
- Supabase and TPPDF packages installed
- Organized folder structure
- Camera and photo permissions configured
- The app runs in the simulator showing "Hello, world!"

**You're ready for Step 2.** Don't move on until all of the above is working. If you get stuck on anything, tell me exactly what you see and I'll walk you through it.
