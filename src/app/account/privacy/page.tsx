import { requirePageSession } from "@/server/auth/page";
import { listMyDataRequests } from "@/server/services/privacy";
import { prisma } from "@/server/db/client";
import { PageHeader, Card, CardHeader, CardBody } from "@/components/ui/card";
import { PrivacyControls } from "@/components/student/settings";
import { fmtDate } from "@/lib/format";

export default async function AccountPrivacy() {
  const s = await requirePageSession();
  const [dsr, consents] = await Promise.all([listMyDataRequests(s.user.id), prisma.consentRecord.findMany({ where: { userId: s.user.id }, orderBy: { createdAt: "desc" }, take: 50 })]);
  return (
    <>
      <PageHeader title="Privacy" />
      <div className="space-y-6">
        <Card><CardHeader title="Your data" description="Download everything held in your personal account, or delete your account." /><CardBody><PrivacyControls requests={JSON.parse(JSON.stringify(dsr))} /></CardBody></Card>
        <Card><CardHeader title="Consent history" /><CardBody><ul className="space-y-1 text-sm">{consents.map((c) => <li key={c.id}>{fmtDate(c.createdAt)} — {c.type.replace(/_/g, " ").toLowerCase()}: <strong>{c.granted ? "given" : "declined"}</strong> <span className="text-xs text-subtle">({c.noticeVersion})</span></li>)}</ul></CardBody></Card>
      </div>
    </>
  );
}
