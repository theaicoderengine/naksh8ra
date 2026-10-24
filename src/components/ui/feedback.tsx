import * as React from "react";
import { cn } from "@/lib/cn";
import { AlertTriangle, CheckCircle2, Info, XCircle, Inbox, Lock } from "lucide-react";

const alertTones = {
  info: { cls: "border-primary/30 bg-primary-soft text-fg", Icon: Info, icon: "text-primary" },
  success: { cls: "border-success/30 bg-success-soft text-fg", Icon: CheckCircle2, icon: "text-success" },
  warning: { cls: "border-warning/30 bg-warning-soft text-fg", Icon: AlertTriangle, icon: "text-warning" },
  danger: { cls: "border-danger/30 bg-danger-soft text-fg", Icon: XCircle, icon: "text-danger" },
};

export function Alert({ tone = "info", title, children, className, action }: { tone?: keyof typeof alertTones; title?: React.ReactNode; children?: React.ReactNode; className?: string; action?: React.ReactNode }) {
  const t = alertTones[tone];
  return (
    <div role={tone === "danger" ? "alert" : "status"} className={cn("flex gap-3 rounded-lg border p-4 text-sm", t.cls, className)}>
      <t.Icon className={cn("mt-0.5 h-4 w-4 shrink-0", t.icon)} aria-hidden="true" />
      <div className="min-w-0 flex-1">
        {title && <p className="font-medium">{title}</p>}
        {children && <div className={cn(title && "mt-1", "text-subtle")}>{children}</div>}
      </div>
      {action}
    </div>
  );
}

export function EmptyState({ title, description, action, icon: Icon = Inbox, className }: { title: string; description?: React.ReactNode; action?: React.ReactNode; icon?: React.ComponentType<{ className?: string }>; className?: string }) {
  return (
    <div className={cn("flex flex-col items-center justify-center rounded-lg border border-dashed border-border px-6 py-12 text-center", className)}>
      <div className="mb-3 rounded-full bg-muted p-3"><Icon className="h-5 w-5 text-subtle" /></div>
      <p className="font-medium">{title}</p>
      {description && <p className="mt-1 max-w-md text-sm text-subtle">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function PermissionDenied({ what = "this page" }: { what?: string }) {
  return <EmptyState icon={Lock} title="You don't have access" description={`Your role doesn't include permission to view ${what}. Ask a workspace owner if you need access.`} />;
}
