import { requireVerifiedPage } from "@/server/auth/page";
import { listPublicPlans } from "@/server/services/billing";
import { OrgWizard } from "@/components/onboarding/org-wizard";

export const dynamic = "force-dynamic";

export default async function OrgOnboarding({ searchParams }: { searchParams: Promise<{ type?: string; plan?: string }> }) {
  await requireVerifiedPage();
  const { type, plan } = await searchParams;
  const t = type === "UNIVERSITY" ? "UNIVERSITY" : "EMPLOYER";
  const { plans } = await listPublicPlans(t);
  return <OrgWizard type={t} plans={JSON.parse(JSON.stringify(plans))} defaultPlan={plan} />;
}
