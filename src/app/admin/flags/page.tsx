import { requirePlatformPage } from "@/server/auth/page";
import { prisma } from "@/server/db/client";
import { PageHeader, Card, CardHeader, CardBody } from "@/components/ui/card";
import { Flags, Settings } from "@/components/admin/flags";

export default async function FlagsPage() {
  await requirePlatformPage("platform.flags.manage");
  const [flags, settings] = await Promise.all([prisma.featureFlag.findMany({ orderBy: { key: "asc" } }), prisma.platformSetting.findMany()]);
  const get = (k: string) => settings.find((s) => s.key === k)?.value;
  return (
    <>
      <PageHeader title="Feature flags & settings" />
      <div className="grid gap-6 lg:grid-cols-2">
        <Card><CardHeader title="Feature flags" /><CardBody><Flags flags={JSON.parse(JSON.stringify(flags))} /></CardBody></Card>
        <Card><CardHeader title="Platform settings" /><CardBody><Settings practiceFree={typeof get("practice.freeMonthly") === "number" ? (get("practice.freeMonthly") as number) : 3} announcement={(get("platform.announcement") as string) ?? ""} /></CardBody></Card>
      </div>
    </>
  );
}
