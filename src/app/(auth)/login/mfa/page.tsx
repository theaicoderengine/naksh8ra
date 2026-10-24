import { AuthCard } from "@/components/auth/auth-card";
import { MfaForm } from "@/components/auth/mfa-form";

export const metadata = { title: "Two-factor verification" };

export default async function Mfa({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams;
  return (
    <AuthCard title="Two-factor verification" description="Enter the code from your authenticator app to finish signing in.">
      <MfaForm next={next ?? "/app"} />
    </AuthCard>
  );
}
