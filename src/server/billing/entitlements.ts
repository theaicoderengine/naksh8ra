import { prisma } from "../db/client";
import { withOrg } from "../db/tenant";

export type Entitlements = {
  planKey: string | null;
  planName: string | null;
  status: string | null;
  seats: number;
  monthlyInterviewCredits: number;
  features: Set<string>;
  raw: Record<string, string>;
};

/** Baseline when an organisation has no active subscription (configurable via PlatformSetting "entitlements.default"). */
const FALLBACK: Record<string, string> = { seats: "2", monthly_interview_credits: "0" };

const ACTIVE = ["TRIALING", "ACTIVE", "PAST_DUE"] as const;

export async function getEntitlements(organisationId: string): Promise<Entitlements> {
  const sub = await withOrg(organisationId, null, (tx) =>
    tx.subscription.findFirst({
      where: { organisationId, status: { in: [...ACTIVE] } },
      orderBy: { createdAt: "desc" },
      include: { plan: { include: { entitlements: true } } },
    }),
  );
  let raw: Record<string, string>;
  if (sub) {
    raw = Object.fromEntries(sub.plan.entitlements.map((e) => [e.key, e.value]));
  } else {
    const setting = await prisma.platformSetting.findUnique({ where: { key: "entitlements.default" } });
    raw = (setting?.value as Record<string, string>) ?? FALLBACK;
  }
  const features = new Set(Object.entries(raw).filter(([k, v]) => k.startsWith("feature.") && v === "true").map(([k]) => k.slice(8)));
  return {
    planKey: sub?.plan.key ?? null,
    planName: sub?.plan.name ?? null,
    status: sub?.status ?? null,
    seats: Number(raw.seats ?? FALLBACK.seats),
    monthlyInterviewCredits: Number(raw.monthly_interview_credits ?? 0),
    features,
    raw,
  };
}

export async function seatsUsed(organisationId: string) {
  const [members, pending] = await Promise.all([
    prisma.organisationMembership.count({ where: { organisationId, status: "ACTIVE" } }),
    prisma.invitation.count({ where: { organisationId, status: "PENDING", expiresAt: { gt: new Date() } } }),
  ]);
  return members + pending;
}
