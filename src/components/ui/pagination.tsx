import Link from "next/link";

export function Pagination({ page, pageSize, total, basePath, params }: { page: number; pageSize: number; total: number; basePath: string; params: Record<string, string | undefined> }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (pages <= 1) return null;
  const href = (p: number) => {
    const q = new URLSearchParams(Object.entries(params).filter(([, v]) => v) as [string, string][]);
    q.set("page", String(p));
    return `${basePath}?${q.toString()}`;
  };
  return (
    <nav aria-label="Pagination" className="mt-6 flex items-center justify-between text-sm">
      <span className="text-subtle">Page {page} of {pages} · {total} results</span>
      <div className="flex gap-2">
        {page > 1 && <Link className="rounded border border-border px-3 py-1.5 hover:bg-muted" href={href(page - 1)}>Previous</Link>}
        {page < pages && <Link className="rounded border border-border px-3 py-1.5 hover:bg-muted" href={href(page + 1)}>Next</Link>}
      </div>
    </nav>
  );
}
