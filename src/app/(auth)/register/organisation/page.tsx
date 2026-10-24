import Link from "next/link";
import { AuthCard } from "@/components/auth/auth-card";
import { RegisterForm } from "@/components/auth/register-form";

export const metadata = { title: "Create an organisation" };

export default async function RegisterOrg({ searchParams }: { searchParams: Promise<{ type?: string; plan?: string }> }) {
  const { type } = await searchParams;
  const uni = type === "UNIVERSITY";
  return (
    <AuthCard
      title={uni ? "Create a university workspace" : "Create your hiring workspace"}
      description="Step 1 of 3 — create your account. After verifying your email you'll set up the organisation and choose a plan."
      footer={<>Already have an account? <Link className="text-primary hover:underline" href="/login?next=/onboarding/organisation">Sign in</Link></>}
    >
      <RegisterForm intent={uni ? "UNIVERSITY" : "EMPLOYER"} askCompany />
    </AuthCard>
  );
}
