import Link from "next/link";
import { AuthCard } from "@/components/auth/auth-card";
import { EmailActionForm } from "@/components/auth/email-action-form";

export const metadata = { title: "Reset password" };

export default function Forgot() {
  return (
    <AuthCard title="Reset your password" description="We'll email you a single-use link that expires in one hour." footer={<Link href="/login" className="text-primary hover:underline">Back to sign in</Link>}>
      <EmailActionForm endpoint="/auth/password/forgot" cta="Send reset link" />
    </AuthCard>
  );
}
