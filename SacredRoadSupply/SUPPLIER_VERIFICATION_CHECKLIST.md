# Supplier Verification Checklist

**Purpose:** Sample-test the 4 high-risk SKUs BEFORE listing them in the live store. Each product gets its own pre-import questions for the supplier and its own physical-sample QA test.

**Rule:** If a SKU fails any **MUST-PASS** check, do not list it. Swap to the backup supplier (CJ-USA) or drop the SKU until v2.

**Total sample cost (estimated):** ~$120 spread across 4 SKUs at supplier cost. One-time spend that prevents weeks of refund pain.

---

## Workflow Overview

```
Step 1 — Pre-import: Ask Zendrop/CJ the questions in §1 of each product below.
Step 2 — Order a sample: Buy 1 unit from the supplier at cost ($10–$50 each).
Step 3 — Physical inspection: Use the test checklist for each product.
Step 4 — Pass → List on Shopify. Fail → Try CJ-USA backup. Fail again → Drop SKU.
```

Sample orders go to **Demarquis Hinton, Greensboro AL 36744** — your real shipping address. This is also our shipping-time validation (does it really arrive in 2–5 days as Zendrop claims?).

---

## SKU 1 — Dual Dash Cam (SRS-EM-002)

**Why it's high-risk:**
- 50% margin is the thinnest in our catalog; one return on a $90 product wipes out 2 orders of profit
- Customers buy this to PROTECT their CDL — if footage is unreadable, the refund + bad review is guaranteed
- Night-vision quality varies wildly across cheap-China rebrands

### Pre-Import Questions (paste into Zendrop chat)

1. Confirm this SKU ships from a **US warehouse** in CA, NJ, or GA. Provide the exact warehouse location.
2. What is the **front camera sensor model**? (Sony IMX307 or IMX415 = good; generic OmniVision = often bad night vision)
3. What is the **cabin camera resolution**? (Confirm true 1080p, not "1080p HD" interpolated from 720p)
4. Is the **infrared LED count** ≥ 4 on the cabin camera? IR LED count drives night vision quality.
5. Is a **32GB Class 10 microSD card included**? Confirmed in original packaging?
6. What is the **G-sensor lock duration** on incident detection?
7. What is the **warranty period** and warranty-claim process? (Does the customer email the supplier directly, or do I handle replacements?)
8. Does it support **24V semi truck electrical input** OR only 12V? (Many cheap dash cams burn out on 24V — this is critical for our market.)
9. **Return rate**: What % of buyers return this SKU in the last 90 days? (Zendrop tracks this — ask directly.)

### Physical Sample Test Checklist

Order 1 sample. When it arrives:

**Packaging & Build:**
- [ ] Arrived within 5 business days of order
- [ ] Box is undamaged, includes printed manual, 32GB SD card, suction mount, USB-C cable, 12V/24V power adapter
- [ ] Build quality: no rattle when shaken, USB ports seat cleanly, mount swivel doesn't feel loose

**Daytime Footage:**
- [ ] Install on your dash. Drive 10 minutes daytime. Pull the SD card.
- [ ] Front footage: license plates readable at 30+ ft? (MUST PASS)
- [ ] Cabin footage: face recognition clear at 3 ft from camera? (MUST PASS)
- [ ] No frame drops, no fisheye distortion warping plates

**Night Vision (THE critical test):**
- [ ] Drive 10 minutes after sunset, ideally with some highway portion
- [ ] Pull SD card, review on a computer (not phone)
- [ ] **Front footage at night:** Can you read a license plate of the car in front of you at 20 ft? **MUST PASS.** If footage is unreadable smear/glow, drop this SKU.
- [ ] **Cabin footage:** Driver's face visible WITHOUT cabin dome light on? **MUST PASS.**

**Electrical:**
- [ ] Plug into a 12V outlet — works, no overheat after 30 min
- [ ] If you have access to a 24V semi outlet (yours or a partner's), plug in there too. **MUST PASS** without smoke/burn smell. If supplier said 12V-only, you only test 12V — but then we cannot market it for 24V semi trucks.

**Software / Loop Recording:**
- [ ] Loop recording overwrites old footage cleanly
- [ ] G-sensor incident lock works when you slap the dashboard hard
- [ ] Power-off → power-on resumes recording without setup

### Decision Rule

**Pass all MUST-PASS checks:** ✅ List the SKU.
**Fail night vision OR 24V (if supplier claimed dual-voltage):** Try CJ-USA's equivalent SKU.
**Fail second supplier too:** Drop to single-channel front-only dash cam at $39.95 retail / $18 cost — that's a known-reliable category.

---

## SKU 2 — 24V/12V Heavy-Duty USB-C + USB-A Charger (SRS-EM-001)

**Why it's high-risk:**
- Marketed as "24V semi-compatible." A 12V-only SKU on a 24V truck = blown unit + burnt cigarette outlet + furious customer.
- Easy to verify, hard to recover from if we miss it.

### Pre-Import Questions

1. Confirm **input voltage range** on the SKU spec sheet — must explicitly state **"12V/24V" or "12-24V DC"**. Reject if it only says "12V."
2. Confirm **fuse / surge protection** is built in. Verify the fuse is replaceable (3A or 5A typical).
3. What is the **wattage output**? (Should be **30W PD on USB-C, 18W QC3.0 on USB-A**, for a $25 SKU.)
4. Provide **photo of the printed product spec label** showing input voltage rating.
5. Ships from **US warehouse**? Confirm exact location.
6. Is it **IP-rated** for moisture? (Most truck cigarette outlets are dry but a few are exposed to weather.)
7. What is the failure / return rate in the last 90 days?

### Physical Sample Test Checklist

**Packaging & Build:**
- [ ] Arrived within 5 business days
- [ ] Product label printed on the housing reads "**12V/24V**" or "**12-24V DC**" — physical confirmation
- [ ] Includes mounting hardware, weather cap, fuse
- [ ] No solder splatter or loose internal parts when you shake it

**12V Test:**
- [ ] Plug into a 12V car/truck outlet. Confirm both USB-C and USB-A power your phone.
- [ ] Use a USB watt meter (~$15 on Amazon, one-time tool) to verify **30W PD on USB-C, 18W on USB-A**. **MUST PASS.**
- [ ] Leave plugged in for 30 minutes with a phone charging. Check housing temperature — warm OK, hot is a fail.

**24V Test:**
- [ ] Plug into a 24V semi outlet (yours OR a partner's truck). **MUST PASS** without blown fuse, no smoke, no burn smell.
- [ ] If you cannot find a 24V test rig, request the supplier provide a third-party UL/CE certificate confirming 12-24V compatibility. **MUST PASS.**

### Decision Rule

**Confirmed 12-24V on label + electrical test:** ✅ List as "Built for semi 24V systems."
**Spec is fuzzy or only 12V:** Reposition the SKU description — **do NOT market as semi-compatible.** Sell as a "12V truck/RV/boat USB-C charger" and clearly state in product description: "For 12V electrical systems. Not compatible with 24V trucks." OR drop and find a different SKU.

---

## SKU 3 — Bluetooth Headset (Single-Ear, Noise Canceling) (SRS-EM-003)

**Why it's high-risk:**
- Trucker headsets compete with BlueParrott — the gold standard ($130+). Customers expect "BlueParrott killer at half price."
- Call quality is where cheap SKUs die. If dispatch can't hear you over engine noise, the headset is useless.
- Battery life claims are routinely inflated 2–3x on supplier listings.

### Pre-Import Questions

1. What is the **Bluetooth version**? (5.0 minimum; 5.2 or 5.3 preferred for stability + multi-device pairing)
2. What is the **CVC noise-cancellation generation**? (CVC 8.0 is current best-in-class. CVC 6.0 acceptable. Below CVC 6.0 = reject.)
3. Real-world **talk time on a full charge**? Ask for **third-party test data**, not the spec-sheet number.
4. Can the headset **pair with two phones simultaneously**? (Critical — drivers use a personal phone + a dispatch phone.)
5. **Microphone boom: rotatable for left or right ear**? (Single-ear headsets that only work on one side cut the addressable market in half.)
6. **Charging port**: USB-C or Micro-USB? (USB-C only — Micro-USB is a legacy red flag.)
7. **Audio prompts language**: English audio prompts for "Power on," "Connected," "Battery low"?
8. What is the failure / return rate in the last 90 days?

### Physical Sample Test Checklist

**Packaging & Build:**
- [ ] Arrived within 5 business days
- [ ] Includes USB-C charging cable, soft carry pouch, optional ear hook attachment
- [ ] Boom mic rotates 180° (left ear ↔ right ear) — **MUST PASS**
- [ ] Power button has a tactile click, no mush

**Pairing:**
- [ ] Pairs with your iPhone or Android in ≤ 30 seconds
- [ ] **Dual-pair: pair to a second phone. Confirm both stay connected.** MUST PASS.
- [ ] Voice prompts in English audible

**Call Quality (the real test):**
- [ ] Make a 5-minute call **while driving a real vehicle with road/engine noise**. Have the person on the other end rate clarity 1–10. MUST be **7+ on the inbound side** (what dispatch hears from you).
- [ ] Inbound voice (what you hear) clear at ~70% volume without distortion. MUST PASS.

**Battery:**
- [ ] Fully charge. Make continuous Bluetooth calls until the battery dies. Time it.
- [ ] **MUST PASS: ≥ 15 hours of actual talk time** (spec sheet probably claims 22; reality of 15+ is acceptable).
- [ ] Charge time from empty to full ≤ 3 hours.

**Comfort:**
- [ ] Wear for 4 hours straight. No ear pain, no headband pressure.

### Decision Rule

**All MUST-PASS checks clear:** ✅ List the SKU.
**Call quality < 7/10 OR battery < 15 hr:** Try CJ-USA equivalent.
**Fail both:** Drop the SKU until v2 and consider partnering with a real BlueParrott reseller program instead.

---

## SKU 4 — Waterless Wash & Wax Kit + Microfibers (SRS-TC-001)

**Why it's high-risk:**
- **Shipping classification**: If the wash bottle is aerosol or contains flammables, USPS/UPS classify it as Hazmat → ground-only shipping → ineligible for AK/HI/APO → customers complain when they can't get it shipped.
- Chemical performance varies widely — bad formula = streaks on chrome = bad reviews.

### Pre-Import Questions

1. **Formula type**: Pump spray (non-aerosol) or aerosol can? **MUST be pump spray.** Aerosol = ground-only shipping restriction.
2. Provide the **MSDS (Material Safety Data Sheet)** for the wash formula. Confirm no flammable solvents (no ethanol, no methanol, no naphtha listed in section 3).
3. Confirm the product is **DOT-classified as non-hazardous for shipping** by air and ground.
4. **Active ingredients** in the wash & wax — is it a true waterless formula (polymers/surfactants) or a heavily-diluted detergent?
5. **Bottle size**: 16 oz or 32 oz? (32 oz is a noticeably better value perception for $34.95.)
6. **Microfiber count**: How many towels per kit, and what GSM rating? (300+ GSM = quality; below 250 GSM feels cheap.)
7. **Ships from US warehouse**? Liquids over 16 oz often only ship ground from CA — confirm.
8. What is the return / complaint rate in the last 90 days?

### Physical Sample Test Checklist

**Packaging & Build:**
- [ ] Arrived within 7 business days (liquids often slower than dry goods)
- [ ] Bottle is sealed, no leaking
- [ ] Spray pump primes and sprays evenly (no clogging on the first 5 pumps)
- [ ] Microfiber towels are at least 250 GSM (feels plush, not thin), no loose threading

**Shipping Compliance:**
- [ ] Packaging label reads "Not Hazardous" — confirm. MUST PASS.
- [ ] No DOT diamond warning label, no UN number on packaging. MUST PASS.

**Real-World Test:**
- [ ] Apply to your truck hood or vehicle hood (a dusty section, not heavily caked mud).
- [ ] Spray, wait 30 seconds, wipe with the supplied towel.
- [ ] Result: panel is clean, no streaks, no scratching. MUST PASS.
- [ ] Apply to a chrome surface (bumper, exhaust if accessible). Streak-free. MUST PASS.
- [ ] Apply to glass. Streak-free. MUST PASS.

### Decision Rule

**Pump spray + non-hazmat + clean wipe results:** ✅ List the SKU.
**Aerosol OR contains flammables:** Reject. The shipping restrictions will produce constant customer issues. Find a different SKU.
**Streaky/scratchy performance:** Try CJ-USA equivalent.
**Fail both:** Drop the SKU; pivot to a microfiber-only kit (no liquid) as a cleaning-category placeholder.

---

## Sample Order Summary

| SKU | Sample Cost | Days to Verify | Test Tools Needed |
|---|---|---|---|
| Dual Dash Cam | ~$45 | 7 days (one drive day + night drive) | USB-C cable to read SD card, computer |
| 24V/12V USB-C Charger | ~$11 | 1 day | USB watt meter (~$15 one-time on Amazon) |
| Bluetooth Headset | ~$23 | 2 days | A second phone to test dual-pair, a willing partner for call-quality rating |
| Waterless Wash Kit | ~$17 | 1 day | Dusty vehicle to test on |
| **Total cash outlay** | **~$96** | **~7 days end-to-end** | One-time $15 watt meter |

This is the cheapest insurance policy in the store. ~$96 to prevent dozens of refunds, chargebacks, and 1-star reviews.

---

## Verification Decision Log Template

After each test, log the result:

```
SKU: SRS-EM-002 Dual Dash Cam
Sample ordered: 2026-MM-DD from Zendrop US
Arrived: 2026-MM-DD (X days)
Day footage:     [PASS / FAIL] — notes:
Night footage:   [PASS / FAIL] — notes:
Cabin footage:   [PASS / FAIL] — notes:
24V test:        [PASS / FAIL / NOT TESTED]
Loop record:     [PASS / FAIL]
Overall:         [LIST / TRY CJ / DROP]
Decision date:   2026-MM-DD
```

Keep these logs — they're the audit trail for why each SKU is or isn't in the catalog.

---

## What I Need from You Before Building Continues

1. ✅ Approve this verification process
2. ✅ Place the 4 sample orders (~$96 total) once Zendrop is set up
3. ✅ Run the tests, log results
4. ✅ Send me the decision log — I'll update the catalog to match (drop, reposition, or proceed with list)

**Order of operations after this approval:**
1. You create Shopify account + add Squarespace CNAME (Step 1 + 2 of the runbook)
2. You install Zendrop, place the 4 sample orders
3. Samples arrive within ~5–7 business days
4. You run the tests
5. We finalize the catalog based on results
6. **Then** I begin product imports and store deployment

No store deployment, no product imports, no live commerce until this verification gate clears.
