// =============================================================================
//  Domain types — mirror the iOS Codable models 1:1.
// -----------------------------------------------------------------------------
//  Phase W1 is read-only, so we only need decode-shape types. Anything the
//  iOS app sets as `var foo: T?` is `foo: T | null` here (PostgREST returns
//  null, not undefined). Snake_case at the table level → camelCase view
//  models is done in lib/supabase/server.ts via per-query .select() rather
//  than a giant generated Database type — keeps W1 dependency-light.
// =============================================================================

export type UUID = string;
export type ISODate = string;

export interface Load {
  id: UUID;
  profile_id: UUID;
  driver_id: UUID | null;
  load_number: string | null;
  broker_name: string | null;
  broker_mc_number: string | null;
  pickup_date: ISODate | null;
  delivery_date: ISODate | null;
  origin: string | null;
  destination: string | null;
  total_miles: number | null;
  line_haul_rate: number | null;
  fuel_surcharge: number | null;
  accessorial_charges: number | null;
  total_revenue: number | null;
  status: string | null;
  broker_id: UUID | null;
  broker_contact_id: UUID | null;
  broker_contact_name: string | null;
  broker_contact_phone: string | null;
  broker_phone_extension: string | null;
  broker_contact_email: string | null;
  // Fleet linkage — added in 20260523 (W3 step 3). Both nullable.
  truck_id: UUID | null;
  trailer_id: UUID | null;
  created_at: ISODate | null;
  updated_at: ISODate | null;
}

export interface Broker {
  id: UUID;
  profile_id: UUID;
  broker_name: string;
  normalized_name: string | null;
  mc_number: string | null;
  total_loads: number | null;
  total_revenue: number | null;
  created_at: ISODate | null;
  updated_at: ISODate | null;
}

export interface BrokerContact {
  id: UUID;
  broker_id: UUID;
  contact_name: string;
  email: string | null;
  phone: string | null;
  phone_extension: string | null;
  created_at: ISODate | null;
  last_interaction_at: ISODate | null;
}

export interface Expense {
  id: UUID;
  load_id: UUID | null;
  profile_id: UUID;
  category: string;
  amount: number;
  vendor_name: string | null;
  description: string | null;
  gallons: number | null;
  price_per_gallon: number | null;
  def_gallons: number | null;
  def_price_per_gallon: number | null;
  def_total: number | null;
  receipt_date: ISODate | null;
  created_at: ISODate | null;
}

export interface Settlement {
  id: UUID;
  profile_id: UUID;
  driver_id: UUID | null;
  settlement_period_start: ISODate | null;
  settlement_period_end: ISODate | null;
  total_revenue: number | null;
  total_expenses: number | null;
  gross_profit: number | null;
  net_pay: number | null;
  pdf_storage_path: string | null;
  status: string | null;
  /** Optional FK to a web-generated paystub that supersedes this legacy row. */
  paystub_id: UUID | null;
  created_at: ISODate | null;
}

export interface TruckDocument {
  id: UUID;
  profile_id: UUID;
  load_id: UUID | null;
  document_type: string | null;
  storage_path: string;
  status: string | null;
  created_at: ISODate | null;
}

export type PaystubTheme =
  | "navy_gold"
  | "forest_gold"
  | "black_silver"
  | "blue_gray";

export const PAYSTUB_THEMES: ReadonlyArray<PaystubTheme> = [
  "navy_gold",
  "forest_gold",
  "black_silver",
  "blue_gray",
];

// Carrier-Sponsored Driver Access — multi-user foundation.
export type CarrierMemberRole = "driver" | "admin";
export type CarrierMemberStatus = "active" | "removed";

export interface CarrierInvite {
  id: UUID;
  carrier_profile_id: UUID;
  invite_code: string;
  email: string | null;
  role: CarrierMemberRole;
  created_by_user_id: UUID | null;
  created_at: ISODate | null;
  expires_at: ISODate | null;
  revoked_at: ISODate | null;
  max_uses: number;
  use_count: number;
  notes: string | null;
  /** Set by inviteDriverAction so accept_carrier_invite() can copy it
   *  into carrier_members.linked_driver_id on acceptance. Nullable for
   *  legacy invites created before 20260528 migration. */
  linked_driver_id: UUID | null;
}

export interface CarrierMember {
  id: UUID;
  carrier_profile_id: UUID;
  user_id: UUID;
  role: CarrierMemberRole;
  status: CarrierMemberStatus;
  invite_id: UUID | null;
  linked_driver_id: UUID | null;
  joined_at: ISODate | null;
  removed_at: ISODate | null;
  removed_by_user_id: UUID | null;
  notes: string | null;
}

export interface Profile {
  id: UUID;
  company_name: string | null;
  mc_number: string | null;
  dot_number: string | null;
  phone: string | null;
  subscription_tier: string | null;
  /** Carrier-Sponsored Driver Access: distinguishes carrier-owned profiles
   *  from driver-owned ones. NULL on every pre-existing row (all carriers).
   *  Set to 'driver' when a new driver creates an account via the join flow. */
  account_type: "carrier" | "driver" | null;

  // -- Fee defaults (base schema; iOS owns these too) ----------------------
  driver_pay_percentage: number | null;
  dispatcher_fee_percentage: number | null;
  factoring_fee_percentage: number | null;
  authority_fee: number | null;
  maintenance_reserve: number | null;
  pay_basis: string | null;

  // -- Carrier HQ Phase W4 branding + company columns ----------------------
  logo_storage_path: string | null;
  paystub_theme: PaystubTheme | null;
  paystub_footer_legal: string | null;
  company_address: string | null;
  company_city: string | null;
  company_state: string | null;
  company_zip: string | null;
  company_ein: string | null;
}

// =============================================================================
//  Drivers — dual classification (1099 + W2)
//  -----------------------------------------------------------------------------
//  Mirrors the iOS Driver model PLUS every column added in
//  20260521000000_drivers_dual_worker_type.sql. Every new field is nullable
//  so existing iOS-created rows decode cleanly.
// =============================================================================

export type WorkerType = "1099" | "W2";

export type EmploymentStatus = "active" | "on_leave" | "terminated";

export type PayFrequency = "weekly" | "biweekly" | "semimonthly" | "monthly";

export type CompType = "hourly" | "salary" | "mileage" | "per_load";

export type FilingStatus =
  | "single"
  | "married"
  | "married_separate"
  | "head_of_household";

export interface Driver {
  id: UUID;
  profile_id: UUID;
  name: string;
  truck_number: string | null;
  pay_percentage: number | null;
  /** "percent" or "flat" — backward compat with iOS. */
  pay_type: string | null;
  flat_rate: number | null;
  phone: string | null;
  email: string | null;
  active: boolean | null;
  created_at: ISODate | null;

  // ---- Dual classification + 1099 escrow ----
  worker_type: WorkerType;
  escrow_per_settlement: number | null;
  escrow_balance: number | null;

  // ---- W2 compensation ----
  employment_status: EmploymentStatus | null;
  pay_frequency: PayFrequency | null;
  comp_type: CompType | null;
  hourly_rate: number | null;
  salary_annual: number | null;
  mileage_rate: number | null;
  per_load_rate: number | null;
  per_diem_daily: number | null;
  overtime_multiplier: number | null;

  // ---- Tax setup placeholders ----
  filing_status: FilingStatus | null;
  federal_allowances: number | null;
  w4_extra_withholding: number | null;
  state_code: string | null;
  state_allowances: number | null;
  ssn_encrypted: string | null;
  ein: string | null;

  // ---- HR & contact ----
  hire_date: ISODate | null;
  termination_date: ISODate | null;
  dob: ISODate | null;
  address: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  emergency_contact_name: string | null;
  emergency_contact_phone: string | null;
  cdl_number: string | null;
  cdl_state: string | null;
  cdl_expiration: ISODate | null;
}

// =============================================================================
//  Unified Paystub model — written by the web for BOTH worker types.
//  iOS continues to write to the legacy `settlements` table.
// =============================================================================

export type PaystubStatus = "draft" | "issued" | "paid" | "voided";

export type PaymentMethod =
  | "ach"
  | "zelle"
  | "cash"
  | "check"
  | "direct_deposit"
  | "other";

export interface Paystub {
  id: UUID;
  profile_id: UUID;
  driver_id: UUID;
  /** Snapshotted at creation so reclassifying a driver never rewrites history. */
  worker_type: WorkerType;
  paystub_number: string | null;
  pay_period_start: ISODate;
  pay_period_end: ISODate;
  check_date: ISODate | null;
  status: PaystubStatus;
  payment_method: PaymentMethod | null;
  check_number: string | null;

  // Totals
  gross_earnings: number | null;
  total_pretax_deductions: number | null;
  /** W2 only; NULL on 1099 paystubs. */
  taxable_wages: number | null;
  /** W2 only; 0 on 1099 paystubs. */
  total_taxes_withheld: number | null;
  total_posttax_deductions: number | null;
  total_reimbursements: number | null;
  /** 1099 only. */
  total_settlement_deductions: number | null;
  net_pay: number;

  // YTD snapshots
  ytd_gross_earnings: number | null;
  ytd_taxable_wages: number | null;
  ytd_taxes_withheld: number | null;
  ytd_net_pay: number | null;

  pdf_storage_path: string | null;
  emailed_to: string[] | null;
  emailed_at: ISODate | null;

  created_by_user_id: UUID | null;
  notes: string | null;
  created_at: ISODate | null;
  updated_at: ISODate | null;
}

export type PaystubEarningKind =
  | "regular"
  | "overtime"
  | "doubletime"
  | "holiday"
  | "sick"
  | "vacation"
  | "bonus"
  | "commission"
  | "per_diem"
  | "mileage"
  | "per_load"
  | "settlement_gross"
  | "detention"
  | "layover"
  | "accessorial"
  | "reimbursement"
  | "other";

export interface PaystubEarning {
  id: UUID;
  paystub_id: UUID;
  profile_id: UUID;
  kind: PaystubEarningKind;
  label: string;
  hours: number | null;
  units: number | null;
  rate: number | null;
  amount: number;
  is_taxable: boolean;
  load_id: UUID | null;
  ytd_amount: number | null;
  notes: string | null;
  created_at: ISODate | null;
}

export type PaystubDeductionKind =
  // pre-tax (W2)
  | "401k"
  | "401k_roth"
  | "health_premium"
  | "dental_premium"
  | "vision_premium"
  | "hsa"
  | "fsa"
  | "commuter"
  | "life_insurance"
  | "disability"
  // post-tax (W2 + 1099)
  | "garnishment"
  | "child_support"
  | "union_dues"
  | "loan_repayment"
  | "uniform"
  | "advance_repayment"
  | "other";

export interface PaystubDeduction {
  id: UUID;
  paystub_id: UUID;
  profile_id: UUID;
  kind: PaystubDeductionKind;
  label: string;
  amount: number;
  is_pre_tax: boolean;
  ytd_amount: number | null;
  notes: string | null;
  created_at: ISODate | null;
}

export type PaystubTaxKind =
  | "federal_income"
  | "state_income"
  | "local_income"
  | "social_security"
  | "medicare"
  | "medicare_additional"
  | "sui"
  | "sdi"
  | "futa"
  | "suta"
  | "workers_comp"
  | "other";

export type PaystubTaxRateBasis = "manual" | "flat_percent" | "table_lookup";

export interface PaystubTax {
  id: UUID;
  paystub_id: UUID;
  profile_id: UUID;
  kind: PaystubTaxKind;
  jurisdiction: string | null;
  label: string;
  employee_amount: number;
  employer_amount: number;
  ytd_employee_amount: number | null;
  ytd_employer_amount: number | null;
  rate_basis: PaystubTaxRateBasis | null;
  notes: string | null;
  created_at: ISODate | null;
}

export type PaystubSettlementItemKind =
  | "escrow_deposit"
  | "escrow_release"
  | "advance"
  | "advance_repayment"
  | "fuel_advance"
  | "fuel_deduction"
  | "toll"
  | "maintenance"
  | "tire"
  | "permit"
  | "eld_lease"
  | "truck_lease"
  | "trailer_lease"
  | "plate"
  | "insurance"
  | "occupational_accident"
  | "cargo_insurance"
  | "chargeback"
  | "damage"
  | "claim"
  | "factoring_fee"
  | "dispatcher_fee"
  | "authority_fee"
  | "maintenance_reserve"
  | "reimbursement"
  | "bonus"
  | "detention_pay"
  | "layover_pay"
  | "other";

export type PaystubSettlementItemDirection = "deduct" | "add";

export interface PaystubSettlementItem {
  id: UUID;
  paystub_id: UUID;
  profile_id: UUID;
  kind: PaystubSettlementItemKind;
  label: string;
  amount: number;
  direction: PaystubSettlementItemDirection;
  load_id: UUID | null;
  ytd_amount: number | null;
  notes: string | null;
  created_at: ISODate | null;
}

// =============================================================================
//  Fleet — trucks + trailers (Phase W3 step 2)
// =============================================================================

export type FleetStatus = "active" | "inactive" | "maintenance" | "sold";

export type TrailerType =
  | "dry_van"
  | "reefer"
  | "flatbed"
  | "step_deck"
  | "tanker"
  | "lowboy"
  | "car_hauler"
  | "container"
  | "dump"
  | "hopper"
  | "other";

export interface Truck {
  id: UUID;
  profile_id: UUID;
  unit_number: string;
  make: string | null;
  model: string | null;
  year: number | null;
  vin: string | null;
  plate_number: string | null;
  state: string | null;
  status: FleetStatus;
  notes: string | null;
  created_at: ISODate | null;
  updated_at: ISODate | null;
}

export interface Trailer {
  id: UUID;
  profile_id: UUID;
  unit_number: string;
  trailer_type: TrailerType | null;
  make: string | null;
  model: string | null;
  year: number | null;
  vin: string | null;
  plate_number: string | null;
  state: string | null;
  status: FleetStatus;
  notes: string | null;
  created_at: ISODate | null;
  updated_at: ISODate | null;
}

/**
 * Read-only row shape from the `v_payroll_unified` SQL view. Combines new
 * paystubs (web) with legacy settlements (iOS) for unified history listing.
 */
export interface PayrollUnifiedRow {
  id: UUID;
  profile_id: UUID;
  driver_id: UUID | null;
  source: "paystub" | "legacy_settlement";
  worker_type: WorkerType;
  paystub_number: string | null;
  pay_period_start: ISODate | null;
  pay_period_end: ISODate | null;
  check_date: ISODate | null;
  status: string | null;
  payment_method: PaymentMethod | null;
  gross_earnings: number | null;
  net_pay: number | null;
  total_taxes_withheld: number | null;
  total_pretax_deductions: number | null;
  total_posttax_deductions: number | null;
  total_settlement_deductions: number | null;
  pdf_storage_path: string | null;
  created_at: ISODate | null;
}
