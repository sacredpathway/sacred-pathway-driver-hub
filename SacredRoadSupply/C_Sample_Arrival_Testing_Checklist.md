# C. Sample Arrival Testing Checklist

**Goal:** Confirm each of 4 high-risk SKUs is fit to list, before adding to Shopify.
**Tool:** `SUPPLIER_VERIFICATION_TRACKER.xlsx` — log every test result there.
**Time:** ~7 days end-to-end from sample order to final decision.

---

## Before Samples Arrive

- [ ] Shopify launch checklist (A) complete
- [ ] Zendrop account active (linked to Shopify, no products imported yet)
- [ ] Place sample orders (one each):
  - [ ] SRS-EM-002 Dual Dash Cam (~$45)
  - [ ] SRS-EM-001 24V/12V USB-C Charger (~$11)
  - [ ] SRS-EM-003 Bluetooth Headset (~$23)
  - [ ] SRS-TC-001 Waterless Wash Kit (~$17)
- [ ] Ship to: Demarquis Hinton, Greensboro AL 36744
- [ ] Buy one-time tool: **USB-C watt meter** (~$15 on Amazon)
- [ ] Open `SUPPLIER_VERIFICATION_TRACKER.xlsx` — record order date + tracking # in each sheet

---

## On Arrival (do for EVERY sample)

- [ ] Log arrival date in tracker
- [ ] Calculate days from order to arrival → log
- [ ] Inspect outer box: no crush, no tape damage
- [ ] Photograph the unopened box (timestamp for warranty disputes)
- [ ] Open carefully, save packaging until you decide to keep or return

---

## SKU 1 — Dual Dash Cam (SRS-EM-002)

**Test time:** 1 day daytime + 1 night drive

- [ ] **PACKAGING (P1–P3):** all accessories present, no rattle
- [ ] **DAYTIME (D1–D3):** install → drive 10 min → review SD card on computer
  - [ ] Front: license plates readable at 30+ ft
  - [ ] Cabin: face recognition at 3 ft
- [ ] **NIGHT VISION — CRITICAL (N1–N3):** drive 10 min after sunset
  - [ ] Front: plate readable at 20 ft after sunset → **MUST PASS**
  - [ ] Cabin: driver's face visible WITHOUT dome light → **MUST PASS**
- [ ] **ELECTRICAL (E1–E2):** plugged in 30 min on 12V — no overheat. 24V test if accessible.
- [ ] **SOFTWARE (S1–S3):** loop record works, G-sensor lock triggers, auto-resume works
- [ ] Log all results in tracker → Decision: LIST / TRY CJ / DROP

---

## SKU 2 — 24V/12V USB-C Charger (SRS-EM-001)

**Test time:** 1 hour

- [ ] **PACKAGING (P1–P4):** housing label reads "12V/24V" or "12-24V DC" → **MUST PASS**
- [ ] **12V TEST (V1–V4):**
  - [ ] Plug into 12V outlet → both USB-C and USB-A power your phone
  - [ ] Watt meter: USB-C ≥ 27W → **MUST PASS**
  - [ ] Watt meter: USB-A ≥ 15W → **MUST PASS**
  - [ ] Plugged 30 min — housing warm, not hot
- [ ] **24V TEST (T1–T2):**
  - [ ] Plug into 24V semi outlet — no smoke, no burn smell → **MUST PASS**
  - [ ] If no 24V outlet accessible, request UL/CE cert from supplier
- [ ] Log results → Decision: LIST as "semi 24V" / LIST as "12V-only" / DROP

---

## SKU 3 — Bluetooth Headset (SRS-EM-003)

**Test time:** 1 day + 4-hour wear test

- [ ] **PACKAGING (P1–P5):** boom mic rotates 180°, USB-C port (not Micro-USB) → both MUST PASS
- [ ] **PAIRING (B1–B3):** quick pair ≤ 30 sec, dual-pair to TWO phones → **MUST PASS**
- [ ] **CALL QUALITY — CRITICAL (Q1–Q2):**
  - [ ] 5-min call WHILE DRIVING — listener rates inbound clarity 7+/10 → **MUST PASS**
- [ ] **BATTERY (BT1–BT2):**
  - [ ] Full charge → talk time ≥ 15 hr → **MUST PASS**
  - [ ] Charge time ≤ 3 hr
- [ ] **COMFORT (C1):** worn 4 hours — no pain
- [ ] Log results → Decision: LIST / TRY CJ / DROP

---

## SKU 4 — Waterless Wash & Wax (SRS-TC-001)

**Test time:** 2 hours

- [ ] **PRE-IMPORT ANSWERS (A1–A5):** confirm in Zendrop chat
  - [ ] Pump spray (not aerosol) → **MUST PASS**
  - [ ] MSDS shows non-flammable → **MUST PASS**
  - [ ] DOT non-hazardous classification → **MUST PASS**
- [ ] **PACKAGING (P1–P4):** sealed, sprays evenly first 5 pumps
- [ ] **SHIPPING COMPLIANCE (S1–S2):** label reads "Not Hazardous", no UN number, no DOT diamond → both MUST PASS
- [ ] **PERFORMANCE (R1–R3):**
  - [ ] Dusty panel — clean, streak-free, no scratch → **MUST PASS**
  - [ ] Chrome — streak-free → **MUST PASS**
  - [ ] Glass — streak-free → **MUST PASS**
- [ ] Log results → Decision: LIST / TRY CJ / DROP

---

## After All 4 Tests Complete

- [ ] Open `SUPPLIER_VERIFICATION_TRACKER.xlsx` → Cover sheet → fill in Decision column for each SKU
- [ ] Save the file
- [ ] Send the completed tracker back in chat
- [ ] I update catalog accordingly:
  - LIST decisions → SKU enters product import queue
  - TRY CJ decisions → I source equivalent from CJ-USA, place 2nd sample order
  - DROP decisions → SKU removed from launch catalog; if it drops total below 18, we discuss replacement

---

## Final Sample Phase Gate

Before moving to product import:

- [ ] All 4 SKUs have a final Decision logged
- [ ] No SKU left in "PENDING" status
- [ ] Total catalog count ≥ 18 (replace if needed)
- [ ] Tracker file shared back

If catalog stays at 18–20 after verification → **green light for product import.**
If catalog drops to 15–17 → discuss replacement SKUs before import.
If catalog drops below 15 → pause and re-source from CJ-USA across the board.

---

## Reminders

- 🚫 Do not list any SKU on Shopify before its tracker decision is logged
- 🚫 Do not skip the watt meter on the charger (most critical SKU for legal/safety)
- 🚫 Do not test the dash cam in daytime only — night vision is THE test
- ✅ Keep all sample packaging until decisions are final (in case returns needed)
- ✅ If an SKU fails, photograph the failure (e.g., bad night footage screenshot) for warranty claim
