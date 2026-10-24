import type { Prisma } from "@prisma/client";
import { prisma } from "./db/client";
import type { Tx } from "./db/tenant";

export type AuditInput = {
  organisationId?: string | null;
  actorUserId?: string | null;
  actorType?: "USER" | "SYSTEM" | "PLATFORM_ADMIN" | "WEBHOOK" | "CANDIDATE";
  action: string;
  targetType?: string;
  targetId?: string;
  reason?: string | null;
  result?: "SUCCESS" | "FAILURE" | "DENIED";
  ip?: string | null;
  userAgent?: string | null;
  metadata?: Prisma.InputJsonValue;
};

/**
 * Append an audit event. Pass `tx` to make the audit record part of the same
 * transaction as the change it describes (preferred for sensitive changes).
 * AuditEvent is append-only at the database level.
 */
export async function audit(input: AuditInput, tx?: Tx) {
  const client = tx ?? prisma;
  await client.auditEvent.create({
    data: {
      organisationId: input.organisationId ?? null,
      actorUserId: input.actorUserId ?? null,
      actorType: input.actorType ?? "USER",
      action: input.action,
      targetType: input.targetType,
      targetId: input.targetId,
      reason: input.reason ?? null,
      result: input.result ?? "SUCCESS",
      ipAddress: input.ip ?? null,
      userAgent: input.userAgent?.slice(0, 300) ?? null,
      metadata: input.metadata ?? {},
    },
  });
}
