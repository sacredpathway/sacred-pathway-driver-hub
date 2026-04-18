# Step 3: Write Your Swift Foundation Code

**Time needed:** 30 minutes  
**What you'll have when done:** Data models, Supabase connection, and authentication working in your app

---

## How to Create a New Swift File in Xcode

You'll do this many times, so learn it once:

1. In the left sidebar, **right-click** on the folder where you want the file
2. Select **"New File..."**
3. Choose **"Swift File"** (NOT "SwiftUI View" — I'll tell you when to use that instead)
4. Click **Next**
5. Type the filename I give you
6. Make sure your project "SacredPathway" is checked under "Targets"
7. Click **Create**
8. **Delete everything** in the new file and **paste** the code I give you

When I say "**Create a SwiftUI View**", use step 3 but choose **"SwiftUI View"** instead.

---

## 3.1 — Configuration File

**Create a new Swift file** in the top-level `SacredPathway` folder (NOT inside any subfolder):

**Filename:** `Config.swift`

```swift
import Foundation

enum Config {
    // ⚠️ PASTE YOUR ACTUAL VALUES HERE (from Step 2.3)
    static let supabaseURL = URL(string: "https://YOUR-PROJECT-ID.supabase.co")!
    static let supabaseAnonKey = "YOUR-ANON-KEY-HERE"
}
```

**IMPORTANT:** Replace `YOUR-PROJECT-ID` and `YOUR-ANON-KEY-HERE` with the actual values you saved in Step 2.3. The URL looks like `https://abcdefghijk.supabase.co` and the key is a long string starting with `eyJ`.

---

## 3.2 — Data Models

These define the shape of your data. One file per model.

### Create `Models/Profile.swift`

Right-click on the **Models** folder → New File → Swift File → name it `Profile`

```swift
import Foundation

struct Profile: Codable, Identifiable {
    let id: UUID
    var companyName: String?
    var mcNumber: String?
    var dotNumber: String?
    var phone: String?
    var subscriptionTier: String?
    var subscriptionStatus: String?
    var driverPayPercentage: Double?
    var dispatcherFeePercentage: Double?
    var factoringFeePercentage: Double?
    var authorityFee: Double?
    var maintenanceReserve: Double?
    var payBasis: String?
    var createdAt: Date?
    var updatedAt: Date?

    enum CodingKeys: String, CodingKey {
        case id
        case companyName = "company_name"
        case mcNumber = "mc_number"
        case dotNumber = "dot_number"
        case phone
        case subscriptionTier = "subscription_tier"
        case subscriptionStatus = "subscription_status"
        case driverPayPercentage = "driver_pay_percentage"
        case dispatcherFeePercentage = "dispatcher_fee_percentage"
        case factoringFeePercentage = "factoring_fee_percentage"
        case authorityFee = "authority_fee"
        case maintenanceReserve = "maintenance_reserve"
        case payBasis = "pay_basis"
        case createdAt = "created_at"
        case updatedAt = "updated_at"
    }
}
```

### Create `Models/Driver.swift`

```swift
import Foundation

struct Driver: Codable, Identifiable {
    var id: UUID?
    let profileId: UUID
    var name: String
    var truckNumber: String?
    var payPercentage: Double?
    var phone: String?
    var email: String?
    var active: Bool?
    var createdAt: Date?

    enum CodingKeys: String, CodingKey {
        case id
        case profileId = "profile_id"
        case name
        case truckNumber = "truck_number"
        case payPercentage = "pay_percentage"
        case phone, email, active
        case createdAt = "created_at"
    }
}
```

### Create `Models/Load.swift`

```swift
import Foundation

struct Load: Codable, Identifiable {
    var id: UUID?
    let profileId: UUID
    var driverId: UUID?
    var loadNumber: String?
    var brokerName: String?
    var brokerMcNumber: String?
    var pickupDate: Date?
    var deliveryDate: Date?
    var origin: String?
    var destination: String?
    var totalMiles: Double?
    var lineHaulRate: Double?
    var fuelSurcharge: Double?
    var accessorialCharges: Double?
    var totalRevenue: Double?
    var status: String?
    var createdAt: Date?
    var updatedAt: Date?

    enum CodingKeys: String, CodingKey {
        case id
        case profileId = "profile_id"
        case driverId = "driver_id"
        case loadNumber = "load_number"
        case brokerName = "broker_name"
        case brokerMcNumber = "broker_mc_number"
        case pickupDate = "pickup_date"
        case deliveryDate = "delivery_date"
        case origin, destination
        case totalMiles = "total_miles"
        case lineHaulRate = "line_haul_rate"
        case fuelSurcharge = "fuel_surcharge"
        case accessorialCharges = "accessorial_charges"
        case totalRevenue = "total_revenue"
        case status
        case createdAt = "created_at"
        case updatedAt = "updated_at"
    }

    // Computed properties for quick math
    var expenses: Double { 0 } // Will be calculated from expenses table
    var profit: Double { (totalRevenue ?? 0) - expenses }
    var ratePerMile: Double {
        guard let miles = totalMiles, miles > 0, let rev = totalRevenue else { return 0 }
        return rev / miles
    }
}
```

### Create `Models/Expense.swift`

```swift
import Foundation

struct Expense: Codable, Identifiable {
    var id: UUID?
    var loadId: UUID?
    let profileId: UUID
    var category: String
    var amount: Double
    var vendorName: String?
    var description: String?
    var gallons: Double?
    var pricePerGallon: Double?
    var receiptDate: Date?
    var createdAt: Date?

    enum CodingKeys: String, CodingKey {
        case id
        case loadId = "load_id"
        case profileId = "profile_id"
        case category, amount
        case vendorName = "vendor_name"
        case description, gallons
        case pricePerGallon = "price_per_gallon"
        case receiptDate = "receipt_date"
        case createdAt = "created_at"
    }
}
```

### Create `Models/TruckDocument.swift`

(We call it "TruckDocument" instead of "Document" because Swift already has a type called Document)

```swift
import Foundation

struct TruckDocument: Codable, Identifiable {
    var id: UUID?
    let profileId: UUID
    var loadId: UUID?
    var documentType: String?
    var storagePath: String
    var extractedData: ExtractedData?
    var confidence: String?
    var processed: Bool?
    var createdAt: Date?

    enum CodingKeys: String, CodingKey {
        case id
        case profileId = "profile_id"
        case loadId = "load_id"
        case documentType = "document_type"
        case storagePath = "storage_path"
        case extractedData = "extracted_data"
        case confidence, processed
        case createdAt = "created_at"
    }
}

// This matches the JSON that Claude AI returns
struct ExtractedData: Codable {
    var documentType: String?
    var brokerName: String?
    var brokerMcNumber: String?
    var loadNumber: String?
    var pickupDate: String?
    var deliveryDate: String?
    var origin: String?
    var destination: String?
    var totalMiles: Double?
    var lineHaulRate: Double?
    var fuelSurcharge: Double?
    var accessorialCharges: Double?
    var totalRevenue: Double?
    var expenseAmount: Double?
    var expenseCategory: String?
    var vendorName: String?
    var gallons: Double?
    var pricePerGallon: Double?
    var notes: String?
    var confidence: String?

    enum CodingKeys: String, CodingKey {
        case documentType = "document_type"
        case brokerName = "broker_name"
        case brokerMcNumber = "broker_mc_number"
        case loadNumber = "load_number"
        case pickupDate = "pickup_date"
        case deliveryDate = "delivery_date"
        case origin, destination
        case totalMiles = "total_miles"
        case lineHaulRate = "line_haul_rate"
        case fuelSurcharge = "fuel_surcharge"
        case accessorialCharges = "accessorial_charges"
        case totalRevenue = "total_revenue"
        case expenseAmount = "expense_amount"
        case expenseCategory = "expense_category"
        case vendorName = "vendor_name"
        case gallons
        case pricePerGallon = "price_per_gallon"
        case notes, confidence
    }
}
```

### Create `Models/Settlement.swift`

```swift
import Foundation

struct Settlement: Codable, Identifiable {
    var id: UUID?
    let profileId: UUID
    var driverId: UUID?
    var settlementPeriodStart: Date?
    var settlementPeriodEnd: Date?
    var totalRevenue: Double?
    var totalExpenses: Double?
    var grossProfit: Double?
    var driverPayPercentage: Double?
    var driverPayAmount: Double?
    var dispatcherFeePercentage: Double?
    var dispatcherFeeAmount: Double?
    var factoringFeePercentage: Double?
    var factoringFeeAmount: Double?
    var authorityFee: Double?
    var maintenanceReserve: Double?
    var netPay: Double?
    var pdfStoragePath: String?
    var status: String?
    var createdAt: Date?

    enum CodingKeys: String, CodingKey {
        case id
        case profileId = "profile_id"
        case driverId = "driver_id"
        case settlementPeriodStart = "settlement_period_start"
        case settlementPeriodEnd = "settlement_period_end"
        case totalRevenue = "total_revenue"
        case totalExpenses = "total_expenses"
        case grossProfit = "gross_profit"
        case driverPayPercentage = "driver_pay_percentage"
        case driverPayAmount = "driver_pay_amount"
        case dispatcherFeePercentage = "dispatcher_fee_percentage"
        case dispatcherFeeAmount = "dispatcher_fee_amount"
        case factoringFeePercentage = "factoring_fee_percentage"
        case factoringFeeAmount = "factoring_fee_amount"
        case authorityFee = "authority_fee"
        case maintenanceReserve = "maintenance_reserve"
        case netPay = "net_pay"
        case pdfStoragePath = "pdf_storage_path"
        case status
        case createdAt = "created_at"
    }
}
```

---

## 3.3 — Supabase Service (Your Backend Connection)

This is the file that talks to your Supabase backend. Every database operation goes through here.

### Create `Services/SupabaseService.swift`

```swift
import Foundation
import Supabase

@MainActor
class SupabaseService: ObservableObject {

    // The Supabase client — your connection to the backend
    let client: SupabaseClient

    // The currently logged-in user's profile
    @Published var currentProfile: Profile?

    // Auth state
    @Published var isAuthenticated = false
    @Published var isLoading = true

    init() {
        self.client = SupabaseClient(
            supabaseURL: Config.supabaseURL,
            supabaseKey: Config.supabaseAnonKey
        )

        // Listen for auth state changes
        Task {
            for await state in client.auth.authStateChanges {
                self.isAuthenticated = state.session != nil
                if state.session != nil {
                    await self.fetchProfile()
                } else {
                    self.currentProfile = nil
                }
                self.isLoading = false
            }
        }
    }

    // MARK: - Auth

    func signUp(email: String, password: String) async throws {
        try await client.auth.signUp(email: email, password: password)
    }

    func signIn(email: String, password: String) async throws {
        try await client.auth.signIn(email: email, password: password)
    }

    func signOut() async throws {
        try await client.auth.signOut()
        self.currentProfile = nil
        self.isAuthenticated = false
    }

    // MARK: - Profile

    func fetchProfile() async {
        guard let userId = client.auth.currentUser?.id else { return }
        do {
            let profile: Profile = try await client.from("profiles")
                .select()
                .eq("id", value: userId)
                .single()
                .execute()
                .value
            self.currentProfile = profile
        } catch {
            print("Error fetching profile: \(error)")
        }
    }

    func updateProfile(_ updates: [String: AnyEncodable]) async throws {
        guard let userId = client.auth.currentUser?.id else { return }
        try await client.from("profiles")
            .update(updates)
            .eq("id", value: userId)
            .execute()
        await fetchProfile()
    }

    // MARK: - Loads

    func fetchLoads() async throws -> [Load] {
        let loads: [Load] = try await client.from("loads")
            .select()
            .order("created_at", ascending: false)
            .execute()
            .value
        return loads
    }

    func createLoad(_ load: Load) async throws -> Load {
        let created: Load = try await client.from("loads")
            .insert(load)
            .select()
            .single()
            .execute()
            .value
        return created
    }

    func updateLoad(_ load: Load) async throws {
        guard let loadId = load.id else { return }
        try await client.from("loads")
            .update(load)
            .eq("id", value: loadId)
            .execute()
    }

    // MARK: - Expenses

    func fetchExpenses(forLoad loadId: UUID) async throws -> [Expense] {
        let expenses: [Expense] = try await client.from("expenses")
            .select()
            .eq("load_id", value: loadId)
            .execute()
            .value
        return expenses
    }

    func createExpense(_ expense: Expense) async throws -> Expense {
        let created: Expense = try await client.from("expenses")
            .insert(expense)
            .select()
            .single()
            .execute()
            .value
        return created
    }

    // MARK: - Drivers

    func fetchDrivers() async throws -> [Driver] {
        let drivers: [Driver] = try await client.from("drivers")
            .select()
            .eq("active", value: true)
            .order("name")
            .execute()
            .value
        return drivers
    }

    func createDriver(_ driver: Driver) async throws -> Driver {
        let created: Driver = try await client.from("drivers")
            .insert(driver)
            .select()
            .single()
            .execute()
            .value
        return created
    }

    // MARK: - Documents

    func createDocument(_ document: TruckDocument) async throws -> TruckDocument {
        let created: TruckDocument = try await client.from("documents")
            .insert(document)
            .select()
            .single()
            .execute()
            .value
        return created
    }

    // MARK: - Settlements

    func fetchSettlements() async throws -> [Settlement] {
        let settlements: [Settlement] = try await client.from("settlements")
            .select()
            .order("created_at", ascending: false)
            .execute()
            .value
        return settlements
    }

    func createSettlement(_ settlement: Settlement) async throws -> Settlement {
        let created: Settlement = try await client.from("settlements")
            .insert(settlement)
            .select()
            .single()
            .execute()
            .value
        return created
    }

    // MARK: - File Storage

    func uploadDocument(data: Data, path: String) async throws -> String {
        try await client.storage
            .from("documents")
            .upload(path: path, file: data, options: .init(contentType: "image/jpeg"))
        return path
    }
}

// Helper to encode mixed types in dictionaries
struct AnyEncodable: Encodable {
    private let _encode: (Encoder) throws -> Void

    init<T: Encodable>(_ wrapped: T) {
        _encode = { encoder in
            try wrapped.encode(to: encoder)
        }
    }

    func encode(to encoder: Encoder) throws {
        try _encode(encoder)
    }
}
```

---

## 3.4 — Update Your App Entry Point

Now let's wire the SupabaseService into your app so every screen can access it.

**Open `SacredPathwayApp.swift`** (click it in the left sidebar) and **replace everything** with:

```swift
import SwiftUI

@main
struct SacredPathwayApp: App {
    @StateObject private var supabase = SupabaseService()

    var body: some Scene {
        WindowGroup {
            Group {
                if supabase.isLoading {
                    // Show loading screen while checking auth status
                    ProgressView("Loading...")
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                } else if supabase.isAuthenticated {
                    // User is logged in — show main app
                    ContentView()
                        .environmentObject(supabase)
                } else {
                    // User is NOT logged in — show login screen
                    LoginView()
                        .environmentObject(supabase)
                }
            }
        }
    }
}
```

**Note:** This will show a red error for `LoginView` — that's expected! We'll create it in Step 4.

---

## 3.5 — Settlement Calculation Engine

### Create `Services/SettlementEngine.swift`

```swift
import Foundation

struct SettlementCalculation {
    let totalRevenue: Double
    let totalExpenses: Double
    let grossProfit: Double
    let driverPayPercentage: Double
    let driverPayAmount: Double
    let dispatcherFeePercentage: Double
    let dispatcherFeeAmount: Double
    let factoringFeePercentage: Double
    let factoringFeeAmount: Double
    let authorityFee: Double
    let maintenanceReserve: Double
    let carrierNetPay: Double
}

class SettlementEngine {

    /// Calculate a complete settlement
    /// - Parameters:
    ///   - loads: The loads included in this settlement
    ///   - expenses: All expenses across those loads
    ///   - profile: The carrier's profile (has fee percentages)
    ///   - driver: The driver being paid
    ///   - payOnRevenue: If true, driver gets % of revenue. If false, % of gross profit.
    static func calculate(
        loads: [Load],
        expenses: [Expense],
        profile: Profile,
        driver: Driver,
        payOnRevenue: Bool = false
    ) -> SettlementCalculation {

        // Step 1: Total revenue from all loads
        let totalRevenue = loads.reduce(0.0) { sum, load in
            sum + (load.totalRevenue ?? 0)
        }

        // Step 2: Total expenses
        let totalExpenses = expenses.reduce(0.0) { sum, expense in
            sum + expense.amount
        }

        // Step 3: Gross profit
        let grossProfit = totalRevenue - totalExpenses

        // Step 4: Driver pay
        let driverPct = driver.payPercentage ?? profile.driverPayPercentage ?? 25.0
        let driverPayBase = payOnRevenue ? totalRevenue : grossProfit
        let driverPayAmount = driverPayBase * (driverPct / 100.0)

        // Step 5: Dispatcher fee (always on revenue)
        let dispatcherPct = profile.dispatcherFeePercentage ?? 0.0
        let dispatcherFeeAmount = totalRevenue * (dispatcherPct / 100.0)

        // Step 6: Factoring fee (always on revenue)
        let factoringPct = profile.factoringFeePercentage ?? 0.0
        let factoringFeeAmount = totalRevenue * (factoringPct / 100.0)

        // Step 7: Flat fees
        let authorityFee = profile.authorityFee ?? 0.0
        let maintenanceReserve = profile.maintenanceReserve ?? 0.0

        // Step 8: Carrier net pay (what the company keeps)
        let carrierNetPay = grossProfit
            - driverPayAmount
            - dispatcherFeeAmount
            - factoringFeeAmount
            - authorityFee
            - maintenanceReserve

        return SettlementCalculation(
            totalRevenue: totalRevenue,
            totalExpenses: totalExpenses,
            grossProfit: grossProfit,
            driverPayPercentage: driverPct,
            driverPayAmount: driverPayAmount,
            dispatcherFeePercentage: dispatcherPct,
            dispatcherFeeAmount: dispatcherFeeAmount,
            factoringFeePercentage: factoringPct,
            factoringFeeAmount: factoringFeeAmount,
            authorityFee: authorityFee,
            maintenanceReserve: maintenanceReserve,
            carrierNetPay: carrierNetPay
        )
    }
}
```

---

## 3.6 — Currency Formatting Helper

### Create `Utilities/Currency+Extensions.swift`

```swift
import Foundation

extension Double {
    /// Formats a number as currency: 1234.5 → "$1,234.50"
    var asCurrency: String {
        let formatter = NumberFormatter()
        formatter.numberStyle = .currency
        formatter.locale = Locale(identifier: "en_US")
        return formatter.string(from: NSNumber(value: self)) ?? "$0.00"
    }

    /// Formats a number as percentage: 25.0 → "25%"
    var asPercent: String {
        return String(format: "%.0f%%", self)
    }
}
```

---

## ✅ Checkpoint

Your project should now have these files:

```
📁 SacredPathway
  📄 SacredPathwayApp.swift       ← Updated with auth routing
  📄 ContentView.swift             ← (we'll update this next)
  📄 Config.swift                  ← Your Supabase URL + key
  📁 Models/
    📄 Profile.swift
    📄 Driver.swift
    📄 Load.swift
    📄 Expense.swift
    📄 TruckDocument.swift
    📄 Settlement.swift
  📁 Services/
    📄 SupabaseService.swift
    📄 SettlementEngine.swift
  📁 Utilities/
    📄 Currency+Extensions.swift
```

**The app won't build yet** — that's expected. We need to create the `LoginView` in Step 4. But all your data models, your backend connection, and your settlement math are done.

**Move on to Step 4 when ready.**
