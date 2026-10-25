import { z } from "zod";
import { prisma } from "../db/client";
import { AppError, invalidState, notFound } from "../errors";
import { aiJson, aiTranscribe, assertAiAvailable } from "../ai/access";
import { PRACTICE_FB_SYSTEM, PRACTICE_FB_VERSION, PRACTICE_Q_SYSTEM, PRACTICE_Q_VERSION, PracticeFeedbackSchema, PracticeQuestionsSchema, inputBlock } from "../ai/prompts";
import { grant, reserve, consume, release, balance } from "../billing/credits";
import { enqueue } from "../queue";
import { AUDIO_TYPES, sniffType } from "../providers/scan";

/**
 * Private practice interviews. Owned by the student, billed only against the
 * student's own practice allowance/credits (never an employer's), never
 * visible to employers, and never used for hiring decisions.
 */
export const startPracticeSchema = z.object({
  targetRole: z.string().trim().min(2).max(120),
  focus: z.enum(["GENERAL", "ROLE_SPECIFIC"]).default("GENERAL"),
  language: z.string().trim().min(2).max(10).default("en"),
  mode: z.enum(["REALTIME_CONVERSATIONAL", "STRUCTURED_AUDIO"]).default("STRUCTURED_AUDIO"),
  durationMinutes: z.number().int().min(3).max(45).default(10),
  questionCount: z.number().int().min(1).max(10).default(4),
});

async function freeMonthlyAllowance() {
  const s = await prisma.platformSetting.findUnique({ where: { key: "practice.freeMonthly" } });
  return typeof s?.value === "number" ? s.value : 3;
}

/** Grant this month's free practice sessions (idempotent per user per month). */
export async function ensureMonthlyPracticeAllowance(userId: string, now = new Date()) {
  const amount = await freeMonthlyAllowance();
  if (amount <= 0) return;
  const period = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  await prisma.$transaction((tx) => grant(tx, { userId }, amount, "GRANT_FREE_PRACTICE", `free-practice:${period}`, { expiresAt: end, reason: `Free practice allowance ${period}` }));
}

export async function practiceBalance(userId: string) {
  await ensureMonthlyPracticeAllowance(userId);
  return prisma.$transaction((tx) => balance(tx, { userId }));
}

export async function startPractice(userId: string, input: z.infer<typeof startPracticeSchema>) {
  // Practice is personal: it runs only on platform AI granted to personal accounts. Fail fast.
  const scope = { kind: "PERSONAL" as const, userId };
  await assertAiAvailable(scope, "PRACTICE_COACHING");
  const active = await prisma.practiceInterview.count({ where: { userId, status: "IN_PROGRESS", startedAt: { gt: new Date(Date.now() - 2 * 3600_000) } } });
  if (active >= 2) throw invalidState("Finish or abandon your current practice session first");
  await ensureMonthlyPracticeAllowance(userId);

  const res = await aiJson(scope, "PRACTICE_COACHING", {
    purpose: PRACTICE_Q_VERSION,
    system: PRACTICE_Q_SYSTEM,
    user: `Create ${input.questionCount} ${input.focus === "ROLE_SPECIFIC" ? "role-specific" : "general behavioural"} practice questions in language "${input.language}".\n${inputBlock({ role: input.targetRole, count: input.questionCount })}`,
    schema: PracticeQuestionsSchema,
    fast: true,
    effort: "low",
  });
  const questions = res.data.questions.slice(0, input.questionCount);
  const p = await prisma.practiceInterview.create({
    data: { userId, ...input, questions, providerMode: res.mode },
  });
  try {
    await prisma.$transaction((tx) => reserve(tx, { userId }, `practice:${p.id}`, p.id));
  } catch (e) {
    await prisma.practiceInterview.delete({ where: { id: p.id } });
    if (e instanceof AppError && e.code === "PAYMENT_REQUIRED") throw new AppError("PAYMENT_REQUIRED", "You've used this month's free practice sessions. Purchase practice credits or try again next month.");
    throw e;
  }
  await prisma.practiceInterview.update({ where: { id: p.id }, data: { creditEntryId: `practice:${p.id}` } });
  return getPractice(userId, p.id);
}

export async function getPractice(userId: string, id: string) {
  const p = await prisma.practiceInterview.findFirst({ where: { id, userId }, include: { answers: { orderBy: { position: "asc" } }, feedback: true } });
  if (!p) throw notFound("Practice session");
  const questions = p.questions as string[];
  return { ...p, questions, currentQuestion: p.status === "IN_PROGRESS" ? (questions[p.currentIndex] ?? null) : null, ttsMode: "browser" as const }; // practice uses the browser's own voice
}

export async function listPractice(userId: string) {
  return prisma.practiceInterview.findMany({ where: { userId }, orderBy: { createdAt: "desc" }, include: { feedback: { select: { summary: true } } }, take: 50 });
}

export async function answerPractice(userId: string, id: string, payload: { audio?: Buffer | null; text?: string | null; durationMs?: number | null }) {
  const p = await prisma.practiceInterview.findFirst({ where: { id, userId } });
  if (!p) throw notFound("Practice session");
  if (p.status !== "IN_PROGRESS") throw invalidState("This practice session has ended");
  const questions = p.questions as string[];
  const q = questions[p.currentIndex];
  if (!q) throw invalidState("All questions answered");
  let transcript: string;
  if (payload.audio) {
    const mime = sniffType(payload.audio, AUDIO_TYPES);
    if (!mime) throw new AppError("BAD_REQUEST", "Unsupported audio format");
    // Practice audio is transcribed and discarded — it is never stored.
    transcript = (await aiTranscribe({ kind: "PERSONAL", userId, sessionId: null }, payload.audio, mime, p.language)).text;
  } else if (payload.text?.trim()) {
    transcript = payload.text.trim().slice(0, 8000);
  } else {
    throw new AppError("BAD_REQUEST", "Provide a recording or a typed answer");
  }
  await prisma.$transaction([
    prisma.practiceAnswer.create({ data: { practiceId: p.id, position: p.currentIndex, question: q, transcript, durationMs: payload.durationMs ?? null } }),
    prisma.practiceInterview.update({ where: { id: p.id }, data: { currentIndex: p.currentIndex + 1 } }),
  ]);
  const next = questions[p.currentIndex + 1] ?? null;
  return { transcript, nextQuestion: next, done: !next };
}

export async function completePractice(userId: string, id: string) {
  const p = await prisma.practiceInterview.findFirst({ where: { id, userId }, include: { _count: { select: { answers: true } } } });
  if (!p) throw notFound("Practice session");
  if (p.status !== "IN_PROGRESS") return { status: p.status };
  if (p._count.answers === 0) {
    await prisma.$transaction(async (tx) => {
      await release(tx, { userId }, `practice:${p.id}`, p.id, "no answers");
      await tx.practiceInterview.update({ where: { id: p.id }, data: { status: "ABANDONED", completedAt: new Date() } });
    });
    return { status: "ABANDONED" };
  }
  await prisma.$transaction(async (tx) => {
    await consume(tx, { userId }, `practice:${p.id}`, p.id);
    await tx.practiceInterview.update({ where: { id: p.id }, data: { status: "COMPLETED", completedAt: new Date() } });
  });
  await enqueue("practice.feedback", { practiceId: p.id, userId });
  return { status: "COMPLETED" };
}

/** Worker: generate private coaching feedback. */
export async function generatePracticeFeedback(practiceId: string) {
  const p = await prisma.practiceInterview.findUnique({ where: { id: practiceId }, include: { answers: { orderBy: { position: "asc" } }, feedback: true } });
  if (!p || p.feedback) return;
  try {
    const res = await aiJson({ kind: "PERSONAL", userId: p.userId }, "PRACTICE_COACHING", {
      purpose: PRACTICE_FB_VERSION,
      system: PRACTICE_FB_SYSTEM,
      user: `Give coaching feedback for this practice interview for the role "${p.targetRole}".\n${inputBlock({ answers: p.answers.map((a) => ({ position: a.position, question: a.question, answer: a.transcript })) })}`,
      schema: PracticeFeedbackSchema,
      effort: "medium",
    });
    await prisma.practiceFeedback.create({
      data: { practiceId: p.id, summary: res.data.summary, strengths: res.data.strengths, improvements: res.data.improvements, perQuestion: res.data.perQuestion, modelVersion: res.model, promptVersion: PRACTICE_FB_VERSION },
    });
  } catch (err) {
    await prisma.practiceInterview.update({ where: { id: p.id }, data: { status: "FAILED" } });
    // The student is not charged for a session whose feedback could not be produced.
    await prisma.$transaction((tx) => grant(tx, { userId: p.userId }, 1, "ADJUSTMENT", `practice-refund:${p.id}`, { reason: "Feedback generation failed", reference: p.id }));
    if (err instanceof AppError && ["PROVIDER_NOT_CONFIGURED", "AI_ACCESS_DENIED", "AI_LIMIT_REACHED", "PROVIDER_QUOTA_EXCEEDED"].includes(err.code)) return; // not transient
    throw err;
  }
}

export async function practiceProgress(userId: string) {
  const sessions = await prisma.practiceInterview.findMany({ where: { userId, status: "COMPLETED" }, include: { feedback: true }, orderBy: { completedAt: "asc" } });
  const score = (v: string) => (v === "HIGH" ? 3 : v === "MEDIUM" ? 2 : 1);
  return sessions
    .filter((s) => s.feedback)
    .map((s) => {
      const pq = (s.feedback!.perQuestion as { relevance: string; clarity: string; completeness: string }[]) ?? [];
      const avg = (k: "relevance" | "clarity" | "completeness") => (pq.length ? pq.reduce((a, x) => a + score(x[k]), 0) / pq.length : null);
      return { id: s.id, date: s.completedAt, role: s.targetRole, relevance: avg("relevance"), clarity: avg("clarity"), completeness: avg("completeness") };
    });
}
