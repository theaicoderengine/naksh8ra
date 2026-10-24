export default function Loading() {
  return (
    <div className="animate-pulse space-y-4" aria-busy="true" aria-label="Loading">
      <div className="h-8 w-64 rounded bg-muted" />
      <div className="grid gap-4 sm:grid-cols-4">{[0, 1, 2, 3].map((i) => <div key={i} className="h-24 rounded-lg bg-muted" />)}</div>
      <div className="h-64 rounded-lg bg-muted" />
    </div>
  );
}
