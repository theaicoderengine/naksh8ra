import type { AiCapability, AiCredentialSource, AiProvider, AiRequestStatus } from "@prisma/client";
import { decrypt } from "../auth/crypto";
import { withOrg, withSystem, type Tx } from "../db/tenant";
import { AppError } from "../errors";
import { logger } from "../logger";
import { createLlmAdapter, isRetryable, maxOutputTokens, scrubSecrets, type JsonRequest, type TextRequest, type TokenUsage } from "../providers/llm";
import { createId } from "../../lib/id";
import { env } from "../env";
import { sttProvider, ttsProvider, type Transcription } from "../providers/speech";
import { estimateLlmCostMicros, recordUsage } from "../providers/usage";
import {
  CAPABILITY_INFO,
  LLM_PROVIDERS,
  PERSONAL_SUBJECT,
  PROVIDER_LABEL,
  deploymentDefaultModel,
  deploymentDefaultProvider,
  deploymentLlmKey,
  deploymentSpeechProvider,
  findModel,
  isLlmProvider,
  type LlmProviderId,
  type SpeechCapability,
  type TextCapability,
} from "./catalog";

/**
 * Tenant-aware AI provider resolution.
 *
 * Every AI operation names a scope (an organisation, or a personal/student account)
 * and a capability. Resolution order, rechecked on EVERY operation (including in
 * background jobs, so revocation stops work that has not started yet):
 *
 *  1. The organisation's explicitly selected route for the capability:
 *       - ORGANISATION + provider → that organisation's own active key, or a clear error;
 *       - PLATFORM + provider     → the deployment key, only with an enabled platform grant.
 *     A selected route that is unusable fails; it never falls back to anything else.
 *  2. No route: the organisation's own active key (earliest connected, if several).
 *  3. Otherwise a deployment (platform-owned) key, only where a platform super-admin has
 *     granted that provider + capability to this organisation (or to personal accounts).
 *  4. Otherwise AI_ACCESS_DENIED / PROVIDER_NOT_CONFIGURED.
 *
 * Keys are decrypted per operation and SDK clients are created per operation: nothing
 * caches a client that could carry one organisation's credential into another request.
 */

export type AiScope =
  | { kind: "ORG"; organisationId: string; userId?: string | null; sessionId?: string | null }
  | { kind: "PERSONAL"; userId: string; sessionId?: string | null };

export type AiResolution = {
  capability: AiCapability;
  provider: AiProvider;
  model: string | null;
  source: AiCredentialSource;
  credentialId: string | null;
  credentialVersion: number | null;
  grantId: string | null;
  mode: "LIVE" | "FIXTURE";
};

type Resolved = Omit<AiResolution, "provider" | "model"> & { provider: LlmProviderId; model: string; apiKey: string };

const subjectOf = (scope: AiScope) => (scope.kind === "ORG" ? scope.organisationId : PERSONAL_SUBJECT);
const period = (d = new Date()) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;

function denied(capability: AiCapability, scope: AiScope) {
  const what = CAPABILITY_INFO[capability].label;
  return new AppError(
    "AI_ACCESS_DENIED",
    scope.kind === "ORG"
      ? `${what} is not available: this organisation has not connected its own AI provider for it and platform AI has not been enabled for it. An organisation admin can connect a key in Settings → AI Providers.`
      : `${what} is not available on this platform yet.`,
    { capability },
  );
}

async function loadGrants(scope: AiScope, capability: AiCapability, tx?: Tx) {
  const where = { subject: subjectOf(scope), capability, enabled: true };
  if (tx) return tx.platformAiGrant.findMany({ where });
  if (scope.kind === "ORG") return withOrg(scope.organisationId, null, (t) => t.platformAiGrant.findMany({ where }));
  return withSystem("ai: personal grants", (t) => t.platformAiGrant.findMany({ where }));
}

function pickPlatformModel(provider: LlmProviderId, allowed: string[], preferred: string | null, fast: boolean): string {
  const defaults = [deploymentDefaultModel(provider, false), deploymentDefaultModel(provider, true)];
  let model: string;
  if (preferred) {
    const ok = allowed.length ? allowed.includes(preferred) : defaults.includes(preferred);
    if (!ok) throw new AppError("AI_ACCESS_DENIED", `The model "${preferred}" is not permitted for platform AI on this organisation.`, { reason: "model_not_permitted" });
    model = preferred;
  } else {
    const d = deploymentDefaultModel(provider, fast);
    model = !allowed.length || allowed.includes(d) ? d : allowed.includes(defaults[0]) ? defaults[0] : allowed[0];
  }
  if (!findModel(provider, model)) throw new AppError("PROVIDER_NOT_CONFIGURED", `The model "${model}" is not in this deployment's supported model list.`, { reason: "unsupported_model" });
  return model;
}

async function resolvePlatform(scope: AiScope, capability: AiCapability, provider: LlmProviderId | null, preferredModel: string | null, fast: boolean): Promise<Resolved> {
  const grants = (await loadGrants(scope, capability)).filter((g) => isLlmProvider(g.provider));
  let grant;
  if (provider) {
    grant = grants.find((g) => g.provider === provider);
    if (!grant) throw denied(capability, scope);
  } else {
    const usable = grants.filter((g) => deploymentLlmKey(g.provider as LlmProviderId));
    if (!usable.length) {
      if (grants.length) throw new AppError("PROVIDER_NOT_CONFIGURED", `Platform AI is enabled for ${CAPABILITY_INFO[capability].label}, but the platform credential for ${grants.map((g) => PROVIDER_LABEL[g.provider]).join(", ")} is not configured on this deployment.`);
      throw denied(capability, scope);
    }
    const preferred = deploymentDefaultProvider();
    grant = usable.find((g) => g.provider === preferred) ?? usable.sort((a, b) => LLM_PROVIDERS.indexOf(a.provider as LlmProviderId) - LLM_PROVIDERS.indexOf(b.provider as LlmProviderId))[0];
  }
  const p = grant.provider as LlmProviderId;
  const apiKey = deploymentLlmKey(p);
  if (!apiKey) throw new AppError("PROVIDER_NOT_CONFIGURED", `The platform credential for ${PROVIDER_LABEL[p]} is not configured on this deployment.`);
  const model = pickPlatformModel(p, grant.allowedModels, preferredModel, fast);
  return { capability, provider: p, model, source: "PLATFORM", credentialId: null, credentialVersion: grant.version, grantId: grant.id, mode: p === "FIXTURE" ? "FIXTURE" : "LIVE", apiKey };
}

function fromOrgCredential(capability: AiCapability, c: { id: string; provider: AiProvider; encryptedKey: string; model: string; version: number }): Resolved {
  const provider = c.provider as LlmProviderId;
  if (!findModel(provider, c.model)) throw new AppError("PROVIDER_NOT_CONFIGURED", `The model "${c.model}" selected for your ${PROVIDER_LABEL[provider]} key is no longer supported. Choose another model in Settings → AI Providers.`, { reason: "unsupported_model" });
  let apiKey: string;
  try {
    apiKey = decrypt(c.encryptedKey);
  } catch {
    // e.g. ENCRYPTION_KEY changed without re-encrypting stored keys. Never fall back.
    logger.error({ credentialId: c.id, provider }, "organisation AI key could not be decrypted");
    throw new AppError("PROVIDER_NOT_CONFIGURED", `Your organisation's ${PROVIDER_LABEL[provider]} key can no longer be read by the platform. Reconnect it in Settings → AI Providers.`, { reason: "undecryptable" });
  }
  return { capability, provider, model: c.model, source: "ORGANISATION", credentialId: c.id, credentialVersion: c.version, grantId: null, mode: provider === "FIXTURE" ? "FIXTURE" : "LIVE", apiKey };
}

/** Resolve (without calling) the provider for a text capability. Throws when nothing is authorised. */
async function resolveText(scope: AiScope, capability: TextCapability, fast = false): Promise<Resolved> {
  if (!CAPABILITY_INFO[capability].scopes.includes(scope.kind)) {
    throw new AppError("BAD_REQUEST", `${CAPABILITY_INFO[capability].label} is not available in this context`);
  }
  if (scope.kind === "PERSONAL") return resolvePlatform(scope, capability, null, null, fast);
  const { route, creds } = await withOrg(scope.organisationId, null, async (tx) => ({
    route: await tx.orgAiRoute.findUnique({ where: { organisationId_capability: { organisationId: scope.organisationId, capability } } }),
    creds: await tx.orgAiCredential.findMany({ where: { organisationId: scope.organisationId }, orderBy: { createdAt: "asc" } }),
  }));
  // Defence in depth on top of RLS: never use a row that is not this organisation's.
  const own = creds.filter((c) => c.organisationId === scope.organisationId);
  if (route) {
    if (route.source === "ORGANISATION") {
      const c = own.find((x) => x.provider === route.provider);
      if (!c) throw new AppError("PROVIDER_NOT_CONFIGURED", `${CAPABILITY_INFO[capability].label} is set to use your organisation's ${PROVIDER_LABEL[route.provider]} key, but no key is connected. Reconnect it or change the selection in Settings → AI Providers.`);
      if (c.status !== "ACTIVE") throw new AppError("PROVIDER_NOT_CONFIGURED", `Your organisation's ${PROVIDER_LABEL[route.provider]} key failed validation (${c.lastError ?? "invalid"}). Replace it in Settings → AI Providers.`);
      return fromOrgCredential(capability, c);
    }
    if (!isLlmProvider(route.provider)) throw denied(capability, scope);
    return resolvePlatform(scope, capability, route.provider, route.model, fast);
  }
  const active = own.find((c) => c.status === "ACTIVE");
  if (active) return fromOrgCredential(capability, active);
  return resolvePlatform(scope, capability, null, null, fast);
}

// ───────────────────────── Platform usage limits ─────────────────────────

/**
 * Platform-funded usage is enforced with per-attempt reservations:
 *
 *   reserve  (one transaction, before the provider call)
 *     - re-check the grant (still enabled, model still permitted) under a row lock;
 *     - conditional UPDATE of the counter: requests + 1 and tokensReserved + estimate,
 *       only if  requests < requestLimit  AND  tokens + tokensReserved + estimate <= tokenLimit;
 *     - insert an AiUsageReservation row.
 *   settle   (after success, failure or timeout — exactly once per reservation)
 *     - delete the reservation; tokensReserved − estimate; tokens + actual usage.
 *   sweep    (worker, for reservations orphaned by a crash)
 *     - after expiresAt, charge the estimate (conservative) and mark it expired; a late
 *       settle then corrects tokens by (actual − estimate).
 *
 * The estimate is the worst case (prompt size + the request's output cap), so concurrent
 * attempts can never push settled + in-flight usage past the token limit, and each retry
 * is a new attempt with its own reservation.
 */
const RESERVATION_GRACE_MS = 60_000;

export function estimateReservationTokens(provider: LlmProviderId, kind: "json" | "text", req: { system: string; user?: string; messages?: { content: string }[]; maxTokens?: number }) {
  const promptBytes = Buffer.byteLength(req.system) + Buffer.byteLength(req.user ?? "") + (req.messages ?? []).reduce((n, m) => n + Buffer.byteLength(m.content), 0);
  // ~3 bytes per token is a conservative (over-)estimate for typical tokenizers.
  return Math.ceil(promptBytes / 3) + maxOutputTokens(provider, kind, req.maxTokens);
}

type Reservation = { id: string; tokens: number };

async function reservePlatform(scope: AiScope, r: { provider: AiProvider; capability: AiCapability; model?: string | null }, estimate: number): Promise<Reservation> {
  const subject = subjectOf(scope);
  const per = period();
  return withSystem("ai: reserve platform usage", async (tx) => {
    const g = await tx.$queryRaw<{ id: string; monthlyRequestLimit: number | null; monthlyTokenLimit: number | null; allowedModels: string[] }[]>`
      SELECT id, "monthlyRequestLimit", "monthlyTokenLimit", "allowedModels" FROM "PlatformAiGrant"
      WHERE subject = ${subject} AND provider = ${r.provider}::"AiProvider" AND capability = ${r.capability}::"AiCapability" AND enabled
      FOR SHARE`;
    if (!g[0]) throw denied(r.capability, scope); // revoked since resolution
    if (r.model && isLlmProvider(r.provider)) {
      const permitted = g[0].allowedModels.length ? g[0].allowedModels.includes(r.model) : [deploymentDefaultModel(r.provider, false), deploymentDefaultModel(r.provider, true)].includes(r.model);
      if (!permitted) throw new AppError("AI_ACCESS_DENIED", `The model "${r.model}" is no longer permitted for platform AI on this organisation.`, { reason: "model_not_permitted" });
    }
    // No conflict target: concurrent first-of-month inserts race on the unique keys and
    // must be absorbed (a targeted ON CONFLICT still raised 23505 on the primary key).
    await tx.$executeRaw`
      INSERT INTO "AiUsageCounter" (id, subject, provider, capability, period, requests, tokens, "tokensReserved", "updatedAt")
      VALUES (${createId()}, ${subject}, ${r.provider}::"AiProvider", ${r.capability}::"AiCapability", ${per}, 0, 0, 0, now())
      ON CONFLICT DO NOTHING`;
    const n = await tx.$executeRaw`
      UPDATE "AiUsageCounter" SET requests = requests + 1, "tokensReserved" = "tokensReserved" + ${estimate}, "updatedAt" = now()
      WHERE subject = ${subject} AND provider = ${r.provider}::"AiProvider" AND capability = ${r.capability}::"AiCapability" AND period = ${per}
        AND (${g[0].monthlyRequestLimit}::int IS NULL OR requests < ${g[0].monthlyRequestLimit}::int)
        AND (${g[0].monthlyTokenLimit}::int IS NULL OR tokens + "tokensReserved" + ${estimate} <= ${g[0].monthlyTokenLimit}::int)`;
    if (n === 0) throw new AppError("AI_LIMIT_REACHED", `The platform AI usage limit for ${CAPABILITY_INFO[r.capability].label} has been reached for this month. Contact the platform administrator, or connect your organisation's own provider key.`, { capability: r.capability });
    const id = createId();
    await tx.aiUsageReservation.create({ data: { id, subject, provider: r.provider, capability: r.capability, period: per, tokens: estimate, expiresAt: new Date(Date.now() + 2 * env().AI_TIMEOUT_MS + RESERVATION_GRACE_MS) } });
    return { id, tokens: estimate };
  });
}

/** Settle a reservation with actual usage. Idempotent: a second settle is a no-op. */
async function settleReservation(res: Reservation, actualTokens: number) {
  const actual = Math.max(0, Math.round(actualTokens));
  await withSystem("ai: settle platform usage", async (tx) => {
    const rows = await tx.$queryRaw<{ subject: string; provider: AiProvider; capability: AiCapability; period: string; tokens: number; expiredAt: Date | null }[]>`
      DELETE FROM "AiUsageReservation" WHERE id = ${res.id} RETURNING subject, provider, capability, period, tokens, "expiredAt"`;
    const row = rows[0];
    if (!row) return;
    if (row.expiredAt) {
      // The sweeper already charged the estimate; correct it to the actual usage.
      await tx.$executeRaw`UPDATE "AiUsageCounter" SET tokens = GREATEST(tokens + ${actual - row.tokens}, 0), "updatedAt" = now()
        WHERE subject = ${row.subject} AND provider = ${row.provider}::"AiProvider" AND capability = ${row.capability}::"AiCapability" AND period = ${row.period}`;
    } else {
      await tx.$executeRaw`UPDATE "AiUsageCounter" SET "tokensReserved" = GREATEST("tokensReserved" - ${row.tokens}, 0), tokens = tokens + ${actual}, "updatedAt" = now()
        WHERE subject = ${row.subject} AND provider = ${row.provider}::"AiProvider" AND capability = ${row.capability}::"AiCapability" AND period = ${row.period}`;
    }
  }).catch((err) => logger.error({ err: (err as Error).message, reservation: res.id }, "ai reservation settle failed (will be swept)"));
}

/**
 * Worker: charge reservations whose process never settled them (crash, kill, lost
 * connection). Conservative: the full estimate is charged; a late settle corrects it.
 */
export async function sweepExpiredReservations(now = new Date()) {
  return withSystem("ai: sweep expired reservations", async (tx) => {
    const expired = await tx.$queryRaw<{ id: string }[]>`
      WITH x AS (
        UPDATE "AiUsageReservation" SET "expiredAt" = ${now} WHERE "expiredAt" IS NULL AND "expiresAt" < ${now} RETURNING id, subject, provider, capability, period, tokens
      ), agg AS (
        SELECT subject, provider, capability, period, SUM(tokens)::int AS t FROM x GROUP BY 1, 2, 3, 4
      ), upd AS (
        UPDATE "AiUsageCounter" c SET "tokensReserved" = GREATEST(c."tokensReserved" - agg.t, 0), tokens = c.tokens + agg.t, "updatedAt" = now()
        FROM agg WHERE c.subject = agg.subject AND c.provider = agg.provider AND c.capability = agg.capability AND c.period = agg.period
        RETURNING c.id
      )
      SELECT id FROM x`;
    const purged = await tx.aiUsageReservation.deleteMany({ where: { expiredAt: { lt: new Date(now.getTime() - 7 * 86400_000) } } });
    if (expired.length) logger.warn({ count: expired.length }, "charged expired AI usage reservations");
    return { expired: expired.length, purged: purged.count };
  });
}

/** Tokens to charge when an attempt failed, by what the provider may have processed. */
function chargeForFailure(e: AppError, estimate: number, inputEstimate: number) {
  const usage = (e.details as { usage?: TokenUsage } | undefined)?.usage;
  if (usage && (usage.inputTokens != null || usage.outputTokens != null)) return (usage.inputTokens ?? 0) + (usage.outputTokens ?? 0);
  const reason = (e.details as { reason?: string } | undefined)?.reason;
  // Timeouts / 5xx: the provider may have processed the prompt — charge the input estimate.
  if (reason === "timeout" || reason === "unavailable") return Math.min(inputEstimate, estimate);
  return 0; // rejected before processing (auth, quota, bad request, unknown model)
}

// ───────────────────────── Request log ─────────────────────────

type LogEntry = {
  scope: AiScope;
  capability: AiCapability;
  status: AiRequestStatus;
  r?: Partial<AiResolution> | null;
  model?: string | null;
  usage?: TokenUsage | null;
  errorCode?: string | null;
  startedAt: number;
  attempt?: number;
};

async function logRequest(e: LogEntry) {
  const provider = e.r?.provider ?? null;
  const model = e.model ?? e.r?.model ?? null;
  const cost = provider && model && e.usage ? estimateLlmCostMicros(provider.toLowerCase(), model, e.usage.inputTokens, e.usage.outputTokens) : null;
  try {
    await withSystem("ai: request log", (tx) =>
      tx.aiRequestLog.create({
        data: {
          organisationId: e.scope.kind === "ORG" ? e.scope.organisationId : null,
          userId: e.scope.userId ?? null,
          sessionId: e.scope.sessionId ?? null,
          capability: e.capability,
          provider,
          model,
          source: e.r?.source ?? null,
          credentialId: e.r?.credentialId ?? null,
          credentialVersion: e.r?.credentialVersion ?? null,
          status: e.status,
          errorCode: e.errorCode ?? null,
          inputTokens: e.usage?.inputTokens ?? null,
          outputTokens: e.usage?.outputTokens ?? null,
          estimatedCostMicros: cost,
          latencyMs: Date.now() - e.startedAt,
          attempt: e.attempt ?? 1,
        },
      }),
    );
  } catch (err) {
    logger.warn({ err: (err as Error).message }, "ai request log failed");
  }
  if (e.status === "SUCCEEDED" && provider && provider !== "FIXTURE" && e.usage) {
    const ctx = { organisationId: e.scope.kind === "ORG" ? e.scope.organisationId : null, userId: e.scope.userId ?? null, sessionId: e.scope.sessionId ?? null };
    if (e.usage.inputTokens) await recordUsage({ ...ctx, kind: "LLM", provider: provider.toLowerCase(), model: model ?? undefined, units: e.usage.inputTokens, unitLabel: "input_tokens" });
    if (e.usage.outputTokens) await recordUsage({ ...ctx, kind: "LLM", provider: provider.toLowerCase(), model: model ?? undefined, units: e.usage.outputTokens, unitLabel: "output_tokens" });
  }
}

/** Organisation key health: an authentication failure during real use marks the key invalid. */
async function noteCredentialError(scope: AiScope, r: Resolved, err: AppError) {
  if (r.source !== "ORGANISATION" || scope.kind !== "ORG" || !r.credentialId) return;
  const reason = (err.details as { reason?: string } | undefined)?.reason;
  const message = scrubSecrets(err.message, [r.apiKey]);
  await withOrg(scope.organisationId, null, (tx) =>
    tx.orgAiCredential.updateMany({
      where: { id: r.credentialId!, organisationId: scope.organisationId, version: r.credentialVersion! },
      data: { lastError: message, lastErrorAt: new Date(), ...(reason === "auth" ? { status: "INVALID" as const } : {}) },
    }),
  ).catch(() => undefined);
}

// ───────────────────────── Public API ─────────────────────────

/** The resolution without the decrypted key — the only shape that leaves this module. */
function publicResolution(r: Resolved): AiResolution {
  return { capability: r.capability, provider: r.provider, model: r.model, source: r.source, credentialId: r.credentialId, credentialVersion: r.credentialVersion, grantId: r.grantId, mode: r.mode };
}

async function run<T>(
  scope: AiScope,
  capability: TextCapability,
  kind: "json" | "text",
  req: { system: string; user?: string; messages?: { content: string }[]; maxTokens?: number; fast?: boolean },
  call: (r: Resolved, maxTokens: number) => Promise<{ value: T; model: string; usage: TokenUsage }>,
) {
  const attempts = 1 + Math.max(0, env().AI_MAX_RETRIES);
  for (let attempt = 1; ; attempt++) {
    const startedAt = Date.now();
    let r: Resolved;
    let reservation: Reservation | null = null;
    let estimate = 0;
    let inputEstimate = 0;
    try {
      // Re-resolved on every attempt: a revoked grant, removed key or rotation applies immediately.
      r = await resolveText(scope, capability, !!req.fast);
      estimate = estimateReservationTokens(r.provider, kind, req);
      inputEstimate = estimate - maxOutputTokens(r.provider, kind, req.maxTokens);
      if (r.source === "PLATFORM") reservation = await reservePlatform(scope, r, estimate);
    } catch (err) {
      const code = err instanceof AppError ? err.code : "INTERNAL";
      await logRequest({ scope, capability, status: code === "AI_ACCESS_DENIED" || code === "AI_LIMIT_REACHED" ? "DENIED" : "FAILED", errorCode: code, startedAt, attempt });
      throw err;
    }
    try {
      const out = await call(r, maxOutputTokens(r.provider, kind, req.maxTokens));
      const used = (out.usage.inputTokens ?? 0) + (out.usage.outputTokens ?? 0);
      if (reservation) await settleReservation(reservation, out.usage.inputTokens == null && out.usage.outputTokens == null ? estimate : used);
      await logRequest({ scope, capability, status: "SUCCEEDED", r, model: out.model, usage: out.usage, startedAt, attempt });
      return { value: out.value, model: out.model, resolution: publicResolution(r) };
    } catch (err) {
      const e = err instanceof AppError ? err : new AppError("PROVIDER_ERROR", "AI request failed", { reason: "unavailable" });
      if (reservation) await settleReservation(reservation, chargeForFailure(e, estimate, inputEstimate));
      const usage = (e.details as { usage?: TokenUsage } | undefined)?.usage ?? null;
      await logRequest({ scope, capability, status: "FAILED", r, usage, errorCode: (e.details as { reason?: string } | undefined)?.reason ?? e.code, startedAt, attempt });
      await noteCredentialError(scope, r, e);
      // Transient errors only (5xx / timeouts) — never quota (429), auth or validation errors.
      if (attempt < attempts && isRetryable(e)) {
        await new Promise((res) => setTimeout(res, env().AI_RETRY_BASE_MS * 2 ** (attempt - 1)));
        continue;
      }
      throw e;
    }
  }
}

export async function aiJson<T>(scope: AiScope, capability: TextCapability, req: JsonRequest<T>) {
  const out = await run(scope, capability, "json", req, async (r, maxTokens) => {
    const adapter = createLlmAdapter(r.provider, r.apiKey);
    const res = await adapter.json({ ...req, maxTokens }, r.model);
    return { value: res.data, model: res.model, usage: res.usage };
  });
  return { data: out.value, model: out.model, mode: out.resolution.mode, resolution: out.resolution };
}

export async function aiText(scope: AiScope, capability: TextCapability, req: TextRequest) {
  const out = await run(scope, capability, "text", req, async (r, maxTokens) => {
    const adapter = createLlmAdapter(r.provider, r.apiKey);
    const res = await adapter.text({ ...req, maxTokens }, r.model);
    return { value: res.text, model: res.model, usage: res.usage };
  });
  return { text: out.value, model: out.model, mode: out.resolution.mode, resolution: out.resolution };
}

/** Fail fast before starting work that needs a capability (e.g. starting an interview). */
export async function assertAiAvailable(scope: AiScope, capability: TextCapability): Promise<AiResolution> {
  return publicResolution(await resolveText(scope, capability));
}

/** `resolution: null` = available without any provider (browser speech synthesis). */
export type AiAvailability = { available: true; resolution: AiResolution | null } | { available: false; code: string; message: string };

/** Non-throwing status for UI and readiness checks. Never includes secrets. */
export async function describeAi(scope: AiScope, capability: AiCapability): Promise<AiAvailability> {
  try {
    if ((["TRANSCRIPTION", "SPEECH_SYNTHESIS"] as AiCapability[]).includes(capability)) {
      const provider = await assertSpeechAvailable(scope, capability as SpeechCapability);
      if (!provider) return { available: true, resolution: null };
      return { available: true, resolution: { capability, provider, model: null, source: "PLATFORM", credentialId: null, credentialVersion: null, grantId: null, mode: provider === "FIXTURE" ? "FIXTURE" : "LIVE" } };
    }
    return { available: true, resolution: await assertAiAvailable(scope, capability as TextCapability) };
  } catch (err) {
    return { available: false, code: err instanceof AppError ? err.code : "INTERNAL", message: err instanceof AppError ? err.message : "AI unavailable" };
  }
}

// ───────────────────────── Speech (platform providers only) ─────────────────────────

/**
 * Speech uses deployment speech providers only; an organisation's text-generation key
 * never enables it. Platform-funded speech requires a grant like any other platform AI.
 * Returns the provider, or null for browser-side speech synthesis (no grant needed).
 */
export async function assertSpeechAvailable(scope: AiScope, capability: SpeechCapability): Promise<AiProvider | null> {
  const provider = deploymentSpeechProvider(capability);
  if (!provider) {
    if (capability === "SPEECH_SYNTHESIS") return null;
    sttProvider(); // throws a descriptive PROVIDER_NOT_CONFIGURED
    return null;
  }
  if (capability === "TRANSCRIPTION") sttProvider();
  else ttsProvider();
  const grants = await loadGrants(scope, capability);
  if (!grants.some((g) => g.provider === provider)) {
    throw new AppError("AI_ACCESS_DENIED", capability === "TRANSCRIPTION" ? "Spoken answers are not enabled for this organisation (speech-to-text needs platform approval). Typed answers may still be available." : "Server voice is not enabled for this organisation.", { capability });
  }
  return provider;
}

export async function aiTranscribe(scope: AiScope, audio: Buffer, mime: string, language: string): Promise<Transcription> {
  const startedAt = Date.now();
  const capability = "TRANSCRIPTION" as const;
  let provider: AiProvider | null;
  let reservation: Reservation | null = null;
  try {
    provider = await assertSpeechAvailable(scope, capability);
    if (provider) reservation = await reservePlatform(scope, { provider, capability }, 0);
  } catch (err) {
    const code = err instanceof AppError ? err.code : "INTERNAL";
    await logRequest({ scope, capability, status: code === "AI_ACCESS_DENIED" || code === "AI_LIMIT_REACHED" ? "DENIED" : "FAILED", errorCode: code, startedAt });
    throw err;
  }
  const r = { provider: provider ?? undefined, source: "PLATFORM" as const };
  try {
    const t = await sttProvider().transcribe(audio, mime, language, { organisationId: scope.kind === "ORG" ? scope.organisationId : null, userId: scope.userId ?? null, sessionId: scope.sessionId ?? null });
    if (reservation) await settleReservation(reservation, 0);
    await logRequest({ scope, capability, status: "SUCCEEDED", r, model: t.provider, startedAt });
    return t;
  } catch (err) {
    if (reservation) await settleReservation(reservation, 0);
    await logRequest({ scope, capability, status: "FAILED", r, errorCode: err instanceof AppError ? err.code : "PROVIDER_ERROR", startedAt });
    throw err;
  }
}

/**
 * Server-side voice when a platform TTS provider is configured AND granted; otherwise
 * null, which tells the client to use the browser's own speech synthesis (not a
 * platform-funded service). A denial is logged so admins can see it.
 */
export async function aiSynthesize(scope: AiScope, text: string, voice: string | null): Promise<{ audio: Buffer; mime: string } | null> {
  const startedAt = Date.now();
  const capability = "SPEECH_SYNTHESIS" as const;
  let provider: AiProvider | null;
  let reservation: Reservation;
  try {
    provider = await assertSpeechAvailable(scope, capability);
    if (!provider) return null;
    reservation = await reservePlatform(scope, { provider, capability }, 0);
  } catch (err) {
    await logRequest({ scope, capability, status: "DENIED", errorCode: err instanceof AppError ? err.code : "INTERNAL", startedAt });
    return null;
  }
  const r = { provider, source: "PLATFORM" as const };
  try {
    const out = await ttsProvider().synthesize(text, voice, { organisationId: scope.kind === "ORG" ? scope.organisationId : null, userId: scope.userId ?? null, sessionId: scope.sessionId ?? null });
    await settleReservation(reservation, 0);
    await logRequest({ scope, capability, status: "SUCCEEDED", r, startedAt });
    return out;
  } catch (err) {
    await settleReservation(reservation, 0);
    await logRequest({ scope, capability, status: "FAILED", r, errorCode: err instanceof AppError ? err.code : "PROVIDER_ERROR", startedAt });
    throw err;
  }
}

/** Which deployment (platform-owned) credentials exist. Booleans only — never key material. */
export function deploymentAiStatus() {
  const llm = LLM_PROVIDERS.map((p) => ({ provider: p, configured: !!deploymentLlmKey(p), defaultModel: deploymentDefaultModel(p, false), fastModel: deploymentDefaultModel(p, true) }));
  return { defaultProvider: deploymentDefaultProvider(), llm, transcription: deploymentSpeechProvider("TRANSCRIPTION"), speechSynthesis: deploymentSpeechProvider("SPEECH_SYNTHESIS") };
}

export const _test = { resolveText, period, subjectOf, reservePlatform, settleReservation };
