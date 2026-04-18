# Step 4: Auth & Onboarding Screens

**Time needed:** 20 minutes  
**What you'll have when done:** Login, sign up, and company setup screens — the first thing users see

---

## 4.1 — Login Screen

**Right-click** on `Views/Auth/` → **New File** → choose **"SwiftUI View"** → name it `LoginView`

**Replace everything** with:

```swift
import SwiftUI

struct LoginView: View {
    @EnvironmentObject var supabase: SupabaseService
    @State private var email = ""
    @State private var password = ""
    @State private var isSignUp = false
    @State private var isLoading = false
    @State private var errorMessage: String?

    var body: some View {
        NavigationStack {
            VStack(spacing: 24) {
                Spacer()

                // Logo area
                VStack(spacing: 8) {
                    Image(systemName: "truck.box.fill")
                        .font(.system(size: 60))
                        .foregroundStyle(.blue)

                    Text("Sacred Pathway")
                        .font(.largeTitle)
                        .fontWeight(.bold)

                    Text("Driver Hub")
                        .font(.title2)
                        .foregroundStyle(.secondary)
                }

                Spacer()

                // Form fields
                VStack(spacing: 16) {
                    TextField("Email", text: $email)
                        .textFieldStyle(.roundedBorder)
                        .textInputAutocapitalization(.never)
                        .keyboardType(.emailAddress)
                        .autocorrectionDisabled()

                    SecureField("Password", text: $password)
                        .textFieldStyle(.roundedBorder)

                    if let error = errorMessage {
                        Text(error)
                            .foregroundStyle(.red)
                            .font(.caption)
                            .multilineTextAlignment(.center)
                    }

                    // Main action button
                    Button(action: handleAuth) {
                        if isLoading {
                            ProgressView()
                                .frame(maxWidth: .infinity)
                                .frame(height: 44)
                        } else {
                            Text(isSignUp ? "Create Account" : "Sign In")
                                .fontWeight(.semibold)
                                .frame(maxWidth: .infinity)
                                .frame(height: 44)
                        }
                    }
                    .buttonStyle(.borderedProminent)
                    .disabled(email.isEmpty || password.isEmpty || isLoading)

                    // Toggle between sign in and sign up
                    Button(action: {
                        isSignUp.toggle()
                        errorMessage = nil
                    }) {
                        Text(isSignUp
                             ? "Already have an account? Sign In"
                             : "Don't have an account? Sign Up")
                            .font(.subheadline)
                    }
                }
                .padding(.horizontal, 32)

                Spacer()
            }
        }
    }

    private func handleAuth() {
        isLoading = true
        errorMessage = nil

        Task {
            do {
                if isSignUp {
                    try await supabase.signUp(email: email, password: password)
                    // After sign up, sign them in automatically
                    try await supabase.signIn(email: email, password: password)
                } else {
                    try await supabase.signIn(email: email, password: password)
                }
            } catch {
                errorMessage = error.localizedDescription
            }
            isLoading = false
        }
    }
}

#Preview {
    LoginView()
        .environmentObject(SupabaseService())
}
```

---

## 4.2 — Onboarding View (Company Setup)

This screen appears after first login — it asks for company info and fee settings.

**Right-click** on `Views/Auth/` → **New File** → **SwiftUI View** → name it `OnboardingView`

```swift
import SwiftUI

struct OnboardingView: View {
    @EnvironmentObject var supabase: SupabaseService
    @Binding var hasCompletedOnboarding: Bool

    // Company info
    @State private var companyName = ""
    @State private var mcNumber = ""
    @State private var dotNumber = ""
    @State private var phone = ""

    // Fee defaults
    @State private var driverPayPct = "25"
    @State private var dispatcherFeePct = "5"
    @State private var factoringFeePct = "3"
    @State private var authorityFee = "50"
    @State private var maintenanceReserve = "100"

    @State private var currentStep = 1
    @State private var isLoading = false

    var body: some View {
        NavigationStack {
            VStack {
                // Progress indicator
                HStack(spacing: 8) {
                    ForEach(1...2, id: \.self) { step in
                        Capsule()
                            .fill(step <= currentStep ? Color.blue : Color.gray.opacity(0.3))
                            .frame(height: 4)
                    }
                }
                .padding(.horizontal, 32)
                .padding(.top, 16)

                if currentStep == 1 {
                    companyInfoStep
                } else {
                    feeConfigStep
                }
            }
            .navigationTitle(currentStep == 1 ? "Company Info" : "Fee Settings")
            .navigationBarTitleDisplayMode(.large)
        }
    }

    // MARK: - Step 1: Company Info

    private var companyInfoStep: some View {
        VStack(spacing: 20) {
            Text("Let's set up your company profile. This info appears on your paystubs.")
                .font(.subheadline)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
                .padding(.horizontal, 32)
                .padding(.top, 8)

            VStack(spacing: 16) {
                VStack(alignment: .leading, spacing: 4) {
                    Text("Company Name")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                    TextField("e.g. Sacred Pathway LLC", text: $companyName)
                        .textFieldStyle(.roundedBorder)
                }

                VStack(alignment: .leading, spacing: 4) {
                    Text("MC Number (optional)")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                    TextField("e.g. MC-123456", text: $mcNumber)
                        .textFieldStyle(.roundedBorder)
                }

                VStack(alignment: .leading, spacing: 4) {
                    Text("DOT Number (optional)")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                    TextField("e.g. 1234567", text: $dotNumber)
                        .textFieldStyle(.roundedBorder)
                }

                VStack(alignment: .leading, spacing: 4) {
                    Text("Phone (optional)")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                    TextField("e.g. 555-555-5555", text: $phone)
                        .textFieldStyle(.roundedBorder)
                        .keyboardType(.phonePad)
                }
            }
            .padding(.horizontal, 32)

            Spacer()

            Button(action: { currentStep = 2 }) {
                Text("Next")
                    .fontWeight(.semibold)
                    .frame(maxWidth: .infinity)
                    .frame(height: 44)
            }
            .buttonStyle(.borderedProminent)
            .padding(.horizontal, 32)
            .padding(.bottom, 24)
        }
    }

    // MARK: - Step 2: Fee Configuration

    private var feeConfigStep: some View {
        VStack(spacing: 20) {
            Text("Set your default fee structure. You can change these anytime in Settings.")
                .font(.subheadline)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
                .padding(.horizontal, 32)
                .padding(.top, 8)

            VStack(spacing: 16) {
                feeRow(label: "Driver Pay", value: $driverPayPct, suffix: "%")
                feeRow(label: "Dispatcher Fee", value: $dispatcherFeePct, suffix: "%")
                feeRow(label: "Factoring Fee", value: $factoringFeePct, suffix: "%")
                feeRow(label: "Authority Fee", value: $authorityFee, suffix: "$/mo")
                feeRow(label: "Maintenance Reserve", value: $maintenanceReserve, suffix: "$/settlement")
            }
            .padding(.horizontal, 32)

            Spacer()

            VStack(spacing: 12) {
                Button(action: saveOnboarding) {
                    if isLoading {
                        ProgressView()
                            .frame(maxWidth: .infinity)
                            .frame(height: 44)
                    } else {
                        Text("Finish Setup")
                            .fontWeight(.semibold)
                            .frame(maxWidth: .infinity)
                            .frame(height: 44)
                    }
                }
                .buttonStyle(.borderedProminent)
                .disabled(isLoading)

                Button("Back") { currentStep = 1 }
                    .font(.subheadline)
            }
            .padding(.horizontal, 32)
            .padding(.bottom, 24)
        }
    }

    private func feeRow(label: String, value: Binding<String>, suffix: String) -> some View {
        HStack {
            Text(label)
                .font(.subheadline)
            Spacer()
            HStack(spacing: 4) {
                TextField("0", text: value)
                    .textFieldStyle(.roundedBorder)
                    .frame(width: 70)
                    .keyboardType(.decimalPad)
                    .multilineTextAlignment(.trailing)
                Text(suffix)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .frame(width: 80, alignment: .leading)
            }
        }
    }

    private func saveOnboarding() {
        isLoading = true
        Task {
            do {
                try await supabase.updateProfile([
                    "company_name": AnyEncodable(companyName.isEmpty ? nil as String? : companyName),
                    "mc_number": AnyEncodable(mcNumber.isEmpty ? nil as String? : mcNumber),
                    "dot_number": AnyEncodable(dotNumber.isEmpty ? nil as String? : dotNumber),
                    "phone": AnyEncodable(phone.isEmpty ? nil as String? : phone),
                    "driver_pay_percentage": AnyEncodable(Double(driverPayPct) ?? 25.0),
                    "dispatcher_fee_percentage": AnyEncodable(Double(dispatcherFeePct) ?? 5.0),
                    "factoring_fee_percentage": AnyEncodable(Double(factoringFeePct) ?? 3.0),
                    "authority_fee": AnyEncodable(Double(authorityFee) ?? 50.0),
                    "maintenance_reserve": AnyEncodable(Double(maintenanceReserve) ?? 100.0),
                ])
                hasCompletedOnboarding = true
            } catch {
                print("Error saving onboarding: \(error)")
            }
            isLoading = false
        }
    }
}

#Preview {
    OnboardingView(hasCompletedOnboarding: .constant(false))
        .environmentObject(SupabaseService())
}
```

---

## ✅ Checkpoint

You should now have two new files:
- `Views/Auth/LoginView.swift`
- `Views/Auth/OnboardingView.swift`

**Try building now:** Press **Cmd + B** (this builds without running). You'll still see an error in `SacredPathwayApp.swift` about `ContentView` — that's fine, we fix it in Step 5.

**Move on to Step 5 when ready.**
