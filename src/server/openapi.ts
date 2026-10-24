import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import { registerSchema } from "./services/auth";
import { createOrgSchema, updateOrgSchema, inviteSchema as memberInviteSchema } from "./services/organisations";
import { jobInputSchema, jobPatchSchema, jobListQuery, discoverQuery, assignmentSchema, jdDraftSchema } from "./services/jobs";
import { applicationListQuery, moveSchema, bulkMoveSchema, feedbackSchema, manualCandidateSchema, applySchema, stageSchema } from "./services/applications";
import { templateSchema, competencySchema, generateQuestionsSchema } from "./services/templates";
import { inviteSchema as interviewInviteSchema, consentSchema } from "./services/interviews";
import { reviewSchema } from "./services/assessments";
import { profileSchema, accommodationSchema, prefsSchema } from "./services/students";
import { startPracticeSchema } from "./services/practice";
import { programmeSchema, cohortSchema } from "./services/universities";
import { checkoutSchema } from "./services/billing";
import { dsrSchema, retentionSchema } from "./services/privacy";
import { orgActionSchema, creditAdjustSchema, planSchema, packSchema, flagSchema, adminRoleSchema, ticketSchema, orgQuery, auditQuery } from "./services/platform";

type Auth = "public" | "session" | "verified" | "org" | "platform" | "interview" | "signature";
type Ep = { method: "get" | "post" | "patch" | "put" | "delete"; path: string; tag: string; summary: string; auth: Auth; body?: z.ZodTypeAny; query?: z.ZodTypeAny; permission?: string; multipart?: string[]; produces?: string };

const E = (method: Ep["method"], path: string, tag: string, summary: string, auth: Auth, extra: Partial<Ep> = {}): Ep => ({ method, path, tag, summary, auth, ...extra });
const tok = z.object({ token: z.string() });
const emailOnly = z.object({ email: z.string().email() });

export const ENDPOINTS: Ep[] = [
  E("post", "/auth/register", "Auth", "Register an account (employer, student, university or candidate). Enumeration-safe.", "public", { body: registerSchema }),
  E("post", "/auth/login", "Auth", "Sign in with email and password; sets a session cookie", "public", { body: z.object({ email: z.string().email(), password: z.string() }) }),
  E("post", "/auth/logout", "Auth", "Revoke the current session", "session"),
  E("get", "/auth/me", "Auth", "Current user, session and organisations", "session"),
  E("post", "/auth/verify-email", "Auth", "Verify email with a single-use token", "public", { body: tok }),
  E("post", "/auth/resend-verification", "Auth", "Resend verification email", "public", { body: emailOnly }),
  E("post", "/auth/password/forgot", "Auth", "Request a password reset link", "public", { body: emailOnly }),
  E("post", "/auth/password/reset", "Auth", "Reset password with a single-use token", "public", { body: z.object({ token: z.string(), password: z.string() }) }),
  E("post", "/auth/password/change", "Auth", "Change password (revokes other sessions)", "session", { body: z.object({ currentPassword: z.string(), newPassword: z.string() }) }),
  E("post", "/auth/mfa/setup", "Auth", "Begin TOTP setup", "session"),
  E("post", "/auth/mfa/enable", "Auth", "Confirm TOTP setup", "session", { body: z.object({ code: z.string() }) }),
  E("post", "/auth/mfa/verify", "Auth", "Complete MFA for the current session", "session", { body: z.object({ code: z.string() }) }),
  E("post", "/auth/mfa/disable", "Auth", "Disable MFA", "session", { body: z.object({ password: z.string(), code: z.string() }) }),
  E("patch", "/auth/profile", "Auth", "Update my name, phone, locale and time zone", "session", { body: z.object({ firstName: z.string().optional(), lastName: z.string().optional(), phone: z.string().nullable().optional(), locale: z.string().optional(), timezone: z.string().optional() }) }),
  E("get", "/auth/sessions", "Auth", "List active sessions", "session"),
  E("delete", "/auth/sessions/{id}", "Auth", "Revoke a session", "session"),
  E("post", "/auth/active-organisation", "Auth", "Switch active organisation (membership verified server-side)", "verified", { body: z.object({ organisation: z.string() }) }),

  E("get", "/organisations", "Organisations", "Organisations I belong to", "session"),
  E("post", "/organisations", "Organisations", "Create an organisation workspace", "verified", { body: createOrgSchema }),
  E("get", "/organisations/current", "Organisations", "Active organisation profile, role and permissions", "org", { permission: "org.view" }),
  E("patch", "/organisations/current", "Organisations", "Update organisation profile/branding/settings", "org", { permission: "org.manage", body: updateOrgSchema }),
  E("get", "/memberships", "Memberships", "Team members, pending invitations, assignable roles", "org", { permission: "members.view" }),
  E("post", "/memberships/invitations", "Memberships", "Invite team members (seat-limited)", "org", { permission: "members.invite", body: memberInviteSchema }),
  E("delete", "/memberships/invitations/{id}", "Memberships", "Revoke an invitation", "org", { permission: "members.invite" }),
  E("patch", "/memberships/{id}", "Memberships", "Change a member's role (no escalation)", "org", { permission: "members.manage", body: z.object({ roleKey: z.string() }) }),
  E("delete", "/memberships/{id}", "Memberships", "Remove a member", "org", { permission: "members.manage" }),
  E("post", "/memberships/{id}/transfer-ownership", "Memberships", "Transfer ownership", "org", { permission: "org.transfer", body: z.object({ confirm: z.literal(true) }) }),
  E("get", "/invitations/preview", "Memberships", "Preview an invitation by token", "public", { query: tok }),
  E("post", "/invitations/accept", "Memberships", "Accept an invitation (email-bound, single use)", "session", { body: tok }),
  E("get", "/departments", "Organisations", "List departments", "org"),
  E("post", "/departments", "Organisations", "Create department", "org", { permission: "departments.manage", body: z.object({ name: z.string() }) }),
  E("delete", "/departments/{id}", "Organisations", "Delete department", "org", { permission: "departments.manage" }),

  E("get", "/jobs", "Jobs", "List vacancies (assignment-scoped for recruiters)", "org", { query: jobListQuery }),
  E("post", "/jobs", "Jobs", "Create vacancy (draft)", "org", { permission: "jobs.create", body: jobInputSchema }),
  E("get", "/jobs/{id}", "Jobs", "Vacancy detail", "org"),
  E("patch", "/jobs/{id}", "Jobs", "Update vacancy", "org", { permission: "jobs.edit", body: jobPatchSchema }),
  E("post", "/jobs/{id}/status", "Jobs", "Publish / pause / resume / close / reopen / archive (AI drafts require human-review confirmation)", "org", { permission: "jobs.publish", body: z.object({ action: z.enum(["publish", "pause", "resume", "close", "reopen", "archive"]), confirmHumanReview: z.boolean().optional() }) }),
  E("put", "/jobs/{id}/assignments", "Jobs", "Set hiring team", "org", { permission: "jobs.edit", body: assignmentSchema }),
  E("get", "/jobs/{id}/analytics", "Jobs", "Vacancy analytics", "org", { permission: "analytics.view" }),
  E("post", "/jobs/draft-description", "Jobs", "AI-assisted job description draft (requires human review before publishing)", "org", { permission: "jobs.create", body: jdDraftSchema }),
  E("get", "/opportunities", "Opportunities", "Discover published vacancies with explainable eligibility", "public", { query: discoverQuery }),
  E("get", "/opportunities/{id}", "Opportunities", "Published vacancy detail", "public"),
  E("post", "/opportunities/{id}/save", "Opportunities", "Save a vacancy", "session"),
  E("delete", "/opportunities/{id}/save", "Opportunities", "Unsave a vacancy", "session"),

  E("get", "/applications", "Applications", "List applications", "org", { query: applicationListQuery }),
  E("get", "/applications/export", "Applications", "Export applications as CSV (audited)", "org", { permission: "candidates.export", query: applicationListQuery, produces: "text/csv" }),
  E("get", "/applications/{id}", "Applications", "Application detail with history, interviews, assessments", "org"),
  E("post", "/applications/{id}/move", "Applications", "Move to a stage (validated transition, audited)", "org", { permission: "applications.move", body: moveSchema }),
  E("post", "/applications/bulk-move", "Applications", "Bulk stage move", "org", { permission: "applications.move", body: bulkMoveSchema }),
  E("post", "/applications/{id}/notes", "Applications", "Add internal note (never visible to candidates)", "org", { permission: "notes.write", body: z.object({ body: z.string() }) }),
  E("post", "/applications/{id}/assign", "Applications", "Assign owner", "org", { permission: "applications.move", body: z.object({ userId: z.string().nullable() }) }),
  E("post", "/applications/{id}/feedback", "Applications", "Structured reviewer feedback", "org", { permission: "feedback.write", body: feedbackSchema }),
  E("post", "/applications/{id}/disclosures", "Applications", "Draft candidate-facing feedback", "org", { permission: "feedback.write", body: z.object({ body: z.string() }) }),
  E("post", "/disclosures/{id}", "Applications", "Approve or retract candidate-facing feedback", "org", { permission: "feedback.disclose", body: z.object({ action: z.enum(["approve", "retract"]) }) }),
  E("post", "/applications/{id}/interviews", "Interviews", "Send an AI interview invitation (reserves one credit)", "org", { permission: "interviews.invite", body: interviewInviteSchema }),
  E("post", "/candidates", "Applications", "Add a candidate to a vacancy manually", "org", { permission: "candidates.manage", body: manualCandidateSchema }),
  E("get", "/stages", "Applications", "Pipeline stages", "org"),
  E("post", "/stages", "Applications", "Create pipeline stage", "org", { permission: "interviews.configure", body: stageSchema }),
  E("patch", "/stages/{id}", "Applications", "Rename / reorder stage", "org", { permission: "interviews.configure", body: z.object({ name: z.string().optional(), position: z.number().optional() }) }),
  E("delete", "/stages/{id}", "Applications", "Delete unused stage", "org", { permission: "interviews.configure" }),
  E("get", "/compare", "Assessments", "Compare candidates on job-related evidence (no composite rank)", "org", { query: z.object({ jobId: z.string(), ids: z.string() }) }),

  E("get", "/interview-templates", "Interview configuration", "List interview templates", "org"),
  E("post", "/interview-templates", "Interview configuration", "Create template", "org", { permission: "interviews.configure", body: templateSchema }),
  E("get", "/interview-templates/{id}", "Interview configuration", "Template detail", "org"),
  E("put", "/interview-templates/{id}", "Interview configuration", "Replace template (new version)", "org", { permission: "interviews.configure", body: templateSchema }),
  E("delete", "/interview-templates/{id}", "Interview configuration", "Archive template", "org", { permission: "interviews.configure" }),
  E("post", "/interview-templates/generate-questions", "Interview configuration", "AI-suggested questions for human review", "org", { permission: "interviews.configure", body: generateQuestionsSchema }),
  E("get", "/competencies", "Interview configuration", "Competencies with versioned rubrics", "org"),
  E("post", "/competencies", "Interview configuration", "Create competency + rubric v1", "org", { permission: "interviews.configure", body: competencySchema }),
  E("patch", "/competencies/{id}", "Interview configuration", "Update competency (rubric change creates a new version)", "org", { permission: "interviews.configure", body: competencySchema.partial() }),
  E("delete", "/competencies/{id}", "Interview configuration", "Archive competency", "org", { permission: "interviews.configure" }),
  E("get", "/interviews/{id}", "Interviews", "Interview detail for reviewers (transcripts/recordings permission-gated)", "org"),
  E("post", "/interviews/{id}/cancel", "Interviews", "Cancel interview (releases reserved credit)", "org", { permission: "interviews.invite" }),
  E("post", "/assessments/{sessionId}/review", "Assessments", "Human review: confirm, adjust with reasons, or reject AI output", "org", { permission: "assessments.review", body: reviewSchema }),
  E("post", "/assessments/{sessionId}/retry", "Assessments", "Retry a failed assessment", "org", { permission: "assessments.review" }),

  E("get", "/interview-session/state", "Candidate interview", "Candidate-safe interview state", "interview"),
  E("post", "/interview-session/consent", "Candidate interview", "Record notice acknowledgement & consents", "interview", { body: consentSchema }),
  E("post", "/interview-session/event", "Candidate interview", "Client events (mic check, disconnect, reconnect)", "interview", { body: z.object({ type: z.string(), data: z.record(z.unknown()).optional(), idempotencyKey: z.string().optional() }) }),
  E("post", "/interview-session/start", "Candidate interview", "Start or resume the interview", "interview"),
  E("post", "/interview-session/answer", "Candidate interview", "Structured mode: submit an answer (audio or typed)", "interview", { multipart: ["position", "file", "text", "durationMs", "retake", "idempotencyKey"] }),
  E("post", "/interview-session/turn", "Candidate interview", "Conversational mode: submit a turn, receive interviewer reply (+audio)", "interview", { multipart: ["file", "text", "durationMs"] }),
  E("post", "/interview-session/complete", "Candidate interview", "Finish the interview", "interview"),

  E("get", "/students/me", "Students", "My profile", "session"),
  E("patch", "/students/me", "Students", "Update my profile", "verified", { body: profileSchema }),
  E("get", "/students/me/dashboard", "Students", "Dashboard data", "session"),
  E("get", "/students/me/resumes", "Students", "My resume versions", "session"),
  E("post", "/students/me/resumes", "Students", "Upload a resume (parsed asynchronously)", "verified", { multipart: ["file", "label"] }),
  E("patch", "/students/me/resumes/{id}", "Students", "Correct parsed fields / set default", "session"),
  E("delete", "/students/me/resumes/{id}", "Students", "Delete a resume version", "session"),
  E("get", "/students/me/applications", "Students", "My applications", "session"),
  E("post", "/students/me/applications", "Students", "Apply (or save draft) — requires consent to share previewed profile", "verified", { body: applySchema }),
  E("post", "/students/me/applications/preview", "Students", "Preview exactly what an employer will receive", "session", { body: z.object({ resumeVersionId: z.string().nullable().optional() }) }),
  E("get", "/students/me/applications/{id}", "Students", "My application (visible history & approved feedback only)", "session"),
  E("post", "/students/me/applications/{id}/withdraw", "Students", "Withdraw application", "session", { body: z.object({ reason: z.string().optional() }) }),
  E("get", "/students/me/saved-jobs", "Students", "Saved vacancies", "session"),
  E("get", "/students/me/recommendations", "Students", "Explainable recommendations", "session"),
  E("get", "/students/me/accommodations", "Students", "My accommodation requests", "session"),
  E("post", "/students/me/accommodations", "Students", "Request an accommodation (private)", "verified", { body: accommodationSchema }),
  E("get", "/students/me/cohort-invites", "Students", "University cohort invitations", "session"),
  E("post", "/students/me/cohort-invites/{id}", "Students", "Accept/decline a cohort invitation (consent)", "verified", { body: z.object({ accept: z.boolean() }) }),
  E("get", "/students/me/notification-preferences", "Students", "Notification preferences", "session"),
  E("put", "/students/me/notification-preferences", "Students", "Update notification preferences", "session", { body: prefsSchema }),
  E("get", "/students/me/practice", "Practice", "My practice sessions (private)", "session"),
  E("post", "/students/me/practice", "Practice", "Start a practice interview (uses my practice allowance)", "verified", { body: startPracticeSchema }),
  E("get", "/students/me/practice/balance", "Practice", "Practice credit balance", "session"),
  E("get", "/students/me/practice/progress", "Practice", "Learning progress", "session"),
  E("get", "/students/me/practice/{id}", "Practice", "Practice session detail & coaching feedback", "session"),
  E("post", "/students/me/practice/{id}/answer", "Practice", "Answer (audio is transcribed and discarded)", "session", { multipart: ["file", "text", "durationMs"] }),
  E("post", "/students/me/practice/{id}/complete", "Practice", "Finish and request coaching feedback", "session"),

  E("get", "/universities/programmes", "Universities", "Placement programmes", "org", { permission: "university.students.view" }),
  E("post", "/universities/programmes", "Universities", "Create programme", "org", { permission: "university.manage", body: programmeSchema }),
  E("patch", "/universities/programmes/{id}", "Universities", "Update programme", "org", { permission: "university.manage", body: programmeSchema }),
  E("post", "/universities/programmes/{id}/employers", "Universities", "Invite an employer to a programme", "org", { permission: "university.manage", body: z.object({ employerSlug: z.string() }) }),
  E("get", "/universities/cohorts", "Universities", "Cohorts", "org", { permission: "university.students.view" }),
  E("post", "/universities/cohorts", "Universities", "Create cohort", "org", { permission: "university.manage", body: cohortSchema }),
  E("get", "/universities/cohorts/{id}/members", "Universities", "Cohort members (detail only for consenting students)", "org", { permission: "university.students.view" }),
  E("post", "/universities/cohorts/{id}/import", "Universities", "Invite students via validated CSV", "org", { permission: "university.import", body: z.object({ csv: z.string().optional(), emails: z.array(z.string()).optional() }) }),
  E("delete", "/universities/cohort-members/{id}", "Universities", "Remove a cohort member", "org", { permission: "university.manage" }),
  E("get", "/universities/analytics", "Universities", "Aggregate cohort analytics (small cells suppressed)", "org", { permission: "analytics.view" }),
  E("get", "/universities/opportunities", "Universities", "Opportunities targeted at my programmes", "org"),
  E("get", "/placement-programmes", "Universities", "Employer: programmes I'm invited to", "org"),
  E("post", "/placement-programmes/{id}/respond", "Universities", "Employer: accept/decline programme", "org", { permission: "jobs.publish", body: z.object({ accept: z.boolean() }) }),

  E("get", "/billing", "Billing", "Subscription, entitlements, credits, invoices, usage", "org", { permission: "billing.view" }),
  E("get", "/billing/plans", "Billing", "Public plans and credit packs", "public", { query: z.object({ audience: z.enum(["EMPLOYER", "UNIVERSITY", "STUDENT"]).optional() }) }),
  E("post", "/billing/checkout", "Billing", "Create hosted checkout (subscription or credit pack)", "org", { permission: "billing.manage", body: checkoutSchema }),
  E("post", "/billing/portal", "Billing", "Open the billing portal (payment methods, invoices, plan changes)", "org", { permission: "billing.manage" }),
  E("post", "/billing/practice-checkout", "Billing", "Student: buy practice credits", "verified", { body: z.object({ packKey: z.string() }) }),
  E("get", "/credits", "Credits", "Credit balance and immutable ledger", "org", { permission: "billing.view" }),
  E("post", "/webhooks/stripe", "Webhooks", "Stripe webhook (signature-verified, idempotent)", "signature"),
  E("post", "/webhooks/email", "Webhooks", "Email delivery status webhook (HMAC-signed)", "signature"),

  E("get", "/notifications", "Notifications", "In-app notifications", "session"),
  E("post", "/notifications/read", "Notifications", "Mark notifications read", "session", { body: z.object({ ids: z.array(z.string()).optional() }) }),
  E("get", "/analytics/dashboard", "Analytics", "HR dashboard metrics", "org"),
  E("get", "/audit", "Audit", "Organisation audit log", "org", { permission: "audit.view", query: auditQuery }),
  E("get", "/files/{id}", "Files", "Download a file (authorised per request; short-lived)", "session", { produces: "application/octet-stream" }),

  E("get", "/privacy/requests", "Privacy", "My data subject requests", "session"),
  E("post", "/privacy/requests", "Privacy", "Request data export, deletion or correction", "verified", { body: dsrSchema }),
  E("get", "/privacy/org-requests", "Privacy", "Requests addressed to my organisation", "org", { permission: "retention.manage" }),
  E("post", "/privacy/org-requests/{id}", "Privacy", "Resolve a request", "org", { permission: "retention.manage", body: z.object({ status: z.enum(["COMPLETED", "REJECTED"]), note: z.string() }) }),
  E("post", "/privacy/candidates/{id}/erase", "Privacy", "Erase a candidate and all derived data", "org", { permission: "retention.manage", body: z.object({ reason: z.string(), confirm: z.literal(true) }) }),
  E("get", "/privacy/retention", "Privacy", "Retention policy", "org"),
  E("put", "/privacy/retention", "Privacy", "Update retention (within platform limits)", "org", { permission: "retention.manage", body: retentionSchema }),
  E("get", "/accommodations", "Privacy", "Accommodation requests addressed to my organisation", "org", { permission: "candidates.view_all" }),
  E("post", "/accommodations/{id}", "Privacy", "Respond to an accommodation request", "org", { permission: "candidates.manage", body: z.object({ status: z.enum(["ACKNOWLEDGED", "GRANTED", "DECLINED"]), note: z.string().optional() }) }),

  E("get", "/support/tickets", "Support", "My tickets", "session"),
  E("post", "/support/tickets", "Support", "Open a ticket", "verified", { body: ticketSchema }),
  E("get", "/support/tickets/{id}", "Support", "Ticket detail", "session"),
  E("post", "/support/tickets/{id}", "Support", "Reply", "session", { body: z.object({ body: z.string() }) }),
  E("get", "/support-access", "Support", "Support access requests for my organisation", "org", { permission: "support.approve_access" }),
  E("post", "/support-access/{id}", "Support", "Approve/deny time-boxed metadata-only support access", "org", { permission: "support.approve_access", body: z.object({ approve: z.boolean() }) }),
  E("post", "/contact", "Support", "Sales / contact enquiry", "public"),

  E("get", "/platform/overview", "Platform", "Platform metrics", "platform"),
  E("get", "/platform/organisations", "Platform", "Organisation directory (metadata only)", "platform", { query: orgQuery }),
  E("get", "/platform/organisations/{id}", "Platform", "Organisation detail (aggregate counts; audited)", "platform"),
  E("post", "/platform/organisations/{id}/actions", "Platform", "Suspend / reactivate / verify (reason + confirmation)", "platform", { body: orgActionSchema }),
  E("post", "/platform/organisations/{id}/credits", "Platform", "Adjust credits (reason, idempotent)", "platform", { body: creditAdjustSchema }),
  E("post", "/platform/organisations/{id}/support-access", "Platform", "Request support access", "platform", { body: z.object({ reason: z.string() }) }),
  E("get", "/platform/plans", "Platform", "Plans & packs", "platform"),
  E("post", "/platform/plans", "Platform", "Create/update plan", "platform", { body: planSchema }),
  E("post", "/platform/credit-packs", "Platform", "Create/update credit pack", "platform", { body: packSchema }),
  E("get", "/platform/flags", "Platform", "Feature flags", "platform"),
  E("post", "/platform/flags", "Platform", "Create/update flag", "platform", { body: flagSchema }),
  E("get", "/platform/settings", "Platform", "Platform settings", "platform"),
  E("post", "/platform/settings", "Platform", "Update a setting", "platform"),
  E("get", "/platform/health", "Platform", "Provider & infrastructure health", "platform"),
  E("get", "/platform/jobs", "Platform", "Background job runs", "platform"),
  E("post", "/platform/jobs/{id}/retry", "Platform", "Retry a failed job", "platform"),
  E("get", "/platform/payment-events", "Platform", "Payment webhook events", "platform"),
  E("post", "/platform/payment-events", "Platform", "Retry failed payment events", "platform"),
  E("get", "/platform/audit", "Platform", "Security audit events", "platform", { query: auditQuery }),
  E("get", "/platform/admins", "Platform", "Platform administrators", "platform"),
  E("post", "/platform/admins", "Platform", "Set a user's platform role", "platform", { body: adminRoleSchema }),
  E("get", "/platform/tickets", "Platform", "Support queue", "platform"),
  E("get", "/platform/tickets/{id}", "Platform", "Ticket detail incl. internal notes", "platform"),
  E("post", "/platform/tickets/{id}", "Platform", "Reply / internal note / status", "platform"),
  E("get", "/platform/privacy-requests", "Platform", "Data subject requests", "platform"),
];

const SECURITY: Record<Auth, unknown[]> = {
  public: [],
  session: [{ sessionCookie: [] }],
  verified: [{ sessionCookie: [] }],
  org: [{ sessionCookie: [], orgHeader: [] }],
  platform: [{ sessionCookie: [] }],
  interview: [{ interviewToken: [] }, { sessionCookie: [] }],
  signature: [],
};

function js(schema: z.ZodTypeAny) {
  const out = zodToJsonSchema(schema, { target: "openApi3", $refStrategy: "none" }) as Record<string, unknown>;
  delete out.$schema;
  return out;
}

export function buildOpenApi(serverUrl = "/api/v1") {
  const paths: Record<string, Record<string, unknown>> = {};
  for (const e of ENDPOINTS) {
    const params = [...e.path.matchAll(/\{(\w+)\}/g)].map((m) => ({ name: m[1], in: "path", required: true, schema: { type: "string" } }));
    if (e.query) {
      const q = js(e.query) as { properties?: Record<string, unknown>; required?: string[] };
      for (const [name, schema] of Object.entries(q.properties ?? {})) params.push({ name, in: "query", required: (q.required ?? []).includes(name), schema: schema as never });
    }
    const op: Record<string, unknown> = {
      tags: [e.tag],
      summary: e.summary,
      security: SECURITY[e.auth],
      parameters: params,
      ...(e.permission ? { "x-required-permission": e.permission } : {}),
      ...(e.auth === "platform" ? { "x-requires": "platform role + MFA" } : {}),
      responses: {
        "200": { description: "Success", content: { [e.produces ?? "application/json"]: { schema: e.produces ? { type: "string", format: "binary" } : { $ref: "#/components/schemas/Envelope" } } } },
        "4XX": { description: "Client error", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
        "5XX": { description: "Server / provider error", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
      },
    };
    if (e.body) op.requestBody = { required: true, content: { "application/json": { schema: js(e.body) } } };
    if (e.multipart) op.requestBody = { required: true, content: { "multipart/form-data": { schema: { type: "object", properties: Object.fromEntries(e.multipart.map((f) => [f, f === "file" ? { type: "string", format: "binary" } : { type: "string" }])) } } } };
    (paths[e.path] ??= {})[e.method] = op;
  }
  return {
    openapi: "3.0.3",
    info: {
      title: `${process.env.APP_NAME ?? "Atlas Hiring"} API`,
      version: "1.0.0",
      description:
        "Versioned REST API. All responses use the envelope `{ data }` or `{ error: { code, message, details, requestId } }`. Request schemas are generated from the server-side validators. State-changing requests from browsers must include a same-origin `Origin` header (CSRF protection). Organisation-scoped endpoints take the organisation slug in `x-atlas-org`; access is always verified against the caller's membership.",
    },
    servers: [{ url: serverUrl }],
    components: {
      securitySchemes: {
        sessionCookie: { type: "apiKey", in: "cookie", name: "atlas_session" },
        orgHeader: { type: "apiKey", in: "header", name: "x-atlas-org" },
        interviewToken: { type: "apiKey", in: "header", name: "x-interview-token" },
      },
      schemas: {
        Envelope: { type: "object", properties: { data: {} } },
        Error: {
          type: "object",
          properties: {
            error: {
              type: "object",
              required: ["code", "message"],
              properties: {
                code: { type: "string", enum: ["BAD_REQUEST", "VALIDATION_FAILED", "UNAUTHENTICATED", "MFA_REQUIRED", "FORBIDDEN", "NOT_FOUND", "CONFLICT", "INVALID_STATE", "RATE_LIMITED", "PAYMENT_REQUIRED", "PROVIDER_NOT_CONFIGURED", "PROVIDER_ERROR", "CSRF_FAILED", "INTERNAL"] },
                message: { type: "string" },
                details: {},
                requestId: { type: "string" },
              },
            },
          },
        },
      },
    },
    paths,
  };
}
