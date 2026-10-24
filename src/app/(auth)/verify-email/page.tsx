import { AuthCard } from "@/components/auth/auth-card";
import { VerifyEmail } from "@/components/auth/verify-email";

export const metadata = { title: "Verify email" };

export default async function Verify({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const { token } = await searchParams;
  return <AuthCard title="Verify your email"><VerifyEmail token={token ?? null} /></AuthCard>;
}
