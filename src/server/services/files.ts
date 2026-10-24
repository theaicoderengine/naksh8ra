import crypto from "node:crypto";
import { prisma } from "../db/client";
import { AppError, notFound } from "../errors";
import { storage } from "../providers/storage";
import { scanBuffer, sniffType } from "../providers/scan";
import { env } from "../env";
import { createId } from "@/lib/id";
import { audit } from "../audit";
import { logger } from "../logger";
import type { SessionInfo } from "../auth/session";
import { resolveOrgContext } from "../auth/context";
import { withOrg } from "../db/tenant";

export type StoreInput = {
  buffer: Buffer;
  fileName: string;
  purpose: "RESUME" | "AUDIO" | "EXPORT" | "LOGO" | "DOCUMENT";
  allowedTypes: string[];
  organisationId?: string | null;
  ownerUserId?: string | null;
  maxBytes?: number;
};

const EXT: Record<string, string> = {
  "application/pdf": "pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
  "text/plain": "txt",
  "audio/webm": "webm",
  "audio/ogg": "ogg",
  "audio/wav": "wav",
  "audio/mp4": "m4a",
  "audio/mpeg": "mp3",
  "image/png": "png",
  "image/jpeg": "jpg",
  "application/json": "json",
  "application/zip": "zip",
  "text/csv": "csv",
};

export async function storeFile(input: StoreInput) {
  const max = input.maxBytes ?? env().MAX_UPLOAD_MB * 1024 * 1024;
  if (input.buffer.length === 0) throw new AppError("BAD_REQUEST", "The file is empty");
  if (input.buffer.length > max) throw new AppError("BAD_REQUEST", `File exceeds the ${Math.round(max / 1024 / 1024)} MB limit`);
  const mime = input.purpose === "EXPORT" ? input.allowedTypes[0] : sniffType(input.buffer, input.allowedTypes);
  if (!mime) throw new AppError("BAD_REQUEST", "Unsupported or unrecognised file type");

  const scan = input.purpose === "EXPORT" ? { status: "NOT_SCANNED" as const } : await scanBuffer(input.buffer);
  if (scan.status === "INFECTED") {
    logger.warn({ purpose: input.purpose, org: input.organisationId }, "malware detected in upload");
    await audit({ organisationId: input.organisationId, actorUserId: input.ownerUserId, action: "file.malware_blocked", result: "DENIED", metadata: { detail: scan.detail ?? "" } });
    throw new AppError("BAD_REQUEST", "The file failed a security scan and was rejected");
  }

  const scope = input.organisationId ? `org/${input.organisationId}` : `user/${input.ownerUserId}`;
  // Keys are random — never derived from user-supplied names.
  const key = `${scope}/${input.purpose.toLowerCase()}/${createId()}.${EXT[mime] ?? "bin"}`;
  await storage().put(key, input.buffer, mime);
  const safeName = input.fileName.replace(/[\\/\0<>:"|?*\u0000-\u001f]/g, "_").slice(0, 200) || `file.${EXT[mime]}`;
  return prisma.storedFile.create({
    data: {
      organisationId: input.organisationId ?? null,
      ownerUserId: input.ownerUserId ?? null,
      storageKey: key,
      fileName: safeName,
      mimeType: mime,
      sizeBytes: input.buffer.length,
      sha256: crypto.createHash("sha256").update(input.buffer).digest("hex"),
      scanStatus: scan.status,
      scanDetail: scan.detail,
      purpose: input.purpose,
    },
  });
}

/** Copy a personal file into an organisation's scope (e.g. resume shared on application). */
export async function copyFileToOrg(fileId: string, organisationId: string) {
  const f = await prisma.storedFile.findUnique({ where: { id: fileId } });
  if (!f || f.deletedAt) throw notFound("File");
  const buf = await storage().get(f.storageKey);
  return storeFile({ buffer: buf, fileName: f.fileName, purpose: f.purpose as "RESUME", allowedTypes: [f.mimeType], organisationId });
}

export async function readFile(fileId: string) {
  const f = await prisma.storedFile.findUnique({ where: { id: fileId } });
  if (!f || f.deletedAt) throw notFound("File");
  return { file: f, buffer: await storage().get(f.storageKey) };
}

export async function deleteStoredFile(fileId: string) {
  const f = await prisma.storedFile.findUnique({ where: { id: fileId } });
  if (!f || f.deletedAt) return;
  await storage().delete(f.storageKey).catch((e) => logger.warn({ e: (e as Error).message }, "storage delete failed"));
  await prisma.storedFile.update({ where: { id: f.id }, data: { deletedAt: new Date() } });
}

/**
 * Authorise a download. Personal files: owner only. Organisation files:
 * active membership + a purpose-specific permission (+ job assignment for
 * assignment-scoped roles). Every organisation file access is audited.
 */
export async function authoriseDownload(session: SessionInfo, fileId: string, meta: { ip: string | null }) {
  const f = await prisma.storedFile.findUnique({ where: { id: fileId } });
  if (!f || f.deletedAt) throw notFound("File");
  if (f.ownerUserId && f.ownerUserId === session.user.id && !f.organisationId) return f;
  if (!f.organisationId) throw notFound("File");
  const ctx = await resolveOrgContext(session, f.organisationId).catch(() => {
    throw notFound("File");
  });
  const needed =
    f.purpose === "AUDIO" ? "interviews.view_recordings" : f.purpose === "RESUME" || f.purpose === "DOCUMENT" ? ["candidates.view_all", "candidates.view_assigned"] : f.purpose === "EXPORT" ? "candidates.export" : "org.view";
  const ok = Array.isArray(needed) ? needed.some((p) => ctx.can(p as never)) : ctx.can(needed as never);
  if (!ok) throw notFound("File");
  if (f.purpose === "EXPORT" && f.ownerUserId && f.ownerUserId !== session.user.id) throw notFound("File");

  // Assignment-scoped users may only access files of candidates on their jobs.
  if ((f.purpose === "RESUME" || f.purpose === "DOCUMENT" || f.purpose === "AUDIO") && !ctx.can("candidates.view_all")) {
    const allowed = await withOrg(ctx.org.id, ctx.userId, async (tx) => {
      const jobIds = (await tx.jobAssignment.findMany({ where: { userId: ctx.userId, organisationId: ctx.org.id }, select: { jobId: true } })).map((j) => j.jobId);
      if (f.purpose === "AUDIO") {
        const a = await tx.audioAsset.findFirst({ where: { fileId: f.id, session: { application: { jobId: { in: jobIds } } } } });
        return !!a;
      }
      const d = await tx.candidateDocument.findFirst({ where: { fileId: f.id, candidate: { applications: { some: { jobId: { in: jobIds } } } } } });
      return !!d;
    });
    if (!allowed) throw notFound("File");
  }
  await audit({ organisationId: f.organisationId, actorUserId: session.user.id, action: "file.downloaded", targetType: "StoredFile", targetId: f.id, ip: meta.ip, metadata: { purpose: f.purpose } });
  return f;
}
