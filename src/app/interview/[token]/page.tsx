import { InterviewRoom } from "@/components/interview/interview-room";

export default async function TokenInterview({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <InterviewRoom token={token} />;
}
