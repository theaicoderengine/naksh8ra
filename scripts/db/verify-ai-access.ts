/**
 * Read-only verification of the AI provider access rollout on a database (staging or
 * production). Run AFTER `prisma migrate deploy` and `npm run db:seed`:
 *
 *   MIGRATION_DATABASE_URL=... npx tsx scripts/db/verify-ai-access.ts [--expect-no-grants]
 *
 * Exits non-zero when an invariant fails. Prints counts only — never key material.
 */
import { PrismaClient } from "@prisma/client";
import { ORG_ROLES } from "../../src/server/rbac/permissions";

const url = process.env.MIGRATION_DATABASE_URL ?? process.env.DATABASE_URL;
if (!url) throw new Error("Set MIGRATION_DATABASE_URL (owner role, read-only queries only)");
const db = new PrismaClient({ datasources: { db: { url } } });
const expectNoGrants = process.argv.includes("--expect-no-grants");

const results: { check: string; ok: boolean; detail: string }[] = [];
const check = (name: string, ok: boolean, detail = "") => results.push({ check: name, ok, detail });

async function main() {
  // 1. Migrations
  const migrations = await db.$queryRaw<{ migration_name: string; finished_at: Date | null; rolled_back_at: Date | null }[]>`
    SELECT migration_name, finished_at, rolled_back_at FROM "_prisma_migrations" ORDER BY started_at`;
  for (const m of ["ai_provider_access", "ai_usage_reservations"]) {
    const row = migrations.find((x) => x.migration_name.endsWith(m));
    check(`migration ${m} applied`, !!row?.finished_at && !row.rolled_back_at, row?.migration_name ?? "missing");
  }
  check("no failed migrations", migrations.every((m) => m.finished_at || m.rolled_back_at), `${migrations.length} total`);

  // 2. Row-level security on the new tables, and the runtime role cannot bypass it.
  const rls = await db.$queryRaw<{ relname: string; relrowsecurity: boolean }[]>`
    SELECT relname, relrowsecurity FROM pg_class WHERE relname IN ('PlatformAiGrant','OrgAiCredential','OrgAiRoute','AiUsageCounter','AiUsageReservation','AiRequestLog')`;
  check("RLS enabled on all 6 AI tables", rls.length === 6 && rls.every((r) => r.relrowsecurity), rls.map((r) => `${r.relname}=${r.relrowsecurity}`).join(" "));
  const policies = await db.$queryRaw<{ tablename: string; policyname: string; cmd: string }[]>`
    SELECT tablename, policyname, cmd FROM pg_policies WHERE tablename IN ('PlatformAiGrant','OrgAiCredential','OrgAiRoute','AiUsageCounter','AiUsageReservation','AiRequestLog') ORDER BY 1, 2`;
  const has = (t: string, p: string) => policies.some((x) => x.tablename === t && x.policyname === p);
  check("grant table: org read-only, system write", has("PlatformAiGrant", "grant_read") && has("PlatformAiGrant", "grant_write"));
  check("request log: org read, system insert/update/delete", ["log_read", "log_write", "log_maintain_update", "log_maintain_delete"].every((p) => has("AiRequestLog", p)));
  const app = await db.$queryRaw<{ rolbypassrls: boolean; rolsuper: boolean }[]>`SELECT rolbypassrls, rolsuper FROM pg_roles WHERE rolname = 'atlas_app'`;
  check("runtime role atlas_app cannot bypass RLS", !!app[0] && !app[0].rolbypassrls && !app[0].rolsuper);

  // 3. Roles: ai.manage reaches OWNER and HR_ADMIN only (system roles).
  const rolePerms = await db.$queryRaw<{ key: string; has: boolean }[]>`
    SELECT r.key, EXISTS (SELECT 1 FROM "RolePermission" rp JOIN "Permission" p ON p.id = rp."permissionId" WHERE rp."roleId" = r.id AND p.key = 'ai.manage') AS has
    FROM "Role" r WHERE r."organisationId" IS NULL`;
  for (const [key, def] of Object.entries(ORG_ROLES)) {
    const expected = (def.permissions as readonly string[]).includes("ai.manage");
    const row = rolePerms.find((r) => r.key === key);
    check(`role ${key}: ai.manage ${expected ? "granted" : "absent"}`, !!row && row.has === expected, row ? String(row.has) : "role missing — run npm run db:seed");
  }

  // 4. Default deny: grants that exist are explicit rows; report them.
  const orgs = await db.organisation.count({ where: { type: "EMPLOYER" } });
  const grants = await db.platformAiGrant.groupBy({ by: ["subject", "enabled"], _count: { _all: true } });
  const enabledSubjects = new Set(grants.filter((g) => g.enabled).map((g) => g.subject));
  check(
    expectNoGrants ? "no platform AI grants exist (default deny after upgrade)" : "platform AI grants (informational)",
    !expectNoGrants || enabledSubjects.size === 0,
    `${enabledSubjects.has("PERSONAL") ? "PERSONAL + " : ""}${[...enabledSubjects].filter((s) => s !== "PERSONAL").length} of ${orgs} employer organisations have enabled grants`,
  );
  const orphanGrants = await db.$queryRaw<{ n: bigint }[]>`SELECT count(*) AS n FROM "PlatformAiGrant" g WHERE g.subject <> 'PERSONAL' AND NOT EXISTS (SELECT 1 FROM "Organisation" o WHERE o.id = g."organisationId")`;
  check("no grants for missing organisations", Number(orphanGrants[0].n) === 0);

  // 5. Credentials: encrypted, never plaintext-looking.
  const creds = await db.orgAiCredential.findMany({ select: { encryptedKey: true } });
  check("org keys stored as AES-GCM envelopes (v1.iv.tag.ciphertext)", creds.every((c) => /^v1\.[\w-]+\.[\w-]+\.[\w-]+$/.test(c.encryptedKey)), `${creds.length} keys`);

  // 6. Usage state consistent.
  const negative = await db.$queryRaw<{ n: bigint }[]>`SELECT count(*) AS n FROM "AiUsageCounter" WHERE requests < 0 OR tokens < 0 OR "tokensReserved" < 0`;
  check("usage counters non-negative", Number(negative[0].n) === 0);
  const staleRes = await db.aiUsageReservation.count({ where: { expiredAt: null, expiresAt: { lt: new Date() } } });
  check("no unswept expired reservations", staleRes === 0, `${staleRes} pending sweep (worker job ai.reservations.sweep)`);

  for (const r of results) console.log(`${r.ok ? "PASS" : "FAIL"}  ${r.check}${r.detail ? ` — ${r.detail}` : ""}`);
  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - failed}/${results.length} checks passed`);
  await db.$disconnect();
  if (failed) process.exit(1);
}

main().catch(async (e) => {
  console.error(e instanceof Error ? e.message : e);
  await db.$disconnect();
  process.exit(1);
});
