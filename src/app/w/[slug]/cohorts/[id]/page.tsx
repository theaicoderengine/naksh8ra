import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePageOrg } from "@/server/auth/page";
import { cohortMembers, listCohorts } from "@/server/services/universities";
import { PageHeader, Card, CardHeader, CardBody } from "@/components/ui/card";
import { Table, Th, Td, Tr } from "@/components/ui/table";
import { StatusBadge, Badge } from "@/components/ui/badge";
import { PermissionDenied, EmptyState } from "@/components/ui/feedback";
import { ImportStudents, RemoveMember } from "@/components/university/forms";

export default async function Cohort({ params }: { params: Promise<{ slug: string; id: string }> }) {
  const { slug, id } = await params;
  const ctx = await requirePageOrg(slug);
  if (ctx.org.type !== "UNIVERSITY" || !ctx.can("university.students.view")) return <PermissionDenied what="cohorts" />;
  const cohort = (await listCohorts(ctx)).find((c) => c.id === id);
  if (!cohort) notFound();
  const members = await cohortMembers(ctx, id);
  return (
    <>
      <PageHeader breadcrumb={<Link className="hover:underline" href={`/w/${slug}/cohorts`}>Cohorts</Link>} title={cohort.name} description={`${cohort.programme?.name ?? "No programme"}${cohort.graduationYear ? ` · graduating ${cohort.graduationYear}` : ""}`} />
      <div className="grid gap-6 lg:grid-cols-[1fr_380px]">
        <div>
          {members.length === 0 ? <EmptyState title="No students invited" description="Import students using the form." /> : (
            <Table caption="Cohort members"><thead><tr><Th>Student</Th><Th>Status</Th><Th>Degree / year</Th><Th>Applications</Th><Th /></tr></thead><tbody>
              {members.map((m) => (
                <Tr key={m.id}>
                  <Td>{"name" in m && m.name ? <p className="font-medium">{m.name}</p> : null}<p className="text-xs text-subtle">{m.email}{m.studentNumber ? ` · ${m.studentNumber}` : ""}</p></Td>
                  <Td><StatusBadge status={m.status} label={m.consented ? "Joined" : m.status.toLowerCase()} /></Td>
                  <Td className="text-subtle">{"degree" in m ? `${m.degree ?? "—"} · ${m.graduationYear ?? "—"}` : "Visible after the student joins"}</Td>
                  <Td>{"applications" in m && m.applications ? <div className="flex flex-wrap gap-1">{Object.entries(m.applications as Record<string, number>).map(([s, n]) => <Badge key={s}>{s.replace("_", " ").toLowerCase()}: {n}</Badge>)}{Object.keys(m.applications as object).length === 0 && <span className="text-xs text-subtle">None yet</span>}</div> : <span className="text-xs text-subtle">—</span>}</Td>
                  <Td className="text-right"><RemoveMember id={m.id} /></Td>
                </Tr>
              ))}
            </tbody></Table>
          )}
          <p className="mt-3 text-xs text-subtle">You see application counts by status only — never employer names, interview recordings, transcripts, assessments or HR decisions.</p>
        </div>
        <Card><CardHeader title="Invite students" /><CardBody><ImportStudents cohortId={id} /></CardBody></Card>
      </div>
    </>
  );
}
