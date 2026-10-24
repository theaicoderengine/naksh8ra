import nodemailer from "nodemailer";
import { env } from "../../env";
import { AppError } from "../../errors";
import { logger } from "../../logger";

export type OutgoingEmail = { to: string; subject: string; text: string; html: string; tags?: Record<string, string> };
export type SendResult = { providerMessageId: string | null; storeBody: boolean };

export interface EmailProvider {
  name: string;
  send(msg: OutgoingEmail): Promise<SendResult>;
}

class ConsoleEmail implements EmailProvider {
  name = "console";
  async send(msg: OutgoingEmail) {
    // Development only: body is kept on the EmailDelivery row so the dev
    // mailbox (/dev/mailbox) and automated tests can follow links.
    logger.info({ to: msg.to, subject: msg.subject }, "console email");
    return { providerMessageId: null, storeBody: true };
  }
}

class SmtpEmail implements EmailProvider {
  name = "smtp";
  private transport = nodemailer.createTransport(env().SMTP_URL!);
  async send(msg: OutgoingEmail) {
    const info = await this.transport.sendMail({ from: env().EMAIL_FROM, to: msg.to, subject: msg.subject, text: msg.text, html: msg.html });
    return { providerMessageId: info.messageId ?? null, storeBody: false };
  }
}

class ResendEmail implements EmailProvider {
  name = "resend";
  async send(msg: OutgoingEmail) {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { authorization: `Bearer ${env().RESEND_API_KEY}`, "content-type": "application/json" },
      body: JSON.stringify({
        from: env().EMAIL_FROM,
        to: [msg.to],
        subject: msg.subject,
        text: msg.text,
        html: msg.html,
        tags: Object.entries(msg.tags ?? {}).map(([name, value]) => ({ name, value })),
      }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) throw new AppError("PROVIDER_ERROR", `Resend responded ${res.status}`);
    const json = (await res.json()) as { id?: string };
    return { providerMessageId: json.id ?? null, storeBody: false };
  }
}

class PostmarkEmail implements EmailProvider {
  name = "postmark";
  async send(msg: OutgoingEmail) {
    const res = await fetch("https://api.postmarkapp.com/email", {
      method: "POST",
      headers: { "X-Postmark-Server-Token": env().POSTMARK_SERVER_TOKEN!, "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({ From: env().EMAIL_FROM, To: msg.to, Subject: msg.subject, TextBody: msg.text, HtmlBody: msg.html, MessageStream: "outbound" }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) throw new AppError("PROVIDER_ERROR", `Postmark responded ${res.status}`);
    const json = (await res.json()) as { MessageID?: string };
    return { providerMessageId: json.MessageID ?? null, storeBody: false };
  }
}

let provider: EmailProvider | null = null;

export function emailProvider(): EmailProvider {
  if (provider) return provider;
  const e = env();
  switch (e.EMAIL_PROVIDER) {
    case "smtp":
      if (!e.SMTP_URL) throw new AppError("PROVIDER_NOT_CONFIGURED", "SMTP_URL is not configured");
      provider = new SmtpEmail();
      break;
    case "resend":
      if (!e.RESEND_API_KEY) throw new AppError("PROVIDER_NOT_CONFIGURED", "RESEND_API_KEY is not configured");
      provider = new ResendEmail();
      break;
    case "postmark":
      if (!e.POSTMARK_SERVER_TOKEN) throw new AppError("PROVIDER_NOT_CONFIGURED", "POSTMARK_SERVER_TOKEN is not configured");
      provider = new PostmarkEmail();
      break;
    default:
      if (e.APP_ENV === "production") throw new AppError("PROVIDER_NOT_CONFIGURED", "A real email provider must be configured in production");
      provider = new ConsoleEmail();
  }
  return provider;
}
