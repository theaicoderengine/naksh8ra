-- Postgres-backed job queue (QUEUE_MODE=postgres) for hosts without Redis or worker processes.
-- Additive only: new nullable/defaulted columns and two new tables; safe for the previous release.
-- AlterTable
ALTER TABLE "JobRun" ADD COLUMN     "lockedBy" TEXT,
ADD COLUMN     "lockedUntil" TIMESTAMP(3),
ADD COLUMN     "maxAttempts" INTEGER NOT NULL DEFAULT 5,
ADD COLUMN     "runAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "startedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "JobSchedule" (
    "name" TEXT NOT NULL,
    "lastSlot" TIMESTAMP(3) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "JobSchedule_pkey" PRIMARY KEY ("name")
);

-- CreateTable
CREATE TABLE "JobRunnerHeartbeat" (
    "source" TEXT NOT NULL,
    "lastSeenAt" TIMESTAMP(3) NOT NULL,
    "processed" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "JobRunnerHeartbeat_pkey" PRIMARY KEY ("source")
);

-- CreateIndex
CREATE INDEX "JobRun_queue_status_runAt_idx" ON "JobRun"("queue", "status", "runAt");


-- Runtime role (RLS is not enabled on these platform tables; they hold ids only, never personal data).
GRANT SELECT, INSERT, UPDATE, DELETE ON "JobSchedule", "JobRunnerHeartbeat" TO atlas_app;

-- Readiness check (/api/ready): the runtime role may list applied migration names, nothing else
-- (it has no access to "_prisma_migrations" itself).
-- plpgsql: the table is resolved when called (it does not exist in Prisma's shadow database).
CREATE OR REPLACE FUNCTION atlas_applied_migrations() RETURNS SETOF text
  LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS
$$ BEGIN
  RETURN QUERY SELECT migration_name::text FROM "_prisma_migrations" WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL;
END $$;
REVOKE ALL ON FUNCTION atlas_applied_migrations() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION atlas_applied_migrations() TO atlas_app;
