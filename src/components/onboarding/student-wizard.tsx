"use client";
import { useState } from "react";
import { api, ApiError } from "@/lib/api";
import { Steps } from "./steps";
import { Card, CardBody } from "../ui/card";
import { Field, Input, Select, Checkbox } from "../ui/form";
import { Button } from "../ui/button";
import { Alert } from "../ui/feedback";
import { ResumeUpload } from "../student/resume-upload";

export function StudentWizard() {
  const [step, setStep] = useState(0);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [p, setP] = useState({ headline: "", country: "", city: "", workArrangement: "", institution: "", degree: "", fieldOfStudy: "", graduationYear: "", skills: "", desiredRoles: "", alerts: false, visibility: "PRIVATE" });
  const steps = ["Privacy", "About you", "Education", "Skills & resume", "Preferences"];

  async function save(extra: Record<string, unknown> = {}, next?: number) {
    setBusy(true);
    setErr(null);
    try {
      await api("/students/me", { method: "PATCH", body: extra });
      if (next != null) setStep(next);
      return true;
    } catch (e) {
      setErr(e instanceof ApiError ? `${e.message}${Object.values(e.fieldErrors()).length ? `: ${Object.values(e.fieldErrors()).join("; ")}` : ""}` : "Could not save");
      return false;
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <h1 className="mb-2 text-2xl font-semibold">Create your career profile</h1>
      <Steps steps={steps} current={step} />
      {err && <Alert tone="danger" className="mb-4">{err}</Alert>}
      <Card><CardBody className="space-y-4 p-6">
        {step === 0 && (
          <>
            <div className="space-y-2 text-sm text-subtle">
              <p className="font-medium text-fg">How your information is used</p>
              <ul className="list-disc space-y-1 pl-5">
                <li>Your profile is <strong>private</strong>. Employers only receive the snapshot you preview and approve when you apply.</li>
                <li>Recommendations use your stated skills, qualifications and preferences — never protected characteristics.</li>
                <li>Practice interviews are visible only to you and are never used for hiring decisions.</li>
                <li>You can export or delete your data at any time in Settings → Privacy.</li>
              </ul>
            </div>
            <Field id="vis" label="Profile visibility"><Select value={p.visibility} onChange={(e) => setP({ ...p, visibility: e.target.value })}><option value="PRIVATE">Private — only shared when I apply</option><option value="EMPLOYERS_I_APPLY_TO">Employers I apply to can see my full profile</option></Select></Field>
            <div className="flex justify-end"><Button loading={busy} onClick={() => save({ visibility: p.visibility }, 1)}>I understand — continue</Button></div>
          </>
        )}
        {step === 1 && (
          <>
            <Field id="headline" label="Headline" hint="e.g. Final-year Computer Science student"><Input value={p.headline} onChange={(e) => setP({ ...p, headline: e.target.value })} /></Field>
            <div className="grid gap-4 sm:grid-cols-3">
              <Field id="country" label="Country code"><Input maxLength={2} value={p.country} onChange={(e) => setP({ ...p, country: e.target.value.toUpperCase() })} /></Field>
              <Field id="city" label="City"><Input value={p.city} onChange={(e) => setP({ ...p, city: e.target.value })} /></Field>
              <Field id="wa" label="Preferred arrangement"><Select value={p.workArrangement} onChange={(e) => setP({ ...p, workArrangement: e.target.value })}><option value="">No preference</option><option value="REMOTE">Remote</option><option value="HYBRID">Hybrid</option><option value="ONSITE">On-site</option></Select></Field>
            </div>
            <div className="flex justify-between"><Button variant="secondary" onClick={() => setStep(0)}>Back</Button><Button loading={busy} onClick={() => save({ headline: p.headline || null, country: p.country.length === 2 ? p.country : null, city: p.city || null, workArrangement: p.workArrangement || null }, 2)}>Continue</Button></div>
          </>
        )}
        {step === 2 && (
          <>
            <Field id="inst" label="Institution"><Input value={p.institution} onChange={(e) => setP({ ...p, institution: e.target.value })} /></Field>
            <div className="grid gap-4 sm:grid-cols-3">
              <Field id="deg" label="Degree"><Input placeholder="BSc Computer Science" value={p.degree} onChange={(e) => setP({ ...p, degree: e.target.value })} /></Field>
              <Field id="fos" label="Field of study"><Input value={p.fieldOfStudy} onChange={(e) => setP({ ...p, fieldOfStudy: e.target.value })} /></Field>
              <Field id="gy" label="Graduation year"><Input inputMode="numeric" maxLength={4} value={p.graduationYear} onChange={(e) => setP({ ...p, graduationYear: e.target.value.replace(/\D/g, "") })} /></Field>
            </div>
            <div className="flex justify-between"><Button variant="secondary" onClick={() => setStep(1)}>Back</Button><Button loading={busy} onClick={() => {
              const gy = p.graduationYear ? Number(p.graduationYear) : null;
              save({ currentInstitution: p.institution || null, currentDegree: p.degree || null, fieldOfStudy: p.fieldOfStudy || null, graduationYear: gy, ...(p.institution && p.degree ? { education: [{ institution: p.institution, degree: p.degree, fieldOfStudy: p.fieldOfStudy || null, graduationYear: gy }] } : {}) }, 3);
            }}>Continue</Button></div>
          </>
        )}
        {step === 3 && (
          <>
            <Field id="skills" label="Skills" hint="Comma-separated, e.g. Python, SQL, Communication"><Input value={p.skills} onChange={(e) => setP({ ...p, skills: e.target.value })} /></Field>
            <ResumeUpload />
            <div className="flex justify-between"><Button variant="secondary" onClick={() => setStep(2)}>Back</Button><Button loading={busy} onClick={() => save({ skills: p.skills.split(",").map((s) => s.trim()).filter(Boolean).map((name) => ({ name })) }, 4)}>Continue</Button></div>
          </>
        )}
        {step === 4 && (
          <>
            <Field id="roles" label="Roles you're interested in" hint="Comma-separated, e.g. Data analyst, Software engineer"><Input value={p.desiredRoles} onChange={(e) => setP({ ...p, desiredRoles: e.target.value })} /></Field>
            <Checkbox id="alerts" checked={p.alerts} onChange={(e) => setP({ ...p, alerts: e.target.checked })} label="Email me about new opportunities that match my profile" description="Off by default. You can change this any time." />
            <div className="flex justify-between"><Button variant="secondary" onClick={() => setStep(3)}>Back</Button><Button loading={busy} onClick={async () => {
              const ok = await save({ preferences: { desiredRoles: p.desiredRoles.split(",").map((s) => s.trim()).filter(Boolean), opportunityAlerts: p.alerts, remotePolicies: p.workArrangement ? [p.workArrangement] : [] }, completeOnboarding: true });
              if (ok) window.location.href = "/student";
            }}>Finish</Button></div>
          </>
        )}
      </CardBody></Card>
    </div>
  );
}
