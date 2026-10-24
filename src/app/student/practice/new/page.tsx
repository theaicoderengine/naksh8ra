import { requireVerifiedPage } from "@/server/auth/page";
import { practiceBalance } from "@/server/services/practice";
import { llmStatus } from "@/server/providers/llm";
import { PageHeader, Card, CardBody } from "@/components/ui/card";
import { Alert } from "@/components/ui/feedback";
import { NewPracticeForm } from "@/components/student/practice";

export default async function NewPractice() {
  const s = await requireVerifiedPage();
  const [bal, ai] = [await practiceBalance(s.user.id), llmStatus()];
  return (
    <>
      <PageHeader title="New practice interview" description={`${bal.available} session(s) available.`} />
      {!ai.configured && <Alert tone="warning" className="mb-4" title="Practice is temporarily unavailable">The AI service isn&apos;t configured on this platform yet.</Alert>}
      <Card><CardBody className="p-6"><NewPracticeForm /></CardBody></Card>
    </>
  );
}
