import Link from "next/link";
import { AuthCard } from "@/components/auth/auth-card";
import { LoginForm } from "@/components/auth/login-form";

export const metadata = { title: "Sign in" };

export default async function Login({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams;
  return (
    <AuthCard title="Welcome back" description="Sign in to your workspace or student account." footer={<>New here? <Link href="/register" className="text-primary hover:underline">Create an account</Link></>}>
      <LoginForm next={next ?? null} />
    </AuthCard>
  );
}
