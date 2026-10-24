import { withOrg } from "../db/tenant";
import { prisma } from "../db/client";
import type { OrgContext } from "../auth/context";
import { assignedJobIds } from "./applications";
import { balance } from "../billing/credits";

/** HR dashboard metrics — computed from real records, scoped to the user's job access. */
export async function hrDashboard(ctx: OrgContext) {
  return withOrg(ctx.org.id, ctx.userId, async (tx) => {
    const scope = ctx.can("candidates.view_all") || ctx.can("candidates.view_assigned") ? await assignedJobIds(ctx, tx) : [];
    const jobFilter = scope ? { jobId: { in: scope } } : {};
    const since90 = new Date(Date.now() - 90 * 86400_000);
    const [openJobs, activeApps, byStage, stages, sessions, pendingReviews, hired, recentEvents, credit, myAssignments] = await Promise.all([
      tx.job.count({ where: { organisationId: ctx.org.id, status: "PUBLISHED", ...(scope ? { id: { in: scope } } : {}) } }),
      tx.application.count({ where: { organisationId: ctx.org.id, status: { in: ["SUBMITTED", "IN_REVIEW", "INTERVIEWING", "OFFER"] }, ...jobFilter } }),
      tx.application.groupBy({ by: ["stageId"], where: { organisationId: ctx.org.id, status: { not: "DRAFT" }, ...jobFilter }, _count: { _all: true } }),
      tx.applicationStage.findMany({ where: { organisationId: ctx.org.id }, orderBy: { position: "asc" } }),
      tx.interviewSession.groupBy({ by: ["status"], where: { organisationId: ctx.org.id, createdAt: { gte: since90 }, ...(scope ? { application: { jobId: { in: scope } } } : {}) }, _count: { _all: true } }),
      tx.interviewSession.findMany({
        where: { organisationId: ctx.org.id, status: { in: ["ASSESSED", "REQUIRES_REVIEW"] }, ...(scope ? { application: { jobId: { in: scope } } } : {}) },
        orderBy: { completedAt: "asc" },
        take: 10,
        select: { id: true, status: true, completedAt: true, providerMode: true, application: { select: { id: true, candidate: { select: { firstName: true, lastName: true } }, job: { select: { title: true } } } } },
      }),
      tx.application.findMany({ where: { organisationId: ctx.org.id, status: "HIRED", decidedAt: { gte: since90 }, submittedAt: { not: null }, ...jobFilter }, select: { submittedAt: true, decidedAt: true } }),
      tx.interviewSession.findMany({
        where: { organisationId: ctx.org.id, status: { in: ["INVITED", "READY", "IN_PROGRESS", "INTERRUPTED"] }, ...(scope ? { application: { jobId: { in: scope } } } : {}) },
        orderBy: { expiresAt: "asc" },
        take: 10,
        select: { id: true, status: true, expiresAt: true, application: { select: { id: true, candidate: { select: { firstName: true, lastName: true } }, job: { select: { title: true } } } } },
      }),
      ctx.can("billing.view") ? balance(tx, { organisationId: ctx.org.id }) : Promise.resolve(null),
      tx.jobAssignment.findMany({ where: { organisationId: ctx.org.id, userId: ctx.userId }, include: { job: { select: { id: true, title: true, status: true, _count: { select: { applications: true } } } } } }),
    ]);
    const count = (s: string) => sessions.find((x) => x.status === s)?._count._all ?? 0;
    const invited = sessions.reduce((a, s) => a + s._count._all, 0) - count("CANCELLED");
    const completed = ["PROCESSING", "ASSESSED", "REQUIRES_REVIEW", "REVIEWED", "CLOSED"].reduce((a, s) => a + count(s), 0);
    const tth = hired.map((h) => (h.decidedAt!.getTime() - h.submittedAt!.getTime()) / 86400_000);
    return {
      openJobs,
      activeApplications: activeApps,
      funnel: stages.map((s) => ({ stageId: s.id, name: s.name, kind: s.kind, count: byStage.find((b) => b.stageId === s.id)?._count._all ?? 0 })),
      interviews: {
        invitedLast90Days: invited,
        completedLast90Days: completed,
        completionRate: invited > 0 ? completed / invited : null,
        expired: count("EXPIRED"),
        failed: count("FAILED"),
      },
      timeToHireDays: tth.length ? { median: median(tth), count: tth.length } : null,
      pendingReviews,
      upcoming: recentEvents,
      credits: credit ? { available: credit.available, reserved: credit.reserved } : null,
      myAssignments: myAssignments.map((a) => ({ role: a.role, job: a.job })),
    };
  });
}

function median(xs: number[]) {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return Math.round((s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2) * 10) / 10;
}

export async function jobAnalytics(ctx: OrgContext, jobId: string) {
  return withOrg(ctx.org.id, ctx.userId, async (tx) => {
    const scope = await assignedJobIds(ctx, tx);
    if (scope && !scope.includes(jobId)) return null;
    const [byStatus, bySource, sessions, results] = await Promise.all([
      tx.application.groupBy({ by: ["status"], where: { organisationId: ctx.org.id, jobId }, _count: { _all: true } }),
      tx.application.groupBy({ by: ["source"], where: { organisationId: ctx.org.id, jobId, status: { not: "DRAFT" } }, _count: { _all: true } }),
      tx.interviewSession.groupBy({ by: ["status"], where: { organisationId: ctx.org.id, application: { jobId } }, _count: { _all: true } }),
      tx.assessmentResult.findMany({ where: { organisationId: ctx.org.id, assessment: { session: { application: { jobId } } } }, select: { competencyId: true, rating: true, humanRating: true } }),
    ]);
    const comps = await tx.competency.findMany({ where: { id: { in: [...new Set(results.map((r) => r.competencyId))] } }, select: { id: true, name: true } });
    const distribution = comps.map((c) => {
      const rs = results.filter((r) => r.competencyId === c.id);
      const counts: Record<string, number> = {};
      for (const r of rs) counts[r.humanRating ?? r.rating] = (counts[r.humanRating ?? r.rating] ?? 0) + 1;
      return { competency: c.name, counts, total: rs.length };
    });
    return { byStatus, bySource, sessions, competencyDistribution: distribution };
  });
}

export async function recentActivity(ctx: OrgContext, limit = 20) {
  if (!ctx.can("audit.view")) return [];
  const items = await prisma.auditEvent.findMany({ where: { organisationId: ctx.org.id }, orderBy: { createdAt: "desc" }, take: limit });
  const actors = await prisma.userProfile.findMany({ where: { userId: { in: items.map((i) => i.actorUserId).filter(Boolean) as string[] } } });
  return items.map((i) => ({ ...i, actor: actors.find((a) => a.userId === i.actorUserId) ? `${actors.find((a) => a.userId === i.actorUserId)!.firstName} ${actors.find((a) => a.userId === i.actorUserId)!.lastName}` : i.actorType }));
}
