export function AuthCard({ title, description, children, footer }: { title: string; description?: React.ReactNode; children: React.ReactNode; footer?: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-border bg-surface p-6 shadow-pop sm:p-8">
      <h1 className="text-2xl font-semibold">{title}</h1>
      {description && <p className="mt-1.5 text-sm text-subtle">{description}</p>}
      <div className="mt-6">{children}</div>
      {footer && <div className="mt-6 border-t border-border pt-4 text-center text-sm text-subtle">{footer}</div>}
    </div>
  );
}
