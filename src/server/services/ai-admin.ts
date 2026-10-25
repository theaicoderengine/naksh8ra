import { z } from "zod";
import type { AiCapability, AiProvider } from "@prisma/client";
import { prisma } from "../db/client";
import { withSystem } from "../db/tenant";
import { audit } from "../audit";
import type { SessionInfo } from "../auth/session";
import type { RequestMeta } from "../http/route";
import { AppError, badRequest, forbidden, notFound } from "../errors";
import { platformCan, type PlatformPermission } from "../rbac/permissions";
import { deploymentAiStatus } from "../ai/access";
import { CAPABILITY_INFO, PERSONAL_SUBJECT, PROVIDER_LABEL, fixturesAllowed, findModel, isLlmProvider, isTextCapability, modelCatalog } from "../ai/catalog";

/**
 * Platform super-admin control of platform-funded AI. Organisations cannot reach any of
 * this: grants are written only here, in an audited system context, by a platform
 * administrator holding platform.ai.manage (SUPER_ADMIN only).
 */

function requirePerm(admin: SessionInfo, p: PlatformPermission) {
  // The route layer also enforces this (and MFA); checked again so no other caller can skip it.
  if (!platformCan(admin.user.platformRole, p) || !admin.mfaVerified) throw forbidden();
}

const SPEECH_PROVIDERS: Record<"TRANSCRIPTION" | "SPEECH_SYNTHESIS", AiProvider[]> = {
  TRANSCRIPTION: ["OPENAI", "DEEPGRAM", "FIXTURE"],
  SPEECH_SYNTHESIS: ["OPENAI", "ELEVENLABS"],
};

export const grantsSchema = z.object({
  reason: z.string().trim().min(5, "Give a reason (recorded in the audit log)").max(500),
  grants: z
    .array(
      z.object({
        provider: z.enum(["ANTHROPIC", "OPENAI", "GEMINI", "DEEPGRAM", "ELEVENLABS", "FIXTURE"]),
        capability: z.enum(["JOB_DRAFTING", "RESUME_PARSING", "QUESTION_GENERATION", "INTERVIEW_CONVERSATION", "ASSESSMENT", "PRACTICE_COACHING", "TRANSCRIPTION", "SPEECH_SYNTHESIS"]),
        enabled: z.boolean(),
        allowedModels: z.array(z.string().trim().min(1).max(120)).max(20).default([]),
        monthlyRequestLimit: z.number().int().min(0).max(100_000_000).nullable().default(null),
        monthlyTokenLimit: z.number().int().min(0).max(2_000_000_000).nullable().default(null),
      }),
    )
    .min(1)
    .max(60),
});

function validateGrant(subjectKind: "ORG" | "PERSONAL", g: z.infer<typeof grantsSchema>["grants"][number]) {
  const info = CAPABILITY_INFO[g.capability as AiCapability];
  if (!info.scopes.includes(subjectKind)) throw badRequest(`${info.label} does not apply to ${subjectKind === "ORG" ? "organisations" : "personal accounts"}`);
  if (g.provider === "FIXTURE" && !fixturesAllowed()) throw badRequest("The fixture provider is test-only");
  if (isTextCapability(g.capability as AiCapability)) {
    if (!isLlmProvider(g.provider)) throw badRequest(`${PROVIDER_LABEL[g.provider]} does not provide ${info.label}`);
    for (const m of g.allowedModels) if (!findModel(g.provider, m)) throw new AppError("VALIDATION_FAILED", `"${m}" is not a supported ${PROVIDER_LABEL[g.provider]} model`, { reason: "unsupported_model" });
  } else {
    const allowed = SPEECH_PROVIDERS[g.capability as "TRANSCRIPTION" | "SPEECH_SYNTHESIS"];
    if (!allowed.includes(g.provider)) throw badRequest(`${PROVIDER_LABEL[g.provider]} does not provide ${info.label}`);
    if (g.allowedModels.length) throw badRequest("Model restrictions apply to text-generation capabilities only");
  }
}

async function accessDetail(subject: string, organisationId: string | null) {
  const period = `${new Date().getUTCFullYear()}-${String(new Date().getUTCMonth() + 1).padStart(2, "0")}`;
  const since = new Date(Date.now() - 30 * 86400_000);
  return withSystem("platform ai access detail", async (tx) => {
    const logWhere = organisationId ? { organisationId } : { organisationId: null };
    const [grants, counters, creds, routes, usage, recentErrors, history] = await Promise.all([
      tx.platformAiGrant.findMany({ where: { subject }, orderBy: [{ capability: "asc" }, { provider: "asc" }] }),
      tx.aiUsageCounter.findMany({ where: { subject, period } }),
      organisationId ? tx.orgAiCredential.findMany({ where: { organisationId }, select: { provider: true, keyLast4: true, keyFingerprint: true, model: true, status: true, version: true, lastValidatedAt: true, lastError: true, lastErrorAt: true, updatedAt: true } }) : [],
      organisationId ? tx.orgAiRoute.findMany({ where: { organisationId } }) : [],
      tx.aiRequestLog.groupBy({ by: ["capability", "provider", "source", "status"], where: { ...logWhere, createdAt: { gte: since } }, _count: { _all: true }, _sum: { inputTokens: true, outputTokens: true, estimatedCostMicros: true } }),
      tx.aiRequestLog.findMany({ where: { ...logWhere, status: { in: ["FAILED", "DENIED"] } }, orderBy: { createdAt: "desc" }, take: 20, select: { id: true, capability: true, provider: true, source: true, status: true, errorCode: true, createdAt: true } }),
      tx.auditEvent.findMany({
        where: { ...(organisationId ? { organisationId } : { targetType: "PlatformAiGrant", organisationId: null }), OR: [{ action: { startsWith: "ai." } }, { action: { startsWith: "platform.ai." } }] },
        orderBy: { createdAt: "desc" },
        take: 50,
        select: { id: true, action: true, actorUserId: true, actorType: true, reason: true, metadata: true, createdAt: true },
      }),
    ]);
    return {
      grants: grants.map((g) => ({ ...g, usedThisMonth: { requests: counters.find((c) => c.provider === g.provider && c.capability === g.capability)?.requests ?? 0, tokens: counters.find((c) => c.provider === g.provider && c.capability === g.capability)?.tokens ?? 0 } })),
      // Credential health only: masked metadata, never key material.
      orgCredentials: creds.map((c) => ({ provider: c.provider, maskedKey: `••••${c.keyLast4}`, fingerprint: c.keyFingerprint, model: c.model, status: c.status, version: c.version, lastValidatedAt: c.lastValidatedAt, lastError: c.lastError, lastErrorAt: c.lastErrorAt, updatedAt: c.updatedAt })),
      routes: routes.map((r) => ({ capability: r.capability, source: r.source, provider: r.provider, model: r.model })),
      usage: usage.map((u) => ({ capability: u.capability, provider: u.provider, source: u.source, status: u.status, requests: u._count._all, inputTokens: u._sum.inputTokens ?? 0, outputTokens: u._sum.outputTokens ?? 0, estimatedCostMicros: u._sum.estimatedCostMicros })),
      recentErrors,
      history,
    };
  });
}

export async function listOrgAiAccess(admin: SessionInfo, q?: string) {
  requirePerm(admin, "platform.ai.view");
  const orgs = await prisma.organisation.findMany({
    where: { type: "EMPLOYER", ...(q ? { OR: [{ name: { contains: q, mode: "insensitive" } }, { slug: { contains: q } }, { id: q }] } : {}) },
    orderBy: { name: "asc" },
    take: 100,
    select: { id: true, name: true, slug: true, status: true },
  });
  const ids = orgs.map((o) => o.id);
  const [grants, creds] = await withSystem("platform ai access list", (tx) =>
    Promise.all([
      tx.platformAiGrant.groupBy({ by: ["organisationId"], where: { organisationId: { in: ids }, enabled: true }, _count: { _all: true } }),
      tx.orgAiCredential.findMany({ where: { organisationId: { in: ids } }, select: { organisationId: true, provider: true, status: true } }),
    ]),
  );
  return {
    deployment: deploymentAiStatus(),
    organisations: orgs.map((o) => ({ ...o, platformGrants: grants.find((g) => g.organisationId === o.id)?._count._all ?? 0, orgKeys: creds.filter((c) => c.organisationId === o.id).map((c) => ({ provider: c.provider, status: c.status })) })),
  };
}

export async function getOrgAiAccess(admin: SessionInfo, orgId: string, meta?: RequestMeta) {
  requirePerm(admin, "platform.ai.view");
  const org = await prisma.organisation.findUnique({ where: { id: orgId }, select: { id: true, name: true, slug: true, status: true, type: true } });
  if (!org) throw notFound("Organisation");
  // Platform staff viewing an organisation's AI configuration is recorded in its audit log.
  await audit({ organisationId: org.id, actorUserId: admin.user.id, actorType: "PLATFORM_ADMIN", action: "platform.ai_access_viewed", targetType: "Organisation", targetId: org.id, ip: meta?.ip ?? null });
  return { organisation: org, subject: org.id, deployment: deploymentAiStatus(), catalog: modelCatalog(), capabilities: capabilityList("ORG"), canManage: platformCan(admin.user.platformRole, "platform.ai.manage"), ...(await accessDetail(org.id, org.id)) };
}

export async function getPersonalAiAccess(admin: SessionInfo) {
  requirePerm(admin, "platform.ai.view");
  return { subject: PERSONAL_SUBJECT, deployment: deploymentAiStatus(), catalog: modelCatalog(), capabilities: capabilityList("PERSONAL"), canManage: platformCan(admin.user.platformRole, "platform.ai.manage"), ...(await accessDetail(PERSONAL_SUBJECT, null)) };
}

function capabilityList(kind: "ORG" | "PERSONAL") {
  return (Object.keys(CAPABILITY_INFO) as AiCapability[])
    .filter((c) => CAPABILITY_INFO[c].scopes.includes(kind))
    .map((c) => ({ capability: c, ...CAPABILITY_INFO[c], providers: isTextCapability(c) ? (["ANTHROPIC", "OPENAI", "GEMINI", ...(fixturesAllowed() ? ["FIXTURE"] : [])] as AiProvider[]) : SPEECH_PROVIDERS[c as "TRANSCRIPTION" | "SPEECH_SYNTHESIS"].filter((p) => p !== "FIXTURE" || fixturesAllowed()) }));
}

/**
 * Grant, change or revoke platform-funded AI for an organisation (or PERSONAL accounts).
 * Changes take effect on the next AI operation, including queued background jobs.
 */
export async function setAiGrants(admin: SessionInfo, subject: string, raw: z.infer<typeof grantsSchema>, meta: RequestMeta) {
  requirePerm(admin, "platform.ai.manage");
  const input = grantsSchema.parse(raw);
  const personal = subject === PERSONAL_SUBJECT;
  const organisationId = personal ? null : subject;
  if (organisationId) {
    const org = await prisma.organisation.findUnique({ where: { id: organisationId }, select: { id: true, type: true } });
    if (!org) throw notFound("Organisation");
    if (org.type !== "EMPLOYER") throw badRequest("AI capabilities apply to employer organisations");
  }
  for (const g of input.grants) validateGrant(personal ? "PERSONAL" : "ORG", g);
  return withSystem("platform: set AI grants", async (tx) => {
    const results = [];
    for (const g of input.grants) {
      const before = await tx.platformAiGrant.findUnique({ where: { subject_provider_capability: { subject, provider: g.provider, capability: g.capability } } });
      const data = { enabled: g.enabled, allowedModels: g.allowedModels, monthlyRequestLimit: g.monthlyRequestLimit, monthlyTokenLimit: g.monthlyTokenLimit, updatedById: admin.user.id };
      if (!before && !g.enabled) continue; // nothing to revoke
      const after = before
        ? await tx.platformAiGrant.update({ where: { id: before.id }, data: { ...data, version: { increment: 1 } } })
        : await tx.platformAiGrant.create({ data: { subject, organisationId, provider: g.provider, capability: g.capability, ...data, grantedById: admin.user.id } });
      const action = !before?.enabled && after.enabled ? "platform.ai.access_granted" : before?.enabled && !after.enabled ? "platform.ai.access_revoked" : "platform.ai.grant_updated";
      const snapshot = (x: typeof after | null) => (x ? { enabled: x.enabled, allowedModels: x.allowedModels, monthlyRequestLimit: x.monthlyRequestLimit, monthlyTokenLimit: x.monthlyTokenLimit } : null);
      await audit({ organisationId, actorUserId: admin.user.id, actorType: "PLATFORM_ADMIN", action, targetType: "PlatformAiGrant", targetId: after.id, reason: input.reason, ip: meta.ip, metadata: { subject, provider: g.provider, capability: g.capability, before: snapshot(before), after: snapshot(after) } }, tx);
      results.push(after);
    }
    return { updated: results.length };
  });
}
