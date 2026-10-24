import { execSync } from "node:child_process";
import { PrismaClient } from "@prisma/client";

/** Apply migrations + system seed to the test database (as the owner role). */
export default async function setup() {
  const owner = process.env.TEST_MIGRATION_DATABASE_URL ?? "postgresql://atlas_owner:atlas_owner_dev@localhost:5432/atlas_test?schema=public";
  const env = { ...process.env, DATABASE_URL: owner, MIGRATION_DATABASE_URL: owner };
  execSync("npx prisma migrate deploy", { env, stdio: "pipe" });
  const prisma = new PrismaClient({ datasources: { db: { url: owner } } });
  const { seedSystem } = await import("../../src/server/seed/system");
  await seedSystem(prisma);
  await prisma.rateLimitBucket.deleteMany();
  await prisma.$disconnect();
}
