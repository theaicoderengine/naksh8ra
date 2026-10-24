import { requirePlatformPage } from "@/server/auth/page";
import { listPlatformAdmins } from "@/server/services/platform";
import { PLATFORM_ROLES } from "@/server/rbac/permissions";
import { PageHeader, Card, CardHeader, CardBody } from "@/components/ui/card";
import { Table, Th, Td, Tr } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { SetAdminRole } from "@/components/admin/admins";
import { fmtRelative } from "@/lib/format";

export default async function Admins() {
  await requirePlatformPage("platform.admins.manage");
  const admins = await listPlatformAdmins();
  return (
    <>
      <PageHeader title="Platform administrators" />
      <Card className="mb-6"><CardHeader title="Grant or change a platform role" /><CardBody><SetAdminRole /></CardBody></Card>
      <Table caption="Administrators"><thead><tr><Th>User</Th><Th>Role</Th><Th>Permissions</Th><Th>MFA</Th><Th>Last sign-in</Th></tr></thead><tbody>
        {admins.map((a) => <Tr key={a.id}><Td>{a.email}</Td><Td><Badge tone="warning">{a.platformRole.toLowerCase()}</Badge></Td><Td className="max-w-md text-xs text-subtle">{PLATFORM_ROLES[a.platformRole]?.join(", ")}</Td><Td>{a.mfaEnabledAt ? <Badge tone="success">on</Badge> : <Badge tone="danger">off</Badge>}</Td><Td className="text-subtle">{fmtRelative(a.lastLoginAt)}</Td></Tr>)}
      </tbody></Table>
    </>
  );
}
