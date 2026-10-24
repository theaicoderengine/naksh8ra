import type { PrismaClient } from "@prisma/client";
import { ORG_ROLES, PERMISSIONS } from "../rbac/permissions";

/** Idempotent: mirror the code-defined permission catalogue and system roles into the database. */
export async function seedSystem(prisma: PrismaClient) {
  for (const [key, description] of Object.entries(PERMISSIONS)) {
    await prisma.permission.upsert({ where: { key }, create: { key, description }, update: { description } });
  }
  const perms = await prisma.permission.findMany();
  const byKey = new Map(perms.map((p) => [p.key, p.id]));
  for (const [key, role] of Object.entries(ORG_ROLES)) {
    let r = await prisma.role.findFirst({ where: { key, organisationId: null } });
    if (r) r = await prisma.role.update({ where: { id: r.id }, data: { name: role.name, description: role.description } });
    else r = await prisma.role.create({ data: { key, name: role.name, description: role.description, isSystem: true } });
    await prisma.rolePermission.deleteMany({ where: { roleId: r.id } });
    await prisma.rolePermission.createMany({ data: role.permissions.map((p) => ({ roleId: r!.id, permissionId: byKey.get(p)! })) });
  }
  await prisma.platformSetting.upsert({ where: { key: "practice.freeMonthly" }, create: { key: "practice.freeMonthly", value: 3 }, update: {} });
  await prisma.platformSetting.upsert({ where: { key: "entitlements.default" }, create: { key: "entitlements.default", value: { seats: "2", monthly_interview_credits: "0", "feature.realtime_interviews": "false" } }, update: {} });
}
