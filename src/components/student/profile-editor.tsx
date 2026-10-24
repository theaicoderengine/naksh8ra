"use client";
import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import { Card, CardHeader, CardBody } from "../ui/card";
import { Field, Input, Select, Textarea, Checkbox } from "../ui/form";
import { Button } from "../ui/button";
import { Alert } from "../ui/feedback";
import { useToast } from "../ui/toast";

type Edu = { institution: string; degree: string; fieldOfStudy: string; graduationYear: string; grade: string };
type Exp = { kind: string; organisation: string; title: string; description: string; startDate: string; endDate: string };
type Proj = { title: string; description: string; url: string };
type Cert = { name: string; issuer: string; url: string };
export type ProfileValue = {
  firstName: string; lastName: string; phone: string; headline: string; bio: string; country: string; city: string; workArrangement: string; graduationYear: string; currentInstitution: string; currentDegree: string; fieldOfStudy: string;
  languages: string; skills: string; links: { label: string; url: string }[]; visibility: string; education: Edu[]; experiences: Exp[]; projects: Proj[]; certifications: Cert[];
  desiredRoles: string; desiredLocations: string; remotePolicies: string[]; employmentTypes: string[]; opportunityAlerts: boolean;
};

function List<T>({ items, onChange, empty, render, label }: { items: T[]; onChange: (x: T[]) => void; empty: T; render: (item: T, set: (p: Partial<T>) => void) => React.ReactNode; label: string }) {
  return (
    <div className="space-y-3">
      {items.map((it, i) => (
        <div key={i} className="relative rounded-lg border border-border p-3 pr-12">
          {render(it, (p) => onChange(items.map((x, j) => (j === i ? { ...x, ...p } : x))))}
          <Button variant="ghost" size="icon" className="absolute right-2 top-2" aria-label={`Remove ${label}`} onClick={() => onChange(items.filter((_, j) => j !== i))}><Trash2 className="h-4 w-4" /></Button>
        </div>
      ))}
      <Button variant="secondary" size="sm" onClick={() => onChange([...items, { ...empty }])}><Plus className="h-4 w-4" />Add {label}</Button>
    </div>
  );
}

const date = (s: string) => (s ? new Date(s).toISOString() : null);

export function ProfileEditor({ initial }: { initial: ProfileValue }) {
  const { toast } = useToast();
  const [v, setV] = useState(initial);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = <K extends keyof ProfileValue>(k: K, val: ProfileValue[K]) => setV((x) => ({ ...x, [k]: val }));
  const csv = (s: string) => s.split(",").map((x) => x.trim()).filter(Boolean);
  async function save() {
    setBusy(true);
    setErr(null);
    try {
      await api("/students/me", {
        method: "PATCH",
        body: {
          firstName: v.firstName, lastName: v.lastName, phone: v.phone || null, headline: v.headline || null, bio: v.bio || null, country: v.country.length === 2 ? v.country : null, city: v.city || null, workArrangement: v.workArrangement || null,
          graduationYear: v.graduationYear ? Number(v.graduationYear) : null, currentInstitution: v.currentInstitution || null, currentDegree: v.currentDegree || null, fieldOfStudy: v.fieldOfStudy || null, languages: csv(v.languages), visibility: v.visibility,
          links: v.links.filter((l) => l.url), skills: csv(v.skills).map((name) => ({ name })),
          education: v.education.filter((e) => e.institution && e.degree).map((e) => ({ institution: e.institution, degree: e.degree, fieldOfStudy: e.fieldOfStudy || null, graduationYear: e.graduationYear ? Number(e.graduationYear) : null, grade: e.grade || null })),
          experiences: v.experiences.filter((e) => e.organisation && e.title).map((e) => ({ kind: e.kind, organisation: e.organisation, title: e.title, description: e.description || null, startDate: date(e.startDate), endDate: date(e.endDate) })),
          projects: v.projects.filter((p) => p.title).map((p) => ({ title: p.title, description: p.description || null, url: p.url || null, skills: [] })),
          certifications: v.certifications.filter((c) => c.name).map((c) => ({ name: c.name, issuer: c.issuer || null, url: c.url || null })),
          preferences: { desiredRoles: csv(v.desiredRoles), desiredLocations: csv(v.desiredLocations), remotePolicies: v.remotePolicies, employmentTypes: v.employmentTypes, opportunityAlerts: v.opportunityAlerts },
          completeOnboarding: true,
        },
      });
      toast("Profile saved");
    } catch (e) {
      setErr(e instanceof ApiError ? `${e.message}${Object.keys(e.fieldErrors()).length ? ": " + Object.entries(e.fieldErrors()).map(([k, m]) => `${k} — ${m}`).join("; ") : ""}` : "Save failed");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="space-y-6">
      {err && <Alert tone="danger">{err}</Alert>}
      <Card><CardHeader title="About you" /><CardBody className="grid gap-4 sm:grid-cols-2">
        <Field id="fn" label="First name"><Input value={v.firstName} onChange={(e) => set("firstName", e.target.value)} /></Field>
        <Field id="ln" label="Last name"><Input value={v.lastName} onChange={(e) => set("lastName", e.target.value)} /></Field>
        <Field id="hl" label="Headline" className="sm:col-span-2"><Input value={v.headline} onChange={(e) => set("headline", e.target.value)} /></Field>
        <Field id="bio" label="Summary" className="sm:col-span-2"><Textarea value={v.bio} onChange={(e) => set("bio", e.target.value)} /></Field>
        <Field id="ph" label="Phone (optional)"><Input value={v.phone} onChange={(e) => set("phone", e.target.value)} /></Field>
        <Field id="lang" label="Languages" hint="Comma-separated"><Input value={v.languages} onChange={(e) => set("languages", e.target.value)} /></Field>
        <Field id="cty" label="Country code"><Input maxLength={2} value={v.country} onChange={(e) => set("country", e.target.value.toUpperCase())} /></Field>
        <Field id="city" label="City"><Input value={v.city} onChange={(e) => set("city", e.target.value)} /></Field>
        <Field id="wa" label="Preferred work arrangement"><Select value={v.workArrangement} onChange={(e) => set("workArrangement", e.target.value)}><option value="">No preference</option><option value="REMOTE">Remote</option><option value="HYBRID">Hybrid</option><option value="ONSITE">On-site</option></Select></Field>
        <Field id="vis" label="Profile visibility"><Select value={v.visibility} onChange={(e) => set("visibility", e.target.value)}><option value="PRIVATE">Private — only shared when I apply</option><option value="EMPLOYERS_I_APPLY_TO">Employers I apply to</option></Select></Field>
      </CardBody></Card>
      <Card><CardHeader title="Current studies" /><CardBody className="grid gap-4 sm:grid-cols-2">
        <Field id="ci" label="Institution"><Input value={v.currentInstitution} onChange={(e) => set("currentInstitution", e.target.value)} /></Field>
        <Field id="cd" label="Degree"><Input value={v.currentDegree} onChange={(e) => set("currentDegree", e.target.value)} /></Field>
        <Field id="cf" label="Field of study"><Input value={v.fieldOfStudy} onChange={(e) => set("fieldOfStudy", e.target.value)} /></Field>
        <Field id="cg" label="Graduation year"><Input inputMode="numeric" maxLength={4} value={v.graduationYear} onChange={(e) => set("graduationYear", e.target.value.replace(/\D/g, ""))} /></Field>
      </CardBody></Card>
      <Card><CardHeader title="Education history" /><CardBody>
        <List label="education" items={v.education} onChange={(x) => set("education", x)} empty={{ institution: "", degree: "", fieldOfStudy: "", graduationYear: "", grade: "" }} render={(e, s) => (
          <div className="grid gap-2 sm:grid-cols-2">
            <Input aria-label="Institution" placeholder="Institution" value={e.institution} onChange={(x) => s({ institution: x.target.value })} />
            <Input aria-label="Degree" placeholder="Degree" value={e.degree} onChange={(x) => s({ degree: x.target.value })} />
            <Input aria-label="Field of study" placeholder="Field of study" value={e.fieldOfStudy} onChange={(x) => s({ fieldOfStudy: x.target.value })} />
            <div className="grid grid-cols-2 gap-2"><Input aria-label="Graduation year" placeholder="Year" value={e.graduationYear} onChange={(x) => s({ graduationYear: x.target.value.replace(/\D/g, "").slice(0, 4) })} /><Input aria-label="Grade" placeholder="Grade (optional)" value={e.grade} onChange={(x) => s({ grade: x.target.value })} /></div>
          </div>
        )} />
      </CardBody></Card>
      <Card><CardHeader title="Skills" /><CardBody><Field id="sk" label="Skills" hint="Comma-separated. Used for explainable recommendations."><Input value={v.skills} onChange={(e) => set("skills", e.target.value)} /></Field></CardBody></Card>
      <Card><CardHeader title="Experience & internships" /><CardBody>
        <List label="experience" items={v.experiences} onChange={(x) => set("experiences", x)} empty={{ kind: "INTERNSHIP", organisation: "", title: "", description: "", startDate: "", endDate: "" }} render={(e, s) => (
          <div className="grid gap-2 sm:grid-cols-3">
            <Select aria-label="Type" value={e.kind} onChange={(x) => s({ kind: x.target.value })}><option value="INTERNSHIP">Internship</option><option value="EMPLOYMENT">Employment</option><option value="VOLUNTEER">Volunteering</option></Select>
            <Input aria-label="Organisation" placeholder="Organisation" value={e.organisation} onChange={(x) => s({ organisation: x.target.value })} />
            <Input aria-label="Title" placeholder="Title" value={e.title} onChange={(x) => s({ title: x.target.value })} />
            <Input aria-label="Start date" type="date" value={e.startDate} onChange={(x) => s({ startDate: x.target.value })} />
            <Input aria-label="End date" type="date" value={e.endDate} onChange={(x) => s({ endDate: x.target.value })} />
            <Textarea aria-label="Description" rows={2} className="min-h-[40px] sm:col-span-3" placeholder="What you did" value={e.description} onChange={(x) => s({ description: x.target.value })} />
          </div>
        )} />
      </CardBody></Card>
      <Card><CardHeader title="Projects" /><CardBody>
        <List label="project" items={v.projects} onChange={(x) => set("projects", x)} empty={{ title: "", description: "", url: "" }} render={(p, s) => (
          <div className="grid gap-2 sm:grid-cols-2"><Input aria-label="Project title" placeholder="Title" value={p.title} onChange={(x) => s({ title: x.target.value })} /><Input aria-label="Project link" placeholder="https://…" value={p.url} onChange={(x) => s({ url: x.target.value })} /><Textarea aria-label="Project description" rows={2} className="min-h-[40px] sm:col-span-2" placeholder="Description" value={p.description} onChange={(x) => s({ description: x.target.value })} /></div>
        )} />
      </CardBody></Card>
      <Card><CardHeader title="Certifications" /><CardBody>
        <List label="certification" items={v.certifications} onChange={(x) => set("certifications", x)} empty={{ name: "", issuer: "", url: "" }} render={(c, s) => (
          <div className="grid gap-2 sm:grid-cols-3"><Input aria-label="Certification" placeholder="Name" value={c.name} onChange={(x) => s({ name: x.target.value })} /><Input aria-label="Issuer" placeholder="Issuer" value={c.issuer} onChange={(x) => s({ issuer: x.target.value })} /><Input aria-label="Credential link" placeholder="https://…" value={c.url} onChange={(x) => s({ url: x.target.value })} /></div>
        )} />
      </CardBody></Card>
      <Card><CardHeader title="Links" /><CardBody>
        <List label="link" items={v.links} onChange={(x) => set("links", x)} empty={{ label: "", url: "" }} render={(l, s) => (
          <div className="grid gap-2 sm:grid-cols-2"><Input aria-label="Link label" placeholder="Portfolio / GitHub / LinkedIn" value={l.label} onChange={(x) => s({ label: x.target.value })} /><Input aria-label="URL" placeholder="https://…" value={l.url} onChange={(x) => s({ url: x.target.value })} /></div>
        )} />
      </CardBody></Card>
      <Card><CardHeader title="Career preferences" /><CardBody className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field id="dr" label="Roles you're interested in" hint="Comma-separated"><Input value={v.desiredRoles} onChange={(e) => set("desiredRoles", e.target.value)} /></Field>
          <Field id="dl" label="Preferred locations" hint="Comma-separated"><Input value={v.desiredLocations} onChange={(e) => set("desiredLocations", e.target.value)} /></Field>
        </div>
        <fieldset><legend className="mb-2 text-sm font-medium">Work arrangements</legend><div className="flex flex-wrap gap-4">{["REMOTE", "HYBRID", "ONSITE"].map((r) => <Checkbox key={r} id={`rp-${r}`} label={r.toLowerCase()} checked={v.remotePolicies.includes(r)} onChange={(e) => set("remotePolicies", e.target.checked ? [...v.remotePolicies, r] : v.remotePolicies.filter((x) => x !== r))} />)}</div></fieldset>
        <fieldset><legend className="mb-2 text-sm font-medium">Employment types</legend><div className="flex flex-wrap gap-4">{["FULL_TIME", "PART_TIME", "INTERNSHIP", "GRADUATE_PROGRAMME", "CONTRACT"].map((r) => <Checkbox key={r} id={`et-${r}`} label={r.replace(/_/g, " ").toLowerCase()} checked={v.employmentTypes.includes(r)} onChange={(e) => set("employmentTypes", e.target.checked ? [...v.employmentTypes, r] : v.employmentTypes.filter((x) => x !== r))} />)}</div></fieldset>
        <Checkbox id="alerts" checked={v.opportunityAlerts} onChange={(e) => set("opportunityAlerts", e.target.checked)} label="Email me about matching opportunities" />
      </CardBody></Card>
      <div className="sticky bottom-4 flex justify-end"><Button size="lg" loading={busy} onClick={save} className="shadow-pop">Save profile</Button></div>
    </div>
  );
}
