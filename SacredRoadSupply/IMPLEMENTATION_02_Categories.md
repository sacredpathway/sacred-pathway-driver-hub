# Category Page Implementation Package — 8 Collections

**Theme:** Dawn
**Page type:** Online Store → Products → Collections → Create collection (one per category)
**Goal:** Field-by-field build for all 8 launch collections, in build order.

---

## Universal Settings (apply to ALL 8 collections)

When you create each collection, set these the same way:

| Field | Value |
|---|---|
| Collection type | **Manual** (you add products; smart-collection rules can be set later when catalog grows) |
| Sort | Manual (drag products into desired order) |
| Visibility | Online Store (✅ shown) |

Then for each collection, paste the unique values below into:
- **Title** (top of edit page)
- **Description** (rich-text editor — paste the HTML below as-is)
- **Image** (under Media on the right — upload the matching tile SVG/PNG from `branding_assets/collection_tiles/`)
- **Theme template** → leave default `collection`
- **Search engine listing** → click **Edit** → paste SEO title + meta description
- **URL handle** (under Search engine listing) → set as specified

---

## Collection 1 — Cab Comfort

**Title:** `Cab Comfort`
**URL handle:** `cab-comfort`
**Tile image:** `tile_cab-comfort.svg` (export to 1080×1080 PNG before upload)

**SEO Title:** `Truck Cab Comfort — Seat Cushions, Blankets & Mattress Toppers`
**Meta Description:** `Beat 11-hour shifts. Lumbar cushions, 12V heated blankets, gel seats & sleeper mattress toppers built for semi truck drivers. Free U.S. shipping $75+.`

**Description (paste into rich-text editor as HTML):**
```html
<h2>Sleep, sit, and survive the next 11 hours.</h2>
<p>After 11 hours behind the wheel, your back, your hips, and your sleeper bunk all take a beating. Cab Comfort is gear built to fight back — memory foam where you actually need it, 12V heat that doesn't make you idle, and sleeper mattress toppers sized for standard 32×80 bunks.</p>
<p>Every product in this collection ships from a U.S. warehouse with free shipping over $75 and 30-day returns.</p>
```

**Products to add (in this order — drag to set manual sort):**
1. 12V Heated Travel Blanket — SRS-CC-002
2. Memory Foam Lumbar Support Cushion — SRS-CC-001
3. Sleeper Cab Mattress Topper — SRS-CC-004
4. Coccyx Gel Seat Cushion — SRS-CC-003

**Header banner (optional Phase 2):** A trucker-sleeper-cab interior shot. For v1 launch the tile image is enough.

---

## Collection 2 — Driver Health & Fitness

**Title:** `Driver Health & Fitness`
**URL handle:** `health-fitness`
**Tile image:** `tile_health-fitness.svg`

**SEO Title:** `Truck Driver Health & Fitness Gear — Compression, Massage, Workout`
**Meta Description:** `Compression socks, in-cab resistance bands, massage guns, hand grip strengtheners. Fitness gear built for life behind the wheel. Ships from U.S.`

**Description:**
```html
<h2>11 hours seated takes its toll. Fight back.</h2>
<p>Sitting eight to twelve hours a day is hard on your body. This collection is gear that works in the limited space and limited time you've got — compression socks for the leg fatigue, a massage gun for the shoulders, resistance bands you can run at any truck stop, and a hand grip strengthener that fits a cup holder.</p>
<p>Built for working drivers. Ships from U.S. warehouses. Free shipping over $75.</p>
```

**Products (manual sort):**
1. Percussive Massage Gun — SRS-HF-004
2. Compression Socks 20-30mmHg 3-Pack — SRS-HF-001
3. In-Cab Resistance Band Kit + Door Anchor — SRS-HF-002
4. Adjustable Hand Grip Strengthener — SRS-HF-003

---

## Collection 3 — Organization & Storage

**Title:** `Organization & Storage`
**URL handle:** `organization-storage`
**Tile image:** `tile_organization-storage.svg`

**SEO Title:** `Truck Cab Organizers & Storage for Drivers`
**Meta Description:** `Between-seats consoles, hanging organizers, magnetic dash trays. Keep logs, gear & snacks in reach in any semi truck cab. Ships from U.S.`

**Description:**
```html
<h2>Free up your dash. Keep gear in reach.</h2>
<p>A clean cab beats a cluttered one — every time. This collection covers the three spots in every truck that need help: the dash, the space between the seats, and the back of the driver's seat. Built to survive vibration, designed to keep logs, devices, and snacks where you can grab them at 65 mph.</p>
```

**Products (manual sort):**
1. Between-Seats Console Organizer — SRS-OS-001
2. Hanging Cab Organizer (10-Pocket) — SRS-OS-003
3. Magnetic Dash Tray with Phone Slot — SRS-OS-002

---

## Collection 4 — Electronics & Mounts

**Title:** `Electronics & Mounts`
**URL handle:** `electronics-mounts`
**Tile image:** `tile_electronics-mounts.svg`

**SEO Title:** `Truck Driver Electronics, Chargers & Dash Cams`
**Meta Description:** `24V/12V chargers, dual dash cams, Bluetooth headsets. Built for semi truck electrical systems. U.S. warehouses, 3-7 day shipping.`

**Description:**
```html
<h2>Charge it. Mount it. Record it. Built for 24V.</h2>
<p>Most "car chargers" burn out on a 24V semi. The dash cam strapped to your windshield isn't worth much if night footage looks like static. This collection is electronics designed for the way truck electrical systems actually work — heavy-duty 12V/24V dual chargers, dash cams that hold up at 3 a.m., and Bluetooth headsets that cut engine noise.</p>
<p>Verify product compatibility on each page before ordering. We list voltage range and warranty terms openly.</p>
```

**Products (manual sort):**
1. Dual Dash Cam — Front + Cabin — SRS-EM-002
2. 24V/12V Heavy-Duty USB-C Charger — SRS-EM-001
3. Trucker Bluetooth Headset — Single Ear NC — SRS-EM-003

**Note on this collection:** All 3 SKUs require supplier verification (see `SUPPLIER_VERIFICATION_CHECKLIST.md`) before going live.

---

## Collection 5 — Safety Equipment

**Title:** `Safety Equipment`
**URL handle:** `safety`
**Tile image:** `tile_safety.svg`

**SEO Title:** `DOT Safety Equipment for Truck Drivers — Triangles, Gauges, Vests`
**Meta Description:** `FMCSA-compliant DOT triangle kits, heavy-duty tire gauges, ANSI Class 2 hi-vis vests. Inspection-ready safety gear for working drivers.`

**Description:**
```html
<h2>DOT-compliant. Inspection-ready.</h2>
<p>The gear in this collection isn't optional — it's what FMCSA Section 393.95 and ANSI 107 require, and what DOT inspectors expect to see. We list the compliance spec on every product page so you know exactly what you're buying.</p>
<p>If you're not sure your existing kit passes inspection, replace it before the next pre-trip.</p>
```

**Products (manual sort):**
1. DOT Reflective Triangle Kit (3-Pack + Case) — SRS-SE-001
2. Hi-Vis Class 2 Reflective Safety Vest — SRS-SE-003
3. Heavy-Duty Truck Tire Pressure Gauge (0-160 PSI) — SRS-SE-002

---

## Collection 6 — Flashlights & Tools

**Title:** `Flashlights & Tools`
**URL handle:** `flashlights-tools`
**Tile image:** `tile_flashlights-tools.svg`

**SEO Title:** `Truck Driver Flashlights & Roadside Tools`
**Meta Description:** `Rechargeable magnetic LED work lights built for pre-trips, roadside repairs, and breakdowns. Hands-free. U.S. warehouse shipping.`

**Description:**
```html
<h2>Hands-free light for pre-trips and breakdowns.</h2>
<p>The wrong flashlight at 3 a.m. on a roadside in the rain is one of those things you only learn once. The right one — magnetic base, swivel hook, USB-C charging, 500 lumens — is the kind of small upgrade that pays back over a hundred-thousand miles.</p>
<p>This collection grows as we find more tools that earn their place in the cab.</p>
```

**Products (manual sort):**
1. Rechargeable Magnetic LED Work Light — SRS-FT-001

---

## Collection 7 — Truck Cleaning Supplies

**Title:** `Truck Cleaning Supplies`
**URL handle:** `cleaning`
**Tile image:** `tile_cleaning.svg`

**SEO Title:** `Truck Cleaning Supplies — Waterless Wash & Microfibers`
**Meta Description:** `Waterless wash & wax kits and microfiber towels. Clean your rig at any truck stop, no hose required. Safe on paint, chrome, and glass.`

**Description:**
```html
<h2>Clean your rig at any truck stop. No hose needed.</h2>
<p>Most truck stops don't have a wash bay. Most washes that do are expensive and slow. A waterless wash kit lives in the side box and gets you a clean rig in 15 minutes without paying $30 or waiting in line.</p>
<p>We list the formula type, microfiber GSM, and shipping classification on every product page — no surprises at checkout.</p>
```

**Products (manual sort):**
1. Waterless Wash & Wax Kit + Microfibers — SRS-TC-001

**Note:** Requires verification before listing (see verification checklist).

---

## Collection 8 — CDL Essentials

**Title:** `CDL Essentials`
**URL handle:** `cdl-essentials`
**Tile image:** `tile_cdl-essentials.svg`

**SEO Title:** `CDL Essentials — Logbooks, Permits & Driver Documents`
**Meta Description:** `Logbook binders and DOT document organizers. Inspection-ready CDL gear for new and seasoned truck drivers.`

**Description:**
```html
<h2>Inspection-ready in 10 seconds.</h2>
<p>If your registration, logs, BOLs, and permits are scattered across your dashboard, glove box, and overhead — you're one DOT pull-over away from a bad day. This collection is the binder and pouch system that puts everything in one place and zips closed.</p>
<p>Whether you're three weeks into your A-license or thirty years deep, the right document system saves you the search.</p>
```

**Products (manual sort):**
1. DOT Logbook Binder / Document Organizer — SRS-CDL-001

---

## Per-Page Layout Settings (apply to every collection page)

Path: Customize → Collections (template).

**Section: Product grid**

| Field | Value |
|---|---|
| Products per row (desktop) | 4 |
| Products per row (mobile) | 2 |
| Products per page | 16 |
| Enable filtering | ✅ |
| Enable sorting | ✅ |
| Image ratio | Adapt to image |
| Show vendor | ❌ |
| Show product rating | ✅ |
| Enable quick add | ✅ |

**Filters to enable (Online Store → Navigation → Filters):**

- Price (auto)
- Availability (auto)
- Vendor (auto — will show "Sacred Road Supply")
- Tag (manual — we'll add tags `owner-operator`, `fleet`, `cdl-student`, `safety`, `electronics`, `comfort` to products during import)

**Sort options to keep:**
- Featured (default — uses your manual sort)
- Best selling
- Price: Low to High
- Price: High to Low
- Newest

---

## Collection Pre-Publish QA

For each collection, before marking it published:

- [ ] Title and URL handle match this doc
- [ ] Description renders correctly (preview the page)
- [ ] Tile image uploaded under Media — appears on homepage Collection list
- [ ] All listed products are added
- [ ] Manual sort matches this doc
- [ ] SEO title + meta description set
- [ ] Filters appear on the page
- [ ] Mobile view: 2 columns, no overlap

---

## Order to Build Collections

Build them in this order to avoid "empty collection" rendering on the homepage during your build:

1. Cab Comfort (4 products, biggest)
2. Driver Health & Fitness (4)
3. Safety Equipment (3)
4. Organization & Storage (3)
5. Electronics & Mounts (3 — depends on verification)
6. Truck Cleaning Supplies (1)
7. Flashlights & Tools (1)
8. CDL Essentials (1)

This way the most-product collections appear first if anything renders mid-build.

---

## What's Already Done vs What Needs You

| Done by me | Needs you to click |
|---|---|
| All 8 titles, handles, descriptions, SEO | Paste into Shopify Collections |
| 8 tile SVGs (need PNG export) | Export to PNG, upload via Media |
| Manual sort order per collection | Drag products in Shopify |
| Product list (Featured collection for homepage) | Create "Featured" collection separately |
| Filter / sort settings | Toggle in Collection template + Filters |

No deploy, no live commerce. Verification gate still in front of us.
