import { AuthCard } from "@/components/auth/auth-card";
import { ButtonLink } from "@/components/ui/button";

export const metadata = { title: "Workspace suspended" };

export default function Suspended() {
  return (
    <AuthCard title="This workspace is suspended" description="Access has been paused by the platform. Your data is retained. Contact support or your workspace owner for details.">
      <div className="flex gap-2"><ButtonLink href="/contact" variant="secondary">Contact support</ButtonLink><ButtonLink href="/app">Switch workspace</ButtonLink></div>
    </AuthCard>
  );
}
