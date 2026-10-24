import { requireVerifiedPage } from "@/server/auth/page";
import { getNotificationPrefs, listMyAccommodations, listCohortInvites } from "@/server/services/students";
import { listMyDataRequests } from "@/server/services/privacy";
import { PageHeader, Card, CardHeader, CardBody } from "@/components/ui/card";
import { NotificationPrefs, PrivacyControls, AccommodationForm } from "@/components/student/settings";
import { CohortInvites } from "@/components/student/cohort-invites";
import { ButtonLink } from "@/components/ui/button";

export default async function StudentSettings() {
  const s = await requireVerifiedPage();
  const [prefs, acc, cohorts, dsr] = await Promise.all([getNotificationPrefs(s.user.id), listMyAccommodations(s.user.id), listCohortInvites(s.user.id), listMyDataRequests(s.user.id)]);
  return (
    <>
      <PageHeader title="Settings" actions={<ButtonLink variant="secondary" href="/account/security">Password & security</ButtonLink>} />
      <div className="grid gap-6 lg:grid-cols-2">
        <Card><CardHeader title="Notifications" /><CardBody><NotificationPrefs prefs={prefs} /></CardBody></Card>
        <Card id="cohorts"><CardHeader title="University cohorts" /><CardBody><CohortInvites items={cohorts} /></CardBody></Card>
        <Card><CardHeader title="Accessibility & accommodations" /><CardBody><AccommodationForm items={JSON.parse(JSON.stringify(acc))} /></CardBody></Card>
        <Card><CardHeader title="Privacy" description="Export or delete your personal data." /><CardBody><PrivacyControls requests={JSON.parse(JSON.stringify(dsr))} /></CardBody></Card>
      </div>
    </>
  );
}
