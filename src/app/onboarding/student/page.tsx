import { redirect } from "next/navigation";
import { requireVerifiedPage } from "@/server/auth/page";
import { ensureStudentProfile } from "@/server/services/students";
import { StudentWizard } from "@/components/onboarding/student-wizard";

export const dynamic = "force-dynamic";

export default async function StudentOnboarding() {
  const s = await requireVerifiedPage();
  const p = await ensureStudentProfile(s);
  if (p.onboardingCompletedAt) redirect("/student");
  return <StudentWizard />;
}
