/**
 * Single-series horizontal bar list (magnitude by category). One hue, thin
 * bars with 4px rounded data-ends, values in text ink beside the bar, a
 * per-row hover title, and an accessible list structure (no colour-only info).
 */
export function BarList({ rows, label }: { rows: { key: string; label: string; value: number; hint?: string }[]; label: string }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <ul aria-label={label} className="space-y-2.5">
      {rows.map((r) => (
        <li key={r.key} className="grid grid-cols-[minmax(8rem,12rem)_1fr_3rem] items-center gap-3 text-sm" title={`${r.label}: ${r.value}${r.hint ? ` (${r.hint})` : ""}`}>
          <span className="truncate text-subtle">{r.label}</span>
          <span className="relative h-2.5 rounded bg-muted" aria-hidden="true">
            <span className="absolute inset-y-0 left-0 rounded bg-primary" style={{ width: `${(r.value / max) * 100}%`, minWidth: r.value > 0 ? 4 : 0 }} />
          </span>
          <span className="text-right tabular-nums font-medium">{r.value}</span>
        </li>
      ))}
    </ul>
  );
}
