import { z } from "zod";
import type { AiCapability, AiProvider } from "@prisma/client";
import { withOrg, withSystem } from "../db/tenant";
import { encrypt, decrypt, sha256 } from "../auth/crypto";
import type { OrgContext } from "../auth/context";
import type { RequestMeta } from "../http/route";
import { audit } from "../audit";
import { AppError, badRequest, notFound } from "../errors";
import { rateLimit } from "../rate-limit";
import { createLlmAdapter, scrubSecrets } from "../providers/llm";
import { describeAi, deploymentAiStatus } from "../ai/access";
import {
  BYOK_PROVIDERS,
  CAPABILITY_INFO,
  PROVIDER_LABEL,
  SPEECH_CAPABILITIES,
  TEXT_CAPABILITIES,
  findModel,
  fixturesAllowed,
  isLlmProvider,
  modelCatalog,
  type LlmProviderId,
} from "../ai/catalog";

/**
 * Settings → AI Providers. Organisation admins connect their own provider keys and
 * choose which source each capability uses. They can SEE platform grants but can
 * never create or widen them — those are written only by platform super-admins.
 */

const ORG_TEXT_CAPS = TEXT_CAPABILITIES.filter((c) => CAPABILITY_INFO[c].scopes.includes("ORG"));

export function byokProviders(): LlmProviderId[] {
  return fixturesAllowed() ? [...BYOK_PROVIDERS, "FIXTURE"] : [...BYOK_PROVIDERS];
}

function assertByokProvider(provider: string): LlmProviderId {
  if (!(byokProviders() as string[]).includes(provider)) throw badRequest("Unsupported provider");
  return provider as LlmProviderId;
}

function assertSupportedModel(provider: LlmProviderId, model: string) {
  const m = findModel(provider, model);
  if (!m) throw new AppError("VALIDATION_FAILED", `"${model}" is not a supported ${PROVIDER_LABEL[provider]} model on this platform. Choose one from the list.`, { reason: "unsupported_model" });
  if (!m.structuredOutput) throw new AppError("VALIDATION_FAILED", `"${model}" does not support the structured output this platform requires.`, { reason: "unsupported_model" });
  return m;
}

export const credentialSchema = z.object({
  apiKey: z.string().trim().min(8, "Enter the full API key").max(400).optional(),
  model: z.string().trim().min(1).max(120),
});

export const testKeySchema = z.object({ apiKey: z.string().trim().min(8).max(400), model: z.string().trim().min(1).max(120) });

export const routesSchema = z.object({
  routes: z
    .array(
      z.object({
        capability: z.enum(TEXT_CAPABILITIES),
        source: z.enum(["AUTO", "ORGANISATION", "PLATFORM"]),
        provider: z.enum(["ANTHROPIC", "OPENAI", "GEMINI", "FIXTURE"]).optional(),
        model: z.string().trim().max(120).nullable().optional(),
      }),
    )
    .max(20),
});

function mask(c: { provider: AiProvider; keyLast4: string; keyFingerprint: string; model: string; status: string; version: number; lastValidatedAt: Date | null; lastError: string | null; lastErrorAt: Date | null; createdAt: Date; updatedAt: Date }) {
  return {
    provider: c.provider,
    connected: true,
    maskedKey: `••••${c.keyLast4}`,
    fingerprint: c.keyFingerprint,
    model: c.model,
    modelInfo: findModel(c.provider, c.model),
    status: c.status,
    version: c.version,
    lastValidatedAt: c.lastValidatedAt,
    lastError: c.lastError,
    lastErrorAt: c.lastErrorAt,
    connectedAt: c.createdAt,
    updatedAt: c.updatedAt,
  };
}

/** Run a no-cost connection test (authentication + model availability). */
async function connectionTest(provider: LlmProviderId, apiKey: string, model: string) {
  try {
    await createLlmAdapter(provider, apiKey).verify(model);
    return { ok: true as const, message: `Connected to ${PROVIDER_LABEL[provider]} — ${model} is available to this key.` };
  } catch (err) {
    const e = err instanceof AppError ? err : new AppError("PROVIDER_ERROR", "Connection test failed");
    return { ok: false as const, code: e.code, reason: (e.details as { reason?: string } | undefined)?.reason ?? null, message: scrubSecrets(e.message, [apiKey]) };
  }
}

export async function getOrgAiSettings(ctx: OrgContext) {
  ctx.assert("ai.manage");
  const orgId = ctx.org.id;
  const since = new Date(Date.now() - 30 * 86400_000);
  const period = `${new Date().getUTCFullYear()}-${String(new Date().getUTCMonth() + 1).padStart(2, "0")}`;
  const { creds, routes, grants, usage, recent } = await withOrg(orgId, ctx.userId, async (tx) => ({
    creds: await tx.orgAiCredential.findMany({ where: { organisationId: orgId }, orderBy: { createdAt: "asc" } }),
    routes: await tx.orgAiRoute.findMany({ where: { organisationId: orgId } }),
    grants: await tx.platformAiGrant.findMany({ where: { organisationId: orgId, enabled: true } }),
    usage: await tx.aiRequestLog.groupBy({
      by: ["capability", "provider", "source", "status"],
      where: { organisationId: orgId, createdAt: { gte: since } },
      _count: { _all: true },
      _sum: { inputTokens: true, outputTokens: true, estimatedCostMicros: true },
    }),
    recent: await tx.aiRequestLog.findMany({ where: { organisationId: orgId, status: { in: ["FAILED", "DENIED"] } }, orderBy: { createdAt: "desc" }, take: 20, select: { id: true, capability: true, provider: true, model: true, source: true, status: true, errorCode: true, createdAt: true } }),
  }));
  const counters = await withSystem("ai settings: platform usage counters", (tx) => tx.aiUsageCounter.findMany({ where: { subject: orgId, period } }));
  const caps: AiCapability[] = [...ORG_TEXT_CAPS, ...SPEECH_CAPABILITIES];
  const effective = await Promise.all(caps.map((c) => describeAi({ kind: "ORG", organisationId: orgId }, c)));
  const deployment = deploymentAiStatus();
  return {
    organisation: { id: orgId, name: ctx.org.name },
    providers: byokProviders().map((p) => {
      const c = creds.find((x) => x.provider === p);
      return { provider: p, label: PROVIDER_LABEL[p], credential: c ? mask(c) : null };
    }),
    models: modelCatalog().filter((m) => (byokProviders() as string[]).includes(m.provider)),
    capabilities: caps.map((c, i) => {
      const r = routes.find((x) => x.capability === c);
      return {
        capability: c,
        ...CAPABILITY_INFO[c],
        byok: (TEXT_CAPABILITIES as readonly string[]).includes(c),
        route: r ? { source: r.source, provider: r.provider, model: r.model } : null,
        effective: effective[i],
        platformGrants: grants
          .filter((g) => g.capability === c)
          .map((g) => {
            const u = counters.find((x) => x.provider === g.provider && x.capability === c);
            return {
              provider: g.provider,
              allowedModels: g.allowedModels,
              monthlyRequestLimit: g.monthlyRequestLimit,
              monthlyTokenLimit: g.monthlyTokenLimit,
              usedThisMonth: { requests: u?.requests ?? 0, tokens: u?.tokens ?? 0 },
              platformCredentialConfigured: isLlmProvider(g.provider) ? !!deployment.llm.find((x) => x.provider === g.provider)?.configured : true,
            };
          }),
      };
    }),
    usage: usage.map((u) => ({ capability: u.capability, provider: u.provider, source: u.source, status: u.status, requests: u._count._all, inputTokens: u._sum.inputTokens ?? 0, outputTokens: u._sum.outputTokens ?? 0, estimatedCostMicros: u._sum.estimatedCostMicros })),
    recentErrors: recent,
  };
}

/** Test a key before saving it (nothing is stored). */
export async function testNewKey(ctx: OrgContext, providerRaw: string, raw: z.infer<typeof testKeySchema>) {
  ctx.assert("ai.manage");
  const input = testKeySchema.parse(raw);
  const provider = assertByokProvider(providerRaw);
  assertSupportedModel(provider, input.model);
  await rateLimit("ai", `keytest:${ctx.org.id}`);
  return connectionTest(provider, input.apiKey, input.model);
}

/**
 * Connect, rotate or change the model of an organisation key. The connection is tested
 * first; a key that fails the test is never stored or activated.
 */
export async function saveOrgCredential(ctx: OrgContext, providerRaw: string, raw: z.infer<typeof credentialSchema>, meta: RequestMeta) {
  ctx.assert("ai.manage");
  const input = credentialSchema.parse(raw);
  const provider = assertByokProvider(providerRaw);
  assertSupportedModel(provider, input.model);
  await rateLimit("ai", `keytest:${ctx.org.id}`);
  const existing = await withOrg(ctx.org.id, ctx.userId, (tx) => tx.orgAiCredential.findUnique({ where: { organisationId_provider: { organisationId: ctx.org.id, provider } } }));
  if (!input.apiKey && !existing) throw badRequest("Enter an API key to connect this provider");
  const apiKey = input.apiKey ?? decrypt(existing!.encryptedKey);
  const test = await connectionTest(provider, apiKey, input.model);
  if (!test.ok) throw new AppError(test.code === "PROVIDER_QUOTA_EXCEEDED" ? "PROVIDER_QUOTA_EXCEEDED" : "BAD_REQUEST", `Connection test failed: ${test.message} The key was not saved.`, { reason: test.reason });
  const now = new Date();
  const keyFields = input.apiKey ? { encryptedKey: encrypt(apiKey), keyLast4: apiKey.slice(-4), keyFingerprint: sha256(apiKey).slice(0, 12) } : {};
  const saved = await withOrg(ctx.org.id, ctx.userId, async (tx) => {
    const c = existing
      ? await tx.orgAiCredential.update({
          where: { id: existing.id },
          data: { ...keyFields, model: input.model, status: "ACTIVE", version: { increment: 1 }, lastValidatedAt: now, lastError: null, lastErrorAt: null, updatedById: ctx.userId },
        })
      : await tx.orgAiCredential.create({
          data: { organisationId: ctx.org.id, provider, encryptedKey: keyFields.encryptedKey!, keyLast4: keyFields.keyLast4!, keyFingerprint: keyFields.keyFingerprint!, model: input.model, status: "ACTIVE", lastValidatedAt: now, createdById: ctx.userId, updatedById: ctx.userId },
        });
    const action = !existing ? "ai.credential.connected" : input.apiKey ? "ai.credential.rotated" : "ai.credential.model_changed";
    await audit({ organisationId: ctx.org.id, actorUserId: ctx.userId, action, targetType: "OrgAiCredential", targetId: c.id, ip: meta.ip, metadata: { provider, model: input.model, fingerprint: c.keyFingerprint, version: c.version } }, tx);
    return c;
  });
  return { credential: mask(saved), test };
}

/** Re-test the stored key; records health (last validation time / error). */
export async function testOrgCredential(ctx: OrgContext, providerRaw: string) {
  ctx.assert("ai.manage");
  const provider = assertByokProvider(providerRaw);
  await rateLimit("ai", `keytest:${ctx.org.id}`);
  const c = await withOrg(ctx.org.id, ctx.userId, (tx) => tx.orgAiCredential.findUnique({ where: { organisationId_provider: { organisationId: ctx.org.id, provider } } }));
  if (!c) throw notFound("AI provider connection");
  const test = await connectionTest(provider, decrypt(c.encryptedKey), c.model);
  const updated = await withOrg(ctx.org.id, ctx.userId, (tx) =>
    tx.orgAiCredential.update({
      where: { id: c.id },
      data: test.ok
        ? { status: "ACTIVE", lastValidatedAt: new Date(), lastError: null, lastErrorAt: null }
        : { lastError: test.message, lastErrorAt: new Date(), ...(test.reason === "auth" || test.reason === "model_not_found" ? { status: "INVALID" as const } : {}) },
    }),
  );
  return { credential: mask(updated), test };
}

export async function removeOrgCredential(ctx: OrgContext, providerRaw: string, meta: RequestMeta) {
  ctx.assert("ai.manage");
  const provider = assertByokProvider(providerRaw);
  return withOrg(ctx.org.id, ctx.userId, async (tx) => {
    const c = await tx.orgAiCredential.findUnique({ where: { organisationId_provider: { organisationId: ctx.org.id, provider } } });
    if (!c) throw notFound("AI provider connection");
    await tx.orgAiCredential.delete({ where: { id: c.id } });
    // Routes that explicitly selected this key stay in place and fail clearly until the
    // admin chooses again — removing a key never silently switches to platform AI.
    const affected = await tx.orgAiRoute.count({ where: { organisationId: ctx.org.id, source: "ORGANISATION", provider } });
    await audit({ organisationId: ctx.org.id, actorUserId: ctx.userId, action: "ai.credential.removed", targetType: "OrgAiCredential", targetId: c.id, ip: meta.ip, metadata: { provider, fingerprint: c.keyFingerprint, routesNeedingAttention: affected } }, tx);
    return { removed: true, routesNeedingAttention: affected };
  });
}

/** Choose the credential source per capability. PLATFORM is only selectable where a grant exists. */
export async function setOrgAiRoutes(ctx: OrgContext, raw: z.infer<typeof routesSchema>, meta: RequestMeta) {
  ctx.assert("ai.manage");
  const input = routesSchema.parse(raw);
  return withOrg(ctx.org.id, ctx.userId, async (tx) => {
    for (const r of input.routes) {
      if (!CAPABILITY_INFO[r.capability].scopes.includes("ORG")) throw badRequest(`${CAPABILITY_INFO[r.capability].label} is not an organisation capability`);
      if (r.source === "AUTO") {
        await tx.orgAiRoute.deleteMany({ where: { organisationId: ctx.org.id, capability: r.capability } });
        continue;
      }
      if (!r.provider) throw badRequest("Choose a provider");
      if (r.source === "ORGANISATION") {
        const c = await tx.orgAiCredential.findUnique({ where: { organisationId_provider: { organisationId: ctx.org.id, provider: r.provider } } });
        if (!c) throw badRequest(`Connect your ${PROVIDER_LABEL[r.provider]} key before selecting it`);
      } else {
        const g = await tx.platformAiGrant.findFirst({ where: { organisationId: ctx.org.id, provider: r.provider, capability: r.capability, enabled: true } });
        if (!g) throw new AppError("AI_ACCESS_DENIED", `Platform ${PROVIDER_LABEL[r.provider]} has not been enabled for ${CAPABILITY_INFO[r.capability].label} on this organisation. Only a platform administrator can enable it.`);
        if (r.model) {
          if (!findModel(r.provider, r.model)) throw new AppError("VALIDATION_FAILED", `"${r.model}" is not a supported model`, { reason: "unsupported_model" });
          if (g.allowedModels.length && !g.allowedModels.includes(r.model)) throw new AppError("AI_ACCESS_DENIED", `"${r.model}" is not permitted by the platform for this organisation`, { reason: "model_not_permitted" });
        }
      }
      const data = { source: r.source, provider: r.provider, model: r.source === "PLATFORM" ? (r.model ?? null) : null, updatedById: ctx.userId };
      await tx.orgAiRoute.upsert({ where: { organisationId_capability: { organisationId: ctx.org.id, capability: r.capability } }, create: { organisationId: ctx.org.id, capability: r.capability, ...data }, update: data });
    }
    await audit({ organisationId: ctx.org.id, actorUserId: ctx.userId, action: "ai.routes.updated", targetType: "Organisation", targetId: ctx.org.id, ip: meta.ip, metadata: { routes: input.routes } }, tx);
    return { ok: true };
  });
}
