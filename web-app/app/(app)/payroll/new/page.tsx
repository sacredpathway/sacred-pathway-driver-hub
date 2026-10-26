// /payroll/new — retired. Web paystubs are read-only legacy history; new
// payroll is created as a settlement (the iPhone settlement model).
// NewPaystubForm.tsx is kept in the tree, unmounted, for reference.
import { redirect } from "next/navigation";

export default async function NewPaystubPage({ searchParams }: { searchParams: Promise<{ driver?: string }> }) {
  const sp = await searchParams;
  const driver = sp.driver && /^[0-9a-f-]{36}$/i.test(sp.driver) ? `?driver=${sp.driver}` : "";
  redirect(`/settlements/new${driver}`);
}
