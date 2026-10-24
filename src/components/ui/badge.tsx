import { cn } from "@/lib/cn";

const tones = {
  neutral: "bg-muted text-subtle",
  primary: "bg-primary-soft text-primary",
  success: "bg-success-soft text-success",
  warning: "bg-warning-soft text-warning",
  danger: "bg-danger-soft text-danger",
  accent: "bg-accent-soft text-accent",
};
export type Tone = keyof typeof tones;

export function Badge({ tone = "neutral", children, className, title }: { tone?: Tone; children: React.ReactNode; className?: string; title?: string }) {
  return <span title={title} className={cn("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap", tones[tone], className)}>{children}</span>;
}

const STATUS_TONE: Record<string, Tone> = {
  DRAFT: "neutral", PUBLISHED: "success", PAUSED: "warning", CLOSED: "neutral", ARCHIVED: "neutral",
  SUBMITTED: "primary", IN_REVIEW: "primary", INTERVIEWING: "accent", OFFER: "success", HIRED: "success", REJECTED: "danger", WITHDRAWN: "neutral",
  CREATED: "neutral", INVITED: "primary", READY: "primary", IN_PROGRESS: "accent", INTERRUPTED: "warning", PROCESSING: "accent", ASSESSED: "success", REQUIRES_REVIEW: "warning", REVIEWED: "success", EXPIRED: "neutral", CANCELLED: "neutral", FAILED: "danger", COMPLETED: "success", PENDING: "primary",
  ACTIVE: "success", TRIALING: "accent", PAST_DUE: "danger", CANCELED: "neutral", SUSPENDED: "danger", VERIFIED: "success", UNVERIFIED: "warning",
  OPEN: "primary", RESOLVED: "success", RECEIVED: "primary", PROCESSED: "success", IGNORED: "neutral", QUEUED: "neutral", RUNNING: "accent",
  APPROVED: "success", DENIED: "danger", REQUESTED: "warning", GRANTED: "success", DECLINED: "danger", ACKNOWLEDGED: "primary",
};

export function StatusBadge({ status, label }: { status: string; label?: string }) {
  return <Badge tone={STATUS_TONE[status] ?? "neutral"}>{label ?? status.replace(/_/g, " ").toLowerCase().replace(/^\w/, (c) => c.toUpperCase())}</Badge>;
}
