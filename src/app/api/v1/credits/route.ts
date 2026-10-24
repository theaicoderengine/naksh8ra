import { route } from "@/server/http/route";
import { withOrg } from "@/server/db/tenant";
import { balance } from "@/server/billing/credits";

export const GET = route({ auth: "org", permission: "billing.view" }, async ({ org }) =>
  withOrg(org.org.id, org.userId, async (tx) => {
    const b = await balance(tx, { organisationId: org.org.id });
    const entries = await tx.creditLedgerEntry.findMany({ where: { accountId: b.accountId }, orderBy: { createdAt: "desc" }, take: 200 });
    return { available: b.available, reserved: b.reserved, entries };
  }),
);
