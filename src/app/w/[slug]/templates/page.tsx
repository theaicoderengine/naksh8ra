import Link from "next/link";
import { requirePageOrg } from "@/server/auth/page";
import { listTemplates } from "@/server/services/templates";
import { PageHeader } from "@/components/ui/card";
import { Table, Th, Td, Tr } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { EmptyState, PermissionDenied } from "@/components/ui/feedback";
import { ButtonLink } from "@/components/ui/button";
import { fmtDate } from "@/lib/format";

export default async function Templates({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const ctx = await requirePageOrg(slug);
  if (!ctx.can("interviews.configure")) return <PermissionDenied what="interview templates" />;
  const items = await listTemplates(ctx);
  const base = `/w/${slug}/templates`;
  return (
    <>
      <PageHeader title="Interview templates" description="Reusable interview configurations. Each invitation freezes the template version it was sent with." actions={<ButtonLink href={`${base}/new`}>New template</ButtonLink>} />
      {items.length === 0 ? <EmptyState title="No templates yet" description="Create a template to start sending AI interviews." action={<ButtonLink href={`${base}/new`}>New template</ButtonLink>} /> : (
        <Table caption="Templates">
          <thead><tr><Th>Name</Th><Th>Mode</Th><Th>Questions</Th><Th>Duration</Th><Th>Competencies</Th><Th>Version</Th><Th>Updated</Th></tr></thead>
          <tbody>{items.map((t) => (
            <Tr key={t.id}>
              <Td><Link className="font-medium hover:underline" href={`${base}/${t.id}`}>{t.name}</Link></Td>
              <Td><Badge tone={t.mode === "REALTIME_CONVERSATIONAL" ? "accent" : "primary"}>{t.mode === "REALTIME_CONVERSATIONAL" ? "Conversational" : "Structured"}</Badge></Td>
              <Td>{t._count.questions}/{t.questionCount}{t.questionSelection === "ADAPTIVE" && <span className="text-xs text-subtle"> adaptive</span>}</Td>
              <Td>{t.durationMinutes} min</Td>
              <Td className="text-subtle">{t.competencies.map((c) => c.competency.name).join(", ")}</Td>
              <Td>v{t.version}</Td>
              <Td className="text-subtle">{fmtDate(t.updatedAt)}</Td>
            </Tr>))}</tbody>
        </Table>
      )}
    </>
  );
}
