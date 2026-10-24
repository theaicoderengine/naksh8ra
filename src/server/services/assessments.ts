import { z } from "zod";
import type { CompetencyRating, InterviewSession } from "@prisma/client";
import { prisma } from "../db/client";
import { withOrg } from "../db/tenant";
import { AppError, invalidState, notFound } from "../errors";
import { audit } from "../audit";
import type { OrgContext } from "../auth/context";
import { llm } from "../providers/llm";
import { ASSESS_PROMPT_VERSION, ASSESS_SYSTEM, AssessmentSchema, inputBlock, type AssessmentOutput } from "../ai/prompts";
import { transition, type SessionConfig } from "./interviews";
import { loadApplicationScoped } from "./applications";
import { sendEmail } from "./notifications";
import { env } from "../env";
import { logger } from "../logger";
import type { RequestMeta } from "../http/route";

export function normaliseForMatch(s: string) {
  return s
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[^\p{L}\p{N}' ]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Verify that an evidence excerpt is a verbatim quote from the candidate's
 * own answer (after whitespace/punctuation normalisation). Excerpts that are
 * not found are kept but marked unverified, and the result is flagged for
 * human review — the model can never "invent" evidence silently.
 */
export function verifyExcerpt(excerpt: string, answers: { position: number; text: string }[], position?: number) {
  const needle = normaliseForMatch(excerpt);
  if (needle.split(" ").length < 3) return { verified: false, position: position ?? null };
  const pool = position != null ? answers.filter((a) => a.position === position) : answers;
  for (const a of [...pool, ...answers]) {
    if (normaliseForMatch(a.text).includes(needle)) return { verified: true, position: a.position };
  }
  return { verified: false, position: position ?? null };
}

export type VerifiedResult = Omit<AssessmentOutput["results"][number], "evidence"> & {
  evidence: (AssessmentOutput["results"][number]["evidence"][number] & { verified: boolean })[];
  flags: string[];
};

/** Pure post-processing of model output (unit-tested). */
export function postProcessAssessment(out: AssessmentOutput, competencyKeys: string[], answers: { position: number; text: string }[]) {
  const results: VerifiedResult[] = [];
  const issues: string[] = [];
  for (const key of competencyKeys) {
    const r = out.results.find((x) => x.competencyKey === key);
    if (!r) {
      results.push({ competencyKey: key, rating: "INSUFFICIENT_EVIDENCE", explanation: "The assessment did not return a result for this competency.", evidence: [], missingEvidence: "Not assessed", uncertainty: "HIGH", flags: ["missing_from_model_output"] });
      issues.push(`missing:${key}`);
      continue;
    }
    const evidence: VerifiedResult["evidence"] = r.evidence.map((e) => {
      const v = verifyExcerpt(e.excerpt, answers, e.answerPosition);
      return { ...e, answerPosition: v.position ?? e.answerPosition, verified: v.verified };
    });
    const flags: string[] = [];
    let rating = r.rating;
    let uncertainty = r.uncertainty;
    if (rating !== "INSUFFICIENT_EVIDENCE" && !evidence.some((e) => e.verified)) {
      // A rating without verifiable evidence is not allowed to stand unreviewed.
      flags.push("no_verified_evidence");
      uncertainty = "HIGH";
      issues.push(`unverified:${key}`);
    }
    if (evidence.some((e) => !e.verified)) flags.push("unverified_excerpt");
    if (rating === "INSUFFICIENT_EVIDENCE" && evidence.length === 0) rating = "INSUFFICIENT_EVIDENCE";
    results.push({ ...r, rating, uncertainty, evidence, flags });
  }
  const sufficient = results.filter((r) => r.rating !== "INSUFFICIENT_EVIDENCE" && r.evidence.some((e) => e.verified)).length;
  const coverage = competencyKeys.length ? sufficient / competencyKeys.length : 0;
  return { results, coverage, requiresReview: issues.length > 0 || results.some((r) => r.uncertainty === "HIGH"), issues };
}

/** Worker: run the assessment for a completed interview. */
export async function runAssessment(organisationId: string, sessionId: string) {
  const loaded = await withOrg(organisationId, null, async (tx) => {
    const s = await tx.interviewSession.findFirst({ where: { id: sessionId, organisationId } });
    if (!s) return null;
    if (!["PROCESSING", "FAILED", "REQUIRES_REVIEW"].includes(s.status)) return null;
    const answers = await tx.answer.findMany({ where: { sessionId }, orderBy: [{ position: "asc" }, { attempt: "desc" }] });
    // Latest attempt per position only.
    const latest = [...new Map(answers.map((a) => [a.position, a])).values()].filter((a) => a.transcript || a.textResponse);
    const consent = await tx.consentRecord.findFirst({ where: { sessionId, type: "AI_ASSESSMENT" }, orderBy: { createdAt: "desc" } });
    return { s, latest, consent };
  });
  if (!loaded) return;
  const { s, latest, consent } = loaded;
  const c = s.config as unknown as SessionConfig;

  if (!consent?.granted) {
    await markFailed(s, "AI assessment consent not given — human review only", "REQUIRES_REVIEW");
    return;
  }
  if (latest.length === 0) {
    await markFailed(s, "No answers to assess", "REQUIRES_REVIEW");
    return;
  }

  const rubrics = await withOrg(organisationId, null, (tx) => tx.competencyRubric.findMany({ where: { id: { in: c.competencies.map((x) => x.rubricId) } } }));
  const answersForModel = latest.map((a) => ({ position: a.position, question: a.questionText, answer: (a.transcript ?? a.textResponse ?? "").slice(0, 8000) }));

  let output: AssessmentOutput;
  let model: string;
  let mode: "LIVE" | "FIXTURE";
  try {
    const provider = llm();
    mode = provider.mode;
    const res = await provider.json({
      purpose: ASSESS_PROMPT_VERSION,
      system: ASSESS_SYSTEM,
      user: `Assess the candidate's answers for the role "${c.jobTitle}" against the competencies below.\n${inputBlock({
        competencies: c.competencies.map((comp) => {
          const r = rubrics.find((x) => x.id === comp.rubricId);
          return { key: comp.key, name: comp.name, description: comp.description, criteria: r?.criteria, indicators: r?.indicators, levels: r?.levels, evidenceRequirements: r?.evidenceRequirements, scoringGuidance: r?.scoringGuidance };
        }),
        answers: answersForModel,
      })}`,
      schema: AssessmentSchema,
      usage: { organisationId, sessionId },
      effort: "high",
    });
    output = res.data;
    model = res.model;
  } catch (err) {
    const msg = err instanceof AppError ? err.message : "Assessment failed";
    await markFailed(s, msg, "FAILED");
    if (err instanceof AppError && err.code === "PROVIDER_NOT_CONFIGURED") return; // no retry until configured
    throw err; // let the queue retry transient provider errors
  }

  const processed = postProcessAssessment(output, c.competencies.map((x) => x.key), answersForModel.map((a) => ({ position: a.position, text: a.answer })));

  await withOrg(organisationId, null, async (tx) => {
    const fresh = await tx.interviewSession.findFirstOrThrow({ where: { id: sessionId } });
    await tx.assessment.deleteMany({ where: { sessionId } }); // re-run replaces a failed attempt
    const assessment = await tx.assessment.create({
      data: {
        organisationId,
        sessionId,
        status: processed.requiresReview ? "REQUIRES_REVIEW" : "COMPLETED",
        summary: output.summary,
        evidenceCoverage: processed.coverage,
        modelVersion: model,
        promptVersion: ASSESS_PROMPT_VERSION,
        providerMode: mode,
        rawOutput: output as never,
        assessedAt: new Date(),
      },
    });
    for (const r of processed.results) {
      const comp = c.competencies.find((x) => x.key === r.competencyKey)!;
      const result = await tx.assessmentResult.create({
        data: {
          organisationId,
          assessmentId: assessment.id,
          competencyId: comp.id,
          rubricId: comp.rubricId,
          rubricVersion: comp.rubricVersion,
          rating: r.rating,
          explanation: r.explanation + (r.flags.length ? ` [flags: ${r.flags.join(", ")}]` : ""),
          missingEvidence: r.missingEvidence || null,
          uncertainty: r.uncertainty,
        },
      });
      if (r.evidence.length) {
        await tx.assessmentEvidence.createMany({
          data: r.evidence.map((e) => ({ organisationId, resultId: result.id, excerpt: e.excerpt.slice(0, 1000), answerPosition: e.answerPosition, supports: e.supports, verified: e.verified })),
        });
      }
    }
    // Transcript retention per template: if transcripts are not to be stored, keep only the
    // verified evidence excerpts needed to justify the assessment.
    if (!c.storeTranscript) {
      await tx.transcriptSegment.deleteMany({ where: { sessionId } });
      await tx.answer.updateMany({ where: { sessionId }, data: { transcript: null, textResponse: null } });
    }
    await transition(tx, fresh, processed.requiresReview ? "REQUIRES_REVIEW" : "ASSESSED", { providerMode: mode === "FIXTURE" ? "FIXTURE" : fresh.providerMode }, { type: "ASSESSED", data: { coverage: processed.coverage, issues: processed.issues } });
  });
  await notifyReviewers(organisationId, s);
}

async function markFailed(s: InterviewSession, reason: string, to: "FAILED" | "REQUIRES_REVIEW") {
  await withOrg(s.organisationId, null, async (tx) => {
    const fresh = await tx.interviewSession.findFirstOrThrow({ where: { id: s.id } });
    await tx.assessment.upsert({
      where: { sessionId: s.id },
      create: { organisationId: s.organisationId, sessionId: s.id, status: to === "FAILED" ? "FAILED" : "REQUIRES_REVIEW", failureReason: reason },
      update: { status: to === "FAILED" ? "FAILED" : "REQUIRES_REVIEW", failureReason: reason },
    });
    if (fresh.status !== to) await transition(tx, fresh, to, { failureReason: reason }, { type: "ASSESSMENT_FAILED", data: { reason } });
  });
  logger.warn({ sessionId: s.id, reason }, "assessment not completed");
}

async function notifyReviewers(orgId: string, s: InterviewSession) {
  const c = s.config as unknown as SessionConfig;
  const { reviewers, candidateName } = await withOrg(orgId, null, async (tx) => {
    const app = await tx.application.findFirstOrThrow({ where: { id: s.applicationId }, include: { candidate: true } });
    const a = await tx.jobAssignment.findMany({ where: { jobId: app.jobId, organisationId: orgId } });
    return { reviewers: [...new Set(a.map((x) => x.userId))], candidateName: `${app.candidate.firstName} ${app.candidate.lastName}` };
  });
  const users = await prisma.user.findMany({ where: { id: { in: reviewers } }, select: { id: true, email: true } });
  const org = await prisma.organisation.findUniqueOrThrow({ where: { id: orgId }, select: { slug: true } });
  for (const u of users) {
    await sendEmail("reviewCompleted", { job: c.jobTitle, candidate: candidateName, url: `${env().APP_URL}/w/${org.slug}/interviews/${s.id}` }, { to: u.email, userId: u.id, organisationId: orgId, idempotencyKey: `review-ready:${s.id}:${u.id}` });
  }
}

/** HR: re-run a failed assessment. */
export async function retryAssessment(ctx: OrgContext, sessionId: string, meta: RequestMeta) {
  ctx.assert("assessments.review");
  await withOrg(ctx.org.id, ctx.userId, async (tx) => {
    const s = await tx.interviewSession.findFirst({ where: { id: sessionId, organisationId: ctx.org.id } });
    if (!s) throw notFound("Interview");
    await loadApplicationScoped(ctx, tx, s.applicationId);
    if (!["FAILED", "REQUIRES_REVIEW"].includes(s.status)) throw invalidState("Only failed assessments can be retried");
    await transition(tx, s, "PROCESSING", {}, { type: "ASSESSMENT_RETRY", data: { by: ctx.userId } });
  });
  await audit({ organisationId: ctx.org.id, actorUserId: ctx.userId, action: "assessment.retried", targetType: "InterviewSession", targetId: sessionId, ip: meta.ip });
  const { enqueue } = await import("../queue");
  await enqueue("interview.assess", { sessionId, organisationId: ctx.org.id });
}

export const reviewSchema = z.object({
  decision: z.enum(["CONFIRMED", "ADJUSTED", "REJECTED_AI_OUTPUT"]),
  notes: z.string().trim().max(5000).optional(),
  overrides: z
    .array(z.object({ competencyId: z.string(), rating: z.enum(["INSUFFICIENT_EVIDENCE", "R1", "R2", "R3", "R4", "R5"]), reason: z.string().trim().min(5, "Explain the override").max(2000) }))
    .max(30)
    .default([]),
});

/** Human review: confirm, adjust (with per-competency override reasons), or reject the AI output. */
export async function reviewAssessment(ctx: OrgContext, sessionId: string, input: z.infer<typeof reviewSchema>, meta: RequestMeta) {
  ctx.assert("assessments.review");
  if (input.decision === "ADJUSTED" && input.overrides.length === 0) throw new AppError("BAD_REQUEST", "Provide at least one adjusted rating");
  if (input.decision === "REJECTED_AI_OUTPUT" && !input.notes) throw new AppError("BAD_REQUEST", "Explain why the AI output was rejected");
  return withOrg(ctx.org.id, ctx.userId, async (tx) => {
    const s = await tx.interviewSession.findFirst({ where: { id: sessionId, organisationId: ctx.org.id } });
    if (!s) throw notFound("Interview");
    await loadApplicationScoped(ctx, tx, s.applicationId);
    const a = await tx.assessment.findFirst({ where: { sessionId, organisationId: ctx.org.id }, include: { results: true } });
    if (!a) throw invalidState("No assessment to review yet");
    for (const o of input.overrides) {
      const r = a.results.find((x) => x.competencyId === o.competencyId);
      if (!r) throw notFound("Assessment result");
      await tx.assessmentResult.update({ where: { id: r.id }, data: { humanRating: o.rating as CompetencyRating, overrideReason: o.reason, overriddenById: ctx.userId, overriddenAt: new Date() } });
    }
    const review = await tx.assessmentReview.create({ data: { organisationId: ctx.org.id, assessmentId: a.id, reviewerId: ctx.userId, decision: input.decision, notes: input.notes } });
    await tx.assessment.update({ where: { id: a.id }, data: { status: "COMPLETED" } });
    if (["ASSESSED", "REQUIRES_REVIEW"].includes(s.status)) await transition(tx, s, "REVIEWED", {}, { type: "REVIEWED", data: { decision: input.decision } });
    await audit({ organisationId: ctx.org.id, actorUserId: ctx.userId, action: "assessment.reviewed", targetType: "Assessment", targetId: a.id, ip: meta.ip, metadata: { decision: input.decision, overrides: input.overrides.length } }, tx);
    return review;
  });
}

/** Side-by-side comparison of candidates for one job, using comparable job-related evidence. */
export async function compareCandidates(ctx: OrgContext, jobId: string, applicationIds: string[]) {
  return withOrg(ctx.org.id, ctx.userId, async (tx) => {
    for (const id of applicationIds) await loadApplicationScoped(ctx, tx, id);
    const apps = await tx.application.findMany({
      where: { id: { in: applicationIds }, organisationId: ctx.org.id, jobId },
      include: {
        candidate: { select: { firstName: true, lastName: true } },
        sessions: { where: { status: { in: ["ASSESSED", "REQUIRES_REVIEW", "REVIEWED", "CLOSED"] } }, orderBy: { completedAt: "desc" }, take: 1, include: { assessment: { include: { results: { include: { evidence: { where: { verified: true }, take: 2 } } } } } } },
      },
    });
    const competencyIds = [...new Set(apps.flatMap((a) => a.sessions[0]?.assessment?.results.map((r) => r.competencyId) ?? []))];
    const competencies = await tx.competency.findMany({ where: { id: { in: competencyIds } }, select: { id: true, name: true } });
    return {
      competencies,
      // No composite rank is computed: reviewers compare evidence per competency, and missing data is shown as missing.
      candidates: apps.map((a) => {
        const asmt = a.sessions[0]?.assessment;
        return {
          applicationId: a.id,
          name: `${a.candidate.firstName} ${a.candidate.lastName}`,
          status: a.status,
          assessed: !!asmt,
          templateVersion: (a.sessions[0]?.config as unknown as SessionConfig | undefined)?.templateVersion ?? null,
          evidenceCoverage: asmt?.evidenceCoverage ?? null,
          byCompetency: Object.fromEntries(
            competencies.map((c) => {
              const r = asmt?.results.find((x) => x.competencyId === c.id);
              return [c.id, r ? { rating: r.humanRating ?? r.rating, aiRating: r.rating, overridden: !!r.humanRating, uncertainty: r.uncertainty, evidence: r.evidence.map((e) => e.excerpt) } : null];
            }),
          ),
        };
      }),
    };
  });
}
