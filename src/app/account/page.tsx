import { requirePageSession } from "@/server/auth/page";
import { PageHeader, Card, CardHeader, CardBody } from "@/components/ui/card";
import { NameForm } from "@/components/account/forms";

export default async function Account() {
  const s = await requirePageSession();
  return (<><PageHeader title="Your account" description={s.user.email} /><Card><CardHeader title="Name" /><CardBody><NameForm first={s.user.firstName ?? ""} last={s.user.lastName ?? ""} /></CardBody></Card></>);
}
