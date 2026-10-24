import { Hero, Section, SectionHeading, Prose, CtaBand } from "@/components/marketing";

export const metadata = { title: "AI interview technology" };

export default function AiInterviews() {
  return (
    <>
      <Hero eyebrow="AI interviews" title="Consistent interviews that candidates understand" lead="Every candidate gets the same job-related questions, a clear explanation of how the interview works, and options to type answers or request accommodations." primary={{ href: "/register/organisation", label: "Configure an interview" }} />
      <Section>
        <div className="grid gap-6 md:grid-cols-2">
          {[
            { t: "Real-time conversational", d: "The interviewer speaks, listens and responds — asking a limited number of follow-ups when an answer lacks the specifics a competency needs, repeating or clarifying on request, and ending on time. Turn-taking, follow-up limits and the question plan are enforced on the server, not left to the model." },
            { t: "Structured question-by-question", d: "One question at a time with optional preparation time, a visible answer timer, configurable retakes and resumable progress. Questions can be read aloud or displayed; answers can be recorded or typed." },
          ].map((x) => (
            <div key={x.t} className="rounded-xl border border-border bg-surface p-6">
              <h2 className="text-xl font-semibold">{x.t}</h2>
              <p className="mt-2 text-sm leading-relaxed text-subtle">{x.d}</p>
            </div>
          ))}
        </div>
      </Section>
      <Section className="pt-0">
        <SectionHeading title="What we deliberately don't do" />
        <Prose>
          <ul>
            <li>No inference of personality, honesty, emotional state, intelligence or “culture fit”.</li>
            <li>No use of accent, dialect, vocal tone, speaking speed, facial appearance or video.</li>
            <li>No single opaque score. Ratings are per competency, with the candidate&apos;s own words as evidence.</li>
            <li>No automated rejection. A human reviewer confirms, adjusts (with a reason) or rejects the AI output.</li>
            <li>No simulated interviews. If an AI provider isn&apos;t configured, the platform says so instead of pretending.</li>
          </ul>
          <h2>Reliability</h2>
          <p>Sessions follow a server-enforced state machine (invited → ready → in progress → processing → assessed → reviewed), with interruption recovery, idempotent submissions, provider timeouts and retries, and queue-based assessment. Credits are reserved when an invitation is sent and released automatically if the interview is cancelled, expires unused or fails for reasons on our side.</p>
          <h2>Validation</h2>
          <p>AI-assisted assessment should be validated against job-related outcomes and audited for adverse impact before it influences hiring decisions in your organisation. We provide the evidence trail and version history needed for that work; we do not claim the scores are objectively accurate.</p>
        </Prose>
      </Section>
      <CtaBand title="Try both interview modes" lead="Create a template, invite yourself as a candidate and experience it end to end." primary={{ href: "/register/organisation", label: "Start a trial" }} />
    </>
  );
}
