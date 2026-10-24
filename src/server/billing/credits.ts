import type { CreditEntryType } from "@prisma/client";
import { createId } from "../../lib/id";
import type { Tx } from "../db/tenant";
import { AppError } from "../errors";

/**
 * Interview credit ledger.
 *
 * - Every balance change is an immutable CreditLedgerEntry (DB trigger blocks
 *   UPDATE/DELETE). CreditAccount.available/reserved are a cache maintained in
 *   the same transaction, under a row lock, so concurrent reservations
 *   serialise and can never overdraw (also enforced by CHECK constraints).
 * - Every operation takes an idempotency key, unique per account: retries,
 *   duplicate webhooks and double-clicks return the original entry instead of
 *   applying twice.
 *
 * Billable-event policy (docs/billing.md#billable-events):
 *   reserve  — when an employer sends an AI interview invitation (capacity is guaranteed
 *              for the candidate, who is never blocked mid-interview)
 *   consume  — when the session completes (PROCESSING) with at least one answer submitted,
 *              including an interrupted session that expires after partial answers
 *   release  — cancelled, withdrawn, expired unused, or failed due to platform/provider fault
 */

export type Owner = { organisationId: string } | { userId: string };

export async function getOrCreateAccount(tx: Tx, owner: Owner) {
  const isOrg = "organisationId" in owner;
  const id = createId();
  if (isOrg) {
    await tx.$executeRaw`INSERT INTO "CreditAccount" (id, "ownerType", "organisationId", available, reserved, "createdAt", "updatedAt")
      VALUES (${id}, 'ORGANISATION', ${owner.organisationId}, 0, 0, now(), now()) ON CONFLICT ("organisationId") DO NOTHING`;
    return tx.creditAccount.findUniqueOrThrow({ where: { organisationId: owner.organisationId } });
  }
  await tx.$executeRaw`INSERT INTO "CreditAccount" (id, "ownerType", "userId", available, reserved, "createdAt", "updatedAt")
    VALUES (${id}, 'USER', ${owner.userId}, 0, 0, now(), now()) ON CONFLICT ("userId") DO NOTHING`;
  return tx.creditAccount.findUniqueOrThrow({ where: { userId: owner.userId } });
}

type PostInput = {
  type: CreditEntryType;
  dAvailable: number;
  dReserved?: number;
  idempotencyKey: string;
  reference?: string;
  reason?: string;
  actorUserId?: string;
  expiresAt?: Date | null;
};

async function post(tx: Tx, accountId: string, input: PostInput) {
  // Serialise all writers on this account.
  const locked = await tx.$queryRaw<{ id: string; available: number; reserved: number; organisationId: string | null }[]>`
    SELECT id, available, reserved, "organisationId" FROM "CreditAccount" WHERE id = ${accountId} FOR UPDATE`;
  if (!locked.length) throw new AppError("NOT_FOUND", "Credit account not found");
  const acct = locked[0];

  const existing = await tx.creditLedgerEntry.findUnique({ where: { accountId_idempotencyKey: { accountId, idempotencyKey: input.idempotencyKey } } });
  if (existing) return { entry: existing, duplicate: true };

  const dReserved = input.dReserved ?? 0;
  const nextAvailable = acct.available + input.dAvailable;
  const nextReserved = acct.reserved + dReserved;
  if (nextAvailable < 0) throw new AppError("PAYMENT_REQUIRED", "Not enough interview credits. Purchase more credits or upgrade your plan.");
  if (nextReserved < 0) throw new AppError("INVALID_STATE", "No matching credit reservation");

  const entry = await tx.creditLedgerEntry.create({
    data: {
      accountId,
      organisationId: acct.organisationId,
      type: input.type,
      amountAvailable: input.dAvailable,
      amountReserved: dReserved,
      balanceAvailable: nextAvailable,
      balanceReserved: nextReserved,
      idempotencyKey: input.idempotencyKey,
      reference: input.reference,
      reason: input.reason,
      actorUserId: input.actorUserId,
      expiresAt: input.expiresAt ?? null,
    },
  });
  await tx.creditAccount.update({ where: { id: accountId }, data: { available: nextAvailable, reserved: nextReserved } });
  return { entry, duplicate: false };
}

export async function grant(
  tx: Tx,
  owner: Owner,
  amount: number,
  type: "GRANT_SUBSCRIPTION" | "GRANT_PURCHASE" | "GRANT_FREE_PRACTICE" | "ADJUSTMENT",
  key: string,
  extra: Partial<PostInput> = {},
) {
  if (!Number.isInteger(amount) || amount <= 0) throw new AppError("BAD_REQUEST", "Grant amount must be a positive integer");
  const acct = await getOrCreateAccount(tx, owner);
  return post(tx, acct.id, { type, dAvailable: amount, idempotencyKey: key, ...extra });
}

/** Signed manual adjustment by a platform billing admin (reason required). */
export async function adjust(tx: Tx, owner: Owner, delta: number, key: string, reason: string, actorUserId: string) {
  if (!Number.isInteger(delta) || delta === 0) throw new AppError("BAD_REQUEST", "Adjustment must be a non-zero integer");
  if (!reason?.trim()) throw new AppError("BAD_REQUEST", "A reason is required");
  const acct = await getOrCreateAccount(tx, owner);
  return post(tx, acct.id, { type: "ADJUSTMENT", dAvailable: delta, idempotencyKey: key, reason, actorUserId });
}

export async function reserve(tx: Tx, owner: Owner, key: string, reference: string, amount = 1) {
  const acct = await getOrCreateAccount(tx, owner);
  return post(tx, acct.id, { type: "RESERVE", dAvailable: -amount, dReserved: amount, idempotencyKey: `reserve:${key}`, reference });
}

/** Settle a reservation as consumed. Idempotent; no-op if already settled. */
export async function consume(tx: Tx, owner: Owner, key: string, reference: string, amount = 1) {
  const acct = await getOrCreateAccount(tx, owner);
  if (await settled(tx, acct.id, key)) return { duplicate: true, entry: null };
  return post(tx, acct.id, { type: "CONSUME", dAvailable: 0, dReserved: -amount, idempotencyKey: `settle:${key}`, reference });
}

/** Return a reservation to the available balance. Idempotent; no-op if already settled. */
export async function release(tx: Tx, owner: Owner, key: string, reference: string, reason: string, amount = 1) {
  const acct = await getOrCreateAccount(tx, owner);
  const reserved = await tx.creditLedgerEntry.findUnique({ where: { accountId_idempotencyKey: { accountId: acct.id, idempotencyKey: `reserve:${key}` } } });
  if (!reserved) return { duplicate: true, entry: null };
  if (await settled(tx, acct.id, key)) return { duplicate: true, entry: null };
  return post(tx, acct.id, { type: "RELEASE", dAvailable: amount, dReserved: -amount, idempotencyKey: `settle:${key}`, reference, reason });
}

async function settled(tx: Tx, accountId: string, key: string) {
  return !!(await tx.creditLedgerEntry.findUnique({ where: { accountId_idempotencyKey: { accountId, idempotencyKey: `settle:${key}` } } }));
}

/** Reverse purchased credits after a provider refund (bounded by what is still available). */
export async function refundCredits(tx: Tx, owner: Owner, amount: number, key: string, reference: string) {
  const acct = await getOrCreateAccount(tx, owner);
  const fresh = await tx.creditAccount.findUniqueOrThrow({ where: { id: acct.id } });
  const reversible = Math.min(amount, fresh.available);
  if (reversible <= 0) return { duplicate: false, entry: null, reversed: 0 };
  const res = await post(tx, acct.id, { type: "REFUND", dAvailable: -reversible, idempotencyKey: key, reference, reason: "provider_refund" });
  return { ...res, reversed: reversible };
}

export async function balance(tx: Tx, owner: Owner) {
  const acct = await getOrCreateAccount(tx, owner);
  return { available: acct.available, reserved: acct.reserved, accountId: acct.id };
}

/** Recompute balances from the ledger and compare to the cached values. */
export async function reconcile(tx: Tx, accountId: string) {
  const [sum] = await tx.$queryRaw<{ a: bigint | null; r: bigint | null }[]>`
    SELECT SUM("amountAvailable") AS a, SUM("amountReserved") AS r FROM "CreditLedgerEntry" WHERE "accountId" = ${accountId}`;
  const acct = await tx.creditAccount.findUniqueOrThrow({ where: { id: accountId } });
  const ledgerAvailable = Number(sum.a ?? 0);
  const ledgerReserved = Number(sum.r ?? 0);
  return {
    accountId,
    cachedAvailable: acct.available,
    cachedReserved: acct.reserved,
    ledgerAvailable,
    ledgerReserved,
    consistent: ledgerAvailable === acct.available && ledgerReserved === acct.reserved,
  };
}

/** Expire grants whose disclosed expiry has passed (FIFO approximation: expire up to the granted amount still unused). */
export async function expireGrants(tx: Tx, accountId: string, now = new Date()) {
  const expired = await tx.creditLedgerEntry.findMany({
    where: { accountId, type: { in: ["GRANT_PURCHASE", "GRANT_SUBSCRIPTION", "GRANT_FREE_PRACTICE"] }, expiresAt: { lte: now } },
  });
  let total = 0;
  for (const g of expired) {
    const acct = await tx.creditAccount.findUniqueOrThrow({ where: { id: accountId } });
    const amount = Math.min(g.amountAvailable, acct.available);
    if (amount <= 0) continue;
    const r = await post(tx, accountId, { type: "EXPIRE", dAvailable: -amount, idempotencyKey: `expire:${g.id}`, reference: g.id, reason: "grant_expired" });
    if (!r.duplicate) total += amount;
  }
  return total;
}
