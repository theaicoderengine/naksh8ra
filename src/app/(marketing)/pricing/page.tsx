import { Check } from "lucide-react";
import { Hero, Section } from "@/components/marketing";
import { ButtonLink } from "@/components/ui/button";
import { Alert } from "@/components/ui/feedback";
import { listPublicPlans } from "@/server/services/billing";
import { fmtMoney } from "@/lib/format";

export const metadata = { title: "Pricing" };
export const dynamic = "force-dynamic";

const LABEL: Record<string, (v: string) => string | null> = {
  seats: (v) => `${v} team seats`,
  monthly_interview_credits: (v) => `${v} AI interview credits / month`,
  trial_interview_credits: (v) => `${v} trial interview credits`,
  "feature.realtime_interviews": (v) => (v === "true" ? "Real-time conversational interviews" : null),
  "feature.campus": (v) => (v === "true" ? "Campus hiring & programmes" : null),
  "feature.sso": (v) => (v === "true" ? "SSO (contact us)" : null),
};

export default async function Pricing() {
  const { plans, packs } = await listPublicPlans("EMPLOYER");
  return (
    <>
      <Hero eyebrow="Pricing" title="Simple plans, predictable credits" lead="Subscribe for seats and a monthly interview allowance; top up with credit packs. One credit = one employer-assigned AI interview that a candidate actually answers." />
      <Section>
        {plans.length === 0 ? (
          <Alert tone="info" title="Pricing is being configured">Plans are managed by the platform administrator. Contact sales for a quote.</Alert>
        ) : (
          <div className="grid gap-5 md:grid-cols-3">
            {plans.map((p, i) => (
              <div key={p.id} className={`flex flex-col rounded-xl border bg-surface p-6 ${i === 1 ? "border-primary shadow-pop" : "border-border"}`}>
                <p className="text-lg font-semibold">{p.name}</p>
                {p.description && <p className="mt-1 text-sm text-subtle">{p.description}</p>}
                <p className="mt-4 text-3xl font-semibold">{p.priceAmount > 0 ? fmtMoney(p.priceAmount, p.currency) : "Contact us"}<span className="text-sm font-normal text-subtle">{p.priceAmount > 0 ? ` / ${p.interval.toLowerCase()}` : ""}</span></p>
                {p.trialDays > 0 && <p className="mt-1 text-sm text-accent">{p.trialDays}-day trial</p>}
                <ul className="mt-5 flex-1 space-y-2 text-sm">
                  {p.entitlements.map((e) => LABEL[e.key]?.(e.value)).filter(Boolean).map((t) => (
                    <li key={t} className="flex gap-2"><Check className="h-4 w-4 shrink-0 text-success" aria-hidden="true" />{t}</li>
                  ))}
                </ul>
                <ButtonLink href={`/register/organisation?plan=${p.key}`} className="mt-6" variant={i === 1 ? "primary" : "secondary"}>Choose {p.name}</ButtonLink>
              </div>
            ))}
          </div>
        )}
        {packs.length > 0 && (
          <div className="mt-12">
            <h2 className="text-xl font-semibold">Credit packs</h2>
            <div className="mt-4 grid gap-4 sm:grid-cols-3">
              {packs.map((p) => (
                <div key={p.id} className="rounded-lg border border-border bg-surface p-4">
                  <p className="font-medium">{p.name}</p>
                  <p className="text-sm text-subtle">{p.priceAmount > 0 ? fmtMoney(p.priceAmount, p.currency) : "Price on request"}{p.expiresInDays ? ` · valid ${p.expiresInDays} days` : ""}</p>
                </div>
              ))}
            </div>
          </div>
        )}
        <div className="mt-12 grid gap-6 md:grid-cols-2">
          <div><h3 className="font-semibold">When is a credit used?</h3><p className="mt-1 text-sm text-subtle">A credit is reserved when you send an interview invitation and consumed only when the candidate submits at least one answer. Cancelled, withdrawn, unused-and-expired, and platform-failed interviews release the credit automatically.</p></div>
          <div><h3 className="font-semibold">Students</h3><p className="mt-1 text-sm text-subtle">Student profiles and applications are free. Practice interviews include a monthly free allowance; employer interviews never use a student&apos;s credits.</p></div>
        </div>
      </Section>
    </>
  );
}
