import { z } from "zod";
import { withOrg } from "../db/tenant";
import { badRequest, conflict, notFound } from "../errors";
import { audit } from "../audit";
import type { OrgContext } from "../auth/context";
import { aiJson } from "../ai/access";
import { QGEN_PROMPT_VERSION, QGEN_SYSTEM, QuestionSetSchema, inputBlock } from "../ai/prompts";
import { getEntitlements } from "../billing/entitlements";
import type { RequestMeta } from "../http/route";

// ───────────────────────── Competencies & rubrics ─────────────────────────

const levelSchema = z.object({ rating: z.enum(["R1", "R2", "R3", "R4", "R5"]), label: z.string().trim().min(1).max(40), descriptor: z.string().trim().min(5).max(500) });

export const competencySchema = z.object({
  key: z.string().trim().regex(/^[a-z0-9_]{2,40}$/, "Use lowercase letters, numbers and underscores"),
  name: z.string().trim().min(2).max(80),
  description: z.string().trim().min(10).max(1000),
  category: z.enum(["TECHNICAL", "BEHAVIOURAL", "GENERAL"]).default("GENERAL"),
  rubric: z.object({
    criteria: z.array(z.string().trim().min(3).max(300)).min(1).max(12),
    indicators: z.object({ positive: z.array(z.string().max(300)).max(12), negative: z.array(z.string().max(300)).max(12) }),
    levels: z.array(levelSchema).length(5),
    evidenceRequirements: z.string().trim().min(5).max(1000),
    scoringGuidance: z.string().trim().min(5).max(2000),
  }),
});

export async function listCompetencies(ctx: OrgContext) {
  return withOrg(ctx.org.id, ctx.userId, (tx) =>
    tx.competency.findMany({
      where: { organisationId: ctx.org.id, archivedAt: null },
      include: { rubrics: { orderBy: { version: "desc" } } },
      orderBy: { name: "asc" },
    }),
  );
}

export async function createCompetency(ctx: OrgContext, input: z.infer<typeof competencySchema>, meta: RequestMeta) {
  ctx.assert("interviews.configure");
  return withOrg(ctx.org.id, ctx.userId, async (tx) => {
    const c = await tx.competency.create({ data: { organisationId: ctx.org.id, key: input.key, name: input.name, description: input.description, category: input.category } });
    await tx.competencyRubric.create({ data: { organisationId: ctx.org.id, competencyId: c.id, version: 1, ...input.rubric, createdById: ctx.userId } });
    await audit({ organisationId: ctx.org.id, actorUserId: ctx.userId, action: "competency.created", targetType: "Competency", targetId: c.id, ip: meta.ip }, tx);
    return c;
  });
}

/** Rubric edits create a new version; prior assessments keep referencing the version they used. */
export async function updateCompetency(ctx: OrgContext, id: string, input: Partial<z.infer<typeof competencySchema>>, meta: RequestMeta) {
  ctx.assert("interviews.configure");
  return withOrg(ctx.org.id, ctx.userId, async (tx) => {
    const c = await tx.competency.findFirst({ where: { id, organisationId: ctx.org.id }, include: { rubrics: { orderBy: { version: "desc" }, take: 1 } } });
    if (!c) throw notFound("Competency");
    await tx.competency.update({ where: { id }, data: { name: input.name, description: input.description, category: input.category } });
    if (input.rubric) {
      const next = (c.rubrics[0]?.version ?? 0) + 1;
      await tx.competencyRubric.updateMany({ where: { competencyId: id }, data: { isCurrent: false } });
      await tx.competencyRubric.create({ data: { organisationId: ctx.org.id, competencyId: id, version: next, ...input.rubric, createdById: ctx.userId } });
    }
    await audit({ organisationId: ctx.org.id, actorUserId: ctx.userId, action: "competency.updated", targetType: "Competency", targetId: id, ip: meta.ip, metadata: { newRubricVersion: !!input.rubric } }, tx);
    return tx.competency.findFirstOrThrow({ where: { id }, include: { rubrics: { orderBy: { version: "desc" } } } });
  });
}

export async function archiveCompetency(ctx: OrgContext, id: string) {
  ctx.assert("interviews.configure");
  return withOrg(ctx.org.id, ctx.userId, async (tx) => {
    const r = await tx.competency.updateMany({ where: { id, organisationId: ctx.org.id }, data: { archivedAt: new Date() } });
    if (!r.count) throw notFound("Competency");
  });
}

// ───────────────────────── Interview templates ─────────────────────────

export const questionInput = z.object({
  prompt: z.string().trim().min(5).max(1000),
  guidance: z.string().trim().max(2000).nullable().optional(),
  competencyId: z.string().nullable().optional(),
  answerSeconds: z.number().int().min(15).max(900).nullable().optional(),
});

export const templateSchema = z
  .object({
    name: z.string().trim().min(2).max(120),
    description: z.string().trim().max(2000).nullable().optional(),
    mode: z.enum(["REALTIME_CONVERSATIONAL", "STRUCTURED_AUDIO"]),
    language: z.string().trim().min(2).max(10).default("en"),
    durationMinutes: z.number().int().min(3).max(120),
    questionCount: z.number().int().min(1).max(30),
    difficulty: z.enum(["ENTRY", "INTERMEDIATE", "ADVANCED", "EXPERT"]).default("INTERMEDIATE"),
    questionSelection: z.enum(["FIXED", "ADAPTIVE"]).default("FIXED"),
    maxFollowUps: z.number().int().min(0).max(10).default(1),
    answerSeconds: z.number().int().min(15).max(900).default(120),
    prepSeconds: z.number().int().min(0).max(300).default(15),
    retakesAllowed: z.number().int().min(0).max(3).default(0),
    recordAudio: z.boolean().default(true),
    storeTranscript: z.boolean().default(true),
    showTranscriptToCandidate: z.boolean().default(false),
    allowResume: z.boolean().default(true),
    voice: z.string().max(60).nullable().optional(),
    candidateInstructions: z.string().trim().max(4000).nullable().optional(),
    accessibilityOptions: z.object({ allowTypedAnswers: z.boolean().default(true), extendedTimeMultiplier: z.number().min(1).max(3).default(1), captions: z.boolean().default(true) }).prefault({}),
    competencyIds: z.array(z.string()).min(1, "Select at least one competency").max(12),
    questions: z.array(questionInput).max(30).default([]),
  })
  .refine((t) => t.questions.length === 0 || t.questions.length <= t.questionCount || t.questionSelection === "ADAPTIVE", { message: "More questions than the configured question count", path: ["questions"] })
  .refine((t) => t.storeTranscript || !t.showTranscriptToCandidate, { message: "Transcripts must be stored to show them to candidates", path: ["showTranscriptToCandidate"] });

export type TemplateInput = z.infer<typeof templateSchema>;

async function assertModeAllowed(orgId: string, mode: string) {
  if (mode !== "REALTIME_CONVERSATIONAL") return;
  const ent = await getEntitlements(orgId);
  if (ent.raw["feature.realtime_interviews"] === "false") throw badRequest("Your plan does not include real-time conversational interviews");
}

export async function listTemplates(ctx: OrgContext) {
  return withOrg(ctx.org.id, ctx.userId, (tx) =>
    tx.interviewTemplate.findMany({
      where: { organisationId: ctx.org.id, archivedAt: null },
      include: { _count: { select: { questions: true, invitations: true } }, competencies: { include: { competency: { select: { name: true } } } } },
      orderBy: { updatedAt: "desc" },
    }),
  );
}

export async function getTemplate(ctx: OrgContext, id: string) {
  return withOrg(ctx.org.id, ctx.userId, async (tx) => {
    const t = await tx.interviewTemplate.findFirst({
      where: { id, organisationId: ctx.org.id },
      include: { questions: { orderBy: { position: "asc" } }, competencies: { include: { competency: true } } },
    });
    if (!t) throw notFound("Interview template");
    return t;
  });
}

export async function saveTemplate(ctx: OrgContext, id: string | null, input: TemplateInput, meta: RequestMeta) {
  ctx.assert("interviews.configure");
  await assertModeAllowed(ctx.org.id, input.mode);
  return withOrg(ctx.org.id, ctx.userId, async (tx) => {
    const comps = await tx.competency.findMany({ where: { id: { in: input.competencyIds }, organisationId: ctx.org.id, archivedAt: null } });
    if (comps.length !== new Set(input.competencyIds).size) throw notFound("Competency");
    for (const q of input.questions) if (q.competencyId && !input.competencyIds.includes(q.competencyId)) throw badRequest("Each question's competency must be one of the template competencies");
    const { competencyIds, questions, ...data } = input;
    let templateId = id;
    if (id) {
      const existing = await tx.interviewTemplate.findFirst({ where: { id, organisationId: ctx.org.id } });
      if (!existing) throw notFound("Interview template");
      // Sessions snapshot the template at invitation time, so editing never changes in-flight interviews.
      await tx.interviewTemplate.update({ where: { id }, data: { ...data, version: { increment: 1 } } });
      await tx.interviewQuestion.deleteMany({ where: { templateId: id, organisationId: ctx.org.id } });
      await tx.templateCompetency.deleteMany({ where: { templateId: id, organisationId: ctx.org.id } });
    } else {
      const t = await tx.interviewTemplate.create({ data: { ...data, organisationId: ctx.org.id, createdById: ctx.userId } });
      templateId = t.id;
    }
    await tx.templateCompetency.createMany({ data: competencyIds.map((competencyId) => ({ organisationId: ctx.org.id, templateId: templateId!, competencyId })) });
    if (questions.length) {
      await tx.interviewQuestion.createMany({
        data: questions.map((q, i) => ({ organisationId: ctx.org.id, templateId: templateId!, position: i, prompt: q.prompt, guidance: q.guidance ?? null, competencyId: q.competencyId ?? null, answerSeconds: q.answerSeconds ?? null })),
      });
    }
    await audit({ organisationId: ctx.org.id, actorUserId: ctx.userId, action: id ? "template.updated" : "template.created", targetType: "InterviewTemplate", targetId: templateId!, ip: meta.ip }, tx);
    return tx.interviewTemplate.findFirstOrThrow({ where: { id: templateId! }, include: { questions: { orderBy: { position: "asc" } }, competencies: true } });
  });
}

export async function archiveTemplate(ctx: OrgContext, id: string) {
  ctx.assert("interviews.configure");
  return withOrg(ctx.org.id, ctx.userId, async (tx) => {
    const inUse = await tx.job.count({ where: { interviewTemplateId: id, organisationId: ctx.org.id, status: { in: ["PUBLISHED", "PAUSED"] } } });
    if (inUse) throw conflict("This template is used by active vacancies");
    const r = await tx.interviewTemplate.updateMany({ where: { id, organisationId: ctx.org.id }, data: { archivedAt: new Date() } });
    if (!r.count) throw notFound("Interview template");
  });
}

export const generateQuestionsSchema = z.object({
  competencyIds: z.array(z.string()).min(1).max(12),
  count: z.number().int().min(1).max(20),
  jobTitle: z.string().max(160).optional(),
  difficulty: z.string().max(20).optional(),
  language: z.string().max(10).default("en"),
});

/** AI-suggested questions for HR to review/edit — never used without being saved by a human. */
export async function generateQuestions(ctx: OrgContext, input: z.infer<typeof generateQuestionsSchema>) {
  ctx.assert("interviews.configure");
  const comps = await withOrg(ctx.org.id, ctx.userId, (tx) => tx.competency.findMany({ where: { id: { in: input.competencyIds }, organisationId: ctx.org.id }, include: { rubrics: { where: { isCurrent: true } } } }));
  if (!comps.length) throw notFound("Competency");
  const res = await aiJson({ kind: "ORG", organisationId: ctx.org.id, userId: ctx.userId }, "QUESTION_GENERATION", {
    purpose: QGEN_PROMPT_VERSION,
    system: QGEN_SYSTEM,
    user: `Write ${input.count} interview questions in language "${input.language}".\n${inputBlock({
      jobTitle: input.jobTitle,
      difficulty: input.difficulty,
      count: input.count,
      competencies: comps.map((c) => ({ key: c.key, name: c.name, description: c.description, criteria: c.rubrics[0]?.criteria ?? [] })),
    })}`,
    schema: QuestionSetSchema,
    effort: "low",
  });
  const byKey = new Map(comps.map((c) => [c.key, c.id]));
  return {
    providerMode: res.mode,
    aiSource: res.resolution.source,
    questions: res.data.questions.slice(0, input.count).map((q) => ({ prompt: q.prompt, guidance: q.guidance, competencyId: byKey.get(q.competencyKey) ?? comps[0].id })),
  };
}
