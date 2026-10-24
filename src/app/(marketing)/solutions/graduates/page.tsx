import { Hero, Section, FeatureGrid, CtaBand } from "@/components/marketing";

export const metadata = { title: "For students and graduates" };

export default function Graduates() {
  return (
    <>
      <Hero eyebrow="Students & graduates" title="Your career profile, applications and interview practice in one place" lead="Find opportunities you're eligible for, apply with a profile you control, and practise interviews privately." primary={{ href: "/register/student", label: "Create a free profile" }} secondary={{ href: "/jobs", label: "Browse jobs" }} />
      <Section>
        <FeatureGrid items={[
          { title: "Private by default", body: "Your profile isn't public. Employers only see what you choose to share when you apply — and you preview it first." },
          { title: "Explainable recommendations", body: "We tell you why a role was suggested — based on your skills, qualifications and preferences only." },
          { title: "Private practice interviews", body: "Practise with AI coaching on relevance, clarity and completeness. Practice sessions are never shown to employers." },
          { title: "Track every application", body: "See status updates, interview invitations and any feedback the employer has chosen to share." },
          { title: "Accessibility", body: "Request accommodations privately, type answers instead of speaking, and use captions." },
          { title: "Your data, your control", body: "Export or delete your data at any time from your privacy settings." },
        ]} />
      </Section>
      <CtaBand title="Get started in two minutes" lead="Verify your email, add your education and skills, and see matching opportunities." primary={{ href: "/register/student", label: "Create profile" }} />
    </>
  );
}
