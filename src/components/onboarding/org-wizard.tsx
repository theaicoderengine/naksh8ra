"use client";
import { useState } from "react";
import { api, ApiError } from "@/lib/api";
import { Steps } from "./steps";
import { Card, CardBody } from "../ui/card";
import { Field, Input, Select, Checkbox, Textarea } from "../ui/form";
import { Button } from "../ui/button";
import { Alert } from "../ui/feedback";
import { fmtMoney } from "@/lib/format";

type Plan = { key: string; name: string; description: string | null; priceAmount: number; currency: string; interval: string; trialDays: number; entitlements: { key: string; value: string }[] };

export function OrgWizard({ type, plans, defaultName, defaultPlan }: { type: "EMPLOYER" | "UNIVERSITY"; plans: Plan[]; defaultName?: string; defaultPlan?: string }) {
  const [step, setStep] = useState(0);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [d, setD] = useState({ name: defaultName ?? "", legalName: "", website: "", industry: "", sizeBand: "", country: "", timezone: typeof Intl !== "undefined" ? Intl.DateTimeFormat().resolvedOptions().timeZone : "UTC" });
  const [planKey, setPlanKey] = useState(defaultPlan ?? plans.find((p) => p.trialDays > 0)?.key ?? "");
  const [terms, setTerms] = useState(false);
  const [slug, setSlug] = useState<string | null>(null);
  const [invites, setInvites] = useState("");
  const [inviteRole, setInviteRole] = useState(type === "UNIVERSITY" ? "PLACEMENT_OFFICER" : "HR_ADMIN");
  const [prefs, setPrefs] = useState({ requireMfa: false, candidateFeedbackDefault: "NONE" });
  const steps = ["Organisation", "Plan", "Terms", "Invite team", "Preferences"];

  async function create() {
    setBusy(true);
    setErr(null);
    try {
      const r = await api<{ slug: string }>("/organisations", { body: { ...d, type, website: d.website || undefined, legalName: d.legalName || undefined, industry: d.industry || undefined, sizeBand: d.sizeBand || undefined, country: d.country || undefined, planKey: planKey || undefined, acceptTerms: true } });
      setSlug(r.slug);
      setStep(3);
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Could not create the organisation");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <h1 className="mb-2 text-2xl font-semibold">{type === "UNIVERSITY" ? "Set up your university workspace" : "Set up your organisation"}</h1>
      <Steps steps={steps} current={step} />
      {err && <Alert tone="danger" className="mb-4">{err}</Alert>}
      <Card><CardBody className="space-y-4 p-6">
        {step === 0 && (
          <>
            <Field id="name" label={type === "UNIVERSITY" ? "Institution name" : "Organisation name"} required><Input value={d.name} onChange={(e) => setD({ ...d, name: e.target.value })} /></Field>
            <Field id="legalName" label="Legal name" hint="As it should appear on invoices"><Input value={d.legalName} onChange={(e) => setD({ ...d, legalName: e.target.value })} /></Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field id="website" label="Website" hint="Used for verification — e.g. https://example.com"><Input type="url" value={d.website} onChange={(e) => setD({ ...d, website: e.target.value })} /></Field>
              <Field id="industry" label="Industry"><Input value={d.industry} onChange={(e) => setD({ ...d, industry: e.target.value })} /></Field>
            </div>
            <div className="grid gap-4 sm:grid-cols-3">
              <Field id="size" label="Size"><Select value={d.sizeBand} onChange={(e) => setD({ ...d, sizeBand: e.target.value })}><option value="">—</option>{["1-10", "11-50", "51-200", "201-1000", "1001-5000", "5000+"].map((s) => <option key={s}>{s}</option>)}</Select></Field>
              <Field id="country" label="Country code" hint="ISO 2-letter, e.g. GB"><Input maxLength={2} value={d.country} onChange={(e) => setD({ ...d, country: e.target.value.toUpperCase() })} /></Field>
              <Field id="tz" label="Time zone"><Input value={d.timezone} onChange={(e) => setD({ ...d, timezone: e.target.value })} /></Field>
            </div>
            <div className="flex justify-end"><Button disabled={d.name.trim().length < 2} onClick={() => setStep(1)}>Continue</Button></div>
          </>
        )}
        {step === 1 && (
          <>
            {plans.length === 0 ? <Alert tone="info">No public plans are configured yet. You can start without a plan and subscribe later from Billing.</Alert> : (
              <fieldset className="space-y-3">
                <legend className="mb-2 text-sm font-medium">Choose a plan — you can change it later</legend>
                {plans.map((p) => (
                  <label key={p.key} className={`flex cursor-pointer gap-3 rounded-lg border p-4 ${planKey === p.key ? "border-primary bg-primary-soft/40" : "border-border"}`}>
                    <input type="radio" name="plan" value={p.key} checked={planKey === p.key} onChange={() => setPlanKey(p.key)} className="mt-1" />
                    <span className="flex-1"><span className="font-medium">{p.name}</span> <span className="text-sm text-subtle">{p.priceAmount > 0 ? `${fmtMoney(p.priceAmount, p.currency)} / ${p.interval.toLowerCase()}` : "Price on request"}{p.trialDays ? ` · ${p.trialDays}-day free trial` : ""}</span>
                      <span className="block text-xs text-subtle">{p.entitlements.filter((e) => ["seats", "monthly_interview_credits", "trial_interview_credits"].includes(e.key)).map((e) => `${e.value} ${e.key.replace(/_/g, " ")}`).join(" · ")}</span></span>
                  </label>
                ))}
                <label className="flex gap-3 rounded-lg border border-border p-4"><input type="radio" name="plan" value="" checked={planKey === ""} onChange={() => setPlanKey("")} className="mt-1" /><span className="text-sm">Decide later</span></label>
              </fieldset>
            )}
            <p className="text-xs text-subtle">Trials start immediately without payment details. Paid plans are activated from Billing via secure hosted checkout.</p>
            <div className="flex justify-between"><Button variant="secondary" onClick={() => setStep(0)}>Back</Button><Button onClick={() => setStep(2)}>Continue</Button></div>
          </>
        )}
        {step === 2 && (
          <>
            <div className="max-h-56 overflow-y-auto rounded border border-border bg-muted/40 p-4 text-sm text-subtle">
              <p className="font-medium text-fg">Customer terms summary</p>
              <ul className="mt-2 list-disc space-y-1 pl-5">
                <li>You are the controller of candidate data you collect and responsible for lawful use of AI-assisted assessment in your jurisdictions.</li>
                <li>A human must make hiring decisions; AI outputs are decision support with evidence and uncertainty.</li>
                <li>Credits are consumed per the published billable-event rules.</li>
                <li>Our processing on your behalf is governed by the Data Processing Agreement.</li>
              </ul>
            </div>
            <Checkbox id="terms" checked={terms} onChange={(e) => setTerms(e.target.checked)} label={<>I accept the <a className="text-primary underline" target="_blank" href="/legal/terms">Terms of service</a> and Data Processing Agreement on behalf of {d.name || "my organisation"}</>} />
            <div className="flex justify-between"><Button variant="secondary" onClick={() => setStep(1)}>Back</Button><Button loading={busy} disabled={!terms} onClick={create}>Create workspace</Button></div>
          </>
        )}
        {step === 3 && slug && (
          <>
            <Alert tone="success" title="Workspace created">Default pipeline stages, a starter competency library and retention policies were set up for you.</Alert>
            <Field id="invites" label="Invite colleagues (optional)" hint="One email per line or comma-separated"><Textarea rows={4} value={invites} onChange={(e) => setInvites(e.target.value)} /></Field>
            <Field id="role" label="Role"><Select value={inviteRole} onChange={(e) => setInviteRole(e.target.value)}>
              {type === "UNIVERSITY" ? <><option value="PLACEMENT_ADMIN">Placement administrator</option><option value="PLACEMENT_OFFICER">Placement officer</option></> : <><option value="HR_ADMIN">HR admin</option><option value="RECRUITER">Recruiter</option><option value="HIRING_MANAGER">Hiring manager</option><option value="INTERVIEWER">Interview reviewer</option></>}
            </Select></Field>
            <div className="flex justify-between">
              <Button variant="secondary" onClick={() => setStep(4)}>Skip</Button>
              <Button loading={busy} onClick={async () => {
                const emails = invites.split(/[\s,;]+/).map((x) => x.trim()).filter(Boolean);
                if (!emails.length) return setStep(4);
                setBusy(true); setErr(null);
                try { await api("/memberships/invitations", { org: slug, body: { invites: emails.map((email) => ({ email, roleKey: inviteRole })) } }); setStep(4); }
                catch (e) { setErr(e instanceof ApiError ? e.message : "Invitations failed"); }
                finally { setBusy(false); }
              }}>Send invitations</Button>
            </div>
          </>
        )}
        {step === 4 && slug && (
          <>
            <Checkbox id="mfa" checked={prefs.requireMfa} onChange={(e) => setPrefs({ ...prefs, requireMfa: e.target.checked })} label="Require two-factor authentication for all members" description="Members without MFA will be asked to enable it before accessing the workspace." />
            <Field id="fb" label="Candidate feedback by default"><Select value={prefs.candidateFeedbackDefault} onChange={(e) => setPrefs({ ...prefs, candidateFeedbackDefault: e.target.value })}><option value="NONE">Don&apos;t share feedback unless we write and approve it</option><option value="APPROVED_ONLY">Encourage reviewers to draft feedback for approval</option></Select></Field>
            <div className="flex justify-end"><Button loading={busy} onClick={async () => {
              setBusy(true);
              try { await api("/organisations/current", { method: "PATCH", org: slug, body: { settings: prefs } }); } catch { /* preferences can be changed later in settings */ }
              window.location.href = `/w/${slug}`;
            }}>Go to dashboard</Button></div>
          </>
        )}
      </CardBody></Card>
    </div>
  );
}
