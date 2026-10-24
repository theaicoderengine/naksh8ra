import { requirePageSession } from "@/server/auth/page";
import { currentSession } from "@/server/auth/session";
import { prisma } from "@/server/db/client";
import { redirect } from "next/navigation";
import { PageHeader, Card, CardHeader, CardBody } from "@/components/ui/card";
import { PasswordForm, MfaSetup, Sessions } from "@/components/account/forms";

export default async function Security({ searchParams }: { searchParams: Promise<{ mfa?: string }> }) {
  const { mfa } = await searchParams;
  // Users who must enrol in MFA can reach this page before completing an MFA challenge.
  const s = (await currentSession()) ?? (await requirePageSession());
  if (s.user.mfaEnabledAt && !s.mfaVerified) redirect("/login/mfa?next=/account/security");
  const sessions = await prisma.session.findMany({ where: { userId: s.user.id, revokedAt: null, expiresAt: { gt: new Date() } }, orderBy: { lastSeenAt: "desc" }, select: { id: true, ipAddress: true, userAgent: true, createdAt: true, lastSeenAt: true } });
  return (
    <>
      <PageHeader title="Security" />
      <div className="space-y-6">
        <Card><CardHeader title="Two-factor authentication" description="Required for platform administrators; your organisation may also require it." /><CardBody><MfaSetup enabled={!!s.user.mfaEnabledAt} required={mfa === "required"} /></CardBody></Card>
        <Card><CardHeader title="Password" /><CardBody><PasswordForm /></CardBody></Card>
        <Card><CardHeader title="Active sessions" /><CardBody className="p-0"><Sessions items={JSON.parse(JSON.stringify(sessions.map((x) => ({ ...x, current: x.id === s.id }))))} /></CardBody></Card>
      </div>
    </>
  );
}
