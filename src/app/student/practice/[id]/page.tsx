import Link from "next/link";
import { notFound } from "next/navigation";
import { requireVerifiedPage } from "@/server/auth/page";
import { getPractice } from "@/server/services/practice";
import { PageHeader } from "@/components/ui/card";
import { StatusBadge } from "@/components/ui/badge";
import { PracticeRoom } from "@/components/student/practice";

export default async function PracticeSession({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const s = await requireVerifiedPage();
  const p = await getPractice(s.user.id, id).catch(() => notFound());
  return (
    <>
      <PageHeader breadcrumb={<Link className="hover:underline" href="/student/practice">Practice</Link>} title={p.targetRole} actions={<StatusBadge status={p.status} />} />
      <PracticeRoom p={JSON.parse(JSON.stringify(p))} />
    </>
  );
}
