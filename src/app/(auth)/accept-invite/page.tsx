import Link from "next/link";
import { AuthCard } from "@/components/auth/auth-card";
import { AcceptInvite } from "@/components/auth/accept-invite";
import { RegisterForm } from "@/components/auth/register-form";
import { Alert } from "@/components/ui/feedback";
import { ButtonLink } from "@/components/ui/button";
import { previewInvitation } from "@/server/services/organisations";
import { currentSession } from "@/server/auth/session";

export const metadata = { title: "Accept invitation" };

export default async function AcceptInvitePage({ searchParams }: { searchParams: Promise<{ token?: string; register?: string }> }) {
  const { token, register } = await searchParams;
  const inv = token ? await previewInvitation(token) : null;
  if (!token || !inv) return <AuthCard title="Invitation unavailable"><Alert tone="danger">This invitation is invalid, expired or already used. Ask your administrator to send a new one.</Alert></AuthCard>;
  const session = await currentSession();
  const next = `/accept-invite?token=${encodeURIComponent(token)}`;
  return (
    <AuthCard title={`Join ${inv.organisation}`} description={<>You&apos;ve been invited as <strong>{inv.role}</strong>.</>}>
      {session ? (
        session.user.email.toLowerCase() === inv.email.toLowerCase() ? (
          <AcceptInvite token={token} />
        ) : (
          <Alert tone="warning" title="Signed in with a different email">This invitation was sent to {inv.email}. <Link className="text-primary underline" href={`/login?next=${encodeURIComponent(next)}`}>Sign in with that address</Link>.</Alert>
        )
      ) : register ? (
        <>
          <RegisterForm intent="EMPLOYER" inviteEmail={inv.email} />
          <p className="mt-3 text-xs text-subtle">After verifying your email, return to this invitation link to join.</p>
        </>
      ) : (
        <div className="space-y-3">
          <ButtonLink href={`/login?next=${encodeURIComponent(next)}`} className="w-full">Sign in to accept</ButtonLink>
          <ButtonLink href={`${next}&register=1`} variant="secondary" className="w-full">Create an account</ButtonLink>
        </div>
      )}
    </AuthCard>
  );
}
