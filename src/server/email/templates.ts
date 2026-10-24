import { brand } from "@/lib/brand";

/**
 * Transactional email templates. Rule: emails NEVER contain interview
 * content, transcripts, assessment ratings or private notes — they link to
 * the authenticated application instead.
 */
export type Rendered = { subject: string; text: string; html: string };

function esc(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

function layout(title: string, paragraphs: string[], cta?: { label: string; url: string }, footnote?: string): Rendered["html"] {
  const b = brand();
  return `<!doctype html><html><body style="margin:0;background:#f5f6f8;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#0f172a">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:32px 16px">
<table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:12px;border:1px solid #e2e8f0">
<tr><td style="padding:24px 32px;border-bottom:1px solid #e2e8f0;font-weight:700;font-size:16px;color:${b.primaryHex}">${esc(b.name)}</td></tr>
<tr><td style="padding:32px">
<h1 style="font-size:20px;margin:0 0 16px">${esc(title)}</h1>
${paragraphs.map((p) => `<p style="font-size:15px;line-height:1.6;margin:0 0 14px">${esc(p)}</p>`).join("")}
${cta ? `<p style="margin:24px 0"><a href="${esc(cta.url)}" style="background:${b.primaryHex};color:#fff;text-decoration:none;padding:12px 20px;border-radius:8px;font-weight:600;display:inline-block">${esc(cta.label)}</a></p><p style="font-size:12px;color:#64748b;word-break:break-all">If the button doesn't work, copy this link: ${esc(cta.url)}</p>` : ""}
${footnote ? `<p style="font-size:13px;color:#64748b;margin-top:24px">${esc(footnote)}</p>` : ""}
</td></tr>
<tr><td style="padding:16px 32px;border-top:1px solid #e2e8f0;font-size:12px;color:#94a3b8">${esc(b.name)} · ${esc(b.supportEmail)}</td></tr>
</table></td></tr></table></body></html>`;
}

function text(title: string, paragraphs: string[], cta?: { label: string; url: string }, footnote?: string) {
  return [title, "", ...paragraphs, ...(cta ? ["", `${cta.label}: ${cta.url}`] : []), ...(footnote ? ["", footnote] : []), "", `— ${brand().name}`].join("\n");
}

function make(subject: string, title: string, paragraphs: string[], cta?: { label: string; url: string }, footnote?: string): Rendered {
  return { subject, html: layout(title, paragraphs, cta, footnote), text: text(title, paragraphs, cta, footnote) };
}

export const templates = {
  emailVerification: (p: { name: string; url: string }) =>
    make(`Verify your email for ${brand().name}`, "Confirm your email address", [`Hi ${p.name},`, "Please confirm your email address to activate your account. This link expires in 24 hours."], { label: "Verify email", url: p.url }, "If you didn't create an account, you can ignore this email."),
  passwordReset: (p: { url: string }) =>
    make("Reset your password", "Password reset requested", ["We received a request to reset your password. This link expires in 1 hour and can be used once."], { label: "Reset password", url: p.url }, "If you didn't request this, you can ignore this email — your password won't change."),
  organisationWelcome: (p: { name: string; org: string; url: string }) =>
    make(`Welcome to ${brand().name}`, `${p.org} is ready`, [`Hi ${p.name},`, `Your workspace for ${p.org} has been created. Next steps: invite your HR team, create your first vacancy and configure an interview template.`], { label: "Open workspace", url: p.url }),
  hrInvitation: (p: { inviter: string; org: string; role: string; url: string }) =>
    make(`${p.inviter} invited you to ${p.org}`, `Join ${p.org} on ${brand().name}`, [`${p.inviter} has invited you to join ${p.org} as ${p.role}.`, "This invitation expires in 7 days and can be used once."], { label: "Accept invitation", url: p.url }),
  studentWelcome: (p: { name: string; url: string }) =>
    make(`Welcome to ${brand().name}`, "Your career profile is ready", [`Hi ${p.name},`, "Complete your profile to see opportunities you're eligible for, and try a private practice interview whenever you like — practice sessions are never shared with employers."], { label: "Go to dashboard", url: p.url }),
  opportunityAlert: (p: { name: string; count: number; url: string }) =>
    make("New opportunities that match your profile", "New matching opportunities", [`Hi ${p.name},`, `${p.count} new opportunities match your preferences.`], { label: "View opportunities", url: p.url }, "You receive this because opportunity alerts are on. Turn them off in notification settings."),
  applicationConfirmation: (p: { name: string; job: string; org: string; url: string }) =>
    make(`Application received: ${p.job}`, "Application submitted", [`Hi ${p.name},`, `Your application for ${p.job} at ${p.org} has been submitted. You can track its status at any time.`], { label: "Track application", url: p.url }),
  interviewInvitation: (p: { name: string; job: string; org: string; url: string; expires: string; minutes: number }) =>
    make(`Interview invitation: ${p.job} at ${p.org}`, "You're invited to an AI-assisted interview", [`Hi ${p.name},`, `${p.org} has invited you to complete an interview for ${p.job}. It takes about ${p.minutes} minutes. Before you start you'll see exactly how it works, what is recorded and how your data is used, and you can request accommodations.`, `Please complete it before ${p.expires}.`], { label: "Open interview", url: p.url }, "This link is personal to you. Do not share it."),
  interviewReminder: (p: { name: string; job: string; url: string; expires: string }) =>
    make(`Reminder: interview for ${p.job}`, "Your interview is still waiting", [`Hi ${p.name},`, `Your interview for ${p.job} expires on ${p.expires}.`], { label: "Open interview", url: p.url }),
  interviewCompleted: (p: { name: string; job: string }) =>
    make(`Interview submitted: ${p.job}`, "Thanks — your interview was submitted", [`Hi ${p.name},`, `We've received your interview for ${p.job}. The hiring team will review it and you'll be notified about next steps.`]),
  reviewCompleted: (p: { job: string; candidate: string; url: string }) =>
    make(`Interview ready for review: ${p.job}`, "An assessment is ready for review", [`An interview for ${p.job} (${p.candidate}) has been processed and is waiting for human review.`], { label: "Review", url: p.url }),
  feedbackAvailable: (p: { name: string; job: string; url: string }) =>
    make(`Feedback available: ${p.job}`, "The hiring team shared feedback with you", [`Hi ${p.name},`, `The hiring team for ${p.job} has shared feedback with you. Sign in to read it.`], { label: "View feedback", url: p.url }),
  applicationStatus: (p: { name: string; job: string; status: string; url: string }) =>
    make(`Update on your application: ${p.job}`, "Your application status changed", [`Hi ${p.name},`, `Your application for ${p.job} is now: ${p.status}.`], { label: "View application", url: p.url }),
  subscriptionReceipt: (p: { org: string; plan: string; amount: string; url: string }) =>
    make(`Receipt: ${p.plan}`, "Payment received", [`Thanks — we received ${p.amount} for ${p.org}'s ${p.plan} subscription.`], { label: "View billing", url: p.url }),
  creditReceipt: (p: { org: string; credits: number; amount: string; url: string }) =>
    make(`Receipt: ${p.credits} interview credits`, "Credits added", [`${p.credits} interview credits were added to ${p.org} (${p.amount}).`], { label: "View billing", url: p.url }),
  paymentFailed: (p: { org: string; url: string }) =>
    make("Action needed: payment failed", "We couldn't process your payment", [`The latest payment for ${p.org} failed. Please update your payment method to avoid interruption.`], { label: "Update payment method", url: p.url }),
  subscriptionRenewed: (p: { org: string; plan: string; periodEnd: string; url: string }) =>
    make(`Subscription renewed: ${p.plan}`, "Subscription renewed", [`${p.org}'s ${p.plan} subscription renewed. Next renewal: ${p.periodEnd}. Your monthly interview credits have been added.`], { label: "View billing", url: p.url }),
  securityAlert: (p: { name: string; event: string; when: string; url: string }) =>
    make("Security alert for your account", "Security alert", [`Hi ${p.name},`, `${p.event} (${p.when}).`, "If this wasn't you, reset your password immediately and contact support."], { label: "Review security settings", url: p.url }),
  cohortInvitation: (p: { university: string; cohort: string; url: string }) =>
    make(`${p.university} invited you to ${p.cohort}`, "Join your placement cohort", [`${p.university} invited you to join the ${p.cohort} placement cohort. If you accept, the placement team can see your profile summary and application progress — never employer assessments or interview recordings.`], { label: "Review invitation", url: p.url }),
  dataExportReady: (p: { url: string }) =>
    make("Your data export is ready", "Your data export is ready", ["The export you requested is ready to download. The download link requires you to be signed in and expires in 7 days."], { label: "Download", url: p.url }),
};

export type TemplateName = keyof typeof templates;
