import { prisma } from "../db/client";
import { templates, type TemplateName } from "../email/templates";
import { enqueue } from "../queue";
import { emailProvider } from "../providers/email";
import { logger } from "../logger";

type TemplateParams<N extends TemplateName> = Parameters<(typeof templates)[N]>[0];

/** Optional topics a user can switch off. Security/transactional mail ignores preferences. */
export const OPTIONAL_TOPICS = ["opportunity_alerts", "interview_reminders", "application_updates", "product"] as const;
export type Topic = (typeof OPTIONAL_TOPICS)[number];

async function emailAllowed(userId: string | undefined, topic?: Topic) {
  if (!userId || !topic) return true;
  const pref = await prisma.notificationPreference.findUnique({ where: { userId_channel_topic: { userId, channel: "EMAIL", topic } } });
  if (pref) return pref.enabled;
  return topic !== "opportunity_alerts" && topic !== "product"; // opt-in topics default off
}

export async function sendEmail<N extends TemplateName>(
  template: N,
  params: TemplateParams<N>,
  opts: { to: string; userId?: string; organisationId?: string; idempotencyKey?: string; topic?: Topic },
) {
  if (!(await emailAllowed(opts.userId, opts.topic))) {
    await prisma.emailDelivery.create({
      data: { toAddress: opts.to, template, subject: "(suppressed by preference)", status: "SUPPRESSED", provider: "none", userId: opts.userId, organisationId: opts.organisationId, idempotencyKey: opts.idempotencyKey },
    }).catch(() => undefined);
    return null;
  }
  const rendered = (templates[template] as (p: TemplateParams<N>) => { subject: string; text: string; html: string })(params);
  if (opts.idempotencyKey) {
    const existing = await prisma.emailDelivery.findUnique({ where: { idempotencyKey: opts.idempotencyKey } });
    if (existing) return existing;
  }
  const delivery = await prisma.emailDelivery.create({
    data: {
      toAddress: opts.to.toLowerCase(),
      template,
      subject: rendered.subject,
      // Rendered body is stored transiently so the worker can send it; it is
      // cleared after a successful send by production providers.
      bodyText: JSON.stringify({ text: rendered.text, html: rendered.html }),
      provider: process.env.EMAIL_PROVIDER ?? "console",
      userId: opts.userId,
      organisationId: opts.organisationId,
      idempotencyKey: opts.idempotencyKey,
    },
  });
  await enqueue("email.send", { deliveryId: delivery.id });
  return delivery;
}

/** Worker: deliver a queued email. Throws to trigger queue retry. */
export async function deliverEmail(deliveryId: string) {
  const d = await prisma.emailDelivery.findUnique({ where: { id: deliveryId } });
  if (!d || d.status !== "QUEUED" || !d.bodyText) return;
  const body = JSON.parse(d.bodyText) as { text: string; html: string };
  try {
    const p = emailProvider();
    const res = await p.send({ to: d.toAddress, subject: d.subject, text: body.text, html: body.html, tags: { template: d.template } });
    await prisma.emailDelivery.update({
      where: { id: d.id },
      data: { status: "SENT", provider: p.name, providerMessageId: res.providerMessageId, attempts: { increment: 1 }, bodyText: res.storeBody ? body.text : null, error: null },
    });
  } catch (err) {
    const updated = await prisma.emailDelivery.update({
      where: { id: d.id },
      data: { attempts: { increment: 1 }, error: err instanceof Error ? err.message.slice(0, 500) : "send failed" },
    });
    if (updated.attempts >= 5) {
      await prisma.emailDelivery.update({ where: { id: d.id }, data: { status: "FAILED", bodyText: null } });
      logger.error({ deliveryId }, "email permanently failed");
      return;
    }
    throw err;
  }
}

/** Provider delivery webhooks (bounce/delivered). */
export async function recordEmailStatus(providerMessageId: string, status: "DELIVERED" | "BOUNCED" | "FAILED", error?: string) {
  await prisma.emailDelivery.updateMany({ where: { providerMessageId }, data: { status, error } });
}

export async function notify(userId: string, n: { type: string; title: string; body: string; link?: string; organisationId?: string }) {
  const pref = await prisma.notificationPreference.findUnique({ where: { userId_channel_topic: { userId, channel: "IN_APP", topic: n.type } } });
  if (pref && !pref.enabled) return null;
  return prisma.notification.create({ data: { userId, ...n } });
}
