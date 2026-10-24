import * as React from "react";
import { cn } from "@/lib/cn";
import { ButtonLink } from "./ui/button";

export function Section({ className, children, id }: { className?: string; children: React.ReactNode; id?: string }) {
  return <section id={id} className={cn("mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-20", className)}>{children}</section>;
}

export function Eyebrow({ children }: { children: React.ReactNode }) {
  return <p className="text-sm font-semibold uppercase tracking-wider text-primary">{children}</p>;
}

export function Hero({ eyebrow, title, lead, primary, secondary, children }: { eyebrow?: string; title: React.ReactNode; lead: React.ReactNode; primary?: { href: string; label: string }; secondary?: { href: string; label: string }; children?: React.ReactNode }) {
  return (
    <div className="relative overflow-hidden border-b border-border bg-gradient-to-b from-primary-soft/60 to-bg">
      <Section className="pb-14 pt-16 sm:pt-24">
        <div className="max-w-3xl">
          {eyebrow && <Eyebrow>{eyebrow}</Eyebrow>}
          <h1 className="mt-3 text-4xl font-semibold leading-[1.1] sm:text-5xl">{title}</h1>
          <p className="mt-5 text-lg leading-relaxed text-subtle">{lead}</p>
          {(primary || secondary) && (
            <div className="mt-8 flex flex-wrap gap-3">
              {primary && <ButtonLink href={primary.href} size="lg">{primary.label}</ButtonLink>}
              {secondary && <ButtonLink href={secondary.href} size="lg" variant="secondary">{secondary.label}</ButtonLink>}
            </div>
          )}
        </div>
        {children}
      </Section>
    </div>
  );
}

export function FeatureGrid({ items, cols = 3 }: { items: { icon?: React.ComponentType<{ className?: string }>; title: string; body: React.ReactNode }[]; cols?: 2 | 3 | 4 }) {
  return (
    <div className={cn("grid gap-5 sm:grid-cols-2", cols === 3 && "lg:grid-cols-3", cols === 4 && "lg:grid-cols-4")}>
      {items.map((f) => (
        <div key={f.title} className="rounded-lg border border-border bg-surface p-5 shadow-card">
          {f.icon && <div className="mb-3 inline-flex rounded-md bg-primary-soft p-2"><f.icon className="h-5 w-5 text-primary" /></div>}
          <h3 className="font-semibold">{f.title}</h3>
          <div className="mt-1.5 text-sm leading-relaxed text-subtle">{f.body}</div>
        </div>
      ))}
    </div>
  );
}

export function SectionHeading({ eyebrow, title, lead, center }: { eyebrow?: string; title: React.ReactNode; lead?: React.ReactNode; center?: boolean }) {
  return (
    <div className={cn("mb-10 max-w-2xl", center && "mx-auto text-center")}>
      {eyebrow && <Eyebrow>{eyebrow}</Eyebrow>}
      <h2 className="mt-2 text-3xl font-semibold">{title}</h2>
      {lead && <p className="mt-3 text-subtle">{lead}</p>}
    </div>
  );
}

export function CtaBand({ title, lead, primary, secondary }: { title: string; lead: string; primary: { href: string; label: string }; secondary?: { href: string; label: string } }) {
  return (
    <Section>
      <div className="rounded-xl bg-fg px-6 py-12 text-bg sm:px-12">
        <h2 className="text-2xl font-semibold sm:text-3xl">{title}</h2>
        <p className="mt-2 max-w-2xl text-bg/70">{lead}</p>
        <div className="mt-6 flex flex-wrap gap-3">
          <ButtonLink href={primary.href} size="lg" className="bg-bg text-fg hover:bg-bg/90">{primary.label}</ButtonLink>
          {secondary && <ButtonLink href={secondary.href} size="lg" variant="ghost" className="text-bg hover:bg-bg/10">{secondary.label}</ButtonLink>}
        </div>
      </div>
    </Section>
  );
}

export function Prose({ children }: { children: React.ReactNode }) {
  return <div className="prose-body max-w-3xl text-[15px] text-fg/90">{children}</div>;
}
