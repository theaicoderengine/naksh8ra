import { notFound } from "next/navigation";
import { requirePageOrg } from "@/server/auth/page";
import { getTemplate, listCompetencies } from "@/server/services/templates";
import { getEntitlements } from "@/server/billing/entitlements";
import { PageHeader } from "@/components/ui/card";
import { PermissionDenied } from "@/components/ui/feedback";
import { TemplateEditor, type TemplateValue } from "@/components/workspace/template-editor";

export default async function EditTemplate({ params }: { params: Promise<{ slug: string; id: string }> }) {
  const { slug, id } = await params;
  const ctx = await requirePageOrg(slug);
  if (!ctx.can("interviews.configure")) return <PermissionDenied what="interview templates" />;
  const [t, comps, ent] = await Promise.all([getTemplate(ctx, id).catch(() => notFound()), listCompetencies(ctx), getEntitlements(ctx.org.id)]);
  const acc = (t.accessibilityOptions ?? {}) as { allowTypedAnswers?: boolean; extendedTimeMultiplier?: number; captions?: boolean };
  const initial: TemplateValue = {
    name: t.name, description: t.description ?? "", mode: t.mode, language: t.language, durationMinutes: String(t.durationMinutes), questionCount: String(t.questionCount), difficulty: t.difficulty, questionSelection: t.questionSelection, maxFollowUps: String(t.maxFollowUps), answerSeconds: String(t.answerSeconds), prepSeconds: String(t.prepSeconds), retakesAllowed: String(t.retakesAllowed),
    recordAudio: t.recordAudio, storeTranscript: t.storeTranscript, showTranscriptToCandidate: t.showTranscriptToCandidate, allowResume: t.allowResume, candidateInstructions: t.candidateInstructions ?? "", allowTypedAnswers: acc.allowTypedAnswers ?? true, extendedTimeMultiplier: String(acc.extendedTimeMultiplier ?? 1), captions: acc.captions ?? true,
    competencyIds: t.competencies.map((c) => c.competencyId), questions: t.questions.map((q) => ({ prompt: q.prompt, guidance: q.guidance ?? "", competencyId: q.competencyId ?? "", answerSeconds: q.answerSeconds ? String(q.answerSeconds) : "" })),
  };
  return (<><PageHeader title={`Edit template: ${t.name}`} description={`Currently version ${t.version}`} /><TemplateEditor templateId={t.id} initial={initial} competencies={comps.map((c) => ({ id: c.id, name: c.name }))} realtimeAllowed={ent.raw["feature.realtime_interviews"] !== "false"} /></>);
}
