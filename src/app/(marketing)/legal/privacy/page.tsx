import { Section, Prose } from "@/components/marketing";
import { Alert } from "@/components/ui/feedback";
import { brand } from "@/lib/brand";

export const metadata = { title: "Privacy policy" };

export default function Privacy() {
  const b = brand();
  return (
    <Section>
      <h1 className="text-3xl font-semibold">Privacy policy</h1>
      <p className="mt-1 text-sm text-subtle">Version 2026-10-01</p>
      <Alert tone="warning" className="my-6" title="Template — requires legal review">Adapt this notice to your entity, lawful bases, regions and subprocessors with qualified counsel. It reflects how the software processes data by default.</Alert>
      <Prose>
        <h2>Roles</h2><p>When you apply to or interview with an employer, that employer is the controller of its recruitment records and {b.name} processes them on its behalf. For your own account (profile, resumes, practice, preferences), {b.legalEntity} is the controller.</p>
        <h2>What we collect</h2>
        <ul>
          <li>Account data: name, email, password hash, optional phone, locale and time zone.</li>
          <li>Profile data you add: education, skills, projects, experience, links and resumes.</li>
          <li>Application data you choose to share with an employer (you preview it before submitting).</li>
          <li>Interview data: answers (audio if you consent to recording, otherwise transcripts only), transcripts and AI-assisted assessments held by the employer.</li>
          <li>Practice interviews: transcripts and coaching feedback, visible only to you; practice audio is not stored.</li>
          <li>Technical data: IP address and user agent for security and audit purposes.</li>
        </ul>
        <h2>What we never do</h2><p>We don&apos;t sell personal data, don&apos;t make your profile public by default, don&apos;t share practice interviews with employers, and don&apos;t infer protected characteristics, emotions or personality from your voice or answers.</p>
        <h2>AI processing</h2><p>Answers are sent to configured AI and speech providers to transcribe and assess them against job-related criteria. Providers are bound by data processing terms; see the subprocessor list available on request.</p>
        <h2>Retention</h2><p>Employers configure retention for recruitment records within platform limits (by default, audio 180 days, transcripts and assessments 365 days, applications 2 years). Account data is kept until you delete your account. Backups expire on a rolling basis.</p>
        <h2>Your rights</h2><p>Depending on where you live you may have rights to access, correct, delete, restrict or object to processing, and to data portability. Use <em>Settings → Privacy</em> to export or delete your data; we forward requests concerning employer records to the relevant employer.</p>
        <h2>Contact</h2><p>{b.supportEmail}</p>
      </Prose>
    </Section>
  );
}
