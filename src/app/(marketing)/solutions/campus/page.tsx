import { Hero, Section, FeatureGrid, CtaBand } from "@/components/marketing";

export const metadata = { title: "Campus placement" };

export default function Campus() {
  return (
    <>
      <Hero eyebrow="Universities & placement cells" title="Coordinate placements with employers — with student consent" lead="Manage programmes and cohorts, invite students via CSV, and follow aggregate progress without accessing confidential employer assessments." primary={{ href: "/register/organisation?type=UNIVERSITY", label: "Create university workspace" }} secondary={{ href: "/contact", label: "Talk to us" }} />
      <Section>
        <FeatureGrid items={[
          { title: "Programmes & cohorts", body: "Organise graduation batches, eligibility criteria and placement officers." },
          { title: "Validated CSV import", body: "Invite thousands of students; invalid rows are reported and nothing partial is imported." },
          { title: "Consent-gated visibility", body: "Students accept cohort invitations before you see their profile summary and application counts." },
          { title: "Employer partnerships", body: "Invite employers to programmes; their campus vacancies can target your programme." },
          { title: "Aggregate analytics", body: "Cohort-level counts with small numbers suppressed to protect individual privacy." },
          { title: "Clear boundaries", body: "No access to employer interview recordings, transcripts, assessments or internal HR decisions." },
        ]} />
      </Section>
      <CtaBand title="Bring your placement programme online" lead="Set up a workspace and import your first cohort." primary={{ href: "/register/organisation?type=UNIVERSITY", label: "Get started" }} />
    </>
  );
}
