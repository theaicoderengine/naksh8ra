import { describe, it, expect, beforeAll } from "vitest";
import Stripe from "stripe";
import { prisma } from "@/server/db/client";
import { withOrg } from "@/server/db/tenant";
import { handleStripeEvent, verifyStripeSignature, reconcileAllAccounts } from "@/server/services/billing";
import { balance, reserve, consume, release, grant, reconcile } from "@/server/billing/credits";
import { getEntitlements } from "@/server/billing/entitlements";
import { POST as webhookRoute } from "@/app/api/v1/webhooks/stripe/route";
import { NextRequest } from "next/server";
import { makeOrg, uid } from "../helpers";

const stripe = new Stripe("sk_test_offline_dummy");
const SECRET = "whsec_test_secret";

function event(type: string, object: Record<string, unknown>, id = `evt_${uid()}`): Stripe.Event {
  return { id, object: "event", type, created: Math.floor(Date.now() / 1000), data: { object }, api_version: "2025-08-27", livemode: false, pending_webhooks: 0, request: null } as unknown as Stripe.Event;
}

function signed(e: Stripe.Event) {
  const payload = JSON.stringify(e);
  return { payload, header: stripe.webhooks.generateTestHeaderString({ payload, secret: SECRET }) };
}

describe("Billing: subscriptions, credit packs and webhooks", () => {
  let org: Awaited<ReturnType<typeof makeOrg>>;
  let planId: string;
  let packId: string;
  const customer = `cus_${uid()}`;
  const subId = `sub_${uid()}`;

  beforeAll(async () => {
    org = await makeOrg();
    await prisma.organisation.update({ where: { id: org.org.id }, data: { stripeCustomerId: customer, billingEmail: org.owner.email } });
    const plan = await prisma.plan.create({ data: { key: `growth-${uid()}`, name: "Growth (test)", priceAmount: 9900, currency: "usd", stripePriceId: `price_${uid()}`, entitlements: { create: [{ key: "seats", value: "15" }, { key: "monthly_interview_credits", value: "50" }] } } });
    planId = plan.id;
    const pack = await prisma.creditPack.create({ data: { key: `pack-${uid()}`, name: "25 credits", credits: 25, priceAmount: 5000, currency: "usd", stripePriceId: `price_${uid()}` } });
    packId = pack.id;
  });

  it("rejects forged or unsigned webhooks at the route", async () => {
    const e = event("checkout.session.completed", { id: "cs_forged", payment_status: "paid", metadata: { kind: "CREDIT_PACK", organisationId: org.org.id, creditPackId: packId } });
    const res = await webhookRoute(new NextRequest("http://localhost/api/v1/webhooks/stripe", { method: "POST", body: JSON.stringify(e), headers: { "stripe-signature": "t=1,v1=deadbeef" } }));
    expect(res.status).toBe(400);
    const none = await webhookRoute(new NextRequest("http://localhost/api/v1/webhooks/stripe", { method: "POST", body: JSON.stringify(e) }));
    expect(none.status).toBe(400);
    expect(() => verifyStripeSignature(JSON.stringify(e), stripe.webhooks.generateTestHeaderString({ payload: JSON.stringify(e), secret: "whsec_wrong" }))).toThrow(/Invalid webhook signature/);
    const bal = await withOrg(org.org.id, null, (tx) => balance(tx, { organisationId: org.org.id }));
    expect(bal.available).toBe(0);
  });

  it("15. credit purchase grants credits once, even when Stripe delivers the event repeatedly", async () => {
    const e = event("checkout.session.completed", { id: `cs_${uid()}`, payment_status: "paid", amount_total: 5000, currency: "usd", payment_intent: `pi_${uid()}`, metadata: { kind: "CREDIT_PACK", organisationId: org.org.id, creditPackId: packId } });
    const { payload, header } = signed(e);
    const send = () => webhookRoute(new NextRequest("http://localhost/api/v1/webhooks/stripe", { method: "POST", body: payload, headers: { "stripe-signature": header } }));
    const first = await send();
    expect((await first.json()).status).toBe("processed");
    // 17. Duplicate deliveries, including concurrent ones.
    const dupes = await Promise.all([send(), send(), send()]);
    for (const d of dupes) expect((await d.json()).status).toBe("duplicate");
    const bal = await withOrg(org.org.id, null, (tx) => balance(tx, { organisationId: org.org.id }));
    expect(bal.available).toBe(25);
    // Even a re-processed copy with a NEW event id for the same checkout can't double-grant (idempotency key = checkout id).
    await handleStripeEvent({ ...e, id: `evt_${uid()}` });
    expect((await withOrg(org.org.id, null, (tx) => balance(tx, { organisationId: org.org.id }))).available).toBe(25);
    const receipt = await prisma.emailDelivery.findFirst({ where: { toAddress: org.owner.email, template: "creditReceipt" } });
    expect(receipt).not.toBeNull();
  });

  it("16. subscription lifecycle: created → invoice paid (allowance) → renewal → payment failure → recovery → cancel", async () => {
    const now = Math.floor(Date.now() / 1000);
    const sub = { id: subId, object: "subscription", customer, status: "active", cancel_at_period_end: false, canceled_at: null, trial_end: null, start_date: now, metadata: { organisationId: org.org.id, planId }, items: { data: [{ price: { id: "price_x" }, current_period_start: now, current_period_end: now + 30 * 86400 }] } };
    await handleStripeEvent(event("customer.subscription.created", sub));
    let ent = await getEntitlements(org.org.id);
    expect(ent.seats).toBe(15);
    expect(ent.status).toBe("ACTIVE");

    const invoice = (id: string, reason: string) => ({ id, object: "invoice", customer, number: "INV-1", status: "paid", amount_due: 9900, amount_paid: 9900, currency: "usd", billing_reason: reason, hosted_invoice_url: null, invoice_pdf: null, period_start: now, period_end: now + 30 * 86400, metadata: {}, parent: { subscription_details: { subscription: subId } } });
    const before = (await withOrg(org.org.id, null, (tx) => balance(tx, { organisationId: org.org.id }))).available;
    const inv1 = event("invoice.paid", invoice(`in_${uid()}`, "subscription_create"));
    await handleStripeEvent(inv1);
    await handleStripeEvent({ ...inv1, id: `evt_${uid()}` }); // same invoice, new event id → no double grant
    let bal = await withOrg(org.org.id, null, (tx) => balance(tx, { organisationId: org.org.id }));
    expect(bal.available).toBe(before + 50);

    await handleStripeEvent(event("invoice.paid", invoice(`in_${uid()}`, "subscription_cycle")));
    bal = await withOrg(org.org.id, null, (tx) => balance(tx, { organisationId: org.org.id }));
    expect(bal.available).toBe(before + 100);
    expect(await prisma.emailDelivery.findFirst({ where: { toAddress: org.owner.email, template: "subscriptionRenewed" } })).not.toBeNull();

    const failedId = `in_${uid()}`;
    await handleStripeEvent(event("invoice.payment_failed", { ...invoice(failedId, "subscription_cycle"), status: "open", amount_paid: 0 }));
    ent = await getEntitlements(org.org.id);
    expect(ent.status).toBe("PAST_DUE");
    expect(await prisma.emailDelivery.findFirst({ where: { toAddress: org.owner.email, template: "paymentFailed" } })).not.toBeNull();
    expect((await prisma.invoice.findUniqueOrThrow({ where: { providerInvoiceId: failedId } })).status).toBe("OPEN");

    await handleStripeEvent(event("invoice.paid", invoice(failedId, "subscription_cycle")));
    expect((await getEntitlements(org.org.id)).status).toBe("ACTIVE");

    await handleStripeEvent(event("customer.subscription.deleted", { ...sub, status: "canceled", canceled_at: now }));
    ent = await getEntitlements(org.org.id);
    expect(ent.status).toBeNull(); // falls back to default entitlements
  });

  it("refunds reverse purchased credits proportionally and only once", async () => {
    const pi = `pi_${uid()}`;
    const cs = event("checkout.session.completed", { id: `cs_${uid()}`, payment_status: "paid", amount_total: 5000, currency: "usd", payment_intent: pi, metadata: { kind: "CREDIT_PACK", organisationId: org.org.id, creditPackId: packId } });
    await handleStripeEvent(cs);
    const before = (await withOrg(org.org.id, null, (tx) => balance(tx, { organisationId: org.org.id }))).available;
    const refund = event("charge.refunded", { id: `ch_${uid()}`, payment_intent: pi, amount: 5000, metadata: {}, refunds: { data: [{ id: `re_${uid()}`, amount: 2500, currency: "usd", reason: "requested_by_customer" }] } });
    await handleStripeEvent(refund);
    await handleStripeEvent({ ...refund, id: `evt_${uid()}` });
    const after = (await withOrg(org.org.id, null, (tx) => balance(tx, { organisationId: org.org.id }))).available;
    expect(before - after).toBe(12); // floor(25 * 2500/5000)
  });

  it("ignores unrelated event types without failing", async () => {
    expect((await handleStripeEvent(event("customer.created", { id: "cus_x" }))).status).toBe("ignored");
  });
});

describe("Credit ledger concurrency and integrity", () => {
  it("concurrent reservations never overdraw the balance", async () => {
    const { org } = await makeOrg();
    await withOrg(org.id, null, (tx) => grant(tx, { organisationId: org.id }, 3, "GRANT_PURCHASE", `race:${org.id}`));
    const attempts = Array.from({ length: 10 }, (_, i) =>
      withOrg(org.id, null, (tx) => reserve(tx, { organisationId: org.id }, `race-${i}`, `ref-${i}`))
        .then(() => "ok")
        .catch((e: Error) => (/Not enough interview credits/.test(e.message) ? "insufficient" : `error:${e.message}`)),
    );
    const results = await Promise.all(attempts);
    expect(results.filter((r) => r === "ok").length).toBe(3);
    expect(results.filter((r) => r === "insufficient").length).toBe(7);
    const b = await withOrg(org.id, null, (tx) => balance(tx, { organisationId: org.id }));
    expect(b).toMatchObject({ available: 0, reserved: 3 });
  });

  it("settlement is idempotent and reconciles with the ledger", async () => {
    const { org } = await makeOrg();
    const owner = { organisationId: org.id };
    await withOrg(org.id, null, async (tx) => {
      await grant(tx, owner, 2, "GRANT_PURCHASE", "g1");
      await grant(tx, owner, 2, "GRANT_PURCHASE", "g1"); // duplicate key → ignored
      await reserve(tx, owner, "s1", "s1");
      await reserve(tx, owner, "s1", "s1"); // duplicate → ignored
      await consume(tx, owner, "s1", "s1");
      await consume(tx, owner, "s1", "s1");
      await release(tx, owner, "s1", "s1", "late release after consume is a no-op");
      await reserve(tx, owner, "s2", "s2");
      await release(tx, owner, "s2", "s2", "cancelled");
      await release(tx, owner, "s2", "s2", "cancelled");
    });
    const b = await withOrg(org.id, null, (tx) => balance(tx, owner));
    expect(b).toMatchObject({ available: 1, reserved: 0 });
    const r = await prisma.$transaction((tx) => reconcile(tx, b.accountId));
    expect(r.consistent).toBe(true);
  });

  it("the ledger is immutable at the database level", async () => {
    const e = await prisma.creditLedgerEntry.findFirstOrThrow();
    await expect(prisma.creditLedgerEntry.update({ where: { id: e.id }, data: { amountAvailable: 9999 } })).rejects.toThrow();
    await expect(prisma.creditAccount.update({ where: { id: e.accountId }, data: { available: -5 } })).rejects.toThrow();
  });

  it("global reconciliation reports no mismatches", async () => {
    const r = await reconcileAllAccounts();
    expect(r.mismatches).toEqual([]);
  });
});
