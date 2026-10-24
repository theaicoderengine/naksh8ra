import type { StageKind } from "@prisma/client";

export const DEFAULT_STAGES: { key: string; name: string; kind: StageKind; terminal?: boolean }[] = [
  { key: "new", name: "New application", kind: "NEW" },
  { key: "review", name: "Initial review", kind: "REVIEW" },
  { key: "screening", name: "Screening", kind: "SCREENING" },
  { key: "ai_invited", name: "AI interview invited", kind: "AI_INTERVIEW_INVITED" },
  { key: "ai_completed", name: "AI interview completed", kind: "AI_INTERVIEW_COMPLETED" },
  { key: "human_interview", name: "Human interview", kind: "HUMAN_INTERVIEW" },
  { key: "final_review", name: "Final review", kind: "FINAL_REVIEW" },
  { key: "offer", name: "Offer", kind: "OFFER" },
  { key: "hired", name: "Hired", kind: "HIRED", terminal: true },
  { key: "rejected", name: "Rejected", kind: "REJECTED", terminal: true },
  { key: "withdrawn", name: "Withdrawn", kind: "WITHDRAWN", terminal: true },
];

const LEVELS = (d: [string, string, string, string, string]) =>
  d.map((descriptor, i) => ({ rating: `R${i + 1}`, label: ["Limited", "Developing", "Competent", "Strong", "Exceptional"][i], descriptor }));

/**
 * Starter competency library. Organisations should review and adapt these to
 * the actual job requirements before relying on them (see docs/assessment.md).
 * Criteria describe observable answer content only — never accent, tone,
 * speaking speed, appearance or personality inference.
 */
export const DEFAULT_COMPETENCIES = [
  {
    key: "communication",
    name: "Structured communication",
    category: "BEHAVIOURAL",
    description: "Explains ideas, decisions and outcomes clearly and in a logical order relevant to the question.",
    criteria: ["Answers the question that was asked", "Organises the answer (context → action → result)", "Uses concrete specifics rather than generalities"],
    indicators: {
      positive: ["States the situation and their own role", "Summarises the outcome", "Checks or clarifies ambiguous questions"],
      negative: ["Answer does not address the question", "Key facts missing so the listener cannot follow"],
    },
    levels: LEVELS([
      "Answer is largely unrelated to the question or cannot be followed.",
      "Partially addresses the question; important structure or specifics missing.",
      "Addresses the question with a clear structure and some specifics.",
      "Clear, well-ordered and specific; anticipates follow-up questions.",
      "Exceptionally clear and concise; tailors detail precisely to the question.",
    ]),
    evidenceRequirements: "At least one complete answer where the candidate describes a situation, their actions and the outcome.",
    scoringGuidance: "Assess content and organisation only. Do not consider accent, grammar typical of non-native speakers, pace, or vocal tone.",
  },
  {
    key: "problem_solving",
    name: "Problem solving",
    category: "GENERAL",
    description: "Breaks problems down, considers options and justifies a chosen approach.",
    criteria: ["Identifies the core problem", "Considers more than one option or trade-off", "Justifies decisions with reasoning or data"],
    indicators: {
      positive: ["Describes how they diagnosed the issue", "Explains trade-offs", "Reflects on what they would do differently"],
      negative: ["Jumps to a solution without analysis", "Cannot explain why an approach was chosen"],
    },
    levels: LEVELS([
      "No discernible approach to the problem.",
      "Describes a solution but little analysis or justification.",
      "Clear analysis and a justified approach.",
      "Weighs alternatives and trade-offs explicitly; learns from outcome.",
      "Sophisticated, well-evidenced reasoning applied to a complex problem.",
    ]),
    evidenceRequirements: "A described problem the candidate worked on, with their reasoning.",
    scoringGuidance: "Credit reasoning that is explicitly stated. Missing detail is insufficient evidence, not poor performance.",
  },
  {
    key: "role_knowledge",
    name: "Role-relevant knowledge",
    category: "TECHNICAL",
    description: "Demonstrates knowledge and skills required by the specific vacancy.",
    criteria: ["Uses role-relevant concepts accurately", "Applies knowledge to a realistic scenario", "Recognises limits of their knowledge"],
    indicators: {
      positive: ["Accurate use of domain concepts", "Concrete example of applying a skill listed in the job"],
      negative: ["Factually incorrect statements about core concepts"],
    },
    levels: LEVELS([
      "Little or inaccurate role knowledge shown.",
      "Basic knowledge with gaps on core requirements.",
      "Solid knowledge covering core requirements.",
      "Deep knowledge applied to realistic scenarios.",
      "Expert-level knowledge with nuanced application.",
    ]),
    evidenceRequirements: "At least one answer to a role-specific question.",
    scoringGuidance: "Compare only against the requirements listed in the vacancy.",
  },
  {
    key: "collaboration",
    name: "Collaboration",
    category: "BEHAVIOURAL",
    description: "Works effectively with others, shares information and resolves disagreements constructively.",
    criteria: ["Describes working with others towards a shared goal", "Handles disagreement constructively", "Credits others appropriately"],
    indicators: {
      positive: ["Specific example of collaboration", "Describes how a conflict was resolved"],
      negative: ["Blames others without reflection"],
    },
    levels: LEVELS([
      "No relevant example given.",
      "Generic statements about teamwork without specifics.",
      "Specific example of effective collaboration.",
      "Example showing constructive handling of disagreement or cross-team work.",
      "Multiple strong examples including enabling others to succeed.",
    ]),
    evidenceRequirements: "A specific example involving other people.",
    scoringGuidance: "Absence of an example is insufficient evidence.",
  },
  {
    key: "ownership",
    name: "Ownership",
    category: "BEHAVIOURAL",
    description: "Takes responsibility for outcomes, follows through and learns from mistakes.",
    criteria: ["Describes their own actions (not only the team's)", "Follows through to an outcome", "Reflects on mistakes or lessons"],
    indicators: {
      positive: ["Uses first-person account of actions", "Describes a lesson learned"],
      negative: ["Cannot distinguish own contribution"],
    },
    levels: LEVELS([
      "No evidence of personal responsibility.",
      "Some personal actions described; little follow-through.",
      "Clear personal ownership of a task to completion.",
      "Proactive ownership beyond assigned scope, with reflection.",
      "Consistently drives significant outcomes and improvement.",
    ]),
    evidenceRequirements: "An example where the candidate's own role is clear.",
    scoringGuidance: "Do not penalise candidates for describing team achievements if their own part is explained.",
  },
] as const;

export const DEFAULT_RETENTION = [
  { dataCategory: "AUDIO", retainDays: 180 },
  { dataCategory: "TRANSCRIPT", retainDays: 365 },
  { dataCategory: "ASSESSMENT", retainDays: 365 },
  { dataCategory: "APPLICATION", retainDays: 730 },
  { dataCategory: "RESUME", retainDays: 730 },
  { dataCategory: "AUDIT", retainDays: 2555 },
] as const;
