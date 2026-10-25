-- AlterTable
ALTER TABLE "AiRequestLog" ADD COLUMN     "attempt" INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "AiUsageCounter" ADD COLUMN     "tokensReserved" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "AiUsageReservation" (
    "id" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "provider" "AiProvider" NOT NULL,
    "capability" "AiCapability" NOT NULL,
    "period" TEXT NOT NULL,
    "tokens" INTEGER NOT NULL,
    "expiredAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AiUsageReservation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AiUsageReservation_expiresAt_idx" ON "AiUsageReservation"("expiresAt");

-- ───────────── Security ─────────────
GRANT SELECT, INSERT, UPDATE, DELETE ON "AiUsageReservation" TO atlas_app;
ALTER TABLE "AiUsageReservation" ENABLE ROW LEVEL SECURITY;
CREATE POLICY system_only ON "AiUsageReservation" USING (app_bypass()) WITH CHECK (app_bypass());
ALTER TABLE "AiUsageReservation" ADD CONSTRAINT "AiUsageReservation_tokens_nonneg" CHECK ("tokens" >= 0);
ALTER TABLE "AiUsageCounter" ADD CONSTRAINT "AiUsageCounter_reserved_nonneg" CHECK ("tokensReserved" >= 0);

-- Request-log maintenance (retention pruning, pseudonymisation on account deletion)
-- is allowed only in system context; organisations keep read-only access.
CREATE POLICY log_maintain_update ON "AiRequestLog" FOR UPDATE USING (app_bypass()) WITH CHECK (app_bypass());
CREATE POLICY log_maintain_delete ON "AiRequestLog" FOR DELETE USING (app_bypass());
