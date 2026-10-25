import { prisma } from "../db/client";
import { withSystem } from "../db/tenant";
import { decryptWithInfo, encrypt } from "../auth/crypto";
import { logger } from "../logger";

export type ReencryptReport = {
  apply: boolean;
  tables: Record<string, { total: number; current: number; reencrypted: number; undecryptable: string[] }>;
};

/**
 * Key rotation step 2: move every stored secret to the current ENCRYPTION_KEY.
 *
 *   1. Deploy with ENCRYPTION_KEY=<new> and ENCRYPTION_KEY_PREVIOUS=<old> (both readable).
 *   2. Run this with apply=true until it reports 0 secrets on the previous key.
 *   3. Remove ENCRYPTION_KEY_PREVIOUS and redeploy.
 *
 * Idempotent; each row is updated only if its ciphertext is unchanged since it was read
 * (so a concurrent key replacement by the organisation is never overwritten). Never logs
 * or returns secret values — only counts and row ids that could not be decrypted.
 */
export async function reencryptSecrets(apply: boolean): Promise<ReencryptReport> {
  const report: ReencryptReport = { apply, tables: {} };
  const t = (name: string) => (report.tables[name] ??= { total: 0, current: 0, reencrypted: 0, undecryptable: [] });

  const creds = await withSystem("key rotation: read org AI keys", (tx) => tx.orgAiCredential.findMany({ select: { id: true, encryptedKey: true } }));
  for (const c of creds) {
    const s = t("OrgAiCredential.encryptedKey");
    s.total++;
    let r;
    try {
      r = decryptWithInfo(c.encryptedKey);
    } catch {
      s.undecryptable.push(c.id);
      continue;
    }
    if (r.keyUsed === "current") {
      s.current++;
      continue;
    }
    if (apply) {
      const n = await withSystem("key rotation: re-encrypt org AI key", (tx) => tx.orgAiCredential.updateMany({ where: { id: c.id, encryptedKey: c.encryptedKey }, data: { encryptedKey: encrypt(r.plain) } }));
      if (n.count) s.reencrypted++;
    } else s.reencrypted++;
  }

  const users = await prisma.user.findMany({ where: { mfaSecret: { not: null } }, select: { id: true, mfaSecret: true } });
  for (const u of users) {
    const s = t("User.mfaSecret");
    s.total++;
    let r;
    try {
      r = decryptWithInfo(u.mfaSecret!);
    } catch {
      s.undecryptable.push(u.id);
      continue;
    }
    if (r.keyUsed === "current") {
      s.current++;
      continue;
    }
    if (apply) {
      const n = await prisma.user.updateMany({ where: { id: u.id, mfaSecret: u.mfaSecret }, data: { mfaSecret: encrypt(r.plain) } });
      if (n.count) s.reencrypted++;
    } else s.reencrypted++;
  }
  logger.info({ apply, tables: Object.fromEntries(Object.entries(report.tables).map(([k, v]) => [k, { ...v, undecryptable: v.undecryptable.length }])) }, "secrets re-encryption");
  return report;
}
