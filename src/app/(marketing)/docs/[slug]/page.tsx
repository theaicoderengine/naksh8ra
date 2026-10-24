import { notFound } from "next/navigation";
import { Section, Prose } from "@/components/marketing";

const DOCS: Record<string, { title: string; body: React.ReactNode }> = {
  "getting-started": {
    title: "Getting started",
    body: (
      <>
        <h2>1. Create your workspace</h2>
        <p>Register with your work email, verify it, then complete the organisation setup: details, plan or trial, and acceptance of the customer terms.</p>
        <h2>2. Invite your team</h2>
        <p>Go to <strong>Team</strong> and invite colleagues by email with a role: HR admin, recruiter, hiring manager or interview reviewer. Invitations are single-use, expire after 7 days and can only be accepted by the invited email address. Seats are limited by your plan.</p>
        <h2>3. Publish a vacancy</h2>
        <p>Create a job under <strong>Jobs</strong>. You can generate a draft description with AI, but you must confirm you&apos;ve reviewed it before publishing. Assign a hiring team so recruiters and hiring managers can see the vacancy.</p>
        <h2>4. Configure an interview</h2>
        <p>Under <strong>Interview templates</strong>, choose the mode, duration, number of questions, competencies and accessibility options. Write questions or ask for AI suggestions to edit.</p>
        <h2>5. Invite candidates</h2>
        <p>From an application, choose <strong>Send AI interview</strong>. One credit is reserved; it&apos;s released automatically if the interview is cancelled, expires unused or fails on our side.</p>
        <h2>6. Review evidence and decide</h2>
        <p>Open the interview to see the transcript, per-competency evidence and uncertainty flags. Confirm, adjust (with a reason) or reject the AI output, then move the candidate through your pipeline.</p>
      </>
    ),
  },
  interviews: {
    title: "Interviews & assessment",
    body: (
      <>
        <h2>Modes</h2>
        <p><strong>Real-time conversational</strong>: spoken turn-taking with limited follow-ups. <strong>Structured</strong>: one question at a time with timers and optional retakes. Both support typed answers when enabled.</p>
        <h2>Session lifecycle</h2>
        <p>Created → Invited → Ready (notice accepted) → In progress → Processing → Assessed → Reviewed → Closed, plus Interrupted (resumable), Requires review, Expired, Cancelled and Failed.</p>
        <h2>Assessment</h2>
        <p>Each competency receives a rating on a five-level rubric or “Insufficient evidence”. Ratings must cite verbatim excerpts from the candidate&apos;s answers; excerpts that can&apos;t be found in the transcript are flagged and the result requires review. Model, prompt and rubric versions are stored with every result.</p>
        <h2>Billing rules</h2>
        <ul>
          <li>Reserve on invitation.</li>
          <li>Consume when the interview completes with at least one answer (including an interrupted interview that expires after partial answers).</li>
          <li>Release on cancellation, candidate withdrawal, expiry without answers, or platform/provider failure.</li>
        </ul>
      </>
    ),
  },
  students: {
    title: "For students",
    body: (
      <>
        <h2>Your profile</h2>
        <p>Add education, skills, projects, experience and resumes. Your profile is private; employers receive a snapshot only when you apply, and you preview it first.</p>
        <h2>Practice interviews</h2>
        <p>Practise for any role and receive coaching feedback. Practice audio is transcribed and discarded; sessions are never visible to employers and use only your own practice allowance.</p>
        <h2>Privacy</h2>
        <p>Download your data or delete your account from <strong>Settings → Privacy</strong>. Employers you applied to are informed of deletion requests so they can action their own records.</p>
      </>
    ),
  },
};

export default async function DocPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const d = DOCS[slug];
  if (!d) notFound();
  return (
    <Section>
      <h1 className="mb-6 text-3xl font-semibold">{d.title}</h1>
      <Prose>{d.body}</Prose>
    </Section>
  );
}
