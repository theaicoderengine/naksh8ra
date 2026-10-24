import { cn } from "@/lib/cn";
import { Check } from "lucide-react";

export function Steps({ steps, current }: { steps: string[]; current: number }) {
  return (
    <ol className="mb-6 flex flex-wrap gap-2" aria-label="Progress">
      {steps.map((s, i) => (
        <li key={s} aria-current={i === current ? "step" : undefined} className={cn("flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-medium", i < current && "border-success/40 bg-success-soft text-success", i === current && "border-primary bg-primary-soft text-primary", i > current && "border-border text-subtle")}>
          {i < current ? <Check className="h-3 w-3" aria-hidden="true" /> : <span>{i + 1}</span>}
          {s}
        </li>
      ))}
    </ol>
  );
}
