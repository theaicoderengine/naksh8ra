-- Security migration: runtime role grants, row-level security, append-only ledgers.
--
-- The application connects as `atlas_app` (NOT the table owner, NOBYPASSRLS), so
-- every policy below is enforced on application traffic. Tenant context is set
-- per transaction with set_config(..., true) — see src/server/db/tenant.ts.
--   app.org_id     : organisation the request is acting within
--   app.user_id    : authenticated user (personal-data policies)
--   app.bypass_rls : 'on' only for audited system/platform contexts
--   app.allow_purge: 'on' only inside deletion/retention jobs

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'atlas_app') THEN
    CREATE ROLE atlas_app NOLOGIN NOBYPASSRLS;
  END IF;
END $$;

GRANT USAGE ON SCHEMA public TO atlas_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO atlas_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO atlas_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO atlas_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO atlas_app;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = '_prisma_migrations') THEN
    REVOKE ALL ON "_prisma_migrations" FROM atlas_app;
  END IF;
END $$;

CREATE OR REPLACE FUNCTION app_org_id() RETURNS text LANGUAGE sql STABLE AS
$$ SELECT NULLIF(current_setting('app.org_id', true), '') $$;
CREATE OR REPLACE FUNCTION app_user_id() RETURNS text LANGUAGE sql STABLE AS
$$ SELECT NULLIF(current_setting('app.user_id', true), '') $$;
CREATE OR REPLACE FUNCTION app_bypass() RETURNS boolean LANGUAGE sql STABLE AS
$$ SELECT coalesce(current_setting('app.bypass_rls', true), '') = 'on' $$;

ALTER TABLE "Department" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "Department" USING ("organisationId" = app_org_id() OR app_bypass()) WITH CHECK ("organisationId" = app_org_id() OR app_bypass());
ALTER TABLE "Job" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "Job" USING ("organisationId" = app_org_id() OR app_bypass()) WITH CHECK ("organisationId" = app_org_id() OR app_bypass());
ALTER TABLE "JobAssignment" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "JobAssignment" USING ("organisationId" = app_org_id() OR app_bypass()) WITH CHECK ("organisationId" = app_org_id() OR app_bypass());
ALTER TABLE "JobCompetency" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "JobCompetency" USING ("organisationId" = app_org_id() OR app_bypass()) WITH CHECK ("organisationId" = app_org_id() OR app_bypass());
ALTER TABLE "Candidate" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "Candidate" USING ("organisationId" = app_org_id() OR app_bypass()) WITH CHECK ("organisationId" = app_org_id() OR app_bypass());
ALTER TABLE "ApplicationStage" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "ApplicationStage" USING ("organisationId" = app_org_id() OR app_bypass()) WITH CHECK ("organisationId" = app_org_id() OR app_bypass());
ALTER TABLE "Application" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "Application" USING ("organisationId" = app_org_id() OR app_bypass()) WITH CHECK ("organisationId" = app_org_id() OR app_bypass());
ALTER TABLE "ApplicationStageHistory" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "ApplicationStageHistory" USING ("organisationId" = app_org_id() OR app_bypass()) WITH CHECK ("organisationId" = app_org_id() OR app_bypass());
ALTER TABLE "CandidateNote" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "CandidateNote" USING ("organisationId" = app_org_id() OR app_bypass()) WITH CHECK ("organisationId" = app_org_id() OR app_bypass());
ALTER TABLE "CandidateDocument" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "CandidateDocument" USING ("organisationId" = app_org_id() OR app_bypass()) WITH CHECK ("organisationId" = app_org_id() OR app_bypass());
ALTER TABLE "InterviewTemplate" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "InterviewTemplate" USING ("organisationId" = app_org_id() OR app_bypass()) WITH CHECK ("organisationId" = app_org_id() OR app_bypass());
ALTER TABLE "InterviewQuestion" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "InterviewQuestion" USING ("organisationId" = app_org_id() OR app_bypass()) WITH CHECK ("organisationId" = app_org_id() OR app_bypass());
ALTER TABLE "TemplateCompetency" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "TemplateCompetency" USING ("organisationId" = app_org_id() OR app_bypass()) WITH CHECK ("organisationId" = app_org_id() OR app_bypass());
ALTER TABLE "Competency" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "Competency" USING ("organisationId" = app_org_id() OR app_bypass()) WITH CHECK ("organisationId" = app_org_id() OR app_bypass());
ALTER TABLE "CompetencyRubric" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "CompetencyRubric" USING ("organisationId" = app_org_id() OR app_bypass()) WITH CHECK ("organisationId" = app_org_id() OR app_bypass());
ALTER TABLE "InterviewInvitation" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "InterviewInvitation" USING ("organisationId" = app_org_id() OR app_bypass()) WITH CHECK ("organisationId" = app_org_id() OR app_bypass());
ALTER TABLE "InterviewSession" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "InterviewSession" USING ("organisationId" = app_org_id() OR app_bypass()) WITH CHECK ("organisationId" = app_org_id() OR app_bypass());
ALTER TABLE "SessionEvent" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "SessionEvent" USING ("organisationId" = app_org_id() OR app_bypass()) WITH CHECK ("organisationId" = app_org_id() OR app_bypass());
ALTER TABLE "Answer" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "Answer" USING ("organisationId" = app_org_id() OR app_bypass()) WITH CHECK ("organisationId" = app_org_id() OR app_bypass());
ALTER TABLE "TranscriptSegment" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "TranscriptSegment" USING ("organisationId" = app_org_id() OR app_bypass()) WITH CHECK ("organisationId" = app_org_id() OR app_bypass());
ALTER TABLE "AudioAsset" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "AudioAsset" USING ("organisationId" = app_org_id() OR app_bypass()) WITH CHECK ("organisationId" = app_org_id() OR app_bypass());
ALTER TABLE "Assessment" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "Assessment" USING ("organisationId" = app_org_id() OR app_bypass()) WITH CHECK ("organisationId" = app_org_id() OR app_bypass());
ALTER TABLE "AssessmentResult" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "AssessmentResult" USING ("organisationId" = app_org_id() OR app_bypass()) WITH CHECK ("organisationId" = app_org_id() OR app_bypass());
ALTER TABLE "AssessmentEvidence" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "AssessmentEvidence" USING ("organisationId" = app_org_id() OR app_bypass()) WITH CHECK ("organisationId" = app_org_id() OR app_bypass());
ALTER TABLE "AssessmentReview" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "AssessmentReview" USING ("organisationId" = app_org_id() OR app_bypass()) WITH CHECK ("organisationId" = app_org_id() OR app_bypass());
ALTER TABLE "ReviewerFeedback" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "ReviewerFeedback" USING ("organisationId" = app_org_id() OR app_bypass()) WITH CHECK ("organisationId" = app_org_id() OR app_bypass());
ALTER TABLE "CandidateFeedbackDisclosure" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "CandidateFeedbackDisclosure" USING ("organisationId" = app_org_id() OR app_bypass()) WITH CHECK ("organisationId" = app_org_id() OR app_bypass());
ALTER TABLE "IntegrationConnection" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "IntegrationConnection" USING ("organisationId" = app_org_id() OR app_bypass()) WITH CHECK ("organisationId" = app_org_id() OR app_bypass());
ALTER TABLE "StudentCohort" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "StudentCohort" USING ("organisationId" = app_org_id() OR app_bypass()) WITH CHECK ("organisationId" = app_org_id() OR app_bypass());
ALTER TABLE "PlacementProgramme" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "PlacementProgramme" USING ("organisationId" = app_org_id() OR app_bypass()) WITH CHECK ("organisationId" = app_org_id() OR app_bypass());
ALTER TABLE "CohortMembership" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "CohortMembership" USING ("organisationId" = app_org_id() OR app_bypass()) WITH CHECK ("organisationId" = app_org_id() OR app_bypass());
ALTER TABLE "Subscription" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "Subscription" USING ("organisationId" = app_org_id() OR app_bypass()) WITH CHECK ("organisationId" = app_org_id() OR app_bypass());

-- Published public/campus vacancies are discoverable by any authenticated context.
CREATE POLICY job_public_read ON "Job" FOR SELECT USING (status = 'PUBLISHED' AND visibility IN ('PUBLIC', 'CAMPUS'));

-- Applicants (students / candidates with accounts) can read their own records across tenants.
CREATE POLICY application_owner_read ON "Application" FOR SELECT USING ("candidateUserId" IS NOT NULL AND "candidateUserId" = app_user_id());
CREATE POLICY candidate_owner_read ON "Candidate" FOR SELECT USING ("userId" IS NOT NULL AND "userId" = app_user_id());
CREATE POLICY session_owner_read ON "InterviewSession" FOR SELECT USING ("candidateUserId" IS NOT NULL AND "candidateUserId" = app_user_id());
CREATE POLICY history_owner_read ON "ApplicationStageHistory" FOR SELECT USING (
  "visibleToCandidate" AND EXISTS (SELECT 1 FROM "Application" a WHERE a.id = "applicationId" AND a."candidateUserId" = app_user_id()));
CREATE POLICY disclosure_owner_read ON "CandidateFeedbackDisclosure" FOR SELECT USING (
  status = 'APPROVED' AND EXISTS (SELECT 1 FROM "Application" a WHERE a.id = "applicationId" AND a."candidateUserId" = app_user_id()));
CREATE POLICY invitation_owner_read ON "InterviewInvitation" FOR SELECT USING (
  EXISTS (SELECT 1 FROM "Application" a WHERE a.id = "applicationId" AND a."candidateUserId" = app_user_id()));
-- Students see their own cohort membership rows (to accept/decline invites).
CREATE POLICY cohort_member_self ON "CohortMembership" FOR SELECT USING ("userId" IS NOT NULL AND "userId" = app_user_id());

-- Append-only tables. UPDATE is never allowed; DELETE only inside purge jobs.
CREATE OR REPLACE FUNCTION forbid_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' AND coalesce(current_setting('app.allow_purge', true), '') = 'on' THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'table % is append-only (% blocked)', TG_TABLE_NAME, TG_OP USING ERRCODE = '42501';
END $$;

CREATE TRIGGER auditevent_append_only BEFORE UPDATE OR DELETE ON "AuditEvent" FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
CREATE TRIGGER creditledgerentry_append_only BEFORE UPDATE OR DELETE ON "CreditLedgerEntry" FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
CREATE TRIGGER applicationstagehistory_append_only BEFORE UPDATE OR DELETE ON "ApplicationStageHistory" FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
CREATE TRIGGER sessionevent_append_only BEFORE UPDATE OR DELETE ON "SessionEvent" FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
CREATE TRIGGER consentrecord_append_only BEFORE UPDATE OR DELETE ON "ConsentRecord" FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

-- Credit balances can never go negative.
ALTER TABLE "CreditAccount" ADD CONSTRAINT credit_available_nonneg CHECK (available >= 0);
ALTER TABLE "CreditAccount" ADD CONSTRAINT credit_reserved_nonneg CHECK (reserved >= 0);
ALTER TABLE "CreditAccount" ADD CONSTRAINT credit_owner_shape CHECK (
  ("ownerType" = 'ORGANISATION' AND "organisationId" IS NOT NULL AND "userId" IS NULL) OR
  ("ownerType" = 'USER' AND "userId" IS NOT NULL AND "organisationId" IS NULL));
ALTER TABLE "Job" ADD CONSTRAINT job_salary_range CHECK ("salaryMin" IS NULL OR "salaryMax" IS NULL OR "salaryMin" <= "salaryMax");
ALTER TABLE "Job" ADD CONSTRAINT job_experience_range CHECK ("experienceMin" IS NULL OR "experienceMax" IS NULL OR "experienceMin" <= "experienceMax");
ALTER TABLE "InterviewTemplate" ADD CONSTRAINT template_bounds CHECK ("durationMinutes" BETWEEN 1 AND 240 AND "questionCount" BETWEEN 1 AND 50);

-- Full-text search over published jobs.
CREATE INDEX job_search_idx ON "Job" USING GIN (to_tsvector('simple', coalesce(title,'') || ' ' || coalesce(description,'')));

