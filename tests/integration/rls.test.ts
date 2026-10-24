import { describe, it, expect, beforeAll } from "vitest";
import { prisma } from "@/server/db/client";
import { withOrg, withUser, withSystem, withPurge } from "@/server/db/tenant";
import { makeOrg, uid } from "../helpers";

/**
 * Database-level tenant isolation. These tests use the application role
 * (atlas_app, NOBYPASSRLS) exactly as production does.
 */
describe("PostgreSQL row-level security", () => {
  let a: Awaited<ReturnType<typeof makeOrg>>;
  let b: Awaited<ReturnType<typeof makeOrg>>;
  let jobB: string;

  beforeAll(async () => {
    a = await makeOrg();
    b = await makeOrg();
    const j = await withOrg(b.org.id, b.owner.id, (tx) =>
      tx.job.create({ data: { organisationId: b.org.id, title: "Secret B role", slug: `secret-${uid()}`, description: "internal draft", createdById: b.owner.id, status: "DRAFT" } }),
    );
    jobB = j.id;
  });

  it("application role is not a superuser and does not bypass RLS", async () => {
    const rows = await prisma.$queryRaw<{ rolsuper: boolean; rolbypassrls: boolean }[]>`SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user`;
    expect(rows[0]).toEqual({ rolsuper: false, rolbypassrls: false });
  });

  it("queries without tenant context see no tenant rows", async () => {
    const n = await prisma.job.count({ where: { id: jobB } });
    expect(n).toBe(0);
  });

  it("tenant A cannot read tenant B's draft job even when querying by id", async () => {
    const found = await withOrg(a.org.id, a.owner.id, (tx) => tx.job.findUnique({ where: { id: jobB } }));
    expect(found).toBeNull();
  });

  it("tenant A cannot update or delete tenant B rows", async () => {
    const upd = await withOrg(a.org.id, a.owner.id, (tx) => tx.job.updateMany({ where: { id: jobB }, data: { title: "pwned" } }));
    expect(upd.count).toBe(0);
    const del = await withOrg(a.org.id, a.owner.id, (tx) => tx.job.deleteMany({ where: { id: jobB } }));
    expect(del.count).toBe(0);
    const still = await withOrg(b.org.id, b.owner.id, (tx) => tx.job.findUnique({ where: { id: jobB } }));
    expect(still?.title).toBe("Secret B role");
  });

  it("tenant A cannot insert rows into tenant B (WITH CHECK)", async () => {
    await expect(
      withOrg(a.org.id, a.owner.id, (tx) => tx.department.create({ data: { organisationId: b.org.id, name: `Injected ${uid()}` } })),
    ).rejects.toThrow();
  });

  it("tenant context does not leak between pooled transactions", async () => {
    await withOrg(b.org.id, b.owner.id, (tx) => tx.job.count());
    const after = await prisma.job.count({ where: { id: jobB } });
    expect(after).toBe(0);
    const setting = await prisma.$queryRaw<{ v: string | null }[]>`SELECT current_setting('app.org_id', true) AS v`;
    expect(setting[0].v ?? "").toBe("");
  });

  it("published public jobs are visible in a personal context, drafts are not", async () => {
    const pub = await withOrg(b.org.id, b.owner.id, (tx) =>
      tx.job.create({ data: { organisationId: b.org.id, title: "Public role", slug: `pub-${uid()}`, description: "desc", createdById: b.owner.id, status: "PUBLISHED", visibility: "PUBLIC" } }),
    );
    const seen = await withUser("someone", (tx) => tx.job.findMany({ where: { id: { in: [pub.id, jobB] } } }));
    expect(seen.map((j) => j.id)).toEqual([pub.id]);
    // ...but cannot be modified from that context
    const upd = await withUser("someone", (tx) => tx.job.updateMany({ where: { id: pub.id }, data: { title: "x" } }));
    expect(upd.count).toBe(0);
  });

  it("system context can read across tenants (audited call sites only)", async () => {
    const n = await withSystem("test", (tx) => tx.job.count({ where: { id: jobB } }));
    expect(n).toBe(1);
  });

  it("append-only ledgers reject UPDATE and DELETE outside purge context", async () => {
    const ev = await prisma.auditEvent.create({ data: { action: "test.event" } });
    await expect(prisma.auditEvent.update({ where: { id: ev.id }, data: { action: "tampered" } })).rejects.toThrow();
    await expect(prisma.auditEvent.delete({ where: { id: ev.id } })).rejects.toThrow();
    await withPurge("test", (tx) => tx.auditEvent.delete({ where: { id: ev.id } }));
    expect(await prisma.auditEvent.findUnique({ where: { id: ev.id } })).toBeNull();
  });
});
