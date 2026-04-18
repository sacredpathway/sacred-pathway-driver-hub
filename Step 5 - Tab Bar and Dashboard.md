# Step 5: Tab Bar & Dashboard

**Time needed:** 20 minutes  
**What you'll have when done:** The main app shell with 4 tabs and a working Dashboard that shows revenue, expenses, and profit

---

## 5.1 — Update ContentView (Main Tab Bar)

**Open `ContentView.swift`** (click it in the left sidebar) and **replace everything** with:

```swift
import SwiftUI

struct ContentView: View {
    @EnvironmentObject var supabase: SupabaseService
    @State private var hasCompletedOnboarding: Bool = false

    var body: some View {
        Group {
            if !hasCompletedOnboarding && supabase.currentProfile?.companyName == nil {
                OnboardingView(hasCompletedOnboarding: $hasCompletedOnboarding)
                    .environmentObject(supabase)
            } else {
                mainTabView
            }
        }
        .onAppear {
            // If they already have a company name, skip onboarding
            if supabase.currentProfile?.companyName != nil {
                hasCompletedOnboarding = true
            }
        }
    }

    private var mainTabView: some View {
        TabView {
            DashboardView()
                .tabItem {
                    Label("Home", systemImage: "house.fill")
                }

            ScanUploadView()
                .tabItem {
                    Label("Scan", systemImage: "camera.fill")
                }

            LoadsListView()
                .tabItem {
                    Label("Loads", systemImage: "truck.box.fill")
                }

            SettingsView()
                .tabItem {
                    Label("Settings", systemImage: "gearshape.fill")
                }
        }
    }
}

#Preview {
    ContentView()
        .environmentObject(SupabaseService())
}
```

---

## 5.2 — Dashboard View

**Right-click** on `Views/Dashboard/` → **New File** → **SwiftUI View** → name it `DashboardView`

```swift
import SwiftUI

struct DashboardView: View {
    @EnvironmentObject var supabase: SupabaseService
    @State private var loads: [Load] = []
    @State private var allExpenses: [Expense] = []
    @State private var isLoading = true

    var totalRevenue: Double {
        loads.reduce(0) { $0 + ($1.totalRevenue ?? 0) }
    }

    var totalExpenses: Double {
        allExpenses.reduce(0) { $0 + $1.amount }
    }

    var netProfit: Double {
        totalRevenue - totalExpenses
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 20) {
                    // Summary cards
                    summarySection

                    // Recent loads
                    recentLoadsSection
                }
                .padding()
            }
            .navigationTitle(supabase.currentProfile?.companyName ?? "Dashboard")
            .refreshable {
                await loadData()
            }
            .task {
                await loadData()
            }
        }
    }

    // MARK: - Summary Cards

    private var summarySection: some View {
        VStack(spacing: 12) {
            HStack(spacing: 12) {
                SummaryCard(
                    title: "Revenue",
                    value: totalRevenue.asCurrency,
                    color: .green
                )
                SummaryCard(
                    title: "Expenses",
                    value: totalExpenses.asCurrency,
                    color: .red
                )
            }

            SummaryCard(
                title: "Net Profit",
                value: netProfit.asCurrency,
                color: netProfit >= 0 ? .blue : .red
            )
        }
    }

    // MARK: - Recent Loads

    private var recentLoadsSection: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Recent Loads")
                .font(.headline)

            if isLoading {
                ProgressView()
                    .frame(maxWidth: .infinity, minHeight: 100)
            } else if loads.isEmpty {
                VStack(spacing: 12) {
                    Image(systemName: "truck.box")
                        .font(.system(size: 40))
                        .foregroundStyle(.secondary)
                    Text("No loads yet")
                        .font(.headline)
                        .foregroundStyle(.secondary)
                    Text("Scan or upload a rate confirmation to get started")
                        .font(.subheadline)
                        .foregroundStyle(.tertiary)
                        .multilineTextAlignment(.center)
                }
                .frame(maxWidth: .infinity)
                .padding(.vertical, 32)
            } else {
                ForEach(loads.prefix(5)) { load in
                    NavigationLink(destination: LoadDetailView(load: load)) {
                        LoadRowView(load: load)
                    }
                    .buttonStyle(.plain)
                }
            }
        }
    }

    private func loadData() async {
        isLoading = true
        do {
            loads = try await supabase.fetchLoads()

            // Fetch expenses for all loads
            var expenses: [Expense] = []
            for load in loads {
                if let loadId = load.id {
                    let loadExpenses = try await supabase.fetchExpenses(forLoad: loadId)
                    expenses.append(contentsOf: loadExpenses)
                }
            }
            allExpenses = expenses
        } catch {
            print("Error loading dashboard: \(error)")
        }
        isLoading = false
    }
}

// MARK: - Summary Card Component

struct SummaryCard: View {
    let title: String
    let value: String
    let color: Color

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(title)
                .font(.caption)
                .foregroundStyle(.secondary)
            Text(value)
                .font(.title2)
                .fontWeight(.bold)
                .foregroundStyle(color)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding()
        .background(color.opacity(0.1))
        .clipShape(RoundedRectangle(cornerRadius: 12))
    }
}

// MARK: - Load Row Component

struct LoadRowView: View {
    let load: Load

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack {
                Text(load.loadNumber.map { "#\($0)" } ?? "No Load #")
                    .font(.headline)
                Spacer()
                Text(load.status?.capitalized ?? "Pending")
                    .font(.caption)
                    .fontWeight(.medium)
                    .padding(.horizontal, 8)
                    .padding(.vertical, 4)
                    .background(statusColor.opacity(0.15))
                    .foregroundStyle(statusColor)
                    .clipShape(Capsule())
            }

            if let broker = load.brokerName {
                Text(broker)
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
            }

            HStack {
                if let origin = load.origin, let dest = load.destination {
                    Text("\(origin) → \(dest)")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
                Spacer()
                if let rev = load.totalRevenue {
                    Text(rev.asCurrency)
                        .font(.subheadline)
                        .fontWeight(.semibold)
                        .foregroundStyle(.green)
                }
            }
        }
        .padding()
        .background(Color(.systemBackground))
        .clipShape(RoundedRectangle(cornerRadius: 12))
        .shadow(color: .black.opacity(0.05), radius: 5, y: 2)
    }

    private var statusColor: Color {
        switch load.status {
        case "delivered": return .green
        case "in_transit": return .blue
        case "settled": return .purple
        default: return .orange
        }
    }
}

#Preview {
    DashboardView()
        .environmentObject(SupabaseService())
}
```

---

## 5.3 — Placeholder Views (So the App Builds)

We need placeholder files for the screens we haven't built yet. Create each of these as a **SwiftUI View**:

### `Views/Scanner/ScanUploadView.swift`

```swift
import SwiftUI

struct ScanUploadView: View {
    @EnvironmentObject var supabase: SupabaseService

    var body: some View {
        NavigationStack {
            VStack(spacing: 24) {
                Spacer()

                // Scan button
                Button(action: { /* Coming in Step 6 */ }) {
                    VStack(spacing: 12) {
                        Image(systemName: "camera.viewfinder")
                            .font(.system(size: 48))
                        Text("Scan Document")
                            .font(.headline)
                        Text("Point camera at any rate con, receipt, or invoice")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                            .multilineTextAlignment(.center)
                    }
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 32)
                    .background(Color.blue.opacity(0.1))
                    .clipShape(RoundedRectangle(cornerRadius: 16))
                }
                .buttonStyle(.plain)

                // Upload button
                Button(action: { /* Coming in Step 6 */ }) {
                    VStack(spacing: 12) {
                        Image(systemName: "folder.badge.plus")
                            .font(.system(size: 48))
                        Text("Upload Document")
                            .font(.headline)
                        Text("Import from Files, Photos, or email")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                            .multilineTextAlignment(.center)
                    }
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 32)
                    .background(Color.green.opacity(0.1))
                    .clipShape(RoundedRectangle(cornerRadius: 16))
                }
                .buttonStyle(.plain)

                // Manual entry
                Button(action: { /* Coming in Step 6 */ }) {
                    Label("Add Load Manually", systemImage: "plus.circle")
                        .font(.subheadline)
                }

                Spacer()
            }
            .padding(.horizontal, 24)
            .navigationTitle("Add Document")
        }
    }
}

#Preview {
    ScanUploadView()
        .environmentObject(SupabaseService())
}
```

### `Views/Loads/LoadsListView.swift`

```swift
import SwiftUI

struct LoadsListView: View {
    @EnvironmentObject var supabase: SupabaseService
    @State private var loads: [Load] = []
    @State private var isLoading = true

    var body: some View {
        NavigationStack {
            Group {
                if isLoading {
                    ProgressView()
                } else if loads.isEmpty {
                    VStack(spacing: 12) {
                        Image(systemName: "truck.box")
                            .font(.system(size: 50))
                            .foregroundStyle(.secondary)
                        Text("No loads yet")
                            .font(.headline)
                        Text("Scan a rate confirmation to create your first load")
                            .font(.subheadline)
                            .foregroundStyle(.secondary)
                    }
                } else {
                    List(loads) { load in
                        NavigationLink(destination: LoadDetailView(load: load)) {
                            LoadRowView(load: load)
                        }
                    }
                    .listStyle(.plain)
                }
            }
            .navigationTitle("Loads")
            .task {
                do {
                    loads = try await supabase.fetchLoads()
                } catch {
                    print("Error: \(error)")
                }
                isLoading = false
            }
        }
    }
}

#Preview {
    LoadsListView()
        .environmentObject(SupabaseService())
}
```

### `Views/Loads/LoadDetailView.swift`

```swift
import SwiftUI

struct LoadDetailView: View {
    @EnvironmentObject var supabase: SupabaseService
    let load: Load
    @State private var expenses: [Expense] = []

    var totalExpenses: Double {
        expenses.reduce(0) { $0 + $1.amount }
    }

    var profit: Double {
        (load.totalRevenue ?? 0) - totalExpenses
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                // Header
                VStack(alignment: .leading, spacing: 4) {
                    if let broker = load.brokerName {
                        Text(broker)
                            .font(.title2)
                            .fontWeight(.bold)
                    }
                    if let mc = load.brokerMcNumber {
                        Text("MC# \(mc)")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                }

                // Route
                if let origin = load.origin, let dest = load.destination {
                    VStack(alignment: .leading, spacing: 4) {
                        Text("ROUTE")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                        Text("\(origin) → \(dest)")
                            .font(.subheadline)
                        if let miles = load.totalMiles {
                            Text("\(Int(miles)) miles")
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        }
                    }
                }

                Divider()

                // Revenue
                VStack(alignment: .leading, spacing: 8) {
                    Text("REVENUE")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                    detailRow("Line haul", value: load.lineHaulRate)
                    detailRow("Fuel surcharge", value: load.fuelSurcharge)
                    detailRow("Accessorials", value: load.accessorialCharges)
                    Divider()
                    HStack {
                        Text("Total Revenue")
                            .fontWeight(.semibold)
                        Spacer()
                        Text((load.totalRevenue ?? 0).asCurrency)
                            .fontWeight(.semibold)
                            .foregroundStyle(.green)
                    }
                }

                Divider()

                // Expenses
                VStack(alignment: .leading, spacing: 8) {
                    Text("EXPENSES")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                    if expenses.isEmpty {
                        Text("No expenses recorded")
                            .font(.subheadline)
                            .foregroundStyle(.tertiary)
                    } else {
                        ForEach(expenses) { expense in
                            HStack {
                                VStack(alignment: .leading) {
                                    Text(expense.category.capitalized)
                                    if let vendor = expense.vendorName {
                                        Text(vendor)
                                            .font(.caption)
                                            .foregroundStyle(.secondary)
                                    }
                                }
                                Spacer()
                                Text(expense.amount.asCurrency)
                                    .foregroundStyle(.red)
                            }
                        }
                        Divider()
                        HStack {
                            Text("Total Expenses")
                                .fontWeight(.semibold)
                            Spacer()
                            Text(totalExpenses.asCurrency)
                                .fontWeight(.semibold)
                                .foregroundStyle(.red)
                        }
                    }
                }

                Divider()

                // Profit summary
                VStack(spacing: 8) {
                    HStack {
                        Text("PROFIT")
                            .font(.headline)
                        Spacer()
                        Text(profit.asCurrency)
                            .font(.title2)
                            .fontWeight(.bold)
                            .foregroundStyle(profit >= 0 ? .green : .red)
                    }

                    if let miles = load.totalMiles, miles > 0 {
                        HStack {
                            Text("Rate/mile")
                                .font(.caption)
                                .foregroundStyle(.secondary)
                            Spacer()
                            Text(((load.totalRevenue ?? 0) / miles).asCurrency)
                                .font(.caption)
                        }
                    }
                }
                .padding()
                .background(Color(.systemGray6))
                .clipShape(RoundedRectangle(cornerRadius: 12))
            }
            .padding()
        }
        .navigationTitle("Load #\(load.loadNumber ?? "—")")
        .navigationBarTitleDisplayMode(.inline)
        .task {
            if let loadId = load.id {
                do {
                    expenses = try await supabase.fetchExpenses(forLoad: loadId)
                } catch {
                    print("Error loading expenses: \(error)")
                }
            }
        }
    }

    private func detailRow(_ label: String, value: Double?) -> some View {
        HStack {
            Text(label)
                .font(.subheadline)
            Spacer()
            Text((value ?? 0).asCurrency)
                .font(.subheadline)
        }
    }
}

#Preview {
    NavigationStack {
        LoadDetailView(load: Load(
            id: UUID(),
            profileId: UUID(),
            loadNumber: "2841",
            brokerName: "XPO Logistics",
            origin: "Dallas, TX",
            destination: "Houston, TX",
            totalMiles: 239,
            lineHaulRate: 1650,
            fuelSurcharge: 150,
            accessorialCharges: 50,
            totalRevenue: 1850,
            status: "delivered"
        ))
        .environmentObject(SupabaseService())
    }
}
```

### `Views/Settings/SettingsView.swift`

```swift
import SwiftUI

struct SettingsView: View {
    @EnvironmentObject var supabase: SupabaseService

    var body: some View {
        NavigationStack {
            List {
                // Company info section
                Section("Company") {
                    LabeledContent("Company", value: supabase.currentProfile?.companyName ?? "Not set")
                    LabeledContent("MC#", value: supabase.currentProfile?.mcNumber ?? "Not set")
                    LabeledContent("DOT#", value: supabase.currentProfile?.dotNumber ?? "Not set")
                }

                // Fee settings section
                Section("Default Fees") {
                    LabeledContent("Driver Pay", value: "\(supabase.currentProfile?.driverPayPercentage ?? 25)%")
                    LabeledContent("Dispatcher Fee", value: "\(supabase.currentProfile?.dispatcherFeePercentage ?? 5)%")
                    LabeledContent("Factoring Fee", value: "\(supabase.currentProfile?.factoringFeePercentage ?? 3)%")
                    LabeledContent("Authority Fee", value: (supabase.currentProfile?.authorityFee ?? 50).asCurrency)
                    LabeledContent("Maint. Reserve", value: (supabase.currentProfile?.maintenanceReserve ?? 100).asCurrency)
                }

                // Subscription section
                Section("Subscription") {
                    LabeledContent("Plan", value: (supabase.currentProfile?.subscriptionTier ?? "free").capitalized)
                }

                // Sign out
                Section {
                    Button("Sign Out", role: .destructive) {
                        Task {
                            try? await supabase.signOut()
                        }
                    }
                }
            }
            .navigationTitle("Settings")
        }
    }
}

#Preview {
    SettingsView()
        .environmentObject(SupabaseService())
}
```

---

## 5.4 — Build and Run!

1. Press **Cmd + B** to build
2. If you see errors, check:
   - Every file is in the right folder
   - You copied the full code (no missing closing braces)
   - The Config.swift file has your real Supabase URL and key
3. If it builds successfully, press **Cmd + R** to run in the simulator
4. You should see the **Login screen**!

**Test the flow:**
- Type an email and password, click "Sign Up"
- You should be taken to the Onboarding screen
- Fill in your company info, click Next, set fees, click "Finish Setup"
- You should land on the Dashboard with the 4-tab bar at the bottom

---

## ✅ Checkpoint

Your app now has:
- Login / Sign Up authentication
- Company onboarding flow
- 4-tab navigation (Home, Scan, Loads, Settings)
- Dashboard with revenue/expense/profit summary cards
- Loads list with load detail view
- Scan/Upload screen (buttons ready, functionality coming in Step 6)
- Settings screen showing company info, fees, and sign out

**This is a working app skeleton.** The next steps will add the real power features: document scanning with AI, settlement generation, and PDF export.

**Tell me when you're ready for Step 6 — Document Scanning & AI Extraction.** That's where Sacred Pathway comes alive.
