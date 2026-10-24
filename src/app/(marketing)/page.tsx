import { Mic, ListChecks, Scale, Users, GraduationCap, Building2, ShieldCheck, CreditCard, FileSearch, Globe2, Quote } from "lucide-react";
import { Hero, Section, SectionHeading, FeatureGrid, CtaBand } from "@/components/marketing";
import { Badge } from "@/components/ui/badge";
import { brand } from "@/lib/brand";

export default function Home() {
  return (
    <>
      <Hero
        eyebrow="AI recruitment platform"
        title={<>Structured AI interviews.<br className="hidden sm:block" /> Evidence you can check. Decisions people make.</>}
        lead={`${brand().name} helps hiring teams run consistent voice interviews at scale, turns answers into job-related evidence mapped to your rubric, and keeps every hiring decision with a human reviewer.`}
        primary={{ href: "/register/organisation", label: "Create your workspace" }}
        secondary={{ href: "/register/student", label: "I'm a student or graduate" }}
      >
        <div className="mt-14 grid gap-4 lg:grid-cols-[1.2fr_1fr]">
          <div className="rounded-xl border border-border bg-surface p-5 shadow-pop">
            <div className="flex items-center justify-between">
              <p className="text-sm font-semibold">Assessment evidence <span className="font-normal text-subtle">· illustrative example</span></p>
              <Badge tone="warning">Awaiting human review</Badge>
            </div>
            <div className="mt-4 space-y-3">
              {[
                { c: "Problem solving", r: "3 · Competent", q: "I profiled the slow endpoint, found it was re-querying per row, and batched the lookups." },
                { c: "Structured communication", r: "4 · Strong", q: "First I explained what the metric meant for their team, then walked through one real week of data." },
                { c: "Collaboration", r: "Insufficient evidence", q: null },
              ].map((x) => (
                <div key={x.c} className="rounded-lg border border-border p-3">
                  <div className="flex items-center justify-between text-sm"><span className="font-medium">{x.c}</span><span className="text-subtle">{x.r}</span></div>
                  {x.q ? (
                    <p className="mt-2 flex gap-2 text-sm text-subtle"><Quote className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />“{x.q}” <span className="text-xs text-success">✓ verbatim</span></p>
                  ) : (
                    <p className="mt-2 text-sm text-subtle">No answer addressed this competency. Insufficient evidence is not a low score.</p>
                  )}
                </div>
              ))}
            </div>
          </div>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-1">
            {[
              { t: "Two interview modes", d: "Real-time conversational voice or structured question-by-question audio — same evidence model." },
              { t: "Verbatim evidence", d: "Every rating cites the candidate's own words. Quotes are checked against the transcript." },
              { t: "No opaque scores", d: "No personality, emotion, accent or speaking-speed inference. Ever." },
            ].map((x) => (
              <div key={x.t} className="rounded-xl border border-border bg-surface p-5"><p className="font-semibold">{x.t}</p><p className="mt-1 text-sm text-subtle">{x.d}</p></div>
            ))}
          </div>
        </div>
      </Hero>

      <Section>
        <SectionHeading eyebrow="How it works" title="From vacancy to decision in one workflow" lead="Every step is permissioned, audited and tenant-isolated." />
        <ol className="grid gap-5 md:grid-cols-4">
          {[
            ["Publish", "Create the vacancy with job-related requirements. AI drafts are optional and always human-reviewed."],
            ["Configure", "Pick competencies and rubrics, interview mode, duration, retakes and accessibility options."],
            ["Interview", "Candidates get a clear notice, test their microphone, and can type answers or request accommodations."],
            ["Review & decide", "Reviewers see evidence, transcripts and uncertainty — then confirm, adjust or reject the AI output."],
          ].map(([t, d], i) => (
            <li key={t} className="rounded-lg border border-border bg-surface p-5">
              <span className="text-sm font-semibold text-primary">Step {i + 1}</span>
              <p className="mt-1 font-semibold">{t}</p>
              <p className="mt-1 text-sm text-subtle">{d}</p>
            </li>
          ))}
        </ol>
      </Section>

      <Section className="pt-0">
        <SectionHeading eyebrow="Platform" title="Everything recruitment teams need" />
        <FeatureGrid
          items={[
            { icon: Mic, title: "AI voice interviews", body: "Conversational or structured audio interviews with follow-ups, repetition, time limits, resumable sessions and typed-answer alternatives." },
            { icon: Scale, title: "Evidence-based assessment", body: "Versioned rubrics, verbatim evidence, uncertainty flags and mandatory human review with override reasons." },
            { icon: ListChecks, title: "Hiring pipeline", body: "Configurable stages, validated transitions, bulk actions, notes, reviewer feedback and full audit history." },
            { icon: Users, title: "Multi-user workspaces", body: "Owners, HR admins, recruiters, hiring managers and reviewers with assignment-scoped access." },
            { icon: GraduationCap, title: "Student portal", body: "Profiles, resumes, eligible opportunities, applications, interview invitations and private practice." },
            { icon: Building2, title: "Campus placement", body: "Universities manage programmes and cohorts with consent-gated, aggregate-only visibility." },
            { icon: FileSearch, title: "Resume parsing", body: "Validated uploads, malware scanning hook, conservative extraction and candidate corrections." },
            { icon: CreditCard, title: "Subscriptions & credits", body: "Plans, seats, monthly allowances and credit packs on an immutable, idempotent ledger." },
            { icon: ShieldCheck, title: "Security & privacy", body: "Row-level security, MFA, audit logs, retention policies, data export and deletion workflows." },
          ]}
        />
      </Section>

      <Section className="pt-0">
        <div className="grid gap-6 lg:grid-cols-3">
          {[
            { icon: Building2, t: "For employers", d: "Run consistent first-round interviews across teams and regions without losing the human decision.", href: "/solutions/enterprise" },
            { icon: GraduationCap, t: "For students", d: "Build your profile once, apply to eligible roles, and practise privately — practice is never shared.", href: "/solutions/graduates" },
            { icon: Globe2, t: "For universities", d: "Coordinate placement programmes and track cohort progress with student consent.", href: "/solutions/campus" },
          ].map((x) => (
            <a key={x.t} href={x.href} className="group rounded-xl border border-border bg-surface p-6 transition-shadow hover:shadow-pop">
              <x.icon className="h-6 w-6 text-primary" />
              <p className="mt-3 text-lg font-semibold">{x.t}</p>
              <p className="mt-1 text-sm text-subtle">{x.d}</p>
              <p className="mt-4 text-sm font-medium text-primary group-hover:underline">Learn more →</p>
            </a>
          ))}
        </div>
      </Section>

      <CtaBand title="Start with a free trial workspace" lead="Invite your team, configure a template and run your first interviews. Live AI requires your deployment's provider keys to be configured." primary={{ href: "/register/organisation", label: "Create workspace" }} secondary={{ href: "/contact", label: "Talk to sales" }} />
    </>
  );
}
