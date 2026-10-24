import { PrismaClient } from "@prisma/client";

declare global {
  // eslint-disable-next-line no-var
  var __atlasPrisma: PrismaClient | undefined;
}

/**
 * Raw Prisma client. Application code should NOT query tenant-owned tables
 * with this directly; use the helpers in ./tenant.ts which set the row-level
 * security context for the transaction. Identity tables (User, Session, ...)
 * are not tenant-owned and may be read through this client by the auth layer.
 */
export const prisma: PrismaClient =
  globalThis.__atlasPrisma ??
  new PrismaClient({
    log: process.env.PRISMA_LOG === "1" ? ["query", "warn", "error"] : process.env.NODE_ENV === "test" ? [] : ["warn", "error"],
  });

if (process.env.NODE_ENV !== "production") globalThis.__atlasPrisma = prisma;
