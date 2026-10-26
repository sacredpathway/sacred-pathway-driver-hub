// =============================================================================
//  /documents/[id]/payroll — Smart Payroll Upload review (owner only)
// -----------------------------------------------------------------------------
//  Shows the original document, every extracted value with its page, quoted
//  text and the model's own confidence label, the matching load record side by
//  side, conflicts, missing values and the owner's corrections. Confirming
//  prepares a DRAFT only, and is disabled outside a local test database.
// =============================================================================

import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import PageHeader from "@/components/ui/PageHeader";
import { resolveToday } from "@/lib/settlements/workflow";
import { buildPayrollProposal, ForeignDocumentError } from "@/lib/payrollUpload/proposal";
import { isCarrierOwnerAccount } from "@/lib/payrollUpload/carrierIdentity";
import { payrollConfirmGate } from "@/lib/payrollUpload/featureFlag";
import { getCarrierProfile, getProposalDocument, readProposalInput } from "@/lib/payrollUpload/server";
import PayrollReview from "./PayrollReview";

export default async function PayrollReviewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) notFound();

  const profile = await getCarrierProfile(supabase, user.id);
  if (!isCarrierOwnerAccount(profile)) {
    return (
      <div className="space-y-4">
        <PageHeader title="Payroll review" />
        <p className="rounded-lg border border-sp-border bg-sp-card p-4 text-sm text-sp-textSecondary">Only the carrier owner account can review payroll documents.</p>
      </div>
    );
  }
  const doc = await getProposalDocument(supabase, user.id, id);
  if (!doc) notFound();

  let proposal;
  try {
    proposal = buildPayrollProposal(await readProposalInput(supabase, doc, profile!, {}, resolveToday(null, new Date())));
  } catch (e) {
    if (e instanceof ForeignDocumentError) notFound();
    throw e;
  }

  let previewUrl: string | null = null;
  if (doc.storage_path) {
    const { data } = await supabase.storage.from("documents").createSignedUrl(doc.storage_path, 60 * 30);
    previewUrl = data?.signedUrl ?? null;
  }
  const gate = payrollConfirmGate(process.env, { profileId: user.id });

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow={<Link href="/documents" className="hover:underline">Documents</Link>}
        title="Payroll review"
        subtitle="Check what was read from the paperwork against your records. Nothing is saved until you confirm, and confirming only prepares a draft."
      />
      <PayrollReview
        documentId={id}
        initial={proposal}
        previewUrl={previewUrl}
        previewMime={doc.file_mime_type ?? null}
        gate={gate}
      />
    </div>
  );
}
