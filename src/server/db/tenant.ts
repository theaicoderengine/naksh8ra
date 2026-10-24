import { Prisma } from "@prisma/client";
import { prisma } from "./client";
import { logger } from "../logger";

export type Tx = Prisma.TransactionClient;

type TxOptions = { timeoutMs?: number; isolation?: Prisma.TransactionIsolationLevel };

async function run<T>(
  settings: Record<string, string>,
  fn: (tx: Tx) => Promise<T>,
  opts: TxOptions = {},
): Promise<T> {
  return prisma.$transaction(
    async (tx) => {
      // set_config(..., true) is transaction-local, so the context can never
      // leak to another request that later reuses this pooled connection.
      for (const [k, v] of Object.entries(settings)) {
        await tx.$executeRaw`SELECT set_config(${k}, ${v}, true)`;
      }
      return fn(tx);
    },
    { timeout: opts.timeoutMs ?? 15_000, maxWait: 10_000, isolationLevel: opts.isolation },
  );
}

/**
 * Execute within an organisation's tenant context. `orgId` MUST come from a
 * server-side resolution (membership lookup, invitation token, job lookup) —
 * never directly from client input.
 */
export function withOrg<T>(orgId: string, userId: string | null, fn: (tx: Tx) => Promise<T>, opts?: TxOptions) {
  if (!orgId) throw new Error("withOrg requires an organisation id");
  return run({ "app.org_id": orgId, "app.user_id": userId ?? "" }, fn, opts);
}

/** Personal context: only rows owned by this user (plus public jobs) are visible in tenant tables. */
export function withUser<T>(userId: string, fn: (tx: Tx) => Promise<T>, opts?: TxOptions) {
  if (!userId) throw new Error("withUser requires a user id");
  return run({ "app.org_id": "", "app.user_id": userId }, fn, opts);
}

/**
 * Bypass row-level security. Only for audited platform-admin operations,
 * token resolution (invitation → organisation) and background maintenance.
 * Every call site must pass a reason, which is logged.
 */
export function withSystem<T>(reason: string, fn: (tx: Tx) => Promise<T>, opts?: TxOptions) {
  logger.debug({ reason }, "system db context");
  return run({ "app.bypass_rls": "on", "app.org_id": "", "app.user_id": "" }, fn, opts);
}

/** System context that may also delete from append-only tables (retention / erasure jobs). */
export function withPurge<T>(reason: string, fn: (tx: Tx) => Promise<T>, opts?: TxOptions) {
  logger.info({ reason }, "purge db context");
  return run({ "app.bypass_rls": "on", "app.allow_purge": "on" }, fn, { timeoutMs: 120_000, ...opts });
}
