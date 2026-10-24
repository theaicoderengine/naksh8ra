import { Hero, Section, Prose } from "@/components/marketing";

export const metadata = { title: "Security & privacy" };

export default function Security() {
  return (
    <>
      <Hero eyebrow="Trust" title="Security and privacy, designed in" lead="How we protect candidate, student and employer data. This page describes controls implemented in the product; it is not a certification or a claim of legal compliance." />
      <Section>
        <Prose>
          <h2>Tenant isolation</h2>
          <p>Every organisation-owned record carries an organisation identifier. Access is resolved from your authenticated membership on the server — never from an identifier supplied by the browser — and the database enforces row-level security policies on every tenant table as a second, independent layer. Automated tests attempt cross-tenant access through IDs, URLs, search, file links, exports, reports and background jobs.</p>
          <h2>Accounts and access</h2>
          <ul>
            <li>Email verification, salted scrypt password hashing, login rate limiting and temporary lockout.</li>
            <li>TOTP multi-factor authentication, mandatory for platform administrators and enforceable per organisation.</li>
            <li>Server-side, revocable sessions in HttpOnly SameSite cookies; a new session on every login.</li>
            <li>Single-use, expiring invitation and reset tokens that are stored only as hashes.</li>
            <li>Role-based and resource-level permissions enforced by the API for every request.</li>
          </ul>
          <h2>Data protection</h2>
          <ul>
            <li>TLS in transit; encrypted storage at rest (database and object storage provider encryption) and application-level encryption for MFA secrets.</li>
            <li>Private object storage. Files are only downloadable through an authorised request with a short-lived link.</li>
            <li>Uploads are type-checked by content and can be malware-scanned before use.</li>
            <li>Logs redact credentials, tokens, transcripts and answer content.</li>
            <li>Platform support staff can see organisation metadata only, through time-boxed access you approve. There is no “view as user” capability.</li>
          </ul>
          <h2>Privacy</h2>
          <ul>
            <li>Candidates see a plain-language notice before every interview and choose whether audio is recorded.</li>
            <li>Students preview exactly what an employer receives before applying. Practice interviews are never shared with employers.</li>
            <li>Configurable retention for audio, transcripts, assessments, applications and resumes, enforced by scheduled jobs.</li>
            <li>Self-service data export and account deletion; requests to employers are forwarded to them as controllers.</li>
          </ul>
          <h2>Responsible AI</h2>
          <p>Assessments are limited to job-related competencies and the candidate&apos;s own words. We do not infer protected characteristics or use voice, accent, emotion or appearance. Outputs carry model, prompt and rubric versions, and a human reviewer is required before decisions.</p>
          <h2>Reporting a vulnerability</h2>
          <p>Please contact us through the <a className="text-primary underline" href="/contact">contact form</a> selecting “Support”, or the security address published in your customer agreement.</p>
        </Prose>
      </Section>
    </>
  );
}
