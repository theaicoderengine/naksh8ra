import { Hero, Section, FeatureGrid, CtaBand } from "@/components/marketing";

export const metadata = { title: "For enterprises" };

export default function Enterprise() {
  return (
    <>
      <Hero eyebrow="Enterprise" title="Scale structured hiring across regions and teams" lead="Consistent interviews, auditable decisions and strict data separation — with the controls security and legal teams expect." primary={{ href: "/contact", label: "Talk to sales" }} secondary={{ href: "/security", label: "Security overview" }} />
      <Section>
        <FeatureGrid
          items={[
            { title: "Tenant isolation", body: "Application-level checks plus PostgreSQL row-level security on every tenant table, tested for cross-tenant access." },
            { title: "Granular roles", body: "Separate billing, ownership, decision, transcript and recording permissions. Recruiters only see assigned vacancies." },
            { title: "MFA & sessions", body: "TOTP MFA (enforceable per organisation), revocable sessions, login rate limiting and lockout." },
            { title: "Audit & export controls", body: "Append-only audit trail; exports are permissioned and logged." },
            { title: "Retention controls", body: "Configure retention for audio, transcripts, assessments, applications and resumes within platform limits." },
            { title: "SSO-ready architecture", body: "Identity is decoupled from memberships so enterprise SSO can be added per organisation (see documentation for status)." },
          ]}
        />
      </Section>
      <CtaBand title="Plan an enterprise rollout" lead="We'll walk through data processing terms, regions and integration needs." primary={{ href: "/contact", label: "Contact sales" }} />
    </>
  );
}
