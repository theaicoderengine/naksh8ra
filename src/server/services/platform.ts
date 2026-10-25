import { z } from "zod";
import { prisma } from "../db/client";
import { withSystem } from "../db/tenant";
import { badRequest, conflict, forbidden, notFound } from "../errors";
import { audit } from "../audit";
import type { SessionInfo } from "../auth/session";
import { adjust, balance } from "../billing/credits";
import { deploymentAiStatus } from "../ai/access";
import { speechStatus } from "../providers/speech";
import { env } from "../env";
import { jobHealth } from "../ops/status";
import { getRedis } from "../queue/redis";
import { enqueue, type JobName } from "../queue";
import { retryFailedPaymentEvents } from "./billing";
import type { RequestMeta } from "../http/route";
import { revokeAllSessions } from "../auth/session";

/**
 * Platform (SaaS operator) administration. Tenant access is METADATA ONLY:
 * no endpoint here returns candidates, resumes, recordings, transcripts or
 * assessments. Every state-changing action requires a reason and is audited.
 */

const reason = z.string().trim().min(5, "A reason of at least 5 characters is required").max(1000);

export async function platformOverview() {
  const since = new Date(Date.now() - 30 * 86400_000);
  const [orgsByStatus, orgsByType, users, students, subs, interviews30, consumed30, cost30, emailFailed, jobsFailed, paymentsFailed, openTickets, dsrsOpen] = await Promise.all([
    prisma.organisation.groupBy({ by: ["status"], _count: { _all: true } }),
    prisma.organisation.groupBy({ by: ["type"], _count: { _all: true } }),
    prisma.user.count({ where: { status: "ACTIVE" } }),
    prisma.studentProfile.count(),
    withSystem("platform overview subscriptions", (tx) => tx.subscription.findMany({ where: { status: { in: ["ACTIVE", "PAST_DUE"] }, provider: "stripe" }, include: { plan: true } })),
    withSystem("platform overview interviews", (tx) => tx.interviewSession.count({ where: { createdAt: { gte: since } } })),
    prisma.creditLedgerEntry.count({ where: { type: "CONSUME", createdAt: { gte: since } } }),
    prisma.usageRecord.groupBy({ by: ["kind", "provider"], where: { createdAt: { gte: since } }, _sum: { costMicros: true, units: true } }),
    prisma.emailDelivery.count({ where: { status: { in: ["FAILED", "BOUNCED"] }, createdAt: { gte: since } } }),
    prisma.jobRun.count({ where: { status: "FAILED", createdAt: { gte: since } } }),
    prisma.paymentEvent.count({ where: { status: "FAILED" } }),
    prisma.supportTicket.count({ where: { status: { in: ["OPEN", "PENDING"] } } }),
    prisma.dataSubjectRequest.count({ where: { status: { in: ["RECEIVED", "IN_PROGRESS"] } } }),
  ]);
  const mrrByCurrency: Record<string, number> = {};
  for (const s of subs) {
    const monthly = s.plan.interval === "YEAR" ? Math.round(s.plan.priceAmount / 12) : s.plan.priceAmount;
    mrrByCurrency[s.plan.currency] = (mrrByCurrency[s.plan.currency] ?? 0) + monthly;
  }
  return {
    organisations: { byStatus: orgsByStatus, byType: orgsByType },
    users,
    students,
    activePaidSubscriptions: subs.length,
    mrrByCurrency,
    interviewsLast30Days: interviews30,
    creditsConsumedLast30Days: consumed30,
    providerCostLast30Days: cost30.map((c) => ({ kind: c.kind, provider: c.provider, costUsd: (c._sum.costMicros ?? 0) / 1_000_000, units: c._sum.units ?? 0 })),
    health: { emailFailed30d: emailFailed, jobsFailed30d: jobsFailed, paymentEventsFailed: paymentsFailed, openTickets, openDataRequests: dsrsOpen },
  };
}

export const orgQuery = z.object({ q: z.string().max(100).optional(), status: z.enum(["PENDING_VERIFICATION", "ACTIVE", "SUSPENDED", "CLOSED"]).optional(), page: z.coerce.number().int().min(1).default(1) });

export async function listOrganisations(q: z.infer<typeof orgQuery>) {
  const where = { ...(q.status ? { status: q.status } : {}), ...(q.q ? { OR: [{ name: { contains: q.q, mode: "insensitive" as const } }, { slug: { contains: q.q } }] } : {}) };
  const [items, total] = await Promise.all([
    prisma.organisation.findMany({ where, orderBy: { createdAt: "desc" }, skip: (q.page - 1) * 50, take: 50, select: { id: true, slug: true, name: true, type: true, status: true, verificationStatus: true, country: true, createdAt: true, _count: { select: { memberships: true } } } }),
    prisma.organisation.count({ where }),
  ]);
  return { items, total, page: q.page, pageSize: 50 };
}

export async function organisationDetail(id: string, admin: SessionInfo, meta: RequestMeta) {
  const org = await prisma.organisation.findUnique({ where: { id }, select: { id: true, slug: true, name: true, legalName: true, type: true, status: true, verificationStatus: true, verificationNotes: true, website: true, industry: true, sizeBand: true, country: true, dataRegion: true, createdAt: true, suspendedAt: true, suspendedReason: true, billingEmail: true, stripeCustomerId: true } });
  if (!org) throw notFound("Organisation");
  const stats = await withSystem("platform org detail (aggregate counts only)", async (tx) => ({
    members: await tx.organisationMembership.count({ where: { organisationId: id, status: "ACTIVE" } }),
    jobs: await tx.job.count({ where: { organisationId: id } }),
    applications: await tx.application.count({ where: { organisationId: id } }),
    interviews: await tx.interviewSession.count({ where: { organisationId: id } }),
    subscriptions: await tx.subscription.findMany({ where: { organisationId: id }, orderBy: { createdAt: "desc" }, include: { plan: { select: { name: true, key: true } } }, take: 5 }),
    credits: await balance(tx, { organisationId: id }),
    ledger: await tx.creditLedgerEntry.findMany({ where: { organisationId: id }, orderBy: { createdAt: "desc" }, take: 20 }),
  }));
  const owners = await prisma.organisationMembership.findMany({ where: { organisationId: id, role: { key: "OWNER" }, status: "ACTIVE" }, select: { user: { select: { email: true } } } });
  const grants = await prisma.supportAccessGrant.findMany({ where: { organisationId: id }, orderBy: { createdAt: "desc" }, take: 10 });
  await audit({ organisationId: id, actorUserId: admin.user.id, actorType: "PLATFORM_ADMIN", action: "platform.org_viewed", targetType: "Organisation", targetId: id, ip: meta.ip });
  return { org, stats, owners: owners.map((o) => o.user.email), supportGrants: grants };
}

export const orgActionSchema = z.object({ action: z.enum(["suspend", "reactivate", "verify", "reject_verification", "close"]), reason, confirm: z.literal(true) });

export async function organisationAction(id: string, raw: z.infer<typeof orgActionSchema>, admin: SessionInfo, meta: RequestMeta) {
  const input = orgActionSchema.parse(raw); // services validate too (defense in depth)
  const org = await prisma.organisation.findUnique({ where: { id } });
  if (!org) throw notFound("Organisation");
  const data =
    input.action === "suspend"
      ? { status: "SUSPENDED" as const, suspendedAt: new Date(), suspendedReason: input.reason }
      : input.action === "reactivate"
        ? { status: "ACTIVE" as const, suspendedAt: null, suspendedReason: null }
        : input.action === "verify"
          ? { verificationStatus: "VERIFIED" as const, verificationNotes: input.reason }
          : input.action === "reject_verification"
            ? { verificationStatus: "REJECTED" as const, verificationNotes: input.reason }
            : { status: "CLOSED" as const };
  if (input.action === "suspend" && org.status === "SUSPENDED") throw conflict("Already suspended");
  if (input.action === "reactivate" && org.status !== "SUSPENDED") throw conflict("Organisation is not suspended");
  await prisma.organisation.update({ where: { id }, data });
  await audit({ organisationId: id, actorUserId: admin.user.id, actorType: "PLATFORM_ADMIN", action: `platform.org_${input.action}`, targetType: "Organisation", targetId: id, reason: input.reason, ip: meta.ip, userAgent: meta.userAgent });
  return prisma.organisation.findUniqueOrThrow({ where: { id } });
}

export const creditAdjustSchema = z.object({ delta: z.number().int().min(-100000).max(100000).refine((n) => n !== 0, "Must be non-zero"), reason, confirm: z.literal(true), idempotencyKey: z.string().min(8).max(100) });

export async function adjustOrgCredits(orgId: string, raw: z.infer<typeof creditAdjustSchema>, admin: SessionInfo, meta: RequestMeta) {
  const input = creditAdjustSchema.parse(raw);
  if (!(await prisma.organisation.findUnique({ where: { id: orgId } }))) throw notFound("Organisation");
  const res = await prisma.$transaction((tx) => adjust(tx, { organisationId: orgId }, input.delta, `admin:${input.idempotencyKey}`, input.reason, admin.user.id));
  await audit({ organisationId: orgId, actorUserId: admin.user.id, actorType: "PLATFORM_ADMIN", action: "platform.credits_adjusted", targetType: "CreditAccount", targetId: res.entry.accountId, reason: input.reason, ip: meta.ip, metadata: { delta: input.delta, duplicate: res.duplicate } });
  return res.entry;
}

// ───────────────────────── Plans & packs ─────────────────────────

export const planSchema = z.object({
  key: z.string().regex(/^[a-z0-9_-]{2,60}$/),
  name: z.string().trim().min(2).max(80),
  description: z.string().trim().max(1000).nullable().optional(),
  audience: z.enum(["EMPLOYER", "UNIVERSITY", "STUDENT"]),
  interval: z.enum(["MONTH", "YEAR"]),
  priceAmount: z.number().int().min(0),
  currency: z.string().length(3).toLowerCase(),
  stripePriceId: z.string().max(100).nullable().optional(),
  trialDays: z.number().int().min(0).max(90).default(0),
  isPublic: z.boolean().default(true),
  isActive: z.boolean().default(true),
  sortOrder: z.number().int().default(0),
  entitlements: z.record(z.string().regex(/^[a-z0-9_.]+$/), z.string().max(40)),
});

export async function upsertPlan(input: z.infer<typeof planSchema>, admin: SessionInfo, meta: RequestMeta) {
  const { entitlements, ...data } = input;
  const plan = await prisma.plan.upsert({ where: { key: input.key }, create: data, update: data });
  await prisma.$transaction([
    prisma.planEntitlement.deleteMany({ where: { planId: plan.id } }),
    prisma.planEntitlement.createMany({ data: Object.entries(entitlements).map(([key, value]) => ({ planId: plan.id, key, value })) }),
  ]);
  await audit({ actorUserId: admin.user.id, actorType: "PLATFORM_ADMIN", action: "platform.plan_saved", targetType: "Plan", targetId: plan.id, ip: meta.ip, metadata: { key: plan.key, price: plan.priceAmount } });
  return prisma.plan.findUniqueOrThrow({ where: { id: plan.id }, include: { entitlements: true } });
}

export const packSchema = z.object({
  key: z.string().regex(/^[a-z0-9_-]{2,60}$/),
  name: z.string().trim().min(2).max(80),
  credits: z.number().int().min(1).max(100000),
  priceAmount: z.number().int().min(0),
  currency: z.string().length(3).toLowerCase(),
  stripePriceId: z.string().max(100).nullable().optional(),
  audience: z.enum(["EMPLOYER", "STUDENT"]),
  expiresInDays: z.number().int().min(1).max(3650).nullable().optional(),
  isActive: z.boolean().default(true),
});

export async function upsertPack(input: z.infer<typeof packSchema>, admin: SessionInfo, meta: RequestMeta) {
  const pack = await prisma.creditPack.upsert({ where: { key: input.key }, create: input, update: input });
  await audit({ actorUserId: admin.user.id, actorType: "PLATFORM_ADMIN", action: "platform.pack_saved", targetType: "CreditPack", targetId: pack.id, ip: meta.ip });
  return pack;
}

export async function listPlansAdmin() {
  const [plans, packs] = await Promise.all([prisma.plan.findMany({ include: { entitlements: true, _count: { select: { subscriptions: true } } }, orderBy: [{ audience: "asc" }, { sortOrder: "asc" }] }), prisma.creditPack.findMany({ orderBy: { credits: "asc" } })]);
  return { plans, packs };
}

// ───────────────────────── Flags & settings ─────────────────────────

export const flagSchema = z.object({ key: z.string().regex(/^[a-z0-9_.-]{2,80}$/), description: z.string().max(500).nullable().optional(), enabled: z.boolean(), rules: z.object({ organisationIds: z.array(z.string()).max(500).default([]) }).default({ organisationIds: [] }) });

export async function upsertFlag(input: z.infer<typeof flagSchema>, admin: SessionInfo, meta: RequestMeta) {
  const f = await prisma.featureFlag.upsert({ where: { key: input.key }, create: { ...input, updatedById: admin.user.id }, update: { ...input, updatedById: admin.user.id } });
  await audit({ actorUserId: admin.user.id, actorType: "PLATFORM_ADMIN", action: "platform.flag_saved", targetType: "FeatureFlag", targetId: f.key, ip: meta.ip, metadata: { enabled: f.enabled } });
  return f;
}

export async function isFlagEnabled(key: string, orgId?: string) {
  const f = await prisma.featureFlag.findUnique({ where: { key } });
  if (!f) return false;
  const ids = ((f.rules as { organisationIds?: string[] })?.organisationIds ?? []) as string[];
  return f.enabled || (!!orgId && ids.includes(orgId));
}

export const settingSchema = z.object({ key: z.enum(["practice.freeMonthly", "entitlements.default", "platform.announcement"]), value: z.unknown() });

export async function setSetting(input: z.infer<typeof settingSchema>, admin: SessionInfo, meta: RequestMeta) {
  if (input.key === "practice.freeMonthly" && (typeof input.value !== "number" || input.value < 0 || input.value > 100)) throw badRequest("Must be a number 0–100");
  const s = await prisma.platformSetting.upsert({ where: { key: input.key }, create: { key: input.key, value: input.value as never }, update: { value: input.value as never } });
  await audit({ actorUserId: admin.user.id, actorType: "PLATFORM_ADMIN", action: "platform.setting_saved", targetId: input.key, ip: meta.ip });
  return s;
}

// ───────────────────────── Operations ─────────────────────────

export async function providerHealth() {
  const redis = getRedis();
  let redisOk: boolean | null = null;
  if (redis) redisOk = await redis.ping().then((r) => r === "PONG").catch(() => false);
  const dbOk = await prisma.$queryRaw`SELECT 1`.then(() => true).catch(() => false);
  const e = env();
  const [emailStats, queueBacklog] = await Promise.all([
    prisma.emailDelivery.groupBy({ by: ["status"], where: { createdAt: { gte: new Date(Date.now() - 7 * 86400_000) } }, _count: { _all: true } }),
    // Due for more than 10 minutes (a retry waiting for its backoff is not stale).
    prisma.jobRun.count({ where: { status: "QUEUED", runAt: { lt: new Date(Date.now() - 10 * 60_000) } } }),
  ]);
  const jobs = await jobHealth().catch(() => null);
  return {
    database: { ok: dbOk },
    redis: { configured: !!redis, ok: redisOk },
    queue: { mode: e.QUEUE_MODE, staleQueued: queueBacklog, healthy: jobs?.healthy ?? null, lastRunnerSeenSeconds: jobs?.lastRunnerSeenSeconds ?? null },
    llm: deploymentAiStatus(),
    speech: speechStatus(),
    email: { provider: e.EMAIL_PROVIDER, last7Days: emailStats },
    payments: { provider: e.PAYMENT_PROVIDER, configured: e.PAYMENT_PROVIDER === "stripe" && !!e.STRIPE_SECRET_KEY, webhookSecretConfigured: !!e.STRIPE_WEBHOOK_SECRET },
    storage: { provider: e.STORAGE_PROVIDER },
    malwareScanner: { provider: e.MALWARE_SCANNER },
  };
}

export async function listJobRuns(status?: string) {
  return prisma.jobRun.findMany({ where: status ? { status } : {}, orderBy: { createdAt: "desc" }, take: 200, select: { id: true, name: true, status: true, attempts: true, error: true, organisationId: true, createdAt: true, finishedAt: true } });
}

export async function retryJobRun(id: string, admin: SessionInfo, meta: RequestMeta) {
  const run = await prisma.jobRun.findUnique({ where: { id } });
  if (!run || run.status !== "FAILED" || !run.payload) throw notFound("Failed job");
  await enqueue(run.name as JobName, run.payload as never);
  await prisma.jobRun.update({ where: { id }, data: { status: "RETRIED" } });
  await audit({ actorUserId: admin.user.id, actorType: "PLATFORM_ADMIN", action: "platform.job_retried", targetType: "JobRun", targetId: id, ip: meta.ip });
}

export async function listPaymentEvents(status?: string) {
  return prisma.paymentEvent.findMany({ where: status ? { status: status as never } : {}, orderBy: { receivedAt: "desc" }, take: 200, select: { id: true, providerEventId: true, type: true, status: true, organisationId: true, error: true, receivedAt: true, processedAt: true } });
}

export async function retryPaymentEvents(admin: SessionInfo, meta: RequestMeta) {
  const r = await retryFailedPaymentEvents();
  await audit({ actorUserId: admin.user.id, actorType: "PLATFORM_ADMIN", action: "platform.payment_events_retried", ip: meta.ip, metadata: r });
  return r;
}

export const auditQuery = z.object({ organisationId: z.string().optional(), action: z.string().max(100).optional(), actorUserId: z.string().optional(), result: z.enum(["SUCCESS", "FAILURE", "DENIED"]).optional(), page: z.coerce.number().int().min(1).default(1) });

export async function listAuditEvents(q: z.infer<typeof auditQuery>, orgScope?: string) {
  const where = {
    ...(orgScope ? { organisationId: orgScope } : q.organisationId ? { organisationId: q.organisationId } : {}),
    ...(q.action ? { action: { startsWith: q.action } } : {}),
    ...(q.actorUserId ? { actorUserId: q.actorUserId } : {}),
    ...(q.result ? { result: q.result } : {}),
  };
  const [items, total] = await Promise.all([prisma.auditEvent.findMany({ where, orderBy: { createdAt: "desc" }, skip: (q.page - 1) * 100, take: 100 }), prisma.auditEvent.count({ where })]);
  const actors = await prisma.user.findMany({ where: { id: { in: [...new Set(items.map((i) => i.actorUserId).filter(Boolean) as string[])] } }, select: { id: true, email: true } });
  return { items: items.map((i) => ({ ...i, actorEmail: actors.find((a) => a.id === i.actorUserId)?.email ?? null })), total, page: q.page, pageSize: 100 };
}

// ───────────────────────── Platform admins ─────────────────────────

export async function listPlatformAdmins() {
  return prisma.user.findMany({ where: { platformRole: { not: "NONE" } }, select: { id: true, email: true, platformRole: true, mfaEnabledAt: true, lastLoginAt: true } });
}

export const adminRoleSchema = z.object({ email: z.string().email(), role: z.enum(["NONE", "SUPPORT", "BILLING_ADMIN", "SUPER_ADMIN"]), reason });

export async function setPlatformRole(input: z.infer<typeof adminRoleSchema>, admin: SessionInfo, meta: RequestMeta) {
  const user = await prisma.user.findUnique({ where: { email: input.email.toLowerCase() } });
  if (!user) throw notFound("User");
  if (user.id === admin.user.id) throw forbidden("You cannot change your own platform role");
  if (user.platformRole === "SUPER_ADMIN" && input.role !== "SUPER_ADMIN") {
    const others = await prisma.user.count({ where: { platformRole: "SUPER_ADMIN", id: { not: user.id }, status: "ACTIVE" } });
    if (others === 0) throw conflict("At least one super admin must remain");
  }
  await prisma.user.update({ where: { id: user.id }, data: { platformRole: input.role } });
  await revokeAllSessions(user.id, "platform_role_changed");
  await audit({ actorUserId: admin.user.id, actorType: "PLATFORM_ADMIN", action: "platform.role_changed", targetType: "User", targetId: user.id, reason: input.reason, ip: meta.ip, metadata: { from: user.platformRole, to: input.role } });
}

// ───────────────────────── Support access (metadata only, approved & time-boxed) ─────────────────────────

export async function requestSupportAccess(orgId: string, reasonText: string, admin: SessionInfo, meta: RequestMeta) {
  reason.parse(reasonText);
  if (!(await prisma.organisation.findUnique({ where: { id: orgId } }))) throw notFound("Organisation");
  const g = await prisma.supportAccessGrant.create({ data: { organisationId: orgId, requestedById: admin.user.id, reason: reasonText } });
  await audit({ organisationId: orgId, actorUserId: admin.user.id, actorType: "PLATFORM_ADMIN", action: "platform.support_access_requested", targetType: "SupportAccessGrant", targetId: g.id, reason: reasonText, ip: meta.ip });
  return g;
}

export async function decideSupportAccess(orgId: string, grantId: string, approve: boolean, actorUserId: string, meta: RequestMeta) {
  const g = await prisma.supportAccessGrant.findFirst({ where: { id: grantId, organisationId: orgId, status: "REQUESTED" } });
  if (!g) throw notFound("Request");
  const updated = await prisma.supportAccessGrant.update({ where: { id: g.id }, data: approve ? { status: "APPROVED", approvedById: actorUserId, decidedAt: new Date(), expiresAt: new Date(Date.now() + 24 * 3600_000) } : { status: "DENIED", decidedAt: new Date() } });
  await audit({ organisationId: orgId, actorUserId, action: approve ? "support_access.approved" : "support_access.denied", targetType: "SupportAccessGrant", targetId: g.id, ip: meta.ip });
  return updated;
}

// ───────────────────────── Support tickets ─────────────────────────

export const ticketSchema = z.object({ subject: z.string().trim().min(3).max(200), body: z.string().trim().min(10).max(10000), priority: z.enum(["LOW", "NORMAL", "HIGH", "URGENT"]).default("NORMAL") });

export async function createTicket(userId: string, orgId: string | null, input: z.infer<typeof ticketSchema>) {
  return prisma.supportTicket.create({ data: { requesterId: userId, organisationId: orgId, subject: input.subject, body: input.body, priority: input.priority } });
}

export async function listTickets(filter: { requesterId?: string; organisationId?: string; status?: string }) {
  return prisma.supportTicket.findMany({ where: { ...(filter.requesterId ? { requesterId: filter.requesterId } : {}), ...(filter.organisationId ? { organisationId: filter.organisationId } : {}), ...(filter.status ? { status: filter.status as never } : {}) }, orderBy: { updatedAt: "desc" }, include: { organisation: { select: { name: true } }, messages: { where: { internal: false }, orderBy: { createdAt: "asc" } } }, take: 200 });
}

export async function getTicket(id: string, opts: { requesterId?: string; admin?: boolean }) {
  const t = await prisma.supportTicket.findUnique({ where: { id }, include: { organisation: { select: { name: true } }, messages: { orderBy: { createdAt: "asc" } } } });
  if (!t || (!opts.admin && t.requesterId !== opts.requesterId)) throw notFound("Ticket");
  return { ...t, messages: opts.admin ? t.messages : t.messages.filter((m) => !m.internal) };
}

export async function replyTicket(id: string, authorId: string, body: string, opts: { admin: boolean; internal?: boolean; status?: "OPEN" | "PENDING" | "RESOLVED" | "CLOSED"; requesterId?: string }) {
  await getTicket(id, { admin: opts.admin, requesterId: opts.requesterId });
  await prisma.supportTicketMessage.create({ data: { ticketId: id, authorId, body: body.trim().slice(0, 10000), internal: opts.admin && !!opts.internal } });
  await prisma.supportTicket.update({ where: { id }, data: { status: opts.status ?? (opts.admin ? "PENDING" : "OPEN"), ...(opts.admin ? { assigneeId: authorId } : {}) } });
  return getTicket(id, { admin: opts.admin, requesterId: opts.requesterId });
}

export async function listDataRequestsAdmin() {
  return prisma.dataSubjectRequest.findMany({ orderBy: { createdAt: "desc" }, take: 200, include: { deletionJob: true } });
}
