import { withOrg } from "../db/tenant";
import type { OrgContext } from "../auth/context";
import { employerProgrammes } from "./universities";

/** Reference data for the job form. */
export async function jobFormData(ctx: OrgContext) {
  const [refs, programmes] = await Promise.all([
    withOrg(ctx.org.id, ctx.userId, async (tx) => ({
      departments: await tx.department.findMany({ where: { organisationId: ctx.org.id }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
      templates: await tx.interviewTemplate.findMany({ where: { organisationId: ctx.org.id, archivedAt: null }, select: { id: true, name: true } }),
      competencies: await tx.competency.findMany({ where: { organisationId: ctx.org.id, archivedAt: null }, select: { id: true, name: true } }),
    })),
    employerProgrammes(ctx).catch(() => []),
  ]);
  return { ...refs, programmes: programmes.filter((p) => p.status === "ACTIVE" && p.programme).map((p) => ({ id: p.programme!.id, name: `${p.programme!.name} (${p.programme!.organisation.name})` })) };
}
