# Step 2: Set Up Your Supabase Backend

**Time needed:** 20 minutes  
**What you'll have when done:** A fully configured cloud backend with database tables, auth, and file storage

---

## 2.1 — Create a Supabase Account

1. Open your web browser
2. Go to **https://supabase.com**
3. Click **"Start your project"** (or "Sign Up")
4. Sign up with your GitHub account or email
5. Once logged in, you'll see the Supabase Dashboard

## 2.2 — Create a New Project

1. Click **"New Project"**
2. Fill in:
   - **Name:** `sacred-pathway`
   - **Database Password:** Create a strong password and **SAVE IT SOMEWHERE SAFE** (you'll need it later)
   - **Region:** Pick the one closest to you (e.g., "East US" if you're on the East Coast)
3. Click **"Create new project"**
4. Wait 1-2 minutes for it to set up

## 2.3 — Get Your API Keys

You'll need two values to connect your iOS app to Supabase:

1. In your Supabase project dashboard, click **"Project Settings"** (gear icon in the left sidebar)
2. Click **"API"** in the left menu
3. You'll see two important values:

| What | Where to find it | What it looks like |
|------|------------------|-------------------|
| **Project URL** | Under "Project URL" | `https://abcdefghijk.supabase.co` |
| **Anon Key** | Under "Project API keys" → `anon` `public` | A long string starting with `eyJ...` |

4. **Copy both of these** and save them in a note. You'll paste them into your Xcode project in Step 3.

**IMPORTANT:** The `anon` key is safe to put in your app — it's designed to be public. The `service_role` key is SECRET — never put that in your app.

## 2.4 — Create Your Database Tables

Now we'll create all the tables your app needs.

1. In the left sidebar, click **"SQL Editor"** (the database icon that looks like a cylinder)
2. Click **"New query"** (top right)
3. **Delete** any text in the editor
4. **Copy and paste** this entire SQL block:

```sql
-- ============================================
-- SACRED PATHWAY DRIVER HUB — DATABASE SCHEMA
-- Run this ONCE in Supabase SQL Editor
-- ============================================

-- 1. PROFILES (extends the built-in auth.users table)
CREATE TABLE profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  company_name TEXT,
  mc_number TEXT,
  dot_number TEXT,
  phone TEXT,
  subscription_tier TEXT DEFAULT 'free',
  subscription_status TEXT DEFAULT 'active',
  stripe_customer_id TEXT,
  driver_pay_percentage DECIMAL(5,2) DEFAULT 25.00,
  dispatcher_fee_percentage DECIMAL(5,2) DEFAULT 5.00,
  factoring_fee_percentage DECIMAL(5,2) DEFAULT 3.00,
  authority_fee DECIMAL(10,2) DEFAULT 50.00,
  maintenance_reserve DECIMAL(10,2) DEFAULT 100.00,
  pay_basis TEXT DEFAULT 'gross_profit',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. DRIVERS
CREATE TABLE drivers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id UUID REFERENCES profiles(id) ON DELETE CASCADE NOT NULL,
  name TEXT NOT NULL,
  truck_number TEXT,
  pay_percentage DECIMAL(5,2) DEFAULT 25.00,
  phone TEXT,
  email TEXT,
  active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 3. LOADS
CREATE TABLE loads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id UUID REFERENCES profiles(id) ON DELETE CASCADE NOT NULL,
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
  status TEXT DEFAULT 'pending',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 4. EXPENSES
CREATE TABLE expenses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  load_id UUID REFERENCES loads(id) ON DELETE CASCADE,
  profile_id UUID REFERENCES profiles(id) ON DELETE CASCADE NOT NULL,
  category TEXT NOT NULL,
  amount DECIMAL(10,2) NOT NULL,
  vendor_name TEXT,
  description TEXT,
  gallons DECIMAL(10,2),
  price_per_gallon DECIMAL(6,3),
  receipt_date DATE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 5. DOCUMENTS
CREATE TABLE documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id UUID REFERENCES profiles(id) ON DELETE CASCADE NOT NULL,
  load_id UUID REFERENCES loads(id),
  document_type TEXT,
  storage_path TEXT NOT NULL,
  extracted_data JSONB,
  confidence TEXT,
  processed BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 6. SETTLEMENTS
CREATE TABLE settlements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id UUID REFERENCES profiles(id) ON DELETE CASCADE NOT NULL,
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
  pdf_storage_path TEXT,
  status TEXT DEFAULT 'draft',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- ROW LEVEL SECURITY (keeps each user's data private)
-- ============================================

ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE drivers ENABLE ROW LEVEL SECURITY;
ALTER TABLE loads ENABLE ROW LEVEL SECURITY;
ALTER TABLE expenses ENABLE ROW LEVEL SECURITY;
ALTER TABLE documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE settlements ENABLE ROW LEVEL SECURITY;

-- Profiles: users can only see/edit their own profile
CREATE POLICY "Users manage own profile" ON profiles
  FOR ALL USING (id = auth.uid());

-- Drivers: users can only see/edit their own drivers
CREATE POLICY "Users manage own drivers" ON drivers
  FOR ALL USING (profile_id = auth.uid());

-- Loads: users can only see/edit their own loads
CREATE POLICY "Users manage own loads" ON loads
  FOR ALL USING (profile_id = auth.uid());

-- Expenses: users can only see/edit their own expenses
CREATE POLICY "Users manage own expenses" ON expenses
  FOR ALL USING (profile_id = auth.uid());

-- Documents: users can only see/edit their own documents
CREATE POLICY "Users manage own documents" ON documents
  FOR ALL USING (profile_id = auth.uid());

-- Settlements: users can only see/edit their own settlements
CREATE POLICY "Users manage own settlements" ON settlements
  FOR ALL USING (profile_id = auth.uid());

-- ============================================
-- AUTO-CREATE PROFILE ON SIGNUP
-- ============================================

-- This function runs every time someone signs up.
-- It automatically creates a profile row for them.
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO profiles (id)
  VALUES (NEW.id);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Hook the function to the auth.users table
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user();
```

5. Click the **"Run"** button (or press **Cmd + Enter**)
6. You should see a green **"Success. No rows returned"** message at the bottom
7. If you see any red errors, copy the error text and tell me — I'll help you fix it

## 2.5 — Verify Your Tables Were Created

1. In the left sidebar, click **"Table Editor"** (the grid icon)
2. You should see all 6 tables listed:
   - profiles
   - drivers
   - loads
   - expenses
   - documents
   - settlements
3. Click on any table to see its columns — they should match the schema above

## 2.6 — Set Up File Storage

1. In the left sidebar, click **"Storage"** (the folder icon)
2. Click **"New bucket"**
3. Name it: `documents`
4. Toggle **"Public bucket"** to **OFF** (private — only authenticated users can access)
5. Click **"Create bucket"**

Now add a storage policy so users can upload/read their own files:

6. Click on the **"documents"** bucket you just created
7. Click the **"Policies"** tab (or go to **Storage → Policies** in the sidebar)
8. Under the `documents` bucket, click **"New Policy"**
9. Choose **"For full customization"**
10. Set it up:
    - **Policy name:** `Users manage own files`
    - **Allowed operation:** Select ALL (SELECT, INSERT, UPDATE, DELETE)
    - **Target roles:** `authenticated`
    - **WITH CHECK expression (for INSERT/UPDATE):**
      ```
      (bucket_id = 'documents' AND (storage.foldername(name))[1] = auth.uid()::text)
      ```
    - **USING expression (for SELECT/DELETE):**
      ```
      (bucket_id = 'documents' AND (storage.foldername(name))[1] = auth.uid()::text)
      ```
11. Click **"Review"** then **"Save Policy"**

This means: each user can only upload to and read from a folder named with their own user ID. User A can never see User B's files.

## 2.7 — Enable Email Auth

1. In the left sidebar, click **"Authentication"** (the key icon)
2. Click **"Providers"** in the sub-menu
3. **Email** should already be enabled (it's on by default)
4. Make sure these settings are:
   - ✅ Enable Email Signup: **ON**
   - Confirm email: You can turn this **OFF** for easier testing during development (turn it back ON before launch)

## 2.8 — Get Your OpenAI API Key

You need this for the AI document scanning:

1. Go to **https://platform.openai.com/api-keys**
2. Sign up or log in
3. Click **"Create new secret key"**
4. Name it: `sacred-pathway-prod`
5. Copy the key (starts with `sk-...`) and **SAVE IT SECURELY** — you'll use this in your Supabase Edge Function
6. While you're there, go to **Settings → Billing → Payment methods** and add a card if you haven't — gpt-4o vision runs about $0.005–$0.01 per document scan

**IMPORTANT:** This key is SECRET. Never put it directly in your iOS app code. It goes in a Supabase Edge Function secret (we'll set that up later).

---

## ✅ Checkpoint

At this point you should have:
- A Supabase project called `sacred-pathway`
- Your **Project URL** and **Anon Key** saved somewhere
- 6 database tables created (profiles, drivers, loads, expenses, documents, settlements)
- Row Level Security enabled on all tables
- A `documents` storage bucket with a privacy policy
- Email auth enabled
- An OpenAI API key saved securely

**You're ready for Step 3** — where we start writing actual Swift code to connect your app to Supabase.
