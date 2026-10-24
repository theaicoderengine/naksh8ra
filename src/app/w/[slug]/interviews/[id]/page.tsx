import Link from "next/link";
import { notFound } from "next/navigation";
import { Quote, Volume2 } from "lucide-react";
import { requirePageOrg } from "@/server/auth/page";
import { getInterviewForHr, type SessionConfig } from "@/server/services/interviews";
import { PageHeader, Card, CardHeader, CardBody } from "@/components/ui/card";
import { StatusBadge, Badge } from "@/components/ui/badge";
import { Alert } from "@/components/ui/feedback";
import { ReviewForm, RetryAssessment } from "@/components/workspace/review-form";
import { fmtDateTime, RATING_LABEL } from "@/lib/format";

export default async function InterviewReview({ params }: { params: Promise<{ slug: string; id: string }> }) {
  const { slug, id } = await params;
  const ctx = await requirePageOrg(slug);
  const d = await getInterviewForHr(ctx, id).catch(() => notFound());
  const cfg = d.session.config as unknown as SessionConfig;
  const a = d.assessment;
  const compName = (cid: string) => cfg.competencies.find((c) => c.id === cid)?.name ?? "Competency";
  const latest = [...new Map(d.answers.map((x) => [x.position, x])).values()];
  return (
    <>
      <PageHeader
        breadcrumb={<Link className="hover:underline" href={`/w/${slug}/candidates/${d.session.applicationId}`}>Back to application</Link>}
        title={<span className="flex flex-wrap items-center gap-3">{cfg.templateName}<StatusBadge status={d.session.status} />{d.session.providerMode === "FIXTURE" && <Badge tone="warning">Fixture provider — not a real AI</Badge>}</span>}
        description={`${cfg.jobTitle} · ${d.session.mode === "REALTIME_CONVERSATIONAL" ? "Conversational" : "Structured"} · completed ${fmtDateTime(d.session.completedAt)} · template v${cfg.templateVersion}`}
        actions={["FAILED", "REQUIRES_REVIEW"].includes(d.session.status) ? <RetryAssessment sessionId={d.session.id} /> : null}
      />
      {d.session.status === "PROCESSING" && <Alert className="mb-4" title="Assessment in progress">The interview is being transcribed and assessed. Refresh in a moment.</Alert>}
      {a?.status === "FAILED" && <Alert tone="danger" className="mb-4" title="Assessment failed">{a.failureReason} — you can retry, or assess manually using the transcript.</Alert>}
      {a?.status === "REQUIRES_REVIEW" && <Alert tone="warning" className="mb-4" title="Needs careful review">{a.failureReason ?? "One or more ratings lack verified evidence or have high uncertainty."}</Alert>}
      <div className="grid gap-6 xl:grid-cols-[1.3fr_1fr]">
        <div className="space-y-6">
          {a && a.results.length > 0 && (
            <Card>
              <CardHeader title="Competency evidence" description={`Coverage: ${Math.round((a.evidenceCoverage ?? 0) * 100)}% of competencies have verified evidence · model ${a.modelVersion} · prompt ${a.promptVersion}`} />
              <CardBody className="space-y-4">
                {a.summary && <p className="rounded bg-muted/60 p-3 text-sm">{a.summary}</p>}
                {a.results.map((r) => (
                  <div key={r.id} className="rounded-lg border border-border p-4">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="font-medium">{compName(r.competencyId)} <span className="text-xs font-normal text-subtle">rubric v{r.rubricVersion}</span></p>
                      <div className="flex flex-wrap gap-1.5">
                        <Badge tone={r.rating === "INSUFFICIENT_EVIDENCE" ? "neutral" : "primary"}>AI: {RATING_LABEL[r.rating]}</Badge>
                        {r.humanRating && <Badge tone="success">Reviewer: {RATING_LABEL[r.humanRating]}</Badge>}
                        <Badge tone={r.uncertainty === "HIGH" ? "warning" : "neutral"}>{r.uncertainty.toLowerCase()} uncertainty</Badge>
                      </div>
                    </div>
                    <p className="mt-2 text-sm text-subtle">{r.explanation}</p>
                    {r.evidence.length > 0 && (
                      <ul className="mt-3 space-y-2">
                        {r.evidence.map((e) => (
                          <li key={e.id} className="flex gap-2 text-sm">
                            <Quote className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
                            <span>“{e.excerpt}” <span className="text-xs text-subtle">— answer {e.answerPosition != null && e.answerPosition < 1000 ? e.answerPosition + 1 : "follow-up"} · {e.supports.toLowerCase()}</span> {e.verified ? <Badge tone="success">verbatim ✓</Badge> : <Badge tone="danger" title="This quote could not be found in the transcript">not found in transcript</Badge>}</span>
                          </li>
                        ))}
                      </ul>
                    )}
                    {r.missingEvidence && <p className="mt-2 text-xs text-subtle"><strong>Missing evidence:</strong> {r.missingEvidence}</p>}
                    {r.overrideReason && <p className="mt-2 text-xs text-success"><strong>Override reason:</strong> {r.overrideReason}</p>}
                  </div>
                ))}
              </CardBody>
            </Card>
          )}
          <Card>
            <CardHeader title="Answers & transcript" description={d.permissions.transcripts ? "Latest attempt per question" : "Your role cannot view transcripts"} />
            <CardBody className="space-y-4">
              {latest.map((x) => {
                const audio = d.audio.find((au) => au.answerPosition === x.position);
                return (
                  <div key={x.id} className="border-b border-border pb-4 last:border-0">
                    <p className="text-sm font-medium">{x.isFollowUp ? "Follow-up" : `Q${x.position + 1}`}: {x.questionText}</p>
                    {x.attempt > 1 && <Badge className="mt-1">Retake (attempt {x.attempt})</Badge>}
                    {d.permissions.transcripts && <p className="mt-2 whitespace-pre-line text-sm text-fg/90">{x.transcript ?? x.textResponse ?? <span className="text-subtle">Transcript deleted per retention policy.</span>}</p>}
                    {x.textResponse && <p className="mt-1 text-xs text-subtle">Typed answer</p>}
                    {audio && d.permissions.recordings && <p className="mt-2"><a className="inline-flex items-center gap-1 text-sm text-primary hover:underline" href={`/api/v1/files/${audio.fileId}`} target="_blank" rel="noreferrer"><Volume2 className="h-4 w-4" aria-hidden="true" />Play recording</a></p>}
                  </div>
                );
              })}
            </CardBody>
          </Card>
        </div>
        <div className="space-y-6">
          <Card><CardHeader title="Human review" description="Required before the assessment informs any decision." />
            <CardBody>
              {a && a.reviews.length > 0 && <div className="mb-4 space-y-2">{a.reviews.map((r) => <div key={r.id} className="rounded border border-border p-2.5 text-sm"><Badge tone="success">{r.decision.replace(/_/g, " ").toLowerCase()}</Badge> <span className="text-xs text-subtle">{fmtDateTime(r.createdAt)}</span>{r.notes && <p className="mt-1 text-subtle">{r.notes}</p>}</div>)}</div>}
              {a && a.results.length > 0 ? <ReviewForm sessionId={d.session.id} results={a.results.map((r) => ({ competencyId: r.competencyId, name: compName(r.competencyId), rating: r.rating }))} /> : <p className="text-sm text-subtle">No AI assessment is available. Use the transcript and structured reviewer feedback on the application.</p>}
            </CardBody>
          </Card>
          <Card><CardHeader title="Consent & session log" /><CardBody className="space-y-3 text-sm">
            <div>{d.consents.map((c) => <p key={c.id}>{c.type.replace(/_/g, " ").toLowerCase()}: <strong>{c.granted ? "given" : "declined"}</strong> <span className="text-xs text-subtle">({c.noticeVersion})</span></p>)}</div>
            <ol className="max-h-72 space-y-1 overflow-y-auto border-l border-border pl-3 text-xs text-subtle">
              {d.events.map((e) => <li key={e.id}>{fmtDateTime(e.createdAt)} — {e.type.replace(/_/g, " ").toLowerCase()}{e.toStatus ? ` → ${e.toStatus.toLowerCase()}` : ""}</li>)}
            </ol>
            <p className="text-xs text-subtle">Billing: {d.session.billingOutcome ? `credit ${d.session.billingOutcome.toLowerCase()}` : "reserved"}</p>
          </CardBody></Card>
        </div>
      </div>
    </>
  );
}
