import { Section } from "@/components/marketing";
import { Badge } from "@/components/ui/badge";
import { ENDPOINTS } from "@/server/openapi";

export const metadata = { title: "API reference" };

export default function ApiDocs() {
  const tags = [...new Set(ENDPOINTS.map((e) => e.tag))];
  return (
    <Section>
      <h1 className="text-3xl font-semibold">REST API reference</h1>
      <p className="mt-2 max-w-3xl text-subtle">Base URL <code className="rounded bg-muted px-1">/api/v1</code>. Machine-readable spec: <a className="text-primary underline" href="/api/v1/openapi.json">openapi.json</a>. Responses use <code>{"{ data }"}</code> or <code>{"{ error: { code, message, details, requestId } }"}</code>. Organisation endpoints take your organisation slug in the <code>x-atlas-org</code> header; access is verified against your membership.</p>
      <div className="mt-8 space-y-8">
        {tags.map((t) => (
          <div key={t}>
            <h2 className="text-lg font-semibold">{t}</h2>
            <div className="mt-2 overflow-hidden rounded-lg border border-border bg-surface">
              {ENDPOINTS.filter((e) => e.tag === t).map((e) => (
                <div key={e.method + e.path} className="flex flex-wrap items-center gap-3 border-b border-border px-4 py-2.5 text-sm last:border-0">
                  <span className="w-14 font-mono text-xs font-semibold uppercase text-primary">{e.method}</span>
                  <code className="font-mono text-xs">{e.path}</code>
                  <span className="flex-1 text-subtle">{e.summary}</span>
                  {e.permission && <Badge>{e.permission}</Badge>}
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </Section>
  );
}
