# Sacred Pathway Driver Hub — MVP Build Plan

**Version:** 1.0  
**Date:** April 14, 2026  
**Target:** App Store submission in 4–6 weeks

---

## MVP Scope — What's In, What's Out

The MVP must do ONE thing so well that a carrier tells another carrier about it: **scan a document and generate a paystub in under 60 seconds.**

### In (V1)

- Email/password auth + Apple Sign-In
- Scan documents with camera (VisionKit)
- Upload documents from Files/Photos (UIDocumentPicker + PHPicker)
- Claude AI extraction → structured load data
- Manual load creation (fallback if AI misreads)
- Edit extracted data before saving
- Dashboard: active loads, revenue vs expenses, profit per load
- Driver management (add drivers, set pay %)
- Settlement calculator with configurable fees
- PDF paystub generation
- Share paystub via system share sheet (email, AirDrop, Files)
- Settings: company info, fee configuration, driver defaults
- Free tier (3 loads/month) + Pro tier ($29/mo unlimited)

### Out (V2+)

- Document Vault / search
- What-If Calculator
- Push notifications
- Driver Scorecard
- IFTA tracking
- Broker Rate Intelligence
- Load board integration
- QuickBooks export
- Multi-user / team accounts
- Web dashboard

---

## Screen-by-Screen UI Breakdown

### Screen 1: Onboarding (3 screens)

| Screen | Content |
|--------|---------|
| Welcome | "Sacred Pathway Driver Hub" logo + tagline. "Get Started" button. |
| Company Setup | Company name, MC#, DOT# (optional). These populate the paystub header. |
| Fee Config | Driver pay %, dispatcher %, factoring %, authority fee, maintenance reserve. All have sensible defaults. Skip button available. |

**After onboarding:** user lands on Dashboard.

### Screen 2: Dashboard (Home Tab)

```
┌─────────────────────────────────┐
│  Sacred Pathway Driver Hub      │
│  [Company Name]                 │
├─────────────────────────────────┤
│                                 │
│  THIS WEEK           ▼ dropdown │
│  ┌──────────┬──────────┐       │
│  │ Revenue  │ Expenses │       │
│  │ $4,280   │ $1,120   │       │
│  ├──────────┴──────────┤       │
│  │ Net Profit: $3,160  │       │
│  └─────────────────────┘       │
│                                 │
│  RECENT LOADS                   │
│  ┌─────────────────────────┐   │
│  │ Load #2841              │   │
│  │ XPO Logistics → Dallas  │   │
│  │ $1,850 rev · $420 exp   │   │
│  │ Status: Delivered ✓     │   │
│  └─────────────────────────┘   │
│  ┌─────────────────────────┐   │
│  │ Load #2840              │   │
│  │ CH Robinson → Houston   │   │
│  │ $2,430 rev · $700 exp   │   │
│  │ Status: Settled ✓✓      │   │
│  └─────────────────────────┘   │
│                                 │
├──────┬──────┬──────┬───────────┤
│ Home │ Scan │Loads │ Settings  │
└──────┴──────┴──────┴───────────┘
```

**Key details:**
- Summary card shows revenue, expenses, net profit for selected period
- Period selector: This Week, This Month, Last Month, Custom
- Recent loads list with quick status indicators
- Tapping a load opens the Load Detail screen

### Screen 3: Scan / Upload (Center Tab — Primary Action)

This is the hero screen. Two big buttons:

```
┌─────────────────────────────────┐
│          Add Document           │
│                                 │
│  ┌─────────────────────────┐   │
│  │                         │   │
│  │    📸 Scan Document     │   │
│  │                         │   │
│  │  Point camera at any    │   │
│  │  rate con, receipt,     │   │
│  │  or invoice             │   │
│  └─────────────────────────┘   │
│                                 │
│  ┌─────────────────────────┐   │
│  │                         │   │
│  │    📁 Upload Document   │   │
│  │                         │   │
│  │  Import from Files,     │   │
│  │  Photos, or email       │   │
│  └─────────────────────────┘   │
│                                 │
│  ── or ──                       │
│                                 │
│  [ + Add Load Manually ]        │
│                                 │
└─────────────────────────────────┘
```

**After scan/upload, the AI Processing screen appears:**

```
┌─────────────────────────────────┐
│     Processing Document...      │
│                                 │
│     [Document thumbnail]        │
│                                 │
│     ◌ Analyzing document...     │
│     ◌ Extracting data...        │
│     ● Found: Rate Confirmation  │
│                                 │
│  ┌─────────────────────────┐   │
│  │ Broker: XPO Logistics   │ ✏️│
│  │ Load #: 2841            │ ✏️│
│  │ Revenue: $1,850.00      │ ✏️│
│  │ Pickup: Dallas, TX      │ ✏️│
│  │ Delivery: Houston, TX   │ ✏️│
│  │ Miles: 239              │ ✏️│
│  │ Confidence: HIGH ●      │   │
│  └─────────────────────────┘   │
│                                 │
│  [ Assign to Load ▼ ]          │
│                                 │
│  [      Save & Continue      ]  │
└─────────────────────────────────┘
```

**Key details:**
- Every extracted field is editable (tap the pencil icon)
- Confidence indicator: green (high), yellow (medium), red (low)
- "Assign to Load" lets user link to existing load or create new
- For receipts: shows expense category, amount, vendor

### Screen 4: Loads List Tab

```
┌─────────────────────────────────┐
│  Loads              [+ New Load]│
│  ┌──────────────────────────┐  │
│  │ Search loads...          │  │
│  └──────────────────────────┘  │
│                                 │
│  [ All ] [ Pending ] [ Settled ]│
│                                 │
│  ┌─────────────────────────┐   │
│  │ #2841 · XPO Logistics   │   │
│  │ Dallas → Houston        │   │
│  │ Apr 12–13 · 239 mi      │   │
│  │ Rev $1,850 · Exp $420   │   │
│  │ Profit: $1,430          │   │
│  │ [Delivered]              │   │
│  └─────────────────────────┘   │
│  ...                            │
└─────────────────────────────────┘
```

### Screen 5: Load Detail

```
┌─────────────────────────────────┐
│  ← Load #2841                   │
│  XPO Logistics · MC# 123456    │
├─────────────────────────────────┤
│  ROUTE                          │
│  Dallas, TX → Houston, TX       │
│  239 miles · Apr 12–13, 2026    │
├─────────────────────────────────┤
│  REVENUE                        │
│  Line haul         $1,650.00    │
│  Fuel surcharge      $150.00    │
│  Accessorials         $50.00    │
│  Total             $1,850.00    │
├─────────────────────────────────┤
│  EXPENSES                       │
│  Fuel (45 gal)       $320.00   │
│  Lumper fee           $75.00    │
│  Toll                 $25.00    │
│  Total               $420.00    │
├─────────────────────────────────┤
│  PROFIT              $1,430.00  │
│  Rate/mile              $7.74   │
│  Cost/mile              $1.76   │
│  Profit/mile            $5.98   │
├─────────────────────────────────┤
│  DOCUMENTS (3)                  │
│  📄 Rate confirmation           │
│  🧾 Fuel receipt                │
│  🧾 Lumper receipt              │
├─────────────────────────────────┤
│  [ + Add Document ]             │
│  [ Generate Settlement ]        │
└─────────────────────────────────┘
```

### Screen 6: Settlement Generator

```
┌─────────────────────────────────┐
│  ← Generate Settlement          │
├─────────────────────────────────┤
│  DRIVER: Marcus Johnson     ▼   │
│  PERIOD: Apr 7–13, 2026    ▼   │
├─────────────────────────────────┤
│  LOADS INCLUDED (3)             │
│  ☑ #2841  $1,850  $420         │
│  ☑ #2840  $2,430  $700         │
│  ☑ #2839  $1,620  $310         │
├─────────────────────────────────┤
│  SUMMARY                        │
│  Total revenue      $5,900.00   │
│  Total expenses    -$1,430.00   │
│  Gross profit       $4,470.00   │
├─────────────────────────────────┤
│  DEDUCTIONS                     │
│  Driver pay (25%)  -$1,117.50   │
│  Dispatcher (5%)     -$295.00   │
│  Factoring (3%)      -$177.00   │
│  Authority fee        -$50.00   │
│  Maint. reserve      -$100.00   │
├─────────────────────────────────┤
│  CARRIER NET PAY    $2,730.50   │
│  DRIVER NET PAY     $1,117.50   │
├─────────────────────────────────┤
│  [ Preview PDF ]                │
│  [ Finalize & Share ]           │
└─────────────────────────────────┘
```

### Screen 7: Settings

```
┌─────────────────────────────────┐
│  Settings                       │
├─────────────────────────────────┤
│  COMPANY                        │
│  Company name     [Sacred Path] │
│  MC Number        [MC-123456  ] │
│  DOT Number       [1234567    ] │
│  Phone            [555-0100   ] │
├─────────────────────────────────┤
│  DEFAULT FEES                   │
│  Driver pay %     [25    ] %    │
│  Dispatcher fee % [5     ] %    │
│  Factoring fee %  [3     ] %    │
│  Authority fee    [$50   ] /mo  │
│  Maint. reserve   [$100  ] /set │
│                                 │
│  Pay driver on:                 │
│  (●) Gross profit  ( ) Revenue  │
├─────────────────────────────────┤
│  DRIVERS                        │
│  Marcus Johnson · Truck #401    │
│  Tony Williams · Truck #402     │
│  [ + Add Driver ]               │
├─────────────────────────────────┤
│  SUBSCRIPTION                   │
│  Plan: Pro ($29/mo)             │
│  [ Manage Subscription ]        │
├─────────────────────────────────┤
│  [ Sign Out ]                   │
└─────────────────────────────────┘
```

---

## Navigation Flow

```
Tab Bar (4 tabs)
├── Home (Dashboard)
│   └── Load Detail
│       ├── Add Document → Scan/Upload → AI Processing → Review
│       └── Generate Settlement → Preview PDF → Share
├── Scan/Upload (center, prominent)
│   ├── Camera Scanner → AI Processing → Review → Assign to Load
│   ├── File Picker → AI Processing → Review → Assign to Load
│   └── Manual Entry → Load Form
├── Loads
│   ├── Load List (filterable)
│   └── Load Detail (same as from Dashboard)
└── Settings
    ├── Company Info
    ├── Fee Configuration
    ├── Driver Management
    │   └── Add/Edit Driver
    └── Subscription Management
```

---

## Build Phases (4–6 Week Timeline)

### Week 1: Foundation

- Set up Xcode project with SwiftUI
- Configure Supabase project (auth, database, storage)
- Create database tables and RLS policies
- Build auth flow (sign up, sign in, Apple Sign-In)
- Build onboarding screens (company setup, fee config)
- Build Settings screen

**Milestone:** User can create account, set up company, configure fees.

### Week 2: Document Processing

- Integrate VisionKit document scanner
- Build file/photo upload picker
- Create Supabase Edge Function for Claude API calls
- Build AI Processing screen (loading → extracted data → review/edit)
- Build manual load entry form
- Store documents in Supabase Storage

**Milestone:** User can scan or upload a document and see extracted data.

### Week 3: Financial Tracking

- Build Loads list with filtering
- Build Load Detail screen with revenue/expense breakdown
- Implement "Assign to Load" flow from document processing
- Build Dashboard with summary cards
- Calculate per-load profit, rate/mile, cost/mile

**Milestone:** User can see all loads, expenses, and profit metrics.

### Week 4: Settlements & PDF

- Build Settlement Generator screen
- Implement settlement calculation engine
- Build PDF generation with TPPDF (branded paystub)
- Integrate system share sheet for export
- Build Driver management screens

**Milestone:** User can generate and share a branded paystub PDF.

### Week 5: Paywall & Polish

- Integrate StoreKit 2 for Pro subscription
- Build paywall screen (free: 3 loads/mo, Pro: unlimited)
- Add usage tracking and limit enforcement
- UI polish: loading states, error handling, empty states
- Edge cases: multi-page documents, low-confidence results
- Performance optimization (image compression, caching)

**Milestone:** App is feature-complete with working subscription.

### Week 6: Launch Prep

- TestFlight beta with 5–10 real carriers
- Fix bugs from beta feedback
- Create App Store assets (screenshots, preview video, description)
- Write privacy policy and terms of service
- Submit to App Store review

**Milestone:** App is live on the App Store.

---

## Xcode Project Structure

```
SacredPathway/
├── App/
│   ├── SacredPathwayApp.swift          // @main entry point
│   ├── ContentView.swift               // Tab bar root
│   └── AppState.swift                  // Global app state
├── Models/
│   ├── Profile.swift
│   ├── Driver.swift
│   ├── Load.swift
│   ├── Expense.swift
│   ├── Document.swift
│   └── Settlement.swift
├── Views/
│   ├── Auth/
│   │   ├── LoginView.swift
│   │   ├── SignUpView.swift
│   │   └── OnboardingView.swift
│   ├── Dashboard/
│   │   ├── DashboardView.swift
│   │   └── SummaryCardView.swift
│   ├── Scanner/
│   │   ├── ScanUploadView.swift
│   │   ├── DocumentScannerView.swift   // VisionKit wrapper
│   │   ├── AIProcessingView.swift
│   │   └── ExtractedDataReviewView.swift
│   ├── Loads/
│   │   ├── LoadsListView.swift
│   │   ├── LoadDetailView.swift
│   │   └── ManualLoadEntryView.swift
│   ├── Settlement/
│   │   ├── SettlementGeneratorView.swift
│   │   ├── SettlementPreviewView.swift
│   │   └── PaystubPDFView.swift
│   └── Settings/
│       ├── SettingsView.swift
│       ├── DriverManagementView.swift
│       └── SubscriptionView.swift
├── Services/
│   ├── SupabaseService.swift           // Auth, DB, Storage client
│   ├── DocumentProcessingService.swift // Upload + Claude API calls
│   ├── SettlementEngine.swift          // Calculation logic
│   ├── PDFGenerator.swift              // TPPDF paystub creation
│   └── SubscriptionService.swift       // StoreKit 2 management
├── Utilities/
│   ├── ImageCompressor.swift
│   ├── DateFormatter+Extensions.swift
│   └── Currency+Extensions.swift
└── Resources/
    ├── Assets.xcassets
    └── Info.plist
```

---

## Key Swift Dependencies (Package.swift / SPM)

| Package | Purpose | URL |
|---------|---------|-----|
| supabase-swift | Supabase client (auth, DB, storage, edge functions) | github.com/supabase/supabase-swift |
| TPPDF | PDF generation on-device | github.com/techprimate/TPPDF |

That's it for MVP. Two dependencies. Keep it lean.

---

## Risk Mitigation

| Risk | Mitigation |
|------|-----------|
| Claude misreads a document | Always show extracted data for review/edit before saving. Confidence indicator flags uncertain results. |
| App Store rejection | Apple Sign-In required. Privacy policy required. No mention of "AI" in ways that imply sentience. TestFlight first. |
| User uploads huge PDF | Limit to 5 pages per document. Compress images to 0.8 quality JPEG. Show file size warning. |
| Supabase goes down | Local cache of recent loads using SwiftData. Queue document uploads for retry. |
| API costs spike | Rate limit Edge Function: max 50 scans/day for free tier, 200 for Pro. Monitor via Supabase dashboard. |

---

## Next Steps — Awaiting Your Approval

Once you approve this architecture and build plan, I'll move to **Phase 1: Foundation** and start generating actual Swift code, beginning with the Supabase setup and auth flow.

**Questions for you before we proceed:**

1. Do you have an Apple Developer account set up? ($99/yr — required for TestFlight and App Store)
2. Do you have a Supabase account? (Free tier works for MVP)
3. Do you have an OpenAI API key? (Required for document processing)
4. Branding: do you have a logo or brand colors picked out for Sacred Pathway?
