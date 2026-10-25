import Link from "next/link";
import { requirePlatformPage } from "@/server/auth/page";
import { getPersonalAiAccess } from "@/server/services/ai-admin";
import { PageHeader } from "@/components/ui/card";
import { Alert } from "@/components/ui/feedback";
import { AiGrantEditor } from "@/components/admin/ai-access";
import { AiAccessPanels } from "@/components/admin/ai-detail";

export default async function PersonalAiAccess() {
  const s = await requirePlatformPage("platform.ai.view");
  const d = await getPersonalAiAccess(s);
  return (
    <>
      <PageHeader breadcrumb={<Link href="/admin/ai" className="hover:underline">AI access</Link>} title="AI access — personal accounts" description="Student practice coaching, resume parsing and practice transcription. Always platform-funded; limits are shared by all personal accounts." />
      <Alert tone="info" className="mb-6">Students never use an employer&apos;s keys or grants. Without a grant here, practice interviews and AI resume parsing are unavailable (resume upload still works with basic extraction).</Alert>
      <AiGrantEditor endpoint="/platform/ai/personal/grants" capabilities={d.capabilities} grants={JSON.parse(JSON.stringify(d.grants))} catalog={d.catalog} deployment={d.deployment} canManage={d.canManage} />
      <AiAccessPanels usage={d.usage} recentErrors={d.recentErrors} history={JSON.parse(JSON.stringify(d.history))} />
    </>
  );
}
