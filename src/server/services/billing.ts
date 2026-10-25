import Stripe from "stripe";
import { z } from "zod";
import type { Prisma, SubscriptionStatus } from "@prisma/client";
import { prisma } from "../db/client";
import { withOrg, withSystem, type Tx } from "../db/tenant";
import { AppError, badRequest, notFound } from "../errors";
import { audit } from "../audit";
import type { OrgContext } from "../auth/context";
import type { SessionInfo } from "../auth/session";
import { env } from "../env";
import { grant, refundCredits, reconcile, balance, expireGrants } from "../billing/credits";
import { getEntitlements, seatsUsed } from "../billing/entitlements";
import { sendEmail } from "./notifications";
import { logger } from "../logger";

/**
 * Payments use Stripe hosted Checkout + Billing Portal: card data never
 * touches our servers. Webhooks are signature-verified, stored once per
 * provider event id (unique constraint) and processed idempotently; every
 * credit grant carries an idempotency key derived from the provider object.
 */
let stripeClient: Stripe | null = null;
export function stripe(): Stripe {
  if (stripeClient) return stripeClient;
  const e = env();
  if (e.PAYMENT_PROVIDER !== "stripe" || !e.STRIPE_SECRET_KEY) throw new AppError("PROVIDER_NOT_CONFIGURED", "Payments are not configured on this deployment (set PAYMENT_PROVIDER=stripe and STRIPE_SECRET_KEY)");
  stripeClient = new Stripe(e.STRIPE_SECRET_KEY, { maxNetworkRetries: 2, timeout: 20_000 });
  return stripeClient;
}

/** Stripe instance usable for signature verification even without a secret key (verification is offline). */
function verifier(): Stripe {
  return stripeClient ?? new Stripe(env().STRIPE_SECRET_KEY ?? "unused-placeholder-signature-verification-only");
}

export function formatMoney(amountMinor: number, currency: string) {
  return new Intl.NumberFormat("en", { style: "currency", currency: currency.toUpperCase() }).format(amountMinor / 100);
}

export async function listPublicPlans(audience: "EMPLOYER" | "UNIVERSITY" | "STUDENT" = "EMPLOYER") {
  const [plans, packs] = await Promise.all([
    prisma.plan.findMany({ where: { isActive: true, isPublic: true, audience }, include: { entitlements: true }, orderBy: { sortOrder: "asc" } }),
    prisma.creditPack.findMany({ where: { isActive: true, audience: audience === "STUDENT" ? "STUDENT" : "EMPLOYER" }, orderBy: { credits: "asc" } }),
  ]);
  return { plans, packs };
}

export async function billingOverview(ctx: OrgContext) {
  ctx.assert("billing.view");
  const [ent, seats, data] = await Promise.all([
    getEntitlements(ctx.org.id),
    seatsUsed(ctx.org.id),
    withOrg(ctx.org.id, ctx.userId, async (tx) => {
      const sub = await tx.subscription.findFirst({ where: { organisationId: ctx.org.id }, orderBy: { createdAt: "desc" }, include: { plan: true } });
      const bal = await balance(tx, { organisationId: ctx.org.id });
      const ledger = await tx.creditLedgerEntry.findMany({ where: { accountId: bal.accountId }, orderBy: { createdAt: "desc" }, take: 50 });
      return { sub, bal, ledger };
    }),
  ]);
  const [invoices, usage] = await Promise.all([
    prisma.invoice.findMany({ where: { organisationId: ctx.org.id }, orderBy: { createdAt: "desc" }, take: 24 }),
    prisma.usageRecord.groupBy({ by: ["kind"], where: { organisationId: ctx.org.id, createdAt: { gte: new Date(Date.now() - 30 * 86400_000) } }, _sum: { units: true } }),
  ]);
  const consumed30d = data.ledger.filter((l) => l.type === "CONSUME" && l.createdAt > new Date(Date.now() - 30 * 86400_000)).length;
  return {
    subscription: data.sub,
    entitlements: { ...ent, features: [...ent.features] },
    seats: { used: seats, limit: ent.seats },
    credits: { available: data.bal.available, reserved: data.bal.reserved, consumedLast30Days: consumed30d },
    ledger: data.ledger,
    invoices,
    usage,
    paymentsConfigured: env().PAYMENT_PROVIDER === "stripe" && !!env().STRIPE_SECRET_KEY,
  };
}

async function ensureCustomer(orgId: string) {
  const org = await prisma.organisation.findUniqueOrThrow({ where: { id: orgId } });
  if (org.stripeCustomerId) return org.stripeCustomerId;
  const customer = await stripe().customers.create(
    { name: org.legalName ?? org.name, email: org.billingEmail ?? undefined, metadata: { organisationId: org.id } },
    { idempotencyKey: `customer:${org.id}` },
  );
  await prisma.organisation.update({ where: { id: org.id }, data: { stripeCustomerId: customer.id } });
  return customer.id;
}

export const checkoutSchema = z.object({ planKey: z.string().max(60).optional(), packKey: z.string().max(60).optional() }).refine((v) => !!v.planKey !== !!v.packKey, "Provide exactly one of planKey or packKey");

export async function createCheckout(ctx: OrgContext, input: z.infer<typeof checkoutSchema>) {
  ctx.assert("billing.manage");
  const customer = await ensureCustomer(ctx.org.id);
  const base = `${env().APP_URL}/w/${ctx.org.slug}/billing`;
  if (input.planKey) {
    const plan = await prisma.plan.findFirst({ where: { key: input.planKey, isActive: true } });
    if (!plan?.stripePriceId) throw notFound("Plan");
    const active = await withOrg(ctx.org.id, ctx.userId, (tx) => tx.subscription.findFirst({ where: { organisationId: ctx.org.id, provider: "stripe", status: { in: ["ACTIVE", "TRIALING", "PAST_DUE"] } } }));
    if (active) throw badRequest("You already have an active subscription. Use 'Manage billing' to change plans.");
    const s = await stripe().checkout.sessions.create({
      mode: "subscription",
      customer,
      line_items: [{ price: plan.stripePriceId, quantity: 1 }],
      success_url: `${base}?checkout=success`,
      cancel_url: `${base}?checkout=cancelled`,
      client_reference_id: ctx.org.id,
      metadata: { organisationId: ctx.org.id, kind: "SUBSCRIPTION", planId: plan.id },
      subscription_data: { metadata: { organisationId: ctx.org.id, planId: plan.id }, ...(plan.trialDays ? { trial_period_days: plan.trialDays } : {}) },
      automatic_tax: { enabled: process.env.STRIPE_AUTOMATIC_TAX === "true" },
      tax_id_collection: { enabled: true },
      customer_update: { address: "auto", name: "auto" },
    });
    await prisma.checkoutSession.create({ data: { organisationId: ctx.org.id, kind: "SUBSCRIPTION", planId: plan.id, providerSessionId: s.id, url: s.url, createdById: ctx.userId } });
    return { url: s.url };
  }
  const pack = await prisma.creditPack.findFirst({ where: { key: input.packKey!, isActive: true, audience: "EMPLOYER" } });
  if (!pack?.stripePriceId) throw notFound("Credit pack");
  const s = await stripe().checkout.sessions.create({
    mode: "payment",
    customer,
    line_items: [{ price: pack.stripePriceId, quantity: 1 }],
    success_url: `${base}?checkout=success`,
    cancel_url: `${base}?checkout=cancelled`,
    client_reference_id: ctx.org.id,
    metadata: { organisationId: ctx.org.id, kind: "CREDIT_PACK", creditPackId: pack.id },
    payment_intent_data: { metadata: { organisationId: ctx.org.id, creditPackId: pack.id } },
    invoice_creation: { enabled: true },
    automatic_tax: { enabled: process.env.STRIPE_AUTOMATIC_TAX === "true" },
  });
  await prisma.checkoutSession.create({ data: { organisationId: ctx.org.id, kind: "CREDIT_PACK", creditPackId: pack.id, providerSessionId: s.id, url: s.url, createdById: ctx.userId } });
  return { url: s.url };
}

export async function createStudentPracticeCheckout(session: SessionInfo, packKey: string) {
  const pack = await prisma.creditPack.findFirst({ where: { key: packKey, isActive: true, audience: "STUDENT" } });
  if (!pack?.stripePriceId) throw notFound("Credit pack");
  const s = await stripe().checkout.sessions.create({
    mode: "payment",
    customer_email: session.user.email,
    line_items: [{ price: pack.stripePriceId, quantity: 1 }],
    success_url: `${env().APP_URL}/student/practice?checkout=success`,
    cancel_url: `${env().APP_URL}/student/practice?checkout=cancelled`,
    client_reference_id: session.user.id,
    metadata: { userId: session.user.id, kind: "CREDIT_PACK", creditPackId: pack.id },
    payment_intent_data: { metadata: { userId: session.user.id, creditPackId: pack.id } },
  });
  await prisma.checkoutSession.create({ data: { userId: session.user.id, kind: "CREDIT_PACK", creditPackId: pack.id, providerSessionId: s.id, url: s.url, createdById: session.user.id } });
  return { url: s.url };
}

export async function billingPortal(ctx: OrgContext) {
  ctx.assert("billing.manage");
  const customer = await ensureCustomer(ctx.org.id);
  const s = await stripe().billingPortal.sessions.create({ customer, return_url: `${env().APP_URL}/w/${ctx.org.slug}/billing` });
  return { url: s.url };
}

// ───────────────────────── Webhooks ─────────────────────────

export function verifyStripeSignature(rawBody: string, signature: string | null): Stripe.Event {
  const secret = env().STRIPE_WEBHOOK_SECRET;
  if (!secret) throw new AppError("PROVIDER_NOT_CONFIGURED", "STRIPE_WEBHOOK_SECRET not configured");
  if (!signature) throw new AppError("BAD_REQUEST", "Missing signature");
  try {
    return verifier().webhooks.constructEvent(rawBody, signature, secret, 300);
  } catch {
    throw new AppError("BAD_REQUEST", "Invalid webhook signature");
  }
}

const STATUS_MAP: Record<string, SubscriptionStatus> = {
  trialing: "TRIALING",
  active: "ACTIVE",
  past_due: "PAST_DUE",
  canceled: "CANCELED",
  incomplete: "INCOMPLETE",
  incomplete_expired: "CANCELED",
  unpaid: "UNPAID",
  paused: "PAST_DUE",
};

function periodOf(sub: Stripe.Subscription) {
  const anySub = sub as unknown as { current_period_start?: number; current_period_end?: number };
  const item = sub.items?.data?.[0] as unknown as { current_period_start?: number; current_period_end?: number } | undefined;
  const start = anySub.current_period_start ?? item?.current_period_start ?? sub.start_date;
  const end = anySub.current_period_end ?? item?.current_period_end ?? start + 30 * 86400;
  return { start: new Date(start * 1000), end: new Date(end * 1000) };
}

async function orgIdFromCustomer(customer: string | Stripe.Customer | Stripe.DeletedCustomer | null, metadataOrg?: string | null) {
  if (metadataOrg) return metadataOrg;
  const id = typeof customer === "string" ? customer : customer?.id;
  if (!id) return null;
  return (await prisma.organisation.findUnique({ where: { stripeCustomerId: id }, select: { id: true } }))?.id ?? null;
}

/** Store-then-process. Returns the outcome; duplicate deliveries are no-ops. */
export async function handleStripeEvent(event: Stripe.Event) {
  const existing = await prisma.paymentEvent.findUnique({ where: { provider_providerEventId: { provider: "stripe", providerEventId: event.id } } });
  if (existing && (existing.status === "PROCESSED" || existing.status === "IGNORED")) return { status: "duplicate" as const };
  const row =
    existing ??
    (await prisma.paymentEvent
      .create({ data: { provider: "stripe", providerEventId: event.id, type: event.type, payload: event as unknown as Prisma.InputJsonValue } })
      .catch(async (e) => {
        // Concurrent delivery of the same event: the unique constraint makes only one insert win.
        if ((e as { code?: string }).code === "P2002") return null;
        throw e;
      }));
  if (!row) return { status: "duplicate" as const };
  try {
    const outcome = await withSystem(`stripe webhook ${event.type}`, (tx) => processEvent(tx, event));
    await prisma.paymentEvent.update({ where: { id: row.id }, data: { status: outcome.handled ? "PROCESSED" : "IGNORED", organisationId: outcome.organisationId ?? null, processedAt: new Date(), error: null } });
    if (outcome.after) await outcome.after().catch((err) => logger.warn({ err }, "post-webhook side effect failed"));
    return { status: outcome.handled ? ("processed" as const) : ("ignored" as const) };
  } catch (err) {
    await prisma.paymentEvent.update({ where: { id: row.id }, data: { status: "FAILED", error: err instanceof Error ? err.message.slice(0, 1000) : String(err) } });
    throw err;
  }
}

type Outcome = { handled: boolean; organisationId?: string | null; after?: () => Promise<unknown> };

async function processEvent(tx: Tx, event: Stripe.Event): Promise<Outcome> {
  switch (event.type) {
    case "checkout.session.completed":
    case "checkout.session.async_payment_succeeded": {
      const s = event.data.object as Stripe.Checkout.Session;
      if (s.payment_status !== "paid" && s.payment_status !== "no_payment_required") return { handled: false };
      const local = await tx.checkoutSession.findUnique({ where: { providerSessionId: s.id } });
      const meta = s.metadata ?? {};
      await tx.checkoutSession.updateMany({ where: { providerSessionId: s.id }, data: { status: "COMPLETED", completedAt: new Date() } });
      if (meta.kind === "CREDIT_PACK") {
        const pack = await tx.creditPack.findUnique({ where: { id: meta.creditPackId ?? local?.creditPackId ?? "" } });
        if (!pack) throw new Error(`Unknown credit pack in checkout ${s.id}`);
        const owner = meta.organisationId ? { organisationId: meta.organisationId } : meta.userId ? { userId: meta.userId } : null;
        if (!owner) throw new Error("Checkout without owner metadata");
        const expiresAt = pack.expiresInDays ? new Date(Date.now() + pack.expiresInDays * 86400_000) : null;
        const res = await grant(tx, owner, pack.credits, "GRANT_PURCHASE", `checkout:${s.id}`, { reference: typeof s.payment_intent === "string" ? s.payment_intent : s.id, reason: pack.name, expiresAt });
        const orgId = meta.organisationId ?? null;
        return {
          handled: true,
          organisationId: orgId,
          after: async () => {
            if (res.duplicate || !orgId) return;
            const org = await prisma.organisation.findUniqueOrThrow({ where: { id: orgId } });
            if (org.billingEmail) await sendEmail("creditReceipt", { org: org.name, credits: pack.credits, amount: formatMoney(s.amount_total ?? pack.priceAmount, s.currency ?? pack.currency), url: `${env().APP_URL}/w/${org.slug}/billing` }, { to: org.billingEmail, organisationId: orgId, idempotencyKey: `credit-receipt:${s.id}` });
          },
        };
      }
      return { handled: true, organisationId: meta.organisationId ?? null };
    }
    case "customer.subscription.created":
    case "customer.subscription.updated":
    case "customer.subscription.deleted": {
      const sub = event.data.object as Stripe.Subscription;
      const orgId = await orgIdFromCustomer(sub.customer, sub.metadata?.organisationId);
      if (!orgId) return { handled: false };
      const priceId = sub.items.data[0]?.price?.id;
      const plan = (sub.metadata?.planId ? await tx.plan.findUnique({ where: { id: sub.metadata.planId } }) : null) ?? (priceId ? await tx.plan.findFirst({ where: { stripePriceId: priceId } }) : null);
      if (!plan) throw new Error(`No plan for subscription ${sub.id}`);
      const { start, end } = periodOf(sub);
      const status = event.type === "customer.subscription.deleted" ? "CANCELED" : (STATUS_MAP[sub.status] ?? "INCOMPLETE");
      const data = {
        organisationId: orgId,
        planId: plan.id,
        status,
        provider: "stripe",
        currentPeriodStart: start,
        currentPeriodEnd: end,
        cancelAtPeriodEnd: sub.cancel_at_period_end,
        canceledAt: sub.canceled_at ? new Date(sub.canceled_at * 1000) : null,
        trialEndsAt: sub.trial_end ? new Date(sub.trial_end * 1000) : null,
      };
      // Event ordering is not guaranteed: never let an older event overwrite newer state.
      const current = await tx.subscription.findUnique({ where: { providerSubscriptionId: sub.id } });
      if (current && current.updatedAt.getTime() > event.created * 1000 + 1000 && current.status === "CANCELED") return { handled: true, organisationId: orgId };
      await tx.subscription.upsert({ where: { providerSubscriptionId: sub.id }, create: { ...data, providerSubscriptionId: sub.id }, update: data });
      // Internal trials are superseded by a paid subscription.
      if (status === "ACTIVE" || status === "TRIALING") await tx.subscription.updateMany({ where: { organisationId: orgId, provider: "internal", status: "TRIALING" }, data: { status: "CANCELED", canceledAt: new Date() } });
      await audit({ organisationId: orgId, actorType: "WEBHOOK", action: `subscription.${event.type.split(".").pop()}`, targetType: "Subscription", targetId: sub.id, metadata: { status, plan: plan.key } }, tx);
      return { handled: true, organisationId: orgId };
    }
    case "invoice.paid":
    case "invoice.payment_succeeded":
    case "invoice.payment_failed":
    case "invoice.finalized":
    case "invoice.voided":
    case "invoice.marked_uncollectible": {
      const inv = event.data.object as Stripe.Invoice;
      const orgId = await orgIdFromCustomer(inv.customer, (inv.metadata as Record<string, string> | null)?.organisationId);
      const status = event.type === "invoice.payment_failed" ? "OPEN" : inv.status === "paid" ? "PAID" : inv.status === "void" ? "VOID" : inv.status === "uncollectible" ? "UNCOLLECTIBLE" : inv.status === "draft" ? "DRAFT" : "OPEN";
      if (!inv.id) return { handled: false };
      await tx.invoice.upsert({
        where: { providerInvoiceId: inv.id },
        create: { providerInvoiceId: inv.id, organisationId: orgId, number: inv.number, status, amountDue: inv.amount_due, amountPaid: inv.amount_paid, currency: inv.currency, hostedUrl: inv.hosted_invoice_url, pdfUrl: inv.invoice_pdf, periodStart: new Date(inv.period_start * 1000), periodEnd: new Date(inv.period_end * 1000) },
        update: { status, amountDue: inv.amount_due, amountPaid: inv.amount_paid, hostedUrl: inv.hosted_invoice_url, pdfUrl: inv.invoice_pdf, number: inv.number },
      });
      if (!orgId) return { handled: true };
      const subId = subscriptionIdOf(inv);
      if ((event.type === "invoice.paid" || event.type === "invoice.payment_succeeded") && subId) {
        const sub = await tx.subscription.findUnique({ where: { providerSubscriptionId: subId }, include: { plan: { include: { entitlements: true } } } });
        const monthly = Number(sub?.plan.entitlements.find((e) => e.key === "monthly_interview_credits")?.value ?? 0);
        const periods = sub?.plan.interval === "YEAR" ? 12 : 1;
        let granted = false;
        if (sub && monthly > 0 && inv.amount_paid >= 0) {
          const end = new Date(inv.period_end * 1000);
          // One grant per paid invoice (idempotent). Annual plans receive 12 months' allowance up front.
          const r = await grant(tx, { organisationId: orgId }, monthly * periods, "GRANT_SUBSCRIPTION", `invoice:${inv.id}`, { reference: inv.id, reason: `${sub.plan.name} allowance`, expiresAt: new Date(end.getTime() + 7 * 86400_000) });
          granted = !r.duplicate;
        }
        if (sub && sub.status === "PAST_DUE") await tx.subscription.update({ where: { id: sub.id }, data: { status: "ACTIVE" } });
        return {
          handled: true,
          organisationId: orgId,
          after: async () => {
            if (!granted || !sub) return;
            const org = await prisma.organisation.findUniqueOrThrow({ where: { id: orgId } });
            if (!org.billingEmail) return;
            if (inv.billing_reason === "subscription_cycle") await sendEmail("subscriptionRenewed", { org: org.name, plan: sub.plan.name, periodEnd: new Date(inv.period_end * 1000).toDateString(), url: `${env().APP_URL}/w/${org.slug}/billing` }, { to: org.billingEmail, organisationId: orgId, idempotencyKey: `renewed:${inv.id}` });
            else await sendEmail("subscriptionReceipt", { org: org.name, plan: sub.plan.name, amount: formatMoney(inv.amount_paid, inv.currency), url: `${env().APP_URL}/w/${org.slug}/billing` }, { to: org.billingEmail, organisationId: orgId, idempotencyKey: `receipt:${inv.id}` });
          },
        };
      }
      if (event.type === "invoice.payment_failed") {
        if (subId) await tx.subscription.updateMany({ where: { providerSubscriptionId: subId }, data: { status: "PAST_DUE" } });
        await audit({ organisationId: orgId, actorType: "WEBHOOK", action: "billing.payment_failed", targetType: "Invoice", targetId: inv.id, result: "FAILURE" }, tx);
        return {
          handled: true,
          organisationId: orgId,
          after: async () => {
            const org = await prisma.organisation.findUniqueOrThrow({ where: { id: orgId } });
            if (org.billingEmail) await sendEmail("paymentFailed", { org: org.name, url: `${env().APP_URL}/w/${org.slug}/billing` }, { to: org.billingEmail, organisationId: orgId, idempotencyKey: `payfail:${inv.id}:${event.id}` });
          },
        };
      }
      return { handled: true, organisationId: orgId };
    }
    case "charge.refunded": {
      const ch = event.data.object as Stripe.Charge;
      const pi = typeof ch.payment_intent === "string" ? ch.payment_intent : ch.payment_intent?.id;
      const meta = ch.metadata ?? {};
      const refunds = ch.refunds?.data ?? [];
      const grantEntry = pi ? await tx.creditLedgerEntry.findFirst({ where: { type: "GRANT_PURCHASE", reference: pi } }) : null;
      let orgId: string | null = meta.organisationId ?? grantEntry?.organisationId ?? null;
      for (const r of refunds) {
        const exists = await tx.refund.findUnique({ where: { providerRefundId: r.id } });
        if (exists) continue;
        let reversed = 0;
        if (grantEntry && ch.amount > 0) {
          const account = await tx.creditAccount.findUniqueOrThrow({ where: { id: grantEntry.accountId } });
          const owner = account.organisationId ? { organisationId: account.organisationId } : { userId: account.userId! };
          orgId = account.organisationId;
          const proportional = Math.floor((grantEntry.amountAvailable * r.amount) / ch.amount);
          if (proportional > 0) reversed = (await refundCredits(tx, owner, proportional, `refund:${r.id}`, r.id)).reversed;
        }
        await tx.refund.create({ data: { providerRefundId: r.id, organisationId: orgId, amount: r.amount, currency: r.currency, creditsReversed: reversed, reason: r.reason ?? null } });
      }
      return { handled: true, organisationId: orgId };
    }
    default:
      return { handled: false };
  }
}

function subscriptionIdOf(inv: Stripe.Invoice): string | null {
  const legacy = (inv as unknown as { subscription?: string | { id: string } | null }).subscription;
  if (legacy) return typeof legacy === "string" ? legacy : legacy.id;
  const parent = (inv as unknown as { parent?: { subscription_details?: { subscription?: string | { id: string } } } }).parent;
  const s = parent?.subscription_details?.subscription;
  return s ? (typeof s === "string" ? s : s.id) : null;
}

/** Re-process failed webhook events (admin action / scheduled). */
export async function retryFailedPaymentEvents(limit = 50) {
  const failed = await prisma.paymentEvent.findMany({ where: { status: { in: ["FAILED", "RECEIVED"] }, receivedAt: { lt: new Date(Date.now() - 60_000) } }, take: limit });
  let ok = 0;
  for (const f of failed) {
    try {
      await handleStripeEvent(f.payload as unknown as Stripe.Event);
      ok++;
    } catch {
      /* stays FAILED */
    }
  }
  return { retried: failed.length, succeeded: ok };
}

/** Ledger ↔ cache reconciliation for every account, plus credit expiry. */
export async function reconcileAllAccounts() {
  const accounts = await prisma.creditAccount.findMany({ select: { id: true } });
  const mismatches: unknown[] = [];
  let expired = 0;
  for (const a of accounts) {
    await prisma.$transaction(async (tx) => {
      expired += await expireGrants(tx, a.id);
      const r = await reconcile(tx, a.id);
      if (!r.consistent) mismatches.push(r);
    });
  }
  if (mismatches.length) logger.error({ mismatches }, "credit ledger reconciliation mismatch");
  return { accounts: accounts.length, mismatches, expired };
}
