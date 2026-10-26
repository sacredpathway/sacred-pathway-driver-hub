# Load status compatibility — iOS 2.3.5-RC vs canonical set — 2026-09-30

Read-only investigation. **No production load status was changed. No iOS file
was changed.** Source: `~/Developer/SacredPathwayDriverHub-2.3.5-RC` (build 46).

## How iOS reads `loads.status`

1. **Decoding never fails.** `Load.status` is `String?` (`Models/Load.swift:57`,
   `decodeIfPresent(String.self)` at :259). Any value, including unknown ones,
   round-trips unchanged. There is also no CHECK constraint on `loads.status`
   in production.
2. **Business logic uses `Load.loadStatus`** (`Models/Load.swift:134`), a 4-case
   enum: `unassigned`, `assigned`, `ready_for_settlement`, `settled`.
   **Any other string silently falls back** to `.unassigned` (no driver) or
   `.assigned` (driver set).
3. **The dashboard load row uses a second, raw-string label**
   (`Views/Dashboard/DashboardView.swift:984`): `""/pending/active → "Active"`,
   `in_transit → "In Transit"`, `delivered → "Delivered"`,
   `ready_for_settlement → "Ready"`, `settled → "Settled"`, anything else →
   `.capitalized` (e.g. `picked_up` → "Picked_Up").
4. **Settlement eligibility** (`Services/SettlementWorkflowService.swift:190`
   `isCompleted`): `ready_for_settlement`/`settled` → completed;
   `assigned`/`unassigned` → completed **iff delivery_date ≤ today**.
   Because of the fallback in (2), every unknown status is judged purely by
   delivery date.

## Per-status results

| Stored value | Decodes? | `loadStatus` (iOS logic) | Dashboard label | Settlement eligible when delivered date passed? | Safe for web to write today? |
|---|---|---|---|---|---|
| `pending` (110 rows) | yes | unassigned/assigned by driver | Active | yes | already stored — **keep**, display Unassigned on web |
| `assigned` | yes | assigned | "Assigned" (capitalized) | yes | **yes** |
| `dispatched` | yes | fallback | "Dispatched" | yes | yes (cosmetic only) |
| `picked_up` | yes | fallback | **"Picked_Up"** (ugly) | yes | cosmetic defect — fix label first |
| `in_transit` | yes | fallback | In Transit | yes | yes |
| `delivered` | yes | fallback | Delivered | yes | yes |
| `completed` | yes | fallback | "Completed" | yes | yes |
| `cancelled` | yes | fallback → **assigned** | "Cancelled" | **YES — BUG** | **NO** |

Values outside the canonical list that iOS itself uses and production holds:

| Value | Who writes it | Production rows | Note |
|---|---|---|---|
| `active` | iOS: new loads (`ManualLoadEntryView.swift:457,521`, `DocumentReviewView.swift:792`, `LoadsListView.swift:374,408`) and local-mode repair of `pending` (`LocalLoadsRepository.swift:59`) | 0 today (2.3.5 not yet shipped) | **Not in the canonical list.** Must be added (display as Unassigned/Assigned by driver) or iOS must stop writing it. |
| `ready_for_settlement` | iOS settlements (`LoadsListView.swift:375`, `SettlementCloudStore.swift:286`) | 2 | Core to the settlement lifecycle — **must stay valid** |
| `settled` | iOS settlements | 25 | Core — **must stay valid** |
| `unassigned` | web (`LOAD_STATUSES`) | 0 | web writes it today |

## Findings that block expanding web writes

1. **`cancelled` is unsafe.** A cancelled load with a driver and a past delivery
   date becomes an eligible, pre-selected settlement load on iOS. Paying a
   cancelled load is a real-money bug.
   **The live web can already write `cancelled`, `in_transit` and `delivered`**
   (`web-app/app/(app)/loads/constants.ts`). Production has none of those values
   right now, so nothing is wrong yet — but it is one click away.
2. **The canonical list omits `ready_for_settlement` and `settled`.** Those are
   the iOS settlement states (27 production rows). They must remain valid stored
   values; the canonical model needs 10 values, not 8, or the settlement flow
   breaks.
3. **iOS writes `active`**, which is in neither list.
4. **`pending` label conflict.** Decision 3 says pending → "Unassigned"; iOS
   dashboard shows pending → "Active". Both apps should show the same word.
5. `picked_up` renders as "Picked_Up" on the iOS dashboard.

## Exact changes required before the web writes the full canonical set

iOS (one PR, with tests — not done):

- Add `LoadStatus` cases `dispatched`, `picked_up`, `in_transit`, `delivered`,
  `completed`, `cancelled`, and legacy aliases `pending`/`active` → `unassigned`
  semantics (keep the raw string untouched on write-back).
- `SettlementWorkflowService.isCompleted`: `cancelled` → **never** eligible;
  `delivered`/`completed` → eligible; the rest keep the delivery-date rule.
- Replace `DashboardView.statusLabel` with `loadStatus.displayName` so there is
  one label table.
- Decide `active` vs `pending` for new loads (recommend: iOS writes `assigned`
  or `unassigned` based on driver, and treats `active`/`pending` as read-only
  legacy aliases).
- Tests: one decode + `loadStatus` + `isCompleted` + label assertion for each of
  the 10 stored values, plus unknown-string fallback.

Web (after the iOS build containing the above is live and adopted):

- One `lib/loads/status.ts` mapping (10 stored values → label/colour/eligibility).
- Until then, recommend restricting web writes to values iOS already handles
  safely: `unassigned`, `assigned`, `in_transit`, `delivered` — and removing
  `cancelled` from the web picker. **Not done in Phase 0; needs your OK** because
  it changes live-site behaviour.

Production data: **no rewrite needed.** All 140 rows keep their stored value.
