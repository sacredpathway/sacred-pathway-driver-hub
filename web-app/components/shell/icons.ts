// lucide-react icons for nav keys (icon library, not hand-drawn artwork).
import {
  LayoutDashboard, Truck, Users, Container, Building2, Contact, Receipt, Wallet,
  CreditCard, BarChart3, FileText, UsersRound, Settings,
  type LucideIcon,
} from "lucide-react";
import type { NavIconKey } from "@/lib/nav/config";

export const NAV_ICONS: Record<NavIconKey, LucideIcon> = {
  dashboard: LayoutDashboard,
  loads: Truck,
  drivers: Users,
  fleet: Container,
  brokers: Building2,
  contacts: Contact,
  settlements: Receipt,
  payroll: Wallet,
  expenses: CreditCard,
  reports: BarChart3,
  documents: FileText,
  team: UsersRound,
  settings: Settings,
};
