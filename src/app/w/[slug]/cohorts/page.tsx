import Link from "next/link";
import { requirePageOrg } from "@/server/auth/page";
import { listCohorts, listProgrammes } from "@/server/services/universities";
import { PageHeader } from "@/components/ui/card";
import { Table, Th, Td, Tr } from "@/components/ui/table";
import { EmptyState, PermissionDenied } from "@/components/ui/feedback";
import { NewCohort } from "@/components/university/forms";
import { fmtDate } from "@/lib/format";

export default async function Cohorts({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const ctx = await requirePageOrg(slug);
  if (ctx.org.type !== "UNIVERSITY" || !ctx.can("university.students.view")) return <PermissionDenied what="cohorts" />;
  const [cohorts, programmes] = await Promise.all([listCohorts(ctx), listProgrammes(ctx)]);
  return (
    <>
      <PageHeader title="Cohorts" description="Graduation batches of students. Students join by accepting your invitation." actions={<NewCohort programmes={programmes.map((p) => ({ id: p.id, name: p.name }))} />} />
      {cohorts.length === 0 ? <EmptyState title="No cohorts yet" description="Create a cohort, then import students by CSV." /> : (
        <Table caption="Cohorts"><thead><tr><Th>Cohort</Th><Th>Programme</Th><Th>Graduation</Th><Th className="text-right">Members</Th><Th>Created</Th></tr></thead><tbody>
          {cohorts.map((c) => <Tr key={c.id}><Td><Link className="font-medium hover:underline" href={`/w/${slug}/cohorts/${c.id}`}>{c.name}</Link></Td><Td>{c.programme?.name ?? "—"}</Td><Td>{c.graduationYear ?? "—"}</Td><Td className="text-right">{c._count.members}</Td><Td className="text-subtle">{fmtDate(c.createdAt)}</Td></Tr>)}
        </tbody></Table>
      )}
    </>
  );
}
