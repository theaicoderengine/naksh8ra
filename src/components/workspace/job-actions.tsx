"use client";
import { useState } from "react";
import { api } from "@/lib/api";
import { useAction } from "../use-action";
import { useOrg } from "./org-context";
import { Button, ButtonLink } from "../ui/button";
import { Dialog } from "../ui/dialog";
import { Checkbox } from "../ui/form";
import { Alert } from "../ui/feedback";

const ACTIONS: Record<string, { action: string; label: string; variant?: "primary" | "secondary" | "danger" }[]> = {
  DRAFT: [{ action: "publish", label: "Publish", variant: "primary" }, { action: "archive", label: "Archive", variant: "secondary" }],
  PUBLISHED: [{ action: "pause", label: "Pause", variant: "secondary" }, { action: "close", label: "Close", variant: "secondary" }],
  PAUSED: [{ action: "resume", label: "Resume", variant: "primary" }, { action: "close", label: "Close", variant: "secondary" }],
  CLOSED: [{ action: "reopen", label: "Reopen", variant: "secondary" }, { action: "archive", label: "Archive", variant: "secondary" }],
  ARCHIVED: [],
};

export function JobActions({ jobId, status, aiDraftPendingReview }: { jobId: string; status: string; aiDraftPendingReview: boolean }) {
  const org = useOrg();
  const [reviewOpen, setReviewOpen] = useState(false);
  const [reviewed, setReviewed] = useState(false);
  const act = useAction((action: string, confirmHumanReview?: boolean) => api(`/jobs/${jobId}/status`, { org: org.slug, body: { action, confirmHumanReview } }), { success: "Vacancy updated" });
  return (
    <div className="flex flex-wrap gap-2">
      {org.can("jobs.edit") && status !== "ARCHIVED" && <ButtonLink href={`/w/${org.slug}/jobs/${jobId}/edit`} variant="secondary">Edit</ButtonLink>}
      {org.can("jobs.publish") && ACTIONS[status]?.map((a) => (
        <Button key={a.action} variant={a.variant} loading={act.pending} onClick={() => ((a.action === "publish" || a.action === "reopen") && aiDraftPendingReview ? setReviewOpen(true) : act.run(a.action))}>{a.label}</Button>
      ))}
      <Dialog open={reviewOpen} onClose={() => setReviewOpen(false)} title="Confirm human review" description="This vacancy contains AI-drafted text." size="sm"
        footer={<><Button variant="secondary" onClick={() => setReviewOpen(false)}>Cancel</Button><Button disabled={!reviewed} loading={act.pending} onClick={async () => { await act.run("publish", true); setReviewOpen(false); }}>Publish</Button></>}>
        <Alert tone="warning">Check that requirements are genuinely job-related, the language is inclusive, and nothing was invented (salary, benefits, company facts).</Alert>
        <Checkbox id="reviewed" className="mt-4" checked={reviewed} onChange={(e) => setReviewed(e.target.checked)} label="I have reviewed and edited this vacancy and take responsibility for its content" />
      </Dialog>
    </div>
  );
}
