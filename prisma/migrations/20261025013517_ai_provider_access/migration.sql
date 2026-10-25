-- CreateEnum
CREATE TYPE "AiProvider" AS ENUM ('ANTHROPIC', 'OPENAI', 'GEMINI', 'DEEPGRAM', 'ELEVENLABS', 'FIXTURE');

-- CreateEnum
CREATE TYPE "AiCapability" AS ENUM ('JOB_DRAFTING', 'RESUME_PARSING', 'QUESTION_GENERATION', 'INTERVIEW_CONVERSATION', 'ASSESSMENT', 'PRACTICE_COACHING', 'TRANSCRIPTION', 'SPEECH_SYNTHESIS');

-- CreateEnum
CREATE TYPE "AiCredentialSource" AS ENUM ('ORGANISATION', 'PLATFORM');

-- CreateEnum
CREATE TYPE "AiCredentialStatus" AS ENUM ('ACTIVE', 'INVALID');

-- CreateEnum
CREATE TYPE "AiRequestStatus" AS ENUM ('SUCCEEDED', 'FAILED', 'DENIED');

-- CreateTable
CREATE TABLE "PlatformAiGrant" (
    "id" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "organisationId" TEXT,
    "provider" "AiProvider" NOT NULL,
    "capability" "AiCapability" NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "allowedModels" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "monthlyRequestLimit" INTEGER,
    "monthlyTokenLimit" INTEGER,
    "version" INTEGER NOT NULL DEFAULT 1,
    "grantedById" TEXT,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PlatformAiGrant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrgAiCredential" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "provider" "AiProvider" NOT NULL,
    "encryptedKey" TEXT NOT NULL,
    "keyLast4" TEXT NOT NULL,
    "keyFingerprint" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "status" "AiCredentialStatus" NOT NULL DEFAULT 'ACTIVE',
    "version" INTEGER NOT NULL DEFAULT 1,
    "lastValidatedAt" TIMESTAMP(3),
    "lastError" TEXT,
    "lastErrorAt" TIMESTAMP(3),
    "createdById" TEXT,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OrgAiCredential_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrgAiRoute" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "capability" "AiCapability" NOT NULL,
    "source" "AiCredentialSource" NOT NULL,
    "provider" "AiProvider" NOT NULL,
    "model" TEXT,
    "updatedById" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OrgAiRoute_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiUsageCounter" (
    "id" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "provider" "AiProvider" NOT NULL,
    "capability" "AiCapability" NOT NULL,
    "period" TEXT NOT NULL,
    "requests" INTEGER NOT NULL DEFAULT 0,
    "tokens" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AiUsageCounter_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiRequestLog" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT,
    "userId" TEXT,
    "sessionId" TEXT,
    "capability" "AiCapability" NOT NULL,
    "provider" "AiProvider",
    "model" TEXT,
    "source" "AiCredentialSource",
    "credentialId" TEXT,
    "credentialVersion" INTEGER,
    "status" "AiRequestStatus" NOT NULL,
    "errorCode" TEXT,
    "inputTokens" INTEGER,
    "outputTokens" INTEGER,
    "estimatedCostMicros" INTEGER,
    "latencyMs" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiRequestLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PlatformAiGrant_organisationId_idx" ON "PlatformAiGrant"("organisationId");

-- CreateIndex
CREATE UNIQUE INDEX "PlatformAiGrant_subject_provider_capability_key" ON "PlatformAiGrant"("subject", "provider", "capability");

-- CreateIndex
CREATE UNIQUE INDEX "OrgAiCredential_organisationId_provider_key" ON "OrgAiCredential"("organisationId", "provider");

-- CreateIndex
CREATE UNIQUE INDEX "OrgAiCredential_id_organisationId_key" ON "OrgAiCredential"("id", "organisationId");

-- CreateIndex
CREATE UNIQUE INDEX "OrgAiRoute_organisationId_capability_key" ON "OrgAiRoute"("organisationId", "capability");

-- CreateIndex
CREATE UNIQUE INDEX "AiUsageCounter_subject_provider_capability_period_key" ON "AiUsageCounter"("subject", "provider", "capability", "period");

-- CreateIndex
CREATE INDEX "AiRequestLog_organisationId_createdAt_idx" ON "AiRequestLog"("organisationId", "createdAt");

-- CreateIndex
CREATE INDEX "AiRequestLog_userId_createdAt_idx" ON "AiRequestLog"("userId", "createdAt");

-- AddForeignKey
ALTER TABLE "PlatformAiGrant" ADD CONSTRAINT "PlatformAiGrant_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrgAiCredential" ADD CONSTRAINT "OrgAiCredential_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrgAiRoute" ADD CONSTRAINT "OrgAiRoute_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ───────────── Security for AI provider access ─────────────
GRANT SELECT, INSERT, UPDATE, DELETE ON "PlatformAiGrant", "OrgAiCredential", "OrgAiRoute", "AiUsageCounter", "AiRequestLog" TO atlas_app;

-- Platform grants: an organisation may READ its own grants (to show status in
-- Settings → AI Providers) but only audited system/platform contexts may write.
ALTER TABLE "PlatformAiGrant" ENABLE ROW LEVEL SECURITY;
CREATE POLICY grant_read ON "PlatformAiGrant" FOR SELECT USING ("organisationId" = app_org_id() OR app_bypass());
CREATE POLICY grant_write ON "PlatformAiGrant" FOR ALL USING (app_bypass()) WITH CHECK (app_bypass());
ALTER TABLE "PlatformAiGrant" ADD CONSTRAINT "PlatformAiGrant_subject_check"
  CHECK (("subject" = 'PERSONAL' AND "organisationId" IS NULL) OR ("subject" <> 'PERSONAL' AND "subject" = "organisationId"));
ALTER TABLE "PlatformAiGrant" ADD CONSTRAINT "PlatformAiGrant_limits_check"
  CHECK (("monthlyRequestLimit" IS NULL OR "monthlyRequestLimit" >= 0) AND ("monthlyTokenLimit" IS NULL OR "monthlyTokenLimit" >= 0));

-- Organisation-owned keys and routes: strict tenant isolation.
ALTER TABLE "OrgAiCredential" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "OrgAiCredential" USING ("organisationId" = app_org_id() OR app_bypass()) WITH CHECK ("organisationId" = app_org_id() OR app_bypass());
ALTER TABLE "OrgAiCredential" ADD CONSTRAINT "OrgAiCredential_provider_check" CHECK ("provider" IN ('ANTHROPIC', 'OPENAI', 'GEMINI', 'FIXTURE'));
ALTER TABLE "OrgAiRoute" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "OrgAiRoute" USING ("organisationId" = app_org_id() OR app_bypass()) WITH CHECK ("organisationId" = app_org_id() OR app_bypass());

-- Usage counters are platform enforcement state: system context only.
ALTER TABLE "AiUsageCounter" ENABLE ROW LEVEL SECURITY;
CREATE POLICY system_only ON "AiUsageCounter" USING (app_bypass()) WITH CHECK (app_bypass());
ALTER TABLE "AiUsageCounter" ADD CONSTRAINT "AiUsageCounter_nonneg" CHECK ("requests" >= 0 AND "tokens" >= 0);

-- Request log: organisations read their own rows; users read their personal rows.
ALTER TABLE "AiRequestLog" ENABLE ROW LEVEL SECURITY;
CREATE POLICY log_read ON "AiRequestLog" FOR SELECT USING (
  app_bypass()
  OR ("organisationId" IS NOT NULL AND "organisationId" = app_org_id())
  OR ("organisationId" IS NULL AND "userId" = app_user_id())
);
CREATE POLICY log_write ON "AiRequestLog" FOR INSERT WITH CHECK (app_bypass());
