import Link from "next/link";
import { notFound } from "next/navigation";
import { FileText, Mail, Phone, MapPin } from "lucide-react";
import { requirePageOrg } from "@/server/auth/page";
import { getApplication, listStages } from "@/server/services/applications";
import { listTemplates, listCompetencies } from "@/server/services/templates";
import { PageHeader, Card, CardHeader, CardBody } from "@/components/ui/card";
import { StatusBadge, Badge } from "@/components/ui/badge";
import { StageControl, InviteInterview, NoteForm, FeedbackForm, Disclosures, SessionRow } from "@/components/workspace/application-panels";
import { fmtDate, fmtDateTime, titleCase } from "@/lib/format";

type Shared = { name?: string; email?: string; phone?: string | null; location?: string | null; headline?: string | null; graduationYear?: number | null; education?: { institution: string; degree: string; fieldOfStudy: string | null; graduationYear: number | null }[]; skills?: string[]; experience?: { kind: string; organisation: string; title: string }[]; projects?: { title: string; url: string | null }[]; certifications?: { name: string; issuer: string | null }[]; links?: { label: string; url: string }[] };

export default async function ApplicationPage({ params }: { params: Promise<{ slug: string; id: string }> }) {
  const { slug, id } = await params;
  const ctx = await requirePageOrg(slug);
  const app = await getApplication(ctx, id).catch(() => notFound());
  const [stages, templates, comps] = await Promise.all([listStages(ctx), listTemplates(ctx), listCompetencies(ctx)]);
  const base = `/w/${slug}`;
  const sp = (app.sharedProfile ?? {}) as Shared;
  const c = app.candidate;
  const questions = (app.job.screeningQuestions as { id: string; question: string }[]) ?? [];
  const answers = (app.screeningAnswers as { id: string; answer: string }[]) ?? [];
  const activeInterview = app.sessions.some((s) => ["CREATED", "INVITED", "READY", "IN_PROGRESS", "INTERRUPTED"].includes(s.status));
  return (
    <>
      <PageHeader
        breadcrumb={<><Link href={`${base}/candidates`} className="hover:underline">Candidates</Link> / <Link href={`${base}/jobs/${app.job.id}`} className="hover:underline">{app.job.title}</Link></>}
        title={<span className="flex flex-wrap items-center gap-3">{c.firstName} {c.lastName}<StatusBadge status={app.status} /></span>}
        description={`${app.stage?.name ?? "No stage"} · ${titleCase(app.source)} · submitted ${fmtDate(app.submittedAt)}`}
        actions={<><StageControl appId={app.id} stageId={app.stageId} status={app.status} stages={stages.map((s) => ({ id: s.id, name: s.name, kind: s.kind }))} /><InviteInterview appId={app.id} templates={templates.map((t) => ({ id: t.id, name: t.name, mode: t.mode }))} defaultTemplateId={app.job.interviewTemplateId} disabled={activeInterview || ["HIRED", "REJECTED", "WITHDRAWN"].includes(app.status)} /></>}
      />
      <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
        <div className="space-y-6">
          <Card>
            <CardHeader title="AI interviews" description="Assessments are decision support. A human reviewer must confirm or adjust them." />
            <CardBody className="space-y-2">{app.sessions.length === 0 ? <p className="text-sm text-subtle">No interviews yet.</p> : app.sessions.map((s) => <SessionRow key={s.id} base={base} s={JSON.parse(JSON.stringify(s))} />)}</CardBody>
          </Card>
          {(questions.length > 0 || app.coverLetter) && (
            <Card><CardHeader title="Application" /><CardBody className="space-y-4 text-sm">
              {questions.map((q) => <div key={q.id}><p className="font-medium">{q.question}</p><p className="mt-1 whitespace-pre-line text-subtle">{answers.find((a) => a.id === q.id)?.answer || "—"}</p></div>)}
              {app.coverLetter && <div><p className="font-medium">Cover letter</p><p className="mt-1 whitespace-pre-line text-subtle">{app.coverLetter}</p></div>}
            </CardBody></Card>
          )}
          {ctx.can("feedback.write") && (
            <Card><CardHeader title="Structured reviewer feedback" description="Your own assessment, separate from the AI output." /><CardBody className="space-y-4">
              {app.feedback.map((f) => <div key={f.id} className="rounded-lg border border-border p-3 text-sm"><div className="flex justify-between"><span className="font-medium">{app.people[f.reviewerId] ?? "Reviewer"}</span><Badge>{f.recommendation.replace("_", " ").toLowerCase()}</Badge></div><p className="mt-1 whitespace-pre-line text-subtle">{f.summary}</p></div>)}
              <FeedbackForm appId={app.id} competencies={comps.map((x) => ({ id: x.id, name: x.name }))} />
            </CardBody></Card>
          )}
          <Card><CardHeader title="Feedback for the candidate" /><CardBody><Disclosures appId={app.id} items={JSON.parse(JSON.stringify(app.disclosures))} /></CardBody></Card>
        </div>
        <div className="space-y-6">
          <Card><CardHeader title="Candidate" description={app.sharedProfile ? "Snapshot the candidate shared when applying" : "Recorded by your team"} /><CardBody className="space-y-3 text-sm">
            <p className="flex items-center gap-2"><Mail className="h-4 w-4 text-subtle" aria-hidden="true" />{c.email}</p>
            {(sp.phone ?? c.phone) && <p className="flex items-center gap-2"><Phone className="h-4 w-4 text-subtle" aria-hidden="true" />{sp.phone ?? c.phone}</p>}
            {(sp.location ?? c.location) && <p className="flex items-center gap-2"><MapPin className="h-4 w-4 text-subtle" aria-hidden="true" />{sp.location ?? c.location}</p>}
            {(sp.headline ?? c.headline) && <p className="text-subtle">{sp.headline ?? c.headline}</p>}
            {sp.education?.length ? <div><p className="font-medium">Education</p>{sp.education.map((e, i) => <p key={i} className="text-subtle">{e.degree}, {e.institution}{e.graduationYear ? ` (${e.graduationYear})` : ""}</p>)}</div> : null}
            {sp.skills?.length ? <div className="flex flex-wrap gap-1">{sp.skills.map((s) => <Badge key={s}>{s}</Badge>)}</div> : null}
            {sp.experience?.length ? <div><p className="font-medium">Experience</p>{sp.experience.map((e, i) => <p key={i} className="text-subtle">{e.title}, {e.organisation} · {e.kind.toLowerCase()}</p>)}</div> : null}
            {sp.links?.length ? <div className="space-y-0.5">{sp.links.map((l) => <a key={l.url} href={l.url} rel="noopener noreferrer nofollow" target="_blank" className="block text-primary hover:underline">{l.label || l.url}</a>)}</div> : null}
            {app.files.map((f) => <a key={f.id} href={`/api/v1/files/${f.id}`} className="flex items-center gap-2 text-primary hover:underline"><FileText className="h-4 w-4" aria-hidden="true" />{f.fileName}{f.scanStatus === "NOT_SCANNED" && <Badge tone="warning" title="Malware scanning is not configured on this deployment">not scanned</Badge>}</a>)}
          </CardBody></Card>
          <Card><CardHeader title="History" /><CardBody>
            <ol className="space-y-3 border-l border-border pl-4 text-sm">
              {app.history.map((h) => <li key={h.id}><p><StatusBadge status={h.toStatus} /> <span className="text-subtle">{fmtDateTime(h.createdAt)}</span></p><p className="text-xs text-subtle">{h.actorUserId ? app.people[h.actorUserId] ?? "Candidate" : "System"}{h.reason ? ` — ${h.reason}` : ""}{h.visibleToCandidate ? " · shared with candidate" : ""}</p></li>)}
            </ol>
          </CardBody></Card>
          {ctx.can("notes.write") && (
            <Card><CardHeader title="Internal notes" /><CardBody className="space-y-3">
              <NoteForm appId={app.id} />
              {(app.notes || []).map((n) => <div key={n.id} className="rounded border border-border p-2.5 text-sm"><p className="whitespace-pre-line">{n.body}</p><p className="mt-1 text-xs text-subtle">{app.people[n.authorId] ?? "Member"} · {fmtDateTime(n.createdAt)}</p></div>)}
            </CardBody></Card>
          )}
        </div>
      </div>
    </>
  );
}
