import { redirect } from "next/navigation";
import Link from "next/link";
import { Building2, GraduationCap } from "lucide-react";
import { requireVerifiedPage } from "@/server/auth/page";
import { prisma } from "@/server/db/client";

export default async function Onboarding() {
  const s = await requireVerifiedPage();
  const user = await prisma.user.findUniqueOrThrow({ where: { id: s.user.id }, select: { signupIntent: true } });
  if (user.signupIntent === "EMPLOYER") redirect("/onboarding/organisation");
  if (user.signupIntent === "UNIVERSITY") redirect("/onboarding/organisation?type=UNIVERSITY");
  if (user.signupIntent === "STUDENT" || user.signupIntent === "CANDIDATE") redirect("/onboarding/student");
  return (
    <div className="rounded-xl border border-border bg-surface p-8">
      <h1 className="text-2xl font-semibold">How will you use the platform?</h1>
      <div className="mt-6 grid gap-3 sm:grid-cols-2">
        <Link href="/onboarding/organisation" className="rounded-lg border border-border p-5 hover:border-primary"><Building2 className="h-5 w-5 text-primary" /><p className="mt-2 font-medium">Set up an organisation</p></Link>
        <Link href="/onboarding/student" className="rounded-lg border border-border p-5 hover:border-primary"><GraduationCap className="h-5 w-5 text-primary" /><p className="mt-2 font-medium">Create my career profile</p></Link>
      </div>
    </div>
  );
}
