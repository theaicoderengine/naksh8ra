/**
 * Permission catalogue and system roles. This is the single source of truth;
 * the seed mirrors it into Role/Permission tables for display and auditing.
 * Changing a role's permissions is a security-relevant change: update
 * docs/security.md#rbac and the unit tests in tests/unit/rbac.test.ts.
 */
export const PERMISSIONS = {
  "org.view": "View organisation profile",
  "org.manage": "Edit organisation profile, branding and preferences",
  "org.transfer": "Transfer organisation ownership",
  "members.view": "View team members",
  "members.invite": "Invite team members",
  "members.manage": "Change roles and remove members",
  "billing.view": "View subscription, invoices and credit usage",
  "billing.manage": "Change plan, buy credits, manage payment methods",
  "departments.manage": "Manage departments",
  "jobs.view_all": "View every vacancy in the organisation",
  "jobs.view_assigned": "View vacancies the user is assigned to",
  "jobs.create": "Create vacancies",
  "jobs.edit": "Edit vacancies",
  "jobs.publish": "Publish, pause and close vacancies",
  "candidates.view_all": "View all candidates and applications",
  "candidates.view_assigned": "View candidates for assigned vacancies",
  "candidates.manage": "Create and edit candidate records",
  "candidates.export": "Export candidate data",
  "applications.move": "Move applications between stages",
  "applications.decide": "Record hire / reject decisions",
  "notes.write": "Write internal notes",
  "interviews.configure": "Manage interview templates, competencies and rubrics",
  "interviews.invite": "Send AI interview invitations",
  "interviews.view_transcripts": "View interview transcripts",
  "interviews.view_recordings": "Listen to interview recordings",
  "assessments.review": "Review and override AI assessments",
  "feedback.write": "Submit structured reviewer feedback",
  "feedback.disclose": "Approve feedback for disclosure to candidates",
  "analytics.view": "View recruitment analytics",
  "integrations.manage": "Manage integrations and webhooks",
  "audit.view": "View organisation audit log",
  "retention.manage": "Configure data retention",
  "university.manage": "Manage placement programmes and cohorts",
  "university.students.view": "View consenting cohort students and their progress",
  "university.import": "Import students via CSV",
  "support.request": "Open support tickets",
  "support.approve_access": "Approve platform support access to the workspace",
} as const;

export type Permission = keyof typeof PERMISSIONS;

const ALL = Object.keys(PERMISSIONS) as Permission[];

export const ORG_ROLES = {
  OWNER: {
    name: "Owner",
    description: "Full control of the workspace including billing and ownership transfer",
    permissions: ALL,
    types: ["EMPLOYER", "UNIVERSITY"],
  },
  HR_ADMIN: {
    name: "HR Admin",
    description: "Runs recruitment operations; cannot manage billing or transfer ownership",
    permissions: ALL.filter(
      (p) => !["org.transfer", "billing.manage", "support.approve_access", "university.manage", "university.import", "university.students.view"].includes(p),
    ),
    types: ["EMPLOYER"],
  },
  RECRUITER: {
    name: "Recruiter",
    description: "Works on assigned vacancies and their candidates",
    permissions: [
      "org.view",
      "members.view",
      "jobs.view_assigned",
      "candidates.view_assigned",
      "candidates.manage",
      "candidates.export",
      "applications.move",
      "notes.write",
      "interviews.invite",
      "interviews.view_transcripts",
      "feedback.write",
      "analytics.view",
      "support.request",
    ] as Permission[],
    types: ["EMPLOYER"],
  },
  HIRING_MANAGER: {
    name: "Hiring Manager",
    description: "Reviews candidates for assigned vacancies and records decisions",
    permissions: [
      "org.view",
      "members.view",
      "jobs.view_assigned",
      "candidates.view_assigned",
      "applications.move",
      "applications.decide",
      "notes.write",
      "interviews.view_transcripts",
      "interviews.view_recordings",
      "assessments.review",
      "feedback.write",
      "support.request",
    ] as Permission[],
    types: ["EMPLOYER"],
  },
  INTERVIEWER: {
    name: "Interview Reviewer",
    description: "Provides structured feedback on assigned candidates",
    permissions: [
      "org.view",
      "jobs.view_assigned",
      "candidates.view_assigned",
      "interviews.view_transcripts",
      "feedback.write",
      "notes.write",
    ] as Permission[],
    types: ["EMPLOYER"],
  },
  PLACEMENT_ADMIN: {
    name: "Placement Administrator",
    description: "Manages placement programmes, cohorts and placement officers",
    permissions: [
      "org.view",
      "org.manage",
      "members.view",
      "members.invite",
      "members.manage",
      "billing.view",
      "university.manage",
      "university.students.view",
      "university.import",
      "analytics.view",
      "audit.view",
      "support.request",
    ] as Permission[],
    types: ["UNIVERSITY"],
  },
  PLACEMENT_OFFICER: {
    name: "Placement Officer",
    description: "Supports students within cohorts",
    permissions: ["org.view", "members.view", "university.students.view", "analytics.view", "support.request"] as Permission[],
    types: ["UNIVERSITY"],
  },
} satisfies Record<string, { name: string; description: string; permissions: readonly Permission[]; types: string[] }>;

export type OrgRoleKey = keyof typeof ORG_ROLES;

export function isOrgRoleKey(k: string): k is OrgRoleKey {
  return k in ORG_ROLES;
}

export function permissionsFor(role: string): Set<Permission> {
  if (!isOrgRoleKey(role)) return new Set();
  return new Set(ORG_ROLES[role].permissions);
}

/** Roles a member holding `actorRole` may assign. Prevents privilege escalation. */
export function assignableRoles(actorRole: string, orgType: string): OrgRoleKey[] {
  const all = (Object.keys(ORG_ROLES) as OrgRoleKey[]).filter((k) => (ORG_ROLES[k].types as string[]).includes(orgType));
  if (actorRole === "OWNER") return all;
  const actor = permissionsFor(actorRole);
  if (!actor.has("members.invite") && !actor.has("members.manage")) return [];
  // A non-owner may only assign roles whose permissions are a subset of their own.
  return all.filter((k) => k !== "OWNER" && [...ORG_ROLES[k].permissions].every((p) => actor.has(p)));
}

// ─── Platform (SaaS operator) roles ───
export const PLATFORM_PERMISSIONS = {
  "platform.orgs.view": "View organisation directory (metadata only)",
  "platform.orgs.manage": "Suspend / reactivate organisations",
  "platform.billing.view": "View revenue, subscriptions and payment events",
  "platform.billing.manage": "Configure plans, credit packs; adjust credits",
  "platform.ops.view": "View platform health, jobs, provider status",
  "platform.flags.manage": "Manage feature flags and system settings",
  "platform.tickets": "Handle support tickets",
  "platform.security.view": "View security audit events",
  "platform.admins.manage": "Manage platform administrators",
  "platform.privacy.manage": "Process data subject requests",
} as const;

export type PlatformPermission = keyof typeof PLATFORM_PERMISSIONS;

export const PLATFORM_ROLES: Record<string, PlatformPermission[]> = {
  NONE: [],
  SUPPORT: ["platform.orgs.view", "platform.tickets", "platform.ops.view"],
  BILLING_ADMIN: ["platform.orgs.view", "platform.billing.view", "platform.billing.manage", "platform.tickets"],
  SUPER_ADMIN: Object.keys(PLATFORM_PERMISSIONS) as PlatformPermission[],
};

export function platformCan(role: string, p: PlatformPermission): boolean {
  return (PLATFORM_ROLES[role] ?? []).includes(p);
}
