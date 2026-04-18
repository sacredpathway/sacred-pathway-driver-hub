# Sacred Pathway Driver Hub — System Architecture

**Version:** 1.0  
**Date:** April 14, 2026  
**Status:** Pre-MVP — awaiting approval to proceed to build

---

## 1. Tech Stack Overview

| Layer | Technology | Why |
|-------|-----------|-----|
| **iOS App** | Swift + SwiftUI | Native performance, camera access, system share sheet, Files integration |
| **UI Framework** | SwiftUI + NavigationStack | Modern declarative UI, less boilerplate than UIKit |
| **Backend** | Supabase (PostgreSQL + Auth + Storage + Edge Functions) | Auth, database, file storage in one platform. Free tier is generous for MVP. |
| **AI Document Parsing** | OpenAI API (gpt-4o vision) | Best-in-class document understanding. Reads scanned images natively via the vision API; PDFs are rendered to images before upload. |
| **PDF Generation** | TPPDF (Swift library) | Native iOS PDF rendering — no server dependency. Branded paystubs generated on-device. |
| **File Storage** | Supabase Storage (S3-compatible) | Store uploaded documents (images + PDFs) per user. 1GB free, scales cheaply. |
| **Payments (iOS)** | StoreKit 2 | Apple's modern subscription API. Required for App Store distribution. |
| **Payments (Web)** | Stripe | Higher margins for Carrier/Enterprise tiers sold outside the App Store. |
| **Analytics** | PostHog (self-serve) or Mixpanel (free tier) | Track feature usage, conversion funnels, retention. |

---

## 2. High-Level Architecture

```
┌─────────────────────────────────────────────────────┐
│                    iOS App (SwiftUI)                 │
│                                                     │
│  ┌──────────┐  ┌──────────┐  ┌──────────────────┐  │
│  │  Camera   │  │  Upload   │  │   Dashboard      │  │
│  │  Scanner  │  │  Picker   │  │   (Loads/P&L)    │  │
│  └────┬─────┘  └────┬─────┘  └────────┬─────────┘  │
│       │              │                 │             │
│       └──────┬───────┘                 │             │
│              ▼                         │             │
│  ┌───────────────────┐    ┌────────────▼──────────┐ │
│  │  Document          │    │  Settlement           │ │
│  │  Processing        │    │  Calculator           │ │
│  │  Manager           │    │  Engine               │ │
│  └────────┬──────────┘    └────────────┬──────────┘ │
│           │                            │             │
│           ▼                            ▼             │
│  ┌──────────────────────────────────────────────┐   │
│  │            Supabase Client SDK               │   │
│  │  (Auth · Database · Storage · Realtime)      │   │
│  └──────────────────────┬───────────────────────┘   │
└─────────────────────────┼───────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────┐
│                 Supabase Backend                     │
│                                                     │
│  ┌──────────┐  ┌──────────┐  ┌──────────────────┐  │
│  │  Auth     │  │  Postgres │  │  Storage (S3)    │  │
│  │  (Email + │  │  Database │  │  Documents +     │  │
│  │  Magic    │  │           │  │  Images          │  │
│  │  Link)    │  │           │  │                  │  │
│  └──────────┘  └──────────┘  └──────────────────┘  │
│                                                     │
│  ┌──────────────────────────────────────────────┐   │
│  │  Edge Functions                               │   │
│  │  • /extract-document → calls OpenAI API       │   │
│  │  • /generate-insights → calls OpenAI API      │   │
│  │  • /generate-paystub → PDF generation         │   │
│  │  • /webhook-stripe → payment events           │   │
│  └──────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────┐
│                  OpenAI API                          │
│  • Receives document image as base64                │
│  • Returns structured JSON: revenue, expenses,      │
│    broker name, dates, line items                    │
└─────────────────────────────────────────────────────┘
```

---

## 3. Document Processing Flow

This is the core of the app — how a physical or digital document becomes structured financial data.

### 3a. Scanning Flow (Camera)

1. User taps "Scan" → iOS `VNDocumentCameraViewController` opens
2. Camera auto-detects document edges, crops, and enhances
3. Output: one or more `UIImage` objects (already perspective-corrected)
4. App compresses to JPEG (quality 0.8, keeps file under ~500KB)
5. Image uploaded to Supabase Storage: `documents/{user_id}/{load_id}/{timestamp}.jpg`
6. Image sent to OpenAI API as base64 via Supabase Edge Function

### 3b. Upload Flow (Files/Photos/Email)

1. User taps "Upload" → iOS `PHPickerViewController` (photos) or `UIDocumentPickerViewController` (files)
2. Supported types: JPEG, PNG, HEIC, PDF
3. For PDFs: render first page as a JPEG via `CGPDFDocument` before upload
4. Upload to Supabase Storage (same path structure)
5. Send to OpenAI API same as scanned docs

### 3c. OpenAI API Extraction

The Edge Function sends the document to OpenAI's Chat Completions endpoint with a structured system prompt. Here's the exact approach:

```
POST https://api.openai.com/v1/chat/completions

{
  "model": "gpt-4o",
  "max_tokens": 1200,
  "temperature": 0,
  "response_format": { "type": "json_object" },
  "messages": [
    {
      "role": "system",
      "content": "<document-extraction system prompt>"
    },
    {
      "role": "user",
      "content": [
        { "type": "text", "text": "Extract all data from this trucking document and return only JSON." },
        {
          "type": "image_url",
          "image_url": {
            "url": "data:image/jpeg;base64,<base64_encoded_image>",
            "detail": "high"
          }
        }
      ]
    }
  ]
}
```

The system prompt tells the model which document types to recognize (rate confirmation, fuel receipt, lumper, toll, repair, other) and which fields to extract: broker_name, broker_mc_number, load_number, pickup_date, delivery_date, origin, destination, total_miles, line_haul_rate, fuel_surcharge, accessorial_charges, total_revenue, expense_amount, expense_category, vendor_name, gallons, price_per_gallon, notes, and confidence. Missing fields are omitted rather than guessed; dates are YYYY-MM-DD; numbers are plain JSON numbers without "$" or commas.

**Why gpt-4o:** Rate confirmations have complex layouts — tables, fine print, multiple dollar amounts. gpt-4o's vision accuracy on structured extraction is strong and the price is ~$0.005–$0.01 per page. gpt-4o-mini is used for the cheaper text-only insights function.

**Why Edge Function instead of on-device:** Keeps the OpenAI API key off the device. Edge Functions also let you add logging, rate limiting, and retry logic without app updates.

---

## 4. Database Schema (Supabase/PostgreSQL)

```sql
-- Users (extends Supabase auth.users)
CREATE TABLE profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id),
  company_name TEXT,
  mc_number TEXT,
  dot_number TEXT,
  phone TEXT,
  subscription_tier TEXT DEFAULT 'free',  -- free, pro, carrier, enterprise
  subscription_status TEXT DEFAULT 'active',
  stripe_customer_id TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Drivers (for companies with multiple drivers)
CREATE TABLE drivers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  truck_number TEXT,
  pay_percentage DECIMAL(5,2) DEFAULT 25.00,  -- e.g., 25%
  phone TEXT,
  email TEXT,
  active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Loads (the central entity — every document ties back to a load)
CREATE TABLE loads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
  driver_id UUID REFERENCES drivers(id),
  load_number TEXT,
  broker_name TEXT,
  broker_mc_number TEXT,
  pickup_date DATE,
  delivery_date DATE,
  origin TEXT,
  destination TEXT,
  total_miles DECIMAL(10,2),
  line_haul_rate DECIMAL(10,2),
  fuel_surcharge DECIMAL(10,2) DEFAULT 0,
  accessorial_charges DECIMAL(10,2) DEFAULT 0,
  total_revenue DECIMAL(10,2),
  status TEXT DEFAULT 'pending',  -- pending, in_transit, delivered, settled
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Expenses (linked to loads)
CREATE TABLE expenses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  load_id UUID REFERENCES loads(id) ON DELETE CASCADE,
  profile_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
  category TEXT NOT NULL,  -- fuel, lumper, toll, maintenance, other
  amount DECIMAL(10,2) NOT NULL,
  vendor_name TEXT,
  description TEXT,
  gallons DECIMAL(10,2),         -- fuel only
  price_per_gallon DECIMAL(6,3), -- fuel only
  receipt_date DATE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Documents (every scanned/uploaded file)
CREATE TABLE documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
  load_id UUID REFERENCES loads(id),
  document_type TEXT,  -- rate_confirmation, fuel_receipt, lumper_receipt, etc.
  storage_path TEXT NOT NULL,  -- path in Supabase Storage
  extracted_data JSONB,  -- raw Claude API response
  confidence TEXT,  -- high, medium, low
  processed BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Settlements (generated paystubs)
CREATE TABLE settlements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
  driver_id UUID REFERENCES drivers(id),
  settlement_period_start DATE,
  settlement_period_end DATE,
  total_revenue DECIMAL(10,2),
  total_expenses DECIMAL(10,2),
  gross_profit DECIMAL(10,2),
  driver_pay_percentage DECIMAL(5,2),
  driver_pay_amount DECIMAL(10,2),
  dispatcher_fee_percentage DECIMAL(5,2) DEFAULT 0,
  dispatcher_fee_amount DECIMAL(10,2) DEFAULT 0,
  factoring_fee_percentage DECIMAL(5,2) DEFAULT 0,
  factoring_fee_amount DECIMAL(10,2) DEFAULT 0,
  authority_fee DECIMAL(10,2) DEFAULT 0,
  maintenance_reserve DECIMAL(10,2) DEFAULT 0,
  net_pay DECIMAL(10,2),
  pdf_storage_path TEXT,  -- generated paystub PDF
  status TEXT DEFAULT 'draft',  -- draft, finalized, sent
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Row Level Security (every table)
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE drivers ENABLE ROW LEVEL SECURITY;
ALTER TABLE loads ENABLE ROW LEVEL SECURITY;
ALTER TABLE expenses ENABLE ROW LEVEL SECURITY;
ALTER TABLE documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE settlements ENABLE ROW LEVEL SECURITY;

-- Example RLS policy (repeat pattern for each table)
CREATE POLICY "Users see own data" ON loads
  FOR ALL USING (profile_id = auth.uid());
```

---

## 5. Settlement Calculation Engine

These are the exact formulas the app uses. Every dollar amount is transparent — carriers hate black-box math.

```
INPUTS (per settlement period):
  total_revenue        = SUM of all load revenues for the period
  total_expenses       = SUM of all expenses across those loads
  driver_pay_pct       = driver's configured pay % (e.g., 25%)
  dispatcher_fee_pct   = dispatcher cut % (e.g., 5%)
  factoring_fee_pct    = factoring company % (e.g., 3%)
  authority_fee        = flat monthly fee (e.g., $50)
  maintenance_reserve  = flat per-settlement hold (e.g., $100)

CALCULATIONS:
  gross_profit         = total_revenue - total_expenses
  driver_pay           = gross_profit × (driver_pay_pct / 100)
  dispatcher_fee       = total_revenue × (dispatcher_fee_pct / 100)
  factoring_fee        = total_revenue × (factoring_fee_pct / 100)

  net_pay = gross_profit
            - driver_pay
            - dispatcher_fee
            - factoring_fee
            - authority_fee
            - maintenance_reserve

ALTERNATIVE (driver gets % of revenue, not profit):
  driver_pay_alt       = total_revenue × (driver_pay_pct / 100)
  // Toggle this in settings — some carriers pay off gross, others off net
```

---

## 6. File Storage Structure

```
Supabase Storage Bucket: "documents"

documents/
  {user_id}/
    {load_id}/
      rate_con_2026-04-14_143022.jpg
      fuel_receipt_2026-04-14_153045.jpg
      lumper_2026-04-14_161012.pdf
    {load_id}/
      ...

settlements/
  {user_id}/
    settlement_2026-04-07_2026-04-13.pdf
    settlement_2026-04-14_2026-04-20.pdf
```

---

## 7. Security Model

| Concern | Solution |
|---------|----------|
| API key protection | Claude API key lives in Supabase Edge Function env vars — never on device |
| Data isolation | Row Level Security on every table — users only see their own data |
| Auth | Supabase Auth with email/password + magic link. Apple Sign-In for App Store compliance. |
| Storage | Supabase Storage policies mirror RLS — users access only their own folder |
| Transport | All traffic over HTTPS. Supabase enforces TLS. |
| Payments | StoreKit 2 handles iOS. Stripe webhooks verified with signing secret. |

---

## 8. Cost Projections (MVP Phase)

| Service | Free Tier | At 100 Users | At 1,000 Users |
|---------|-----------|-------------|----------------|
| Supabase | 500MB DB, 1GB storage, 50K auth | ~$25/mo (Pro plan) | ~$75/mo |
| Claude API (Sonnet) | — | ~$15/mo (5K scans) | ~$150/mo (50K scans) |
| Apple Developer | $99/yr | $99/yr | $99/yr |
| PostHog | 1M events free | Free | Free |
| **Total** | **~$8/mo** | **~$50/mo** | **~$235/mo** |

At $29/mo per carrier, you need **2 paying users** to cover MVP costs. At 100 paying users, you're at $2,900 MRR against $50 in costs. The margins on this are excellent.
