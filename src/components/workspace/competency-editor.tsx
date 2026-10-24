"use client";
import { useState } from "react";
import { api } from "@/lib/api";
import { useAction } from "../use-action";
import { useOrg } from "./org-context";
import { Button } from "../ui/button";
import { Dialog } from "../ui/dialog";
import { Field, Input, Select, Textarea } from "../ui/form";
import { Alert } from "../ui/feedback";

type Level = { rating: string; label: string; descriptor: string };
export type CompetencyValue = { id?: string; key: string; name: string; description: string; category: string; criteria: string; positive: string; negative: string; levels: Level[]; evidenceRequirements: string; scoringGuidance: string };

const DEFAULT_LEVELS: Level[] = ["Limited", "Developing", "Competent", "Strong", "Exceptional"].map((label, i) => ({ rating: `R${i + 1}`, label, descriptor: "" }));
export const emptyCompetency: CompetencyValue = { key: "", name: "", description: "", category: "GENERAL", criteria: "", positive: "", negative: "", levels: DEFAULT_LEVELS, evidenceRequirements: "", scoringGuidance: "Assess observable answer content only. Do not consider accent, tone, pace or any protected characteristic." };

export function CompetencyEditor({ initial, trigger }: { initial: CompetencyValue; trigger: string }) {
  const org = useOrg();
  const [open, setOpen] = useState(false);
  const [v, setV] = useState(initial);
  const lines = (s: string) => s.split("\n").map((x) => x.trim()).filter(Boolean);
  const save = useAction(
    () => {
      const body = { key: v.key, name: v.name, description: v.description, category: v.category, rubric: { criteria: lines(v.criteria), indicators: { positive: lines(v.positive), negative: lines(v.negative) }, levels: v.levels, evidenceRequirements: v.evidenceRequirements, scoringGuidance: v.scoringGuidance } };
      return v.id ? api(`/competencies/${v.id}`, { method: "PATCH", org: org.slug, body }) : api("/competencies", { org: org.slug, body });
    },
    { success: "Competency saved", onSuccess: () => setOpen(false) },
  );
  if (!org.can("interviews.configure")) return null;
  return (
    <>
      <Button variant={v.id ? "secondary" : "primary"} size={v.id ? "sm" : "md"} onClick={() => setOpen(true)}>{trigger}</Button>
      <Dialog open={open} onClose={() => setOpen(false)} title={v.id ? `Edit ${initial.name}` : "New competency"} size="lg" description={v.id ? "Changing the rubric creates a new version. Existing assessments keep the version they used." : undefined}
        footer={<><Button variant="secondary" onClick={() => setOpen(false)}>Cancel</Button><Button loading={save.pending} onClick={() => save.run()}>Save</Button></>}>
        <div className="space-y-4">
          {save.error && <Alert tone="danger">{save.error.message}{Object.keys(save.fieldErrors).length ? `: ${Object.entries(save.fieldErrors).map(([k, m]) => `${k} — ${m}`).join("; ")}` : ""}</Alert>}
          <div className="grid gap-3 sm:grid-cols-3">
            <Field id="cname" label="Name"><Input value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} /></Field>
            <Field id="ckey" label="Key" hint="lowercase_with_underscores"><Input value={v.key} disabled={!!v.id} onChange={(e) => setV({ ...v, key: e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, "_") })} /></Field>
            <Field id="ccat" label="Category"><Select value={v.category} onChange={(e) => setV({ ...v, category: e.target.value })}><option value="GENERAL">General</option><option value="BEHAVIOURAL">Behavioural</option><option value="TECHNICAL">Technical</option></Select></Field>
          </div>
          <Field id="cdesc" label="Description"><Textarea rows={2} value={v.description} onChange={(e) => setV({ ...v, description: e.target.value })} /></Field>
          <Field id="ccrit" label="Observable assessment criteria" hint="One per line"><Textarea rows={3} value={v.criteria} onChange={(e) => setV({ ...v, criteria: e.target.value })} /></Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field id="cpos" label="Positive indicators" hint="One per line"><Textarea rows={3} value={v.positive} onChange={(e) => setV({ ...v, positive: e.target.value })} /></Field>
            <Field id="cneg" label="Negative indicators" hint="One per line"><Textarea rows={3} value={v.negative} onChange={(e) => setV({ ...v, negative: e.target.value })} /></Field>
          </div>
          <fieldset className="space-y-2"><legend className="text-sm font-medium">Rating scale</legend>
            {v.levels.map((l, i) => (
              <div key={l.rating} className="grid gap-2 sm:grid-cols-[60px_140px_1fr]">
                <span className="pt-2 text-sm font-medium">{l.rating.slice(1)}</span>
                <Input aria-label={`Level ${i + 1} label`} value={l.label} onChange={(e) => setV({ ...v, levels: v.levels.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)) })} />
                <Input aria-label={`Level ${i + 1} descriptor`} placeholder="Observable descriptor" value={l.descriptor} onChange={(e) => setV({ ...v, levels: v.levels.map((x, j) => (j === i ? { ...x, descriptor: e.target.value } : x)) })} />
              </div>
            ))}
          </fieldset>
          <Field id="cevid" label="Evidence requirements"><Textarea rows={2} value={v.evidenceRequirements} onChange={(e) => setV({ ...v, evidenceRequirements: e.target.value })} /></Field>
          <Field id="cguide" label="Scoring guidance"><Textarea rows={2} value={v.scoringGuidance} onChange={(e) => setV({ ...v, scoringGuidance: e.target.value })} /></Field>
        </div>
      </Dialog>
    </>
  );
}
