import { requireVerifiedPage } from "@/server/auth/page";
import { getStudentProfile } from "@/server/services/students";
import { PageHeader } from "@/components/ui/card";
import { ProfileEditor, type ProfileValue } from "@/components/student/profile-editor";

const d = (x: Date | null) => (x ? x.toISOString().slice(0, 10) : "");

export default async function Profile() {
  const s = await requireVerifiedPage();
  const p = await getStudentProfile(s.user.id);
  const sp = p.student;
  const initial: ProfileValue = {
    firstName: p.profile?.firstName ?? "", lastName: p.profile?.lastName ?? "", phone: p.profile?.phone ?? "", headline: sp?.headline ?? "", bio: sp?.bio ?? "", country: sp?.country ?? "", city: sp?.city ?? "", workArrangement: sp?.workArrangement ?? "", graduationYear: sp?.graduationYear ? String(sp.graduationYear) : "",
    currentInstitution: sp?.currentInstitution ?? "", currentDegree: sp?.currentDegree ?? "", fieldOfStudy: sp?.fieldOfStudy ?? "", languages: (sp?.languages ?? []).join(", "), skills: (sp?.skills ?? []).map((x) => x.name).join(", "), links: (sp?.links as { label: string; url: string }[]) ?? [], visibility: sp?.visibility ?? "PRIVATE",
    education: (sp?.education ?? []).map((e) => ({ institution: e.institution, degree: e.degree, fieldOfStudy: e.fieldOfStudy ?? "", graduationYear: e.graduationYear ? String(e.graduationYear) : "", grade: e.grade ?? "" })),
    experiences: (sp?.experiences ?? []).map((e) => ({ kind: e.kind, organisation: e.organisation, title: e.title, description: e.description ?? "", startDate: d(e.startDate), endDate: d(e.endDate) })),
    projects: (sp?.projects ?? []).map((x) => ({ title: x.title, description: x.description ?? "", url: x.url ?? "" })),
    certifications: (sp?.certifications ?? []).map((c) => ({ name: c.name, issuer: c.issuer ?? "", url: c.url ?? "" })),
    desiredRoles: (sp?.preference?.desiredRoles ?? []).join(", "), desiredLocations: (sp?.preference?.desiredLocations ?? []).join(", "), remotePolicies: sp?.preference?.remotePolicies ?? [], employmentTypes: sp?.preference?.employmentTypes ?? [], opportunityAlerts: sp?.preference?.opportunityAlerts ?? false,
  };
  return (<><PageHeader title="Your profile" description="Private by default. Employers only receive the snapshot you preview when you apply." /><ProfileEditor initial={initial} /></>);
}
