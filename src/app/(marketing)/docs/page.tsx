import Link from "next/link";
import { Hero, Section } from "@/components/marketing";

export const metadata = { title: "Documentation" };

export default function Docs() {
  return (
    <>
      <Hero eyebrow="Documentation" title="Guides and API reference" lead="Everything you need to set up a workspace, run interviews and integrate with the API." />
      <Section>
        <div className="grid gap-4 md:grid-cols-2">
          {[
            ["/docs/getting-started", "Getting started", "Create a workspace, invite your team, publish a vacancy and send your first interview."],
            ["/docs/interviews", "Interviews & assessment", "Interview modes, templates, competencies, rubrics, review and billing rules."],
            ["/docs/students", "For students", "Profiles, applications, practice interviews and privacy controls."],
            ["/docs/api", "REST API reference", "Versioned /api/v1 endpoints generated from the server validators (OpenAPI 3)."],
          ].map(([href, t, d]) => (
            <Link key={href} href={href} className="rounded-xl border border-border bg-surface p-5 hover:shadow-pop">
              <p className="font-semibold">{t}</p>
              <p className="mt-1 text-sm text-subtle">{d}</p>
            </Link>
          ))}
        </div>
      </Section>
    </>
  );
}
