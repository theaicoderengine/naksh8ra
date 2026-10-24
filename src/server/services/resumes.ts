import { z } from "zod";
import pdf from "pdf-parse/lib/pdf-parse.js";
import mammoth from "mammoth";
import { prisma } from "../db/client";
import { AppError, notFound } from "../errors";
import { storeFile, readFile, deleteStoredFile } from "./files";
import { RESUME_TYPES } from "../providers/scan";
import { enqueue } from "../queue";
import { llm } from "../providers/llm";
import { RESUME_SYSTEM, ResumeSchema, inputBlock, RESUME_PROMPT_VERSION, type ParsedResume } from "../ai/prompts";
import { logger } from "../logger";

export async function extractText(buffer: Buffer, mime: string): Promise<string> {
  if (mime === "application/pdf") {
    const res = await pdf(buffer);
    return res.text;
  }
  if (mime.includes("wordprocessingml")) {
    const res = await mammoth.extractRawText({ buffer });
    return res.value;
  }
  return buffer.toString("utf8");
}

/** Conservative heuristic extraction used when no AI provider is configured (and to cross-check AI output). */
export function heuristicParse(text: string): ParsedResume {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const email = text.match(/[\w.+-]+@[\w-]+(\.[\w-]+)+/)?.[0] ?? null;
  const phone = text.match(/\+?\d[\d\s().-]{7,}\d/)?.[0]?.trim() ?? null;
  const skillsLine = lines.find((l) => /^skills?\s*[:\-]/i.test(l));
  const skills = skillsLine ? skillsLine.replace(/^skills?\s*[:\-]\s*/i, "").split(/[,;|•]/).map((s) => s.trim()).filter((s) => s && s.length < 40).slice(0, 40) : [];
  return {
    name: lines[0] && lines[0].length < 60 && !lines[0].includes("@") ? lines[0] : null,
    email,
    phone,
    location: null,
    headline: lines[1] && lines[1].length < 100 ? lines[1] : null,
    skills,
    education: [],
    experience: [],
    certifications: [],
    languages: [],
    uncertainFields: ["location", "education", "experience"],
  };
}

export async function uploadResume(userId: string, file: { buffer: Buffer; fileName: string }, label?: string) {
  const count = await prisma.resumeVersion.count({ where: { userId } });
  if (count >= 10) throw new AppError("BAD_REQUEST", "You can keep up to 10 resume versions. Delete one first.");
  const stored = await storeFile({ buffer: file.buffer, fileName: file.fileName, purpose: "RESUME", allowedTypes: RESUME_TYPES, ownerUserId: userId });
  const rv = await prisma.resumeVersion.create({
    data: { userId, label: label?.trim() || file.fileName.slice(0, 80), fileId: stored.id, isDefault: count === 0 },
  });
  await enqueue("resume.parse", { resumeVersionId: rv.id, userId });
  return prisma.resumeVersion.findUniqueOrThrow({ where: { id: rv.id } });
}

/** Worker: parse a resume version. */
export async function parseResume(resumeVersionId: string) {
  const rv = await prisma.resumeVersion.findUnique({ where: { id: resumeVersionId } });
  if (!rv) return;
  try {
    const { file, buffer } = await readFile(rv.fileId);
    const text = (await extractText(buffer, file.mimeType)).slice(0, 60_000);
    if (text.trim().length < 30) {
      await prisma.resumeVersion.update({ where: { id: rv.id }, data: { extractedText: text, parseStatus: "NEEDS_REVIEW", parseWarnings: ["Very little text could be extracted (scanned image PDF?). Please complete your profile manually."] } });
      return;
    }
    let parsed: ParsedResume = heuristicParse(text);
    const warnings: string[] = [];
    try {
      const res = await llm().json({
        purpose: RESUME_PROMPT_VERSION,
        system: RESUME_SYSTEM,
        user: `Extract structured fields from this resume.\n${inputBlock({ text })}`,
        schema: ResumeSchema,
        usage: { userId: rv.userId },
        fast: true,
        effort: "low",
      });
      parsed = res.data;
      // Guard against invented contact details: anything not literally present is dropped.
      if (parsed.email && !text.includes(parsed.email)) {
        warnings.push("Email could not be verified against the document");
        parsed.email = null;
      }
    } catch (err) {
      warnings.push("AI-assisted extraction unavailable; basic extraction used. Please review your details.");
      logger.info({ err: (err as Error).message }, "resume parse falling back to heuristics");
    }
    const needsReview = parsed.uncertainFields.length > 0 || warnings.length > 0;
    await prisma.resumeVersion.update({
      where: { id: rv.id },
      data: { extractedText: text, parsed: parsed as never, parseStatus: needsReview ? "NEEDS_REVIEW" : "PARSED", parseWarnings: [...warnings, ...parsed.uncertainFields.map((f) => `Please check: ${f}`)] },
    });
  } catch (err) {
    await prisma.resumeVersion.update({ where: { id: rv.id }, data: { parseStatus: "FAILED", parseWarnings: ["We couldn't read this file. Try a PDF or DOCX export."] } });
    throw err;
  }
}

export const resumeCorrectionSchema = z.object({
  label: z.string().trim().min(1).max(80).optional(),
  isDefault: z.boolean().optional(),
  parsed: z
    .object({
      name: z.string().max(120).nullable(),
      email: z.string().max(254).nullable(),
      phone: z.string().max(40).nullable(),
      location: z.string().max(120).nullable(),
      headline: z.string().max(200).nullable(),
      skills: z.array(z.string().max(60)).max(80),
    })
    .partial()
    .optional(),
});

export async function updateResume(userId: string, id: string, input: z.infer<typeof resumeCorrectionSchema>) {
  const rv = await prisma.resumeVersion.findFirst({ where: { id, userId } });
  if (!rv) throw notFound("Resume");
  if (input.isDefault) await prisma.resumeVersion.updateMany({ where: { userId }, data: { isDefault: false } });
  return prisma.resumeVersion.update({
    where: { id },
    data: {
      label: input.label,
      isDefault: input.isDefault,
      ...(input.parsed ? { parsed: { ...((rv.parsed as object) ?? {}), ...input.parsed } as never, correctedAt: new Date(), parseStatus: "PARSED" } : {}),
    },
  });
}

export async function deleteResume(userId: string, id: string) {
  const rv = await prisma.resumeVersion.findFirst({ where: { id, userId } });
  if (!rv) throw notFound("Resume");
  await prisma.resumeVersion.delete({ where: { id } });
  // Employers hold their own copy made at application time (separate retention).
  await deleteStoredFile(rv.fileId);
}

export async function listResumes(userId: string) {
  return prisma.resumeVersion.findMany({ where: { userId }, orderBy: { createdAt: "desc" }, select: { id: true, label: true, fileId: true, parseStatus: true, parseWarnings: true, parsed: true, isDefault: true, createdAt: true, correctedAt: true } });
}
