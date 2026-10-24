import { Mic, Scale, ListChecks, Users, BarChart3, FileSearch, Bell, Lock, Download, Workflow, Languages, Accessibility } from "lucide-react";
import { Hero, Section, FeatureGrid, CtaBand } from "@/components/marketing";

export const metadata = { title: "Product features" };

export default function Features() {
  return (
    <>
      <Hero eyebrow="Product" title="A complete recruitment workspace" lead="Vacancies, pipelines, AI interviews, evidence-based review, team permissions, analytics and billing — in one multi-tenant platform." primary={{ href: "/register/organisation", label: "Start a trial" }} secondary={{ href: "/docs", label: "Read the docs" }} />
      <Section>
        <FeatureGrid
          items={[
            { icon: Workflow, title: "Vacancy management", body: "Departments, hiring teams, salary ranges, deadlines, eligibility rules, screening questions and visibility (public, campus, internal, invite-only)." },
            { icon: ListChecks, title: "Configurable pipeline", body: "Your own stages on top of a validated lifecycle. Decisions require permission and a recorded reason." },
            { icon: Mic, title: "AI interviews", body: "Two modes, configurable language, duration, question count, difficulty, fixed or adaptive questions, follow-up limits and retakes." },
            { icon: Scale, title: "Rubric-based assessment", body: "Per-competency ratings with verbatim evidence, missing-evidence notes, uncertainty and model/prompt/rubric versions." },
            { icon: Users, title: "Team roles", body: "Owner, HR admin, recruiter, hiring manager and interview reviewer. Assignment-scoped visibility for recruiters." },
            { icon: BarChart3, title: "Analytics", body: "Funnel, completion rates, time-to-hire, competency distributions and credit usage — computed from your real records." },
            { icon: FileSearch, title: "Resume pipeline", body: "Type-sniffed uploads, optional ClamAV scanning, text extraction and conservative structured parsing with flagged uncertainty." },
            { icon: Bell, title: "Notifications", body: "Transactional email with delivery tracking and in-app notifications, respecting user preferences. No interview content in emails." },
            { icon: Download, title: "Controlled exports", body: "CSV exports are permission-gated, audited and protected against spreadsheet formula injection." },
            { icon: Lock, title: "Audit trail", body: "Sensitive changes record actor, timestamp, target, reason and result on an append-only log." },
            { icon: Languages, title: "Global ready", body: "Per-template interview language, organisation time zones and locales, and data region tagging." },
            { icon: Accessibility, title: "Accessible by design", body: "Keyboard navigation, captions, typed answers, extended time and private accommodation requests." },
          ]}
        />
      </Section>
      <CtaBand title="See it with your own vacancies" lead="Create a workspace in minutes. No credit card is needed for the trial." primary={{ href: "/register/organisation", label: "Get started" }} />
    </>
  );
}
