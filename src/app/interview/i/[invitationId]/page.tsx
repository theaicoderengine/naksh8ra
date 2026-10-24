import { requireVerifiedPage } from "@/server/auth/page";
import { InterviewRoom } from "@/components/interview/interview-room";

/** Signed-in applicants open their interview from the dashboard without the emailed token. */
export default async function AccountInterview({ params }: { params: Promise<{ invitationId: string }> }) {
  const { invitationId } = await params;
  await requireVerifiedPage();
  return <InterviewRoom invitationId={invitationId} />;
}
