import { AuthCard } from "@/components/auth/auth-card";
import { EmailActionForm } from "@/components/auth/email-action-form";
import { currentSession } from "@/server/auth/session";

export const metadata = { title: "Verify your email" };

export default async function Sent() {
  const s = await currentSession();
  return (
    <AuthCard title="Verify your email" description="Open the link we emailed you to activate your account. Didn't get it? Check spam, or request a new link.">
      <EmailActionForm endpoint="/auth/resend-verification" cta="Send a new link" defaultEmail={s?.user.email} />
    </AuthCard>
  );
}
