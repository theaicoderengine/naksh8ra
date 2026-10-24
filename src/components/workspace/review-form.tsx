"use client";
import { useState } from "react";
import { api } from "@/lib/api";
import { useAction } from "../use-action";
import { useOrg } from "./org-context";
import { Button } from "../ui/button";
import { Select, Textarea, Field } from "../ui/form";
import { RATING_LABEL } from "@/lib/format";

export function ReviewForm({ sessionId, results }: { sessionId: string; results: { competencyId: string; name: string; rating: string }[] }) {
  const org = useOrg();
  const [decision, setDecision] = useState("CONFIRMED");
  const [notes, setNotes] = useState("");
  const [ov, setOv] = useState<Record<string, { rating: string; reason: string }>>({});
  const submit = useAction(
    () => api(`/assessments/${sessionId}/review`, { org: org.slug, body: { decision, notes: notes || undefined, overrides: decision === "ADJUSTED" ? Object.entries(ov).filter(([, v]) => v.rating).map(([competencyId, v]) => ({ competencyId, ...v })) : [] } }),
    { success: "Review recorded" },
  );
  if (!org.can("assessments.review")) return <p className="text-sm text-subtle">You don&apos;t have permission to review assessments.</p>;
  const adjustedValid = decision !== "ADJUSTED" || (Object.values(ov).some((v) => v.rating) && Object.values(ov).filter((v) => v.rating).every((v) => v.reason.trim().length >= 5));
  return (
    <div className="space-y-4">
      <Field id="decision" label="Your decision on the AI output">
        <Select value={decision} onChange={(e) => setDecision(e.target.value)}>
          <option value="CONFIRMED">Confirm — ratings match the evidence</option>
          <option value="ADJUSTED">Adjust — change specific ratings (reason required)</option>
          <option value="REJECTED_AI_OUTPUT">Reject AI output — I will assess manually</option>
        </Select>
      </Field>
      {decision === "ADJUSTED" && results.map((r) => (
        <div key={r.competencyId} className="rounded-lg border border-border p-3">
          <p className="text-sm font-medium">{r.name} <span className="font-normal text-subtle">· AI: {RATING_LABEL[r.rating]}</span></p>
          <div className="mt-2 grid gap-2 sm:grid-cols-[200px_1fr]">
            <Select aria-label={`Adjusted rating for ${r.name}`} value={ov[r.competencyId]?.rating ?? ""} onChange={(e) => setOv({ ...ov, [r.competencyId]: { rating: e.target.value, reason: ov[r.competencyId]?.reason ?? "" } })}><option value="">Keep AI rating</option>{Object.entries(RATING_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</Select>
            <Textarea aria-label={`Reason for ${r.name}`} rows={1} className="min-h-[40px]" placeholder="Reason, citing the evidence" value={ov[r.competencyId]?.reason ?? ""} onChange={(e) => setOv({ ...ov, [r.competencyId]: { rating: ov[r.competencyId]?.rating ?? "", reason: e.target.value } })} />
          </div>
        </div>
      ))}
      <Field id="notes" label={decision === "REJECTED_AI_OUTPUT" ? "Why was the AI output rejected? (required)" : "Notes (optional)"}><Textarea value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
      <Button loading={submit.pending} disabled={!adjustedValid || (decision === "REJECTED_AI_OUTPUT" && notes.trim().length < 5)} onClick={() => submit.run()}>Record review</Button>
    </div>
  );
}

export function RetryAssessment({ sessionId }: { sessionId: string }) {
  const org = useOrg();
  const r = useAction(() => api(`/assessments/${sessionId}/retry`, { org: org.slug, method: "POST" }), { success: "Assessment re-queued" });
  if (!org.can("assessments.review")) return null;
  return <Button variant="secondary" loading={r.pending} onClick={() => r.run()}>Retry assessment</Button>;
}
