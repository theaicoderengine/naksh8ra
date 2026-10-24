import { z } from "zod";
import type { InterviewSession, InterviewSessionStatus, Prisma } from "@prisma/client";
import { prisma } from "../db/client";
import { withOrg, withSystem, type Tx } from "../db/tenant";
import { AppError, badRequest, conflict, forbidden, invalidState, notFound } from "../errors";
import { audit } from "../audit";
import type { OrgContext } from "../auth/context";
import type { SessionInfo } from "../auth/session";
import { randomToken, sha256 } from "../auth/crypto";
import { canTransition, billingOutcome, CANDIDATE_ACTIVE_STATES } from "../domain/state-machines";
import { reserve, consume, release } from "../billing/credits";
import { loadApplicationScoped } from "./applications";
import { sendEmail, notify } from "./notifications";
import { env } from "../env";
import { enqueue } from "../queue";
import { llm } from "../providers/llm";
import { sttProvider, ttsProvider } from "../providers/speech";
import { storeFile } from "./files";
import { AUDIO_TYPES } from "../providers/scan";
import { QGEN_PROMPT_VERSION, QGEN_SYSTEM, QuestionSetSchema, TURN_PROMPT_VERSION, TURN_SYSTEM, TurnSchema, inputBlock } from "../ai/prompts";
import { logger } from "../logger";
import type { RequestMeta } from "../http/route";

export const PRIVACY_NOTICE_VERSION = "interview-notice-2026-10";

/** Frozen snapshot of the template stored on the session at invitation time. */
export type SessionConfig = {
  templateId: string;
  templateVersion: number;
  templateName: string;
  jobTitle: string;
  organisationName: string;
  mode: "REALTIME_CONVERSATIONAL" | "STRUCTURED_AUDIO";
  language: string;
  durationMinutes: number;
  questionCount: number;
  difficulty: string;
  questionSelection: "FIXED" | "ADAPTIVE";
  maxFollowUps: number;
  answerSeconds: number;
  prepSeconds: number;
  retakesAllowed: number;
  recordAudio: boolean;
  storeTranscript: boolean;
  showTranscriptToCandidate: boolean;
  allowResume: boolean;
  voice: string | null;
  candidateInstructions: string | null;
  accessibility: { allowTypedAnswers: boolean; extendedTimeMultiplier: number; captions: boolean };
  competencies: { id: string; key: string; name: string; description: string; rubricId: string; rubricVersion: number; weight: number }[];
};

export type PlanItem = { position: number; prompt: string; competencyId: string | null; guidance: string | null; answerSeconds: number; generated?: boolean };
type Turn = { role: "interviewer" | "candidate"; text: string; at: string; position?: number; followUp?: boolean };

// ───────────────────────── state transitions ─────────────────────────

/**
 * Server-enforced, idempotent, optimistic-concurrency state transition.
 * Re-applying the current state is a no-op (safe retries); a concurrent
 * change makes the conditional update affect 0 rows → CONFLICT.
 */
export async function transition(
  tx: Tx,
  s: Pick<InterviewSession, "id" | "organisationId" | "status" | "version">,
  to: InterviewSessionStatus,
  data: Prisma.InterviewSessionUpdateManyMutationInput = {},
  event: { type?: string; data?: Prisma.InputJsonValue; idempotencyKey?: string } = {},
) {
  if (s.status === to) return { changed: false };
  if (!canTransition(s.status, to)) throw invalidState(`Interview cannot move from ${s.status} to ${to}`);
  const res = await tx.interviewSession.updateMany({ where: { id: s.id, version: s.version, status: s.status }, data: { ...data, status: to, version: { increment: 1 } } });
  if (res.count !== 1) throw conflict("The interview was updated by another request. Please retry.");
  await tx.sessionEvent.create({
    data: { organisationId: s.organisationId, sessionId: s.id, type: event.type ?? "STATE_CHANGE", fromStatus: s.status, toStatus: to, data: event.data ?? {}, idempotencyKey: event.idempotencyKey },
  });
  return { changed: true };
}

async function settleCredit(tx: Tx, s: InterviewSession, terminal: "PROCESSING" | "EXPIRED" | "CANCELLED" | "FAILED", reason: string, answerCount: number) {
  if (!s.creditReservationKey || s.billingOutcome) return;
  const outcome = billingOutcome(terminal, answerCount);
  if (outcome === "CONSUME") await consume(tx, { organisationId: s.organisationId }, s.creditReservationKey, s.id);
  else await release(tx, { organisationId: s.organisationId }, s.creditReservationKey, s.id, reason);
  await tx.interviewSession.update({ where: { id: s.id }, data: { billable: outcome === "CONSUME", billingOutcome: outcome === "CONSUME" ? "CONSUMED" : "RELEASED" } });
}

async function moveAppToStageKind(tx: Tx, orgId: string, applicationId: string, kind: "AI_INTERVIEW_INVITED" | "AI_INTERVIEW_COMPLETED", actor: string | null, reason: string) {
  const app = await tx.application.findFirst({ where: { id: applicationId, organisationId: orgId } });
  if (!app || ["HIRED", "REJECTED", "WITHDRAWN", "OFFER"].includes(app.status)) return;
  const stage = await tx.applicationStage.findFirst({ where: { organisationId: orgId, kind }, orderBy: { position: "asc" } });
  if (!stage || app.stageId === stage.id) return;
  await tx.application.update({ where: { id: app.id }, data: { stageId: stage.id, status: "INTERVIEWING" } });
  await tx.applicationStageHistory.create({ data: { organisationId: orgId, applicationId: app.id, fromStageId: app.stageId, toStageId: stage.id, fromStatus: app.status, toStatus: "INTERVIEWING", actorUserId: actor, reason, visibleToCandidate: kind === "AI_INTERVIEW_INVITED" } });
}

// ───────────────────────── HR: invite ─────────────────────────

export const inviteSchema = z.object({
  templateId: z.string(),
  expiresInDays: z.number().int().min(1).max(60).default(7),
  message: z.string().max(1000).optional(),
});

export async function inviteToInterview(ctx: OrgContext, applicationId: string, input: z.infer<typeof inviteSchema>, meta: RequestMeta) {
  ctx.assert("interviews.invite");
  const token = randomToken();
  const result = await withOrg(ctx.org.id, ctx.userId, async (tx) => {
    const app = await loadApplicationScoped(ctx, tx, applicationId);
    if (["HIRED", "REJECTED", "WITHDRAWN", "DRAFT"].includes(app.status)) throw invalidState("Interviews can only be sent for active applications");
    const tpl = await tx.interviewTemplate.findFirst({
      where: { id: input.templateId, organisationId: ctx.org.id, archivedAt: null },
      include: { questions: { orderBy: { position: "asc" } }, competencies: { include: { competency: { include: { rubrics: { where: { isCurrent: true }, take: 1 } } } } } },
    });
    if (!tpl) throw notFound("Interview template");
    if (tpl.questionSelection === "FIXED" && tpl.questions.length < tpl.questionCount) {
      throw badRequest(`This template needs ${tpl.questionCount} questions (it has ${tpl.questions.length}). Add questions or switch to adaptive selection.`);
    }
    const active = await tx.interviewSession.findFirst({ where: { applicationId: app.id, organisationId: ctx.org.id, status: { in: ["CREATED", "INVITED", "READY", "IN_PROGRESS", "INTERRUPTED"] } } });
    if (active) throw conflict("This candidate already has an interview in progress or awaiting completion");

    const [candidate, job] = await Promise.all([
      tx.candidate.findFirstOrThrow({ where: { id: app.candidateId, organisationId: ctx.org.id } }),
      tx.job.findFirstOrThrow({ where: { id: app.jobId, organisationId: ctx.org.id } }),
    ]);
    const config: SessionConfig = {
      templateId: tpl.id,
      templateVersion: tpl.version,
      templateName: tpl.name,
      jobTitle: job.title,
      organisationName: ctx.org.name,
      mode: tpl.mode,
      language: tpl.language,
      durationMinutes: tpl.durationMinutes,
      questionCount: tpl.questionCount,
      difficulty: tpl.difficulty,
      questionSelection: tpl.questionSelection,
      maxFollowUps: tpl.maxFollowUps,
      answerSeconds: tpl.answerSeconds,
      prepSeconds: tpl.prepSeconds,
      retakesAllowed: tpl.retakesAllowed,
      recordAudio: tpl.recordAudio,
      storeTranscript: tpl.storeTranscript,
      showTranscriptToCandidate: tpl.showTranscriptToCandidate,
      allowResume: tpl.allowResume,
      voice: tpl.voice,
      candidateInstructions: tpl.candidateInstructions,
      accessibility: { allowTypedAnswers: true, extendedTimeMultiplier: 1, captions: true, ...(tpl.accessibilityOptions as object) },
      competencies: tpl.competencies.map((tc) => {
        const rubric = tc.competency.rubrics[0];
        if (!rubric) throw badRequest(`Competency ${tc.competency.name} has no rubric`);
        return { id: tc.competency.id, key: tc.competency.key, name: tc.competency.name, description: tc.competency.description, rubricId: rubric.id, rubricVersion: rubric.version, weight: tc.weight };
      }),
    };
    const plan: PlanItem[] = tpl.questions.slice(0, tpl.questionCount).map((q, i) => ({ position: i, prompt: q.prompt, competencyId: q.competencyId, guidance: q.guidance, answerSeconds: q.answerSeconds ?? tpl.answerSeconds }));

    const invitation = await tx.interviewInvitation.create({
      data: { organisationId: ctx.org.id, applicationId: app.id, templateId: tpl.id, tokenHash: sha256(token), email: candidate.email, expiresAt: new Date(Date.now() + input.expiresInDays * 86400_000), createdById: ctx.userId },
    });
    const session = await tx.interviewSession.create({
      data: {
        organisationId: ctx.org.id,
        applicationId: app.id,
        invitationId: invitation.id,
        candidateUserId: candidate.userId,
        mode: tpl.mode,
        status: "CREATED",
        config: config as unknown as Prisma.InputJsonValue,
        plan: plan as unknown as Prisma.InputJsonValue,
        expiresAt: invitation.expiresAt,
        creditReservationKey: `interview:${invitation.id}`,
      },
    });
    // Reserve one credit up front so the candidate is never blocked mid-interview.
    await reserve(tx, { organisationId: ctx.org.id }, session.creditReservationKey!, session.id);
    await transition(tx, session, "INVITED", { providerMode: safeProviderMode() }, { data: { by: ctx.userId } });
    await tx.interviewInvitation.update({ where: { id: invitation.id }, data: { sentAt: new Date() } });
    await moveAppToStageKind(tx, ctx.org.id, app.id, "AI_INTERVIEW_INVITED", ctx.userId, "AI interview invited");
    await audit({ organisationId: ctx.org.id, actorUserId: ctx.userId, action: "interview.invited", targetType: "InterviewSession", targetId: session.id, ip: meta.ip, metadata: { template: tpl.id, mode: tpl.mode } }, tx);
    return { invitation, session, candidate, job, config };
  });

  const url = `${env().APP_URL}/interview/${token}`;
  await sendEmail(
    "interviewInvitation",
    { name: result.candidate.firstName, job: result.job.title, org: ctx.org.name, url, expires: result.invitation.expiresAt.toUTCString(), minutes: result.config.durationMinutes },
    { to: result.candidate.email, userId: result.candidate.userId ?? undefined, organisationId: ctx.org.id, idempotencyKey: `interview-invite:${result.invitation.id}` },
  );
  if (result.candidate.userId) {
    await notify(result.candidate.userId, { type: "interview_reminders", title: "Interview invitation", body: `${result.job.title} at ${ctx.org.name}`, link: `/interview/i/${result.invitation.id}`, organisationId: ctx.org.id });
  }
  return { invitationId: result.invitation.id, sessionId: result.session.id, expiresAt: result.invitation.expiresAt, ...(env().APP_ENV !== "production" && process.env.EXPOSE_TEST_TOKENS === "true" ? { testToken: token } : {}) };
}

function safeProviderMode(): "LIVE" | "FIXTURE" {
  try {
    return llm().mode === "FIXTURE" ? "FIXTURE" : "LIVE";
  } catch {
    return "LIVE";
  }
}

/** Cancel (HR, withdrawal, or system). Releases the reserved credit if no answer was given. */
export async function cancelSession(orgId: string, sessionId: string, reason: string, actorUserId: string | null) {
  await withOrg(orgId, actorUserId, async (tx) => {
    const s = await tx.interviewSession.findFirst({ where: { id: sessionId, organisationId: orgId } });
    if (!s || !["CREATED", "INVITED", "READY", "IN_PROGRESS", "INTERRUPTED"].includes(s.status)) return;
    const answers = await tx.answer.count({ where: { sessionId: s.id } });
    await transition(tx, s, "CANCELLED", { failureReason: reason }, { data: { reason } });
    await tx.interviewInvitation.update({ where: { id: s.invitationId }, data: { revokedAt: new Date() } });
    await settleCredit(tx, s, "CANCELLED", reason, answers);
  });
}

export async function cancelInterviewByHr(ctx: OrgContext, sessionId: string, meta: RequestMeta) {
  ctx.assert("interviews.invite");
  await withOrg(ctx.org.id, ctx.userId, async (tx) => {
    const s = await tx.interviewSession.findFirst({ where: { id: sessionId, organisationId: ctx.org.id } });
    if (!s) throw notFound("Interview");
    await loadApplicationScoped(ctx, tx, s.applicationId);
  });
  await cancelSession(ctx.org.id, sessionId, "cancelled_by_employer", ctx.userId);
  await audit({ organisationId: ctx.org.id, actorUserId: ctx.userId, action: "interview.cancelled", targetType: "InterviewSession", targetId: sessionId, ip: meta.ip });
}

// ───────────────────────── Candidate access ─────────────────────────

export type InterviewAccess = { sessionId: string; organisationId: string; invitationId: string; actorUserId: string | null };

/**
 * Resolve candidate access either from the emailed bearer token or from an
 * authenticated account that owns the application. The organisation is
 * derived from the invitation record — never from client input.
 */
export async function resolveInterviewAccess(ref: { token?: string | null; invitationId?: string | null }, session: SessionInfo | null): Promise<InterviewAccess> {
  const inv = await withSystem("interview access resolution", async (tx) => {
    if (ref.token) return tx.interviewInvitation.findUnique({ where: { tokenHash: sha256(ref.token) }, include: { session: true } });
    if (ref.invitationId && session) {
      const i = await tx.interviewInvitation.findUnique({ where: { id: ref.invitationId }, include: { session: true } });
      if (i && i.session?.candidateUserId && i.session.candidateUserId === session.user.id) return i;
    }
    return null;
  });
  if (!inv || !inv.session) throw notFound("Interview");
  if (inv.revokedAt) throw new AppError("FORBIDDEN", "This interview invitation was withdrawn");
  if (!inv.openedAt) await withOrg(inv.organisationId, null, (tx) => tx.interviewInvitation.update({ where: { id: inv.id }, data: { openedAt: new Date() } }));
  return { sessionId: inv.session.id, organisationId: inv.organisationId, invitationId: inv.id, actorUserId: session?.user.id ?? null };
}

async function loadSession(tx: Tx, a: InterviewAccess) {
  const s = await tx.interviewSession.findFirst({ where: { id: a.sessionId, organisationId: a.organisationId } });
  if (!s) throw notFound("Interview");
  return s;
}

function cfg(s: InterviewSession) {
  return s.config as unknown as SessionConfig;
}
function plan(s: InterviewSession) {
  return s.plan as unknown as PlanItem[];
}

/** Expire lazily on access as well as via the scheduled job. */
async function expireIfDue(tx: Tx, s: InterviewSession) {
  if (!s.expiresAt || s.expiresAt > new Date()) return s;
  if (["INVITED", "READY"].includes(s.status)) {
    await transition(tx, s, "EXPIRED", {}, { data: { reason: "invitation_expired" } });
    await settleCredit(tx, s, "EXPIRED", "invitation_expired", 0);
  } else if (s.status === "INTERRUPTED") {
    const answers = await tx.answer.count({ where: { sessionId: s.id } });
    if (answers > 0) await finalise(tx, s, "expired_after_interruption");
    else {
      await transition(tx, s, "EXPIRED", {}, { data: { reason: "expired_after_interruption" } });
      await settleCredit(tx, s, "EXPIRED", "expired", 0);
    }
  }
  return tx.interviewSession.findFirstOrThrow({ where: { id: s.id } });
}

/** Candidate-safe view of the session: no rubric, guidance, assessment or internal status. */
export async function getCandidateState(a: InterviewAccess) {
  return withOrg(a.organisationId, a.actorUserId, async (tx) => {
    let s = await loadSession(tx, a);
    s = await expireIfDue(tx, s);
    const c = cfg(s);
    const p = plan(s);
    const answers = await tx.answer.findMany({ where: { sessionId: s.id }, select: { position: true, attempt: true, isFollowUp: true } });
    const consents = await tx.consentRecord.findMany({ where: { sessionId: s.id }, select: { type: true, granted: true } });
    const current = s.status === "IN_PROGRESS" && s.mode === "STRUCTURED_AUDIO" ? p[s.currentIndex] : null;
    const lastAnswered = Math.max(-1, ...answers.filter((x) => !x.isFollowUp).map((x) => x.position));
    const lastAttempt = answers.filter((x) => x.position === lastAnswered).reduce((m, x) => Math.max(m, x.attempt), 0);
    let providers: { ready: boolean; message: string | null } = { ready: true, message: null };
    try {
      if (s.mode === "REALTIME_CONVERSATIONAL") llm();
      if (!(c.accessibility.allowTypedAnswers && !c.recordAudio)) sttProvider();
    } catch (e) {
      providers = { ready: false, message: e instanceof Error ? e.message : "AI provider not configured" };
    }
    return {
      status: candidateStatus(s.status),
      providerMode: s.providerMode,
      providers,
      organisation: c.organisationName,
      jobTitle: c.jobTitle,
      mode: s.mode,
      language: c.language,
      durationMinutes: c.durationMinutes,
      questionCount: c.questionCount,
      answerSeconds: Math.round(c.answerSeconds * c.accessibility.extendedTimeMultiplier),
      prepSeconds: c.prepSeconds,
      retakesAllowed: c.retakesAllowed,
      canRetakeLast: s.mode === "STRUCTURED_AUDIO" && s.status === "IN_PROGRESS" && lastAnswered >= 0 && lastAttempt <= c.retakesAllowed && lastAnswered === s.currentIndex - 1,
      recordAudio: c.recordAudio,
      storeTranscript: c.storeTranscript,
      allowTypedAnswers: c.accessibility.allowTypedAnswers,
      captions: c.accessibility.captions,
      allowResume: c.allowResume,
      instructions: c.candidateInstructions,
      expiresAt: s.expiresAt,
      startedAt: s.startedAt,
      progress: { answered: s.mode === "STRUCTURED_AUDIO" ? Math.min(s.currentIndex, p.length) : answers.filter((x) => !x.isFollowUp).length, total: c.questionCount },
      currentQuestion: current ? { position: current.position, prompt: current.prompt, answerSeconds: Math.round(current.answerSeconds * c.accessibility.extendedTimeMultiplier) } : null,
      // Live captions while the interview runs; afterwards only if the employer chose to share transcripts.
      conversation:
        s.mode === "REALTIME_CONVERSATIONAL" && ((c.accessibility.captions && ["IN_PROGRESS", "INTERRUPTED"].includes(s.status)) || (c.showTranscriptToCandidate && candidateStatus(s.status) === "COMPLETED"))
          ? (s.conversation as Turn[]).map((t) => ({ role: t.role, text: t.text }))
          : [],
      consents: Object.fromEntries(consents.map((x) => [x.type, x.granted])),
      noticeVersion: PRIVACY_NOTICE_VERSION,
      ttsMode: ttsProvider().name === "browser" ? "browser" : "server",
    };
  });
}

function candidateStatus(s: InterviewSessionStatus) {
  if (["PROCESSING", "ASSESSED", "REQUIRES_REVIEW", "REVIEWED", "CLOSED"].includes(s)) return "COMPLETED";
  return s; // INVITED | READY | IN_PROGRESS | INTERRUPTED | EXPIRED | CANCELLED | FAILED
}

export const consentSchema = z.object({
  recording: z.boolean(),
  aiAssessment: z.boolean(),
  transcript: z.boolean(),
  accommodationRequest: z.string().trim().max(2000).optional(),
});

export async function recordConsent(a: InterviewAccess, input: z.infer<typeof consentSchema>, meta: RequestMeta) {
  return withOrg(a.organisationId, a.actorUserId, async (tx) => {
    let s = await loadSession(tx, a);
    s = await expireIfDue(tx, s);
    if (!["INVITED", "READY"].includes(s.status)) throw invalidState("Consent can only be given before the interview starts");
    const c = cfg(s);
    const inv = await tx.interviewInvitation.findFirstOrThrow({ where: { id: s.invitationId } });
    const base = { sessionId: s.id, organisationId: a.organisationId, userId: s.candidateUserId, email: inv.email, noticeVersion: PRIVACY_NOTICE_VERSION, ipAddress: meta.ip, userAgent: meta.userAgent };
    await tx.consentRecord.createMany({
      data: [
        { ...base, type: "AI_ASSESSMENT", granted: input.aiAssessment },
        { ...base, type: "INTERVIEW_RECORDING", granted: input.recording },
        { ...base, type: "TRANSCRIPT_PROCESSING", granted: input.transcript },
      ],
    });
    if (input.accommodationRequest) {
      await tx.sessionEvent.create({ data: { organisationId: a.organisationId, sessionId: s.id, type: "ACCOMMODATION_REQUEST", data: { requested: true } } });
      await prisma.accommodationRequest.create({ data: { userId: s.candidateUserId, organisationId: a.organisationId, applicationId: s.applicationId, details: input.accommodationRequest } });
    }
    // AI assessment and transcript processing are inherent to an AI interview. A candidate who
    // declines is not penalised: the employer is notified to arrange an alternative process.
    if (!input.aiAssessment || !input.transcript || (c.recordAudio && !input.recording && !c.accessibility.allowTypedAnswers)) {
      await tx.sessionEvent.create({ data: { organisationId: a.organisationId, sessionId: s.id, type: "CONSENT_DECLINED", data: { aiAssessment: input.aiAssessment, transcript: input.transcript, recording: input.recording } } });
      await audit({ organisationId: a.organisationId, actorType: "CANDIDATE", actorUserId: a.actorUserId, action: "interview.consent_declined", targetType: "InterviewSession", targetId: s.id, ip: meta.ip }, tx);
      return { ready: false, alternativeRequested: true };
    }
    await transition(tx, s, "READY", {}, { type: "CONSENT_GIVEN", data: { recording: input.recording } });
    return { ready: true, alternativeRequested: false };
  });
}

export async function recordClientEvent(a: InterviewAccess, type: string, data: Record<string, unknown>, idempotencyKey?: string) {
  const allowed = ["MIC_CHECK_PASSED", "MIC_CHECK_FAILED", "BROWSER_INFO", "DISCONNECT", "RECONNECT", "TAB_HIDDEN", "PLAYBACK_ERROR"];
  if (!allowed.includes(type)) throw badRequest("Unknown event type");
  return withOrg(a.organisationId, a.actorUserId, async (tx) => {
    const s = await loadSession(tx, a);
    await tx.sessionEvent.upsert({
      where: { sessionId_idempotencyKey: { sessionId: s.id, idempotencyKey: idempotencyKey ?? `${type}:${Date.now()}:${Math.random()}` } },
      create: { organisationId: a.organisationId, sessionId: s.id, type, data: JSON.parse(JSON.stringify(data).slice(0, 4000)), idempotencyKey },
      update: {},
    });
    if (type === "DISCONNECT" && s.status === "IN_PROGRESS") await transition(tx, s, "INTERRUPTED", {}, { data: { reason: "client_disconnect" } });
    return { ok: true };
  });
}

// ───────────────────────── Start / resume ─────────────────────────

async function buildAdaptivePlan(s: InterviewSession): Promise<PlanItem[]> {
  const c = cfg(s);
  const existing = plan(s);
  if (existing.length >= c.questionCount) return existing;
  const missing = c.questionCount - existing.length;
  const res = await llm().json({
    purpose: QGEN_PROMPT_VERSION,
    system: QGEN_SYSTEM,
    user: `Write ${missing} additional interview questions in language "${c.language}" at ${c.difficulty} difficulty, distinct from the existing ones.\n${inputBlock({
      jobTitle: c.jobTitle,
      count: missing,
      existingQuestions: existing.map((q) => q.prompt),
      competencies: c.competencies.map((x) => ({ key: x.key, name: x.name, description: x.description })),
    })}`,
    schema: QuestionSetSchema,
    usage: { organisationId: s.organisationId, sessionId: s.id },
    effort: "low",
  });
  const byKey = new Map(c.competencies.map((x) => [x.key, x.id]));
  return [
    ...existing,
    ...res.data.questions.slice(0, missing).map((q, i) => ({ position: existing.length + i, prompt: q.prompt, competencyId: byKey.get(q.competencyKey) ?? null, guidance: q.guidance, answerSeconds: c.answerSeconds, generated: true })),
  ];
}

async function speak(s: InterviewSession, text: string) {
  const audio = await ttsProvider().synthesize(text, cfg(s).voice, { organisationId: s.organisationId, sessionId: s.id });
  return audio ? { audioBase64: audio.audio.toString("base64"), audioMime: audio.mime } : { audioBase64: null, audioMime: null };
}

export async function startInterview(a: InterviewAccess, meta: RequestMeta) {
  // Provider readiness is checked before any state change: never pretend an interview can run.
  const pre = await withOrg(a.organisationId, a.actorUserId, (tx) => loadSession(tx, a));
  const c = cfg(pre);
  if (pre.mode === "REALTIME_CONVERSATIONAL" || c.questionSelection === "ADAPTIVE") llm();
  if (c.recordAudio || !c.accessibility.allowTypedAnswers) sttProvider();

  let newPlan: PlanItem[] | null = null;
  if (pre.status === "READY" && plan(pre).length < c.questionCount) newPlan = await buildAdaptivePlan(pre);

  const s = await withOrg(a.organisationId, a.actorUserId, async (tx) => {
    let s = await loadSession(tx, a);
    s = await expireIfDue(tx, s);
    if (s.status === "IN_PROGRESS") return s; // idempotent
    if (s.status === "INTERRUPTED") {
      if (!cfg(s).allowResume) throw invalidState("This interview cannot be resumed. Contact the employer.");
      await transition(tx, s, "IN_PROGRESS", { lastActivityAt: new Date() }, { type: "RESUMED" });
    } else if (s.status === "READY") {
      await transition(tx, s, "IN_PROGRESS", { startedAt: new Date(), lastActivityAt: new Date(), ...(newPlan ? { plan: newPlan as unknown as Prisma.InputJsonValue } : {}), llmModel: safeModel(), promptVersion: TURN_PROMPT_VERSION }, { type: "STARTED", data: { ua: meta.userAgent?.slice(0, 200) ?? "" } });
    } else if (s.status === "INVITED") {
      throw invalidState("Please review and accept the interview notice first");
    } else {
      throw invalidState("This interview is no longer available");
    }
    return tx.interviewSession.findFirstOrThrow({ where: { id: s.id } });
  });

  if (s.mode === "REALTIME_CONVERSATIONAL") {
    const conv = s.conversation as Turn[];
    if (conv.length === 0) {
      const first = plan(s)[0];
      const greeting = `Hello, and thank you for joining this interview for the ${c.jobTitle} role at ${c.organisationName}. I'll ask you ${c.questionCount} questions; take your time, and you can ask me to repeat or clarify at any point. Here is the first question. ${first.prompt}`;
      await withOrg(a.organisationId, a.actorUserId, (tx) => tx.interviewSession.update({ where: { id: s.id }, data: { conversation: [{ role: "interviewer", text: greeting, at: new Date().toISOString(), position: 0 }] } }));
      return { say: greeting, ...(await speak(s, greeting)), done: false };
    }
    const last = [...conv].reverse().find((t) => t.role === "interviewer")!;
    const resumeText = `Welcome back. Let's continue. ${last.text}`;
    return { say: resumeText, ...(await speak(s, resumeText)), done: false };
  }
  const q = plan(s)[s.currentIndex];
  return { question: q ? { position: q.position, prompt: q.prompt, answerSeconds: Math.round(q.answerSeconds * c.accessibility.extendedTimeMultiplier) } : null, ...(q ? await speak(s, q.prompt) : {}) };
}

function safeModel() {
  try {
    return llm().model();
  } catch {
    return null;
  }
}

// ───────────────────────── Answers (structured) ─────────────────────────

type AnswerPayload = { position: number; audio?: { buffer: Buffer; fileName: string } | null; text?: string | null; durationMs?: number | null; retake?: boolean; idempotencyKey?: string | null };

async function transcribeAnswer(s: InterviewSession, payload: AnswerPayload) {
  const c = cfg(s);
  if (payload.audio) {
    const consentRecording = await prisma.consentRecord.findFirst({ where: { sessionId: s.id, type: "INTERVIEW_RECORDING" }, orderBy: { createdAt: "desc" } });
    const file = await storeFile({ buffer: payload.audio.buffer, fileName: payload.audio.fileName, purpose: "AUDIO", allowedTypes: AUDIO_TYPES, organisationId: s.organisationId, maxBytes: 25 * 1024 * 1024 });
    const t = await sttProvider().transcribe(payload.audio.buffer, file.mimeType, c.language, { organisationId: s.organisationId, sessionId: s.id });
    // If recording consent was not given (or the template doesn't store audio), keep transcript only.
    const keepAudio = c.recordAudio && consentRecording?.granted === true;
    if (!keepAudio) {
      const { deleteStoredFile } = await import("./files");
      await deleteStoredFile(file.id);
    }
    return { transcript: t.text, segments: t.segments, durationMs: t.durationMs ?? payload.durationMs ?? null, fileId: keepAudio ? file.id : null, textResponse: null, sttMode: t.mode };
  }
  if (payload.text && c.accessibility.allowTypedAnswers) {
    return { transcript: payload.text.trim(), segments: [], durationMs: payload.durationMs ?? null, fileId: null, textResponse: payload.text.trim(), sttMode: "LIVE" as const };
  }
  throw badRequest(c.accessibility.allowTypedAnswers ? "Provide an audio recording or a typed answer" : "Provide an audio recording");
}

export async function submitStructuredAnswer(a: InterviewAccess, payload: AnswerPayload) {
  const pre = await withOrg(a.organisationId, a.actorUserId, (tx) => loadSession(tx, a));
  if (pre.mode !== "STRUCTURED_AUDIO") throw badRequest("Use the conversational endpoint for this interview");
  if (pre.status !== "IN_PROGRESS") throw invalidState("The interview is not in progress");
  if (payload.idempotencyKey) {
    const dup = await withOrg(a.organisationId, a.actorUserId, (tx) => tx.sessionEvent.findUnique({ where: { sessionId_idempotencyKey: { sessionId: pre.id, idempotencyKey: `answer:${payload.idempotencyKey}` } } }));
    if (dup) return nextStructuredState(a);
  }
  const c = cfg(pre);
  const p = plan(pre);
  const isRetake = !!payload.retake;
  const expectedPosition = isRetake ? pre.currentIndex - 1 : pre.currentIndex;
  if (payload.position !== expectedPosition || !p[expectedPosition]) throw invalidState("Answer does not match the current question");
  const t = await transcribeAnswer(pre, payload);
  if (!t.transcript) throw badRequest("We couldn't hear an answer. Please try recording again.");

  await withOrg(a.organisationId, a.actorUserId, async (tx) => {
    const s = await loadSession(tx, a);
    if (s.status !== "IN_PROGRESS" || s.version !== pre.version) throw conflict("The interview changed while your answer was uploading. Please retry.");
    const prior = await tx.answer.findMany({ where: { sessionId: s.id, position: expectedPosition } });
    if (isRetake && prior.length > c.retakesAllowed) throw invalidState("No retakes remaining for this question");
    if (!isRetake && prior.length > 0) throw conflict("This question was already answered");
    const attempt = prior.length + 1;
    const q = p[expectedPosition];
    const answer = await tx.answer.create({
      data: { organisationId: s.organisationId, sessionId: s.id, position: q.position, attempt, questionText: q.prompt, competencyId: q.competencyId, transcript: t.transcript, textResponse: t.textResponse, durationMs: t.durationMs, audioAssetId: null },
    });
    if (t.fileId) {
      const asset = await tx.audioAsset.create({ data: { organisationId: s.organisationId, sessionId: s.id, fileId: t.fileId, answerPosition: q.position, durationMs: t.durationMs } });
      await tx.answer.update({ where: { id: answer.id }, data: { audioAssetId: asset.id } });
    }
    const seqBase = (await tx.transcriptSegment.count({ where: { sessionId: s.id } })) + 1;
    await tx.transcriptSegment.createMany({
      data: [
        { organisationId: s.organisationId, sessionId: s.id, speaker: "INTERVIEWER", text: q.prompt, sequence: seqBase },
        ...(t.segments.length ? t.segments : [{ startMs: null as number | null, endMs: null as number | null, text: t.transcript }]).map((seg, i) => ({
          organisationId: s.organisationId,
          sessionId: s.id,
          answerId: answer.id,
          speaker: "CANDIDATE",
          text: seg.text,
          startMs: seg.startMs,
          endMs: seg.endMs,
          sequence: seqBase + 1 + i,
        })),
      ],
    });
    await tx.interviewSession.update({
      where: { id: s.id },
      data: { currentIndex: isRetake ? s.currentIndex : s.currentIndex + 1, lastActivityAt: new Date(), attemptsUsed: { increment: isRetake ? 1 : 0 }, version: { increment: 1 }, ...(t.sttMode === "FIXTURE" ? { providerMode: "FIXTURE" } : {}) },
    });
    if (payload.idempotencyKey) await tx.sessionEvent.create({ data: { organisationId: s.organisationId, sessionId: s.id, type: "ANSWER_SUBMITTED", data: { position: q.position, attempt }, idempotencyKey: `answer:${payload.idempotencyKey}` } });
  });
  return nextStructuredState(a);
}

async function nextStructuredState(a: InterviewAccess) {
  const s = await withOrg(a.organisationId, a.actorUserId, (tx) => loadSession(tx, a));
  const c = cfg(s);
  const q = plan(s)[s.currentIndex];
  if (!q) return { done: true, question: null };
  return { done: false, question: { position: q.position, prompt: q.prompt, answerSeconds: Math.round(q.answerSeconds * c.accessibility.extendedTimeMultiplier) }, ...(await speak(s, q.prompt)) };
}

// ───────────────────────── Conversational turns ─────────────────────────

const REPEAT_RE = /\b(repeat|say that again|pardon|didn'?t (catch|hear))\b/i;

export async function conversationalTurn(a: InterviewAccess, payload: Omit<AnswerPayload, "position" | "retake">) {
  const pre = await withOrg(a.organisationId, a.actorUserId, (tx) => loadSession(tx, a));
  if (pre.mode !== "REALTIME_CONVERSATIONAL") throw badRequest("Use the structured answer endpoint for this interview");
  if (pre.status !== "IN_PROGRESS") throw invalidState("The interview is not in progress");
  const c = cfg(pre);
  const p = plan(pre);
  const t = await transcribeAnswer(pre, { ...payload, position: pre.currentIndex });
  const conv = [...(pre.conversation as Turn[])];
  const candidateText = t.transcript || "(no speech detected)";
  conv.push({ role: "candidate", text: candidateText, at: new Date().toISOString(), position: pre.currentIndex });

  const elapsedMin = pre.startedAt ? (Date.now() - pre.startedAt.getTime()) / 60000 : 0;
  const timeUp = elapsedMin >= c.durationMinutes * c.accessibility.extendedTimeMultiplier;
  const current = p[pre.currentIndex];
  const next = p[pre.currentIndex + 1] ?? null;
  const followUpsRemaining = Math.max(0, c.maxFollowUps - pre.followUpsUsed);

  let decision: { action: "ASK_NEXT" | "FOLLOW_UP" | "CLARIFY" | "REPEAT" | "END"; say: string };
  if (!t.transcript) decision = { action: "REPEAT", say: `I didn't catch that. ${current.prompt}` };
  else if (REPEAT_RE.test(candidateText) && candidateText.split(/\s+/).length < 12) decision = { action: "REPEAT", say: `Of course. ${current.prompt}` };
  else if (timeUp) decision = { action: "END", say: "We've reached the time for this interview. Thank you very much for your answers. The hiring team will review your interview and be in touch about next steps." };
  else {
    const res = await llm().json({
      purpose: TURN_PROMPT_VERSION,
      system: TURN_SYSTEM,
      user: `Decide the next interviewer turn.\n${inputBlock({
        jobTitle: c.jobTitle,
        language: c.language,
        currentQuestion: current.prompt,
        currentCompetency: c.competencies.find((x) => x.id === current.competencyId)?.name ?? null,
        nextQuestion: next?.prompt ?? null,
        followUpsRemaining,
        lastAnswer: candidateText,
        recentConversation: conv.slice(-8).map((x) => ({ role: x.role, text: x.text })),
        minutesRemaining: Math.max(0, Math.round(c.durationMinutes - elapsedMin)),
      })}`,
      schema: TurnSchema,
      usage: { organisationId: pre.organisationId, sessionId: pre.id },
      fast: true,
      effort: "low",
      maxTokens: 2000,
    });
    decision = res.data;
    // Server-side guards: the model cannot exceed follow-up limits or skip/extend the plan.
    if (decision.action === "FOLLOW_UP" && followUpsRemaining === 0) decision = next ? { action: "ASK_NEXT", say: next.prompt } : { action: "END", say: decision.say };
    if (decision.action === "ASK_NEXT" && !next) decision = { action: "END", say: "Thank you, that covers all of my questions. The hiring team will review your interview and be in touch about next steps." };
    if (decision.action === "END" && next && !timeUp) decision = { action: "ASK_NEXT", say: next.prompt };
  }

  const isAnswer = decision.action !== "REPEAT" && decision.action !== "CLARIFY" && !!t.transcript;
  await withOrg(a.organisationId, a.actorUserId, async (tx) => {
    const s = await loadSession(tx, a);
    if (s.version !== pre.version) throw conflict("The interview changed. Please retry.");
    if (isAnswer) {
      const isFollowUpAnswer = (pre.conversation as Turn[]).at(-1)?.followUp === true;
      const position = isFollowUpAnswer ? 1000 + (await tx.answer.count({ where: { sessionId: s.id, isFollowUp: true } })) : s.currentIndex;
      const answer = await tx.answer.create({
        data: { organisationId: s.organisationId, sessionId: s.id, position, attempt: 1, questionText: [...(pre.conversation as Turn[])].reverse().find((x) => x.role === "interviewer")!.text, competencyId: current.competencyId, isFollowUp: isFollowUpAnswer, transcript: t.transcript, textResponse: t.textResponse, durationMs: t.durationMs },
      });
      if (t.fileId) {
        const asset = await tx.audioAsset.create({ data: { organisationId: s.organisationId, sessionId: s.id, fileId: t.fileId, answerPosition: position, durationMs: t.durationMs } });
        await tx.answer.update({ where: { id: answer.id }, data: { audioAssetId: asset.id } });
      }
      const seq = (await tx.transcriptSegment.count({ where: { sessionId: s.id } })) + 1;
      await tx.transcriptSegment.create({ data: { organisationId: s.organisationId, sessionId: s.id, answerId: answer.id, speaker: "CANDIDATE", text: t.transcript, sequence: seq } });
    }
    conv.push({ role: "interviewer", text: decision.say, at: new Date().toISOString(), position: decision.action === "ASK_NEXT" ? s.currentIndex + 1 : s.currentIndex, followUp: decision.action === "FOLLOW_UP" });
    const seq2 = (await tx.transcriptSegment.count({ where: { sessionId: s.id } })) + 1;
    await tx.transcriptSegment.create({ data: { organisationId: s.organisationId, sessionId: s.id, speaker: "INTERVIEWER", text: decision.say, sequence: seq2 } });
    await tx.interviewSession.update({
      where: { id: s.id },
      data: {
        conversation: conv as unknown as Prisma.InputJsonValue,
        currentIndex: decision.action === "ASK_NEXT" ? s.currentIndex + 1 : s.currentIndex,
        followUpsUsed: decision.action === "FOLLOW_UP" ? { increment: 1 } : decision.action === "ASK_NEXT" ? 0 : undefined,
        lastActivityAt: new Date(),
        version: { increment: 1 },
        ...(t.sttMode === "FIXTURE" || llm().mode === "FIXTURE" ? { providerMode: "FIXTURE" } : {}),
      },
    });
  });
  const done = decision.action === "END";
  if (done) await completeInterview(a, "conversation_ended");
  return { say: decision.say, action: decision.action, done, transcript: c.accessibility.captions ? candidateText : null, ...(await speak(pre, decision.say)) };
}

// ───────────────────────── Completion ─────────────────────────

async function finalise(tx: Tx, s: InterviewSession, reason: string) {
  const answers = await tx.answer.count({ where: { sessionId: s.id } });
  if (answers === 0) throw invalidState("Answer at least one question before finishing");
  await transition(tx, s, "PROCESSING", { completedAt: new Date() }, { type: "COMPLETED", data: { reason } });
  await settleCredit(tx, s, "PROCESSING", reason, answers);
  await moveAppToStageKind(tx, s.organisationId, s.applicationId, "AI_INTERVIEW_COMPLETED", null, "AI interview completed");
}

export async function completeInterview(a: InterviewAccess, reason = "candidate_completed") {
  const res = await withOrg(a.organisationId, a.actorUserId, async (tx) => {
    const s = await loadSession(tx, a);
    if (["PROCESSING", "ASSESSED", "REQUIRES_REVIEW", "REVIEWED", "CLOSED"].includes(s.status)) return { already: true, s };
    if (!["IN_PROGRESS", "INTERRUPTED"].includes(s.status)) throw invalidState("The interview is not in progress");
    if (s.mode === "STRUCTURED_AUDIO" && s.currentIndex < plan(s).length && reason === "candidate_completed") {
      // Partial submission is allowed (e.g. candidate chooses to stop) — recorded explicitly.
      await tx.sessionEvent.create({ data: { organisationId: s.organisationId, sessionId: s.id, type: "PARTIAL_SUBMISSION", data: { answered: s.currentIndex, planned: plan(s).length } } });
    }
    await finalise(tx, s, reason);
    const inv = await tx.interviewInvitation.findFirstOrThrow({ where: { id: s.invitationId } });
    const app = await tx.application.findFirstOrThrow({ where: { id: s.applicationId }, include: { candidate: true } });
    return { already: false, s, inv, app };
  });
  if (!res.already && "app" in res && res.app) {
    await enqueue("interview.assess", { sessionId: res.s.id, organisationId: res.s.organisationId });
    const c = cfg(res.s);
    await sendEmail("interviewCompleted", { name: res.app.candidate.firstName, job: c.jobTitle }, { to: res.inv!.email, userId: res.app.candidateUserId ?? undefined, organisationId: res.s.organisationId, idempotencyKey: `interview-done:${res.s.id}` });
  }
  return { completed: true };
}

// ───────────────────────── Scheduled maintenance ─────────────────────────

/** Interrupt idle sessions; expire unused invitations; finalise abandoned partial interviews. */
export async function sweepSessions(now = new Date()) {
  const idle = new Date(now.getTime() - 15 * 60_000);
  const candidates = await withSystem("session sweep", (tx) =>
    tx.interviewSession.findMany({
      where: {
        OR: [
          { status: "IN_PROGRESS", lastActivityAt: { lt: idle } },
          { status: { in: ["INVITED", "READY", "INTERRUPTED"] }, expiresAt: { lt: now } },
        ],
      },
      take: 500,
    }),
  );
  let changed = 0;
  for (const s of candidates) {
    try {
      await withOrg(s.organisationId, null, async (tx) => {
        const fresh = await tx.interviewSession.findFirstOrThrow({ where: { id: s.id } });
        if (fresh.status === "IN_PROGRESS") {
          await transition(tx, fresh, "INTERRUPTED", {}, { data: { reason: "idle_timeout" } });
        } else {
          await expireIfDue(tx, fresh);
        }
      });
      changed++;
      const after = await withOrg(s.organisationId, null, (tx) => tx.interviewSession.findFirstOrThrow({ where: { id: s.id } }));
      if (after.status === "PROCESSING") await enqueue("interview.assess", { sessionId: s.id, organisationId: s.organisationId });
    } catch (err) {
      logger.warn({ err: (err as Error).message, sessionId: s.id }, "session sweep failed");
    }
  }
  return { changed };
}

export async function sendReminders(now = new Date()) {
  const soon = new Date(now.getTime() + 48 * 3600_000);
  const invs = await withSystem("interview reminders", (tx) =>
    tx.interviewInvitation.findMany({ where: { revokedAt: null, remindersSent: 0, expiresAt: { gt: now, lt: soon }, session: { status: { in: ["INVITED", "READY"] } } }, include: { application: { include: { candidate: true } }, session: true }, take: 500 }),
  );
  for (const inv of invs) {
    const c = inv.session!.config as unknown as SessionConfig;
    const url = inv.session?.candidateUserId ? `${env().APP_URL}/interview/i/${inv.id}` : `${env().APP_URL}/student/applications`;
    // We cannot re-send the original token (only its hash is stored); account holders get a
    // direct link, others are pointed to their original invitation email.
    await sendEmail("interviewReminder", { name: inv.application.candidate.firstName, job: c.jobTitle, url, expires: inv.expiresAt.toUTCString() }, { to: inv.email, userId: inv.application.candidateUserId ?? undefined, organisationId: inv.organisationId, topic: "interview_reminders", idempotencyKey: `reminder:${inv.id}` });
    await withOrg(inv.organisationId, null, (tx) => tx.interviewInvitation.update({ where: { id: inv.id }, data: { remindersSent: { increment: 1 } } }));
  }
  return { sent: invs.length };
}

// ───────────────────────── HR: view interview ─────────────────────────

export async function getInterviewForHr(ctx: OrgContext, sessionId: string) {
  return withOrg(ctx.org.id, ctx.userId, async (tx) => {
    const s = await tx.interviewSession.findFirst({ where: { id: sessionId, organisationId: ctx.org.id } });
    if (!s) throw notFound("Interview");
    await loadApplicationScoped(ctx, tx, s.applicationId);
    const canTranscript = ctx.can("interviews.view_transcripts");
    const [answers, transcript, audio, events, assessment, consents] = await Promise.all([
      tx.answer.findMany({ where: { sessionId: s.id }, orderBy: [{ position: "asc" }, { attempt: "asc" }] }),
      canTranscript ? tx.transcriptSegment.findMany({ where: { sessionId: s.id }, orderBy: { sequence: "asc" } }) : Promise.resolve([]),
      ctx.can("interviews.view_recordings") ? tx.audioAsset.findMany({ where: { sessionId: s.id } }) : Promise.resolve([]),
      tx.sessionEvent.findMany({ where: { sessionId: s.id }, orderBy: { createdAt: "asc" } }),
      tx.assessment.findFirst({ where: { sessionId: s.id }, include: { results: { include: { evidence: true } }, reviews: { orderBy: { createdAt: "desc" } } } }),
      tx.consentRecord.findMany({ where: { sessionId: s.id } }),
    ]);
    return {
      session: { id: s.id, status: s.status, mode: s.mode, providerMode: s.providerMode, startedAt: s.startedAt, completedAt: s.completedAt, expiresAt: s.expiresAt, billable: s.billable, billingOutcome: s.billingOutcome, applicationId: s.applicationId, config: s.config, llmModel: s.llmModel },
      answers: answers.map((x) => ({ ...x, transcript: canTranscript ? x.transcript : null, textResponse: canTranscript ? x.textResponse : null })),
      transcript,
      audio,
      events,
      assessment,
      consents,
      permissions: { transcripts: canTranscript, recordings: ctx.can("interviews.view_recordings"), review: ctx.can("assessments.review") },
    };
  });
}

export function assertCandidateNotHr(session: SessionInfo | null) {
  if (session && session.user.platformRole !== "NONE") throw forbidden("Platform administrators cannot take interviews");
}

export { CANDIDATE_ACTIVE_STATES };
