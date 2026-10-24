import { requireVerifiedPage } from "@/server/auth/page";
import { listResumes } from "@/server/services/resumes";
import { PageHeader } from "@/components/ui/card";
import { ResumeList } from "@/components/student/resume-list";

export default async function Resumes() {
  const s = await requireVerifiedPage();
  const items = await listResumes(s.user.id);
  return (<><PageHeader title="Resumes" description="Keep up to 10 versions. Extracted details are flagged when uncertain — correct anything we got wrong." /><ResumeList items={JSON.parse(JSON.stringify(items))} /></>);
}
