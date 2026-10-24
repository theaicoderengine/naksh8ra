import { describe, it, expect } from "vitest";
import { ORG_ROLES, PERMISSIONS, assignableRoles, permissionsFor, platformCan } from "@/server/rbac/permissions";

describe("RBAC", () => {
  it("owner has every permission", () => {
    expect(permissionsFor("OWNER").size).toBe(Object.keys(PERMISSIONS).length);
  });
  it("HR admin cannot manage billing or transfer ownership", () => {
    const p = permissionsFor("HR_ADMIN");
    expect(p.has("billing.manage")).toBe(false);
    expect(p.has("org.transfer")).toBe(false);
    expect(p.has("jobs.publish")).toBe(true);
    expect(p.has("billing.view")).toBe(true);
  });
  it("recruiters are assignment-scoped and cannot decide or view recordings", () => {
    const p = permissionsFor("RECRUITER");
    expect(p.has("jobs.view_all")).toBe(false);
    expect(p.has("candidates.view_all")).toBe(false);
    expect(p.has("candidates.view_assigned")).toBe(true);
    expect(p.has("applications.decide")).toBe(false);
    expect(p.has("interviews.view_recordings")).toBe(false);
  });
  it("university roles never get employer assessment permissions", () => {
    for (const k of ["PLACEMENT_ADMIN", "PLACEMENT_OFFICER"]) {
      const p = permissionsFor(k);
      expect(p.has("assessments.review")).toBe(false);
      expect(p.has("interviews.view_transcripts")).toBe(false);
      expect(p.has("candidates.view_all")).toBe(false);
    }
  });
  it("unknown role has no permissions", () => {
    expect(permissionsFor("HACKER").size).toBe(0);
  });
  it("non-owners can only assign roles that are subsets of their own (no escalation)", () => {
    const hr = assignableRoles("HR_ADMIN", "EMPLOYER");
    expect(hr).not.toContain("OWNER");
    expect(hr).toContain("RECRUITER");
    for (const r of hr) for (const p of ORG_ROLES[r].permissions) expect(permissionsFor("HR_ADMIN").has(p)).toBe(true);
    expect(assignableRoles("RECRUITER", "EMPLOYER")).toEqual([]);
    expect(assignableRoles("OWNER", "EMPLOYER")).toContain("OWNER");
  });
  it("roles are restricted to the organisation type", () => {
    expect(assignableRoles("OWNER", "UNIVERSITY")).not.toContain("RECRUITER");
    expect(assignableRoles("OWNER", "EMPLOYER")).not.toContain("PLACEMENT_ADMIN");
  });
  it("platform roles", () => {
    expect(platformCan("SUPPORT", "platform.orgs.view")).toBe(true);
    expect(platformCan("SUPPORT", "platform.orgs.manage")).toBe(false);
    expect(platformCan("BILLING_ADMIN", "platform.billing.manage")).toBe(true);
    expect(platformCan("NONE", "platform.orgs.view")).toBe(false);
    expect(platformCan("SUPER_ADMIN", "platform.admins.manage")).toBe(true);
  });
});
