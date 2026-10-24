import { AuthCard } from "@/components/auth/auth-card";
import { ResetForm } from "@/components/auth/reset-form";
import { Alert } from "@/components/ui/feedback";

export const metadata = { title: "Choose a new password" };

export default async function Reset({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const { token } = await searchParams;
  return <AuthCard title="Choose a new password">{token ? <ResetForm token={token} /> : <Alert tone="danger">This link is missing its token.</Alert>}</AuthCard>;
}
