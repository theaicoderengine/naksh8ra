import Link from "next/link";
import { Building2, GraduationCap, Landmark } from "lucide-react";
import { AuthCard } from "@/components/auth/auth-card";

export const metadata = { title: "Create an account" };

export default function RegisterChoice() {
  const opts = [
    { href: "/register/organisation", icon: Building2, t: "I'm hiring", d: "Create an organisation workspace for your recruitment team." },
    { href: "/register/student", icon: GraduationCap, t: "I'm a student, graduate or job seeker", d: "Build your profile, apply to roles and practise interviews." },
    { href: "/register/organisation?type=UNIVERSITY", icon: Landmark, t: "I run a university placement programme", d: "Manage cohorts and placement partnerships." },
  ];
  return (
    <AuthCard title="Create your account" footer={<>Already have an account? <Link className="text-primary hover:underline" href="/login">Sign in</Link></>}>
      <div className="space-y-3">
        {opts.map((o) => (
          <Link key={o.href} href={o.href} className="flex gap-3 rounded-lg border border-border p-4 hover:border-primary hover:bg-primary-soft/40">
            <o.icon className="mt-0.5 h-5 w-5 text-primary" aria-hidden="true" />
            <span><span className="block font-medium">{o.t}</span><span className="block text-sm text-subtle">{o.d}</span></span>
          </Link>
        ))}
      </div>
    </AuthCard>
  );
}
