import { notFound } from "next/navigation";
import { prisma } from "@/server/db/client";
import { env } from "@/server/env";
import { fmtDateTime } from "@/lib/format";

export const dynamic = "force-dynamic";

/** Development-only mailbox for the console email provider. Disabled in staging/production. */
export default async function Mailbox() {
  if (env().APP_ENV === "production" || env().APP_ENV === "staging" || env().EMAIL_PROVIDER !== "console") notFound();
  const mails = await prisma.emailDelivery.findMany({ orderBy: { createdAt: "desc" }, take: 50 });
  return (
    <main id="main" className="mx-auto max-w-4xl px-4 py-8">
      <h1 className="text-2xl font-semibold">Dev mailbox</h1>
      <p className="mb-6 text-sm text-subtle">Emails captured by the console provider (development only).</p>
      <ul className="space-y-4">{mails.map((m) => (
        <li key={m.id} className="rounded-lg border border-border bg-surface p-4">
          <p className="text-sm font-medium">{m.subject}</p>
          <p className="text-xs text-subtle">To {m.toAddress} · {m.template} · {m.status} · {fmtDateTime(m.createdAt)}</p>
          {m.bodyText && <pre className="mt-3 whitespace-pre-wrap break-all text-xs">{(() => { try { return (JSON.parse(m.bodyText) as { text: string }).text; } catch { return m.bodyText; } })()}</pre>}
        </li>
      ))}</ul>
    </main>
  );
}
