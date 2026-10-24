import Link from "next/link";
import { AuthCard } from "@/components/auth/auth-card";
import { RegisterForm } from "@/components/auth/register-form";

export const metadata = { title: "Create a student profile" };

export default function RegisterStudent() {
  return (
    <AuthCard title="Create your career profile" description="Free for students, graduates and job seekers. Your profile stays private until you apply." footer={<>Already registered? <Link className="text-primary hover:underline" href="/login">Sign in</Link></>}>
      <RegisterForm intent="STUDENT" />
    </AuthCard>
  );
}
