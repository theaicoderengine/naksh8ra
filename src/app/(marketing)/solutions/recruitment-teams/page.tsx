import { Hero, Section, FeatureGrid, CtaBand } from "@/components/marketing";

export const metadata = { title: "For recruitment teams" };

export default function Teams() {
  return (
    <>
      <Hero eyebrow="Recruitment teams" title="Spend your time on the conversations that matter" lead="Automate consistent first-round interviews, review evidence side by side, and move candidates forward with confidence." primary={{ href: "/register/organisation", label: "Create workspace" }} />
      <Section>
        <FeatureGrid items={[
          { title: "Bulk actions", body: "Move, filter and export candidates in bulk — every change validated and recorded." },
          { title: "Candidate comparison", body: "Compare candidates on the same competencies with missing evidence shown as missing, never guessed." },
          { title: "Reviewer workflow", body: "Hiring managers confirm or adjust AI ratings and submit structured feedback." },
          { title: "Candidate communication", body: "Approved feedback, status updates and reminders — with no sensitive content in email bodies." },
          { title: "Credits you can predict", body: "Credits are reserved per invitation and only consumed when a candidate actually answers." },
          { title: "Interview templates", body: "Reusable templates with versioned rubrics; in-flight interviews are never affected by edits." },
        ]} />
      </Section>
      <CtaBand title="Run your first AI interview today" lead="Invite colleagues and set up a template in minutes." primary={{ href: "/register/organisation", label: "Get started" }} />
    </>
  );
}
