import { requirePageOrg } from "@/server/auth/page";
import { listCompetencies } from "@/server/services/templates";
import { PageHeader, Card, CardHeader, CardBody } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { PermissionDenied, Alert } from "@/components/ui/feedback";
import { CompetencyEditor, emptyCompetency } from "@/components/workspace/competency-editor";

type Levels = { rating: string; label: string; descriptor: string }[];

export default async function Competencies({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const ctx = await requirePageOrg(slug);
  if (!ctx.can("interviews.configure")) return <PermissionDenied what="competencies" />;
  const items = await listCompetencies(ctx);
  return (
    <>
      <PageHeader title="Competencies & rubrics" description="Job-related competencies with observable criteria. Rubrics are versioned so every assessment can be traced to the exact rubric used." actions={<CompetencyEditor initial={emptyCompetency} trigger="New competency" />} />
      <Alert className="mb-6" tone="info">The starter library is a template. Validate competencies against the actual requirements of each role, and audit outcomes for adverse impact before relying on AI-assisted ratings.</Alert>
      <div className="grid gap-4 lg:grid-cols-2">
        {items.map((c) => {
          const r = c.rubrics[0];
          const ind = (r?.indicators ?? { positive: [], negative: [] }) as { positive: string[]; negative: string[] };
          return (
            <Card key={c.id}>
              <CardHeader title={c.name} description={c.description} actions={<><Badge>{c.category.toLowerCase()}</Badge><Badge tone="primary">rubric v{r?.version}</Badge><CompetencyEditor trigger="Edit" initial={{ id: c.id, key: c.key, name: c.name, description: c.description, category: c.category, criteria: r?.criteria.join("\n") ?? "", positive: ind.positive.join("\n"), negative: ind.negative.join("\n"), levels: (r?.levels as Levels) ?? emptyCompetency.levels, evidenceRequirements: r?.evidenceRequirements ?? "", scoringGuidance: r?.scoringGuidance ?? "" }} /></>} />
              <CardBody className="space-y-3 text-sm">
                <div><p className="font-medium">Criteria</p><ul className="list-disc pl-5 text-subtle">{r?.criteria.map((x) => <li key={x}>{x}</li>)}</ul></div>
                <details><summary className="cursor-pointer font-medium">Rating scale</summary><ol className="mt-2 space-y-1">{((r?.levels as Levels) ?? []).map((l) => <li key={l.rating}><strong>{l.rating.slice(1)} · {l.label}</strong> — <span className="text-subtle">{l.descriptor}</span></li>)}</ol></details>
              </CardBody>
            </Card>
          );
        })}
      </div>
    </>
  );
}
