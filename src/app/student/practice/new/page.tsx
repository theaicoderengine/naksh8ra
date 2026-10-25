import { requireVerifiedPage } from "@/server/auth/page";
import { practiceBalance } from "@/server/services/practice";
import { describeAi } from "@/server/ai/access";
import { PageHeader, Card, CardBody } from "@/components/ui/card";
import { Alert } from "@/components/ui/feedback";
import { NewPracticeForm } from "@/components/student/practice";

export default async function NewPractice() {
  const s = await requireVerifiedPage();
  const [bal, ai] = await Promise.all([practiceBalance(s.user.id), describeAi({ kind: "PERSONAL", userId: s.user.id }, "PRACTICE_COACHING")]);
  return (
    <>
      <PageHeader title="New practice interview" description={`${bal.available} session(s) available.`} />
      {!ai.available && <Alert tone="warning" className="mb-4" title="Practice is temporarily unavailable">AI practice hasn&apos;t been enabled on this platform yet.</Alert>}
      <Card><CardBody className="p-6"><NewPracticeForm /></CardBody></Card>
    </>
  );
}
