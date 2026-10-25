/**
 * Database seed.
 *   npm run db:seed                 → system roles, permissions, platform defaults (safe in every environment)
 *   SEED_DEMO=true npm run db:seed  → also creates DEMO data for local development ONLY
 *
 * Demo data is fictional. Demo plan prices are placeholders that must be
 * replaced in Platform admin → Plans before taking real payments. The demo
 * seed refuses to run when APP_ENV=production.
 *
 * Runs as the migration (owner) role, so RLS does not apply here.
 */
import { PrismaClient } from "@prisma/client";
import { seedSystem } from "../src/server/seed/system";
import { hashPassword, encrypt } from "../src/server/auth/crypto";
import { generateTotpSecret } from "../src/server/auth/totp";
import { DEFAULT_COMPETENCIES, DEFAULT_RETENTION, DEFAULT_STAGES } from "../src/server/services/defaults";

const prisma = new PrismaClient({ datasources: { db: { url: process.env.MIGRATION_DATABASE_URL ?? process.env.DATABASE_URL } } });

async function demo() {
  if (process.env.APP_ENV === "production") throw new Error("Refusing to seed demo data in production");
  const password = process.env.SEED_DEMO_PASSWORD || "Demo-password-2026!";
  const pw = await hashPassword(password);
  const verified = new Date();

  async function user(email: string, first: string, last: string, extra: Record<string, unknown> = {}) {
    return prisma.user.upsert({
      where: { email },
      create: { email, passwordHash: pw, emailVerifiedAt: verified, profile: { create: { firstName: first, lastName: last } }, ...extra },
      update: {},
    });
  }

  // Platform super-admin with MFA (secret printed once below).
  const totp = generateTotpSecret();
  const admin = await prisma.user.findUnique({ where: { email: "admin@atlas.example" } });
  if (!admin) await user("admin@atlas.example", "Platform", "Admin", { platformRole: "SUPER_ADMIN", mfaSecret: encrypt(totp), mfaEnabledAt: new Date() });

  // Plans & packs — DEVELOPMENT PLACEHOLDERS.
  const plans = [
    { key: "starter", name: "Starter", priceAmount: 0, trialDays: 14, ent: { seats: "3", monthly_interview_credits: "10", trial_interview_credits: "10", "feature.realtime_interviews": "false" } },
    { key: "growth", name: "Growth", priceAmount: 0, trialDays: 14, ent: { seats: "15", monthly_interview_credits: "100", trial_interview_credits: "20", "feature.realtime_interviews": "true", "feature.campus": "true" } },
    { key: "enterprise", name: "Enterprise", priceAmount: 0, trialDays: 0, ent: { seats: "500", monthly_interview_credits: "1000", "feature.realtime_interviews": "true", "feature.campus": "true", "feature.sso": "true" } },
  ];
  for (const [i, p] of plans.entries()) {
    const plan = await prisma.plan.upsert({
      where: { key: p.key },
      create: { key: p.key, name: p.name, description: "Development placeholder — set real pricing and a Stripe price ID in Platform admin.", priceAmount: p.priceAmount, currency: "usd", trialDays: p.trialDays, sortOrder: i, stripePriceId: process.env[`SEED_STRIPE_PRICE_${p.key.toUpperCase()}`] ?? null },
      update: {},
    });
    for (const [key, value] of Object.entries(p.ent)) await prisma.planEntitlement.upsert({ where: { planId_key: { planId: plan.id, key } }, create: { planId: plan.id, key, value }, update: { value } });
  }
  await prisma.creditPack.upsert({ where: { key: "credits-25" }, create: { key: "credits-25", name: "25 interview credits", credits: 25, priceAmount: 0, currency: "usd", audience: "EMPLOYER", expiresInDays: 365 }, update: {} });
  await prisma.creditPack.upsert({ where: { key: "practice-10" }, create: { key: "practice-10", name: "10 practice sessions", credits: 10, priceAmount: 0, currency: "usd", audience: "STUDENT", expiresInDays: 365 }, update: {} });

  // Employer workspace.
  const owner = await user("owner@northwind.example", "Olivia", "Owner");
  const hr = await user("hr@northwind.example", "Harper", "Reyes");
  const recruiter = await user("recruiter@northwind.example", "Ravi", "Kumar");
  const roles = Object.fromEntries((await prisma.role.findMany({ where: { organisationId: null } })).map((r) => [r.key, r.id]));
  let org = await prisma.organisation.findUnique({ where: { slug: "northwind-labs" } });
  if (!org) {
    org = await prisma.organisation.create({
      data: {
        slug: "northwind-labs",
        name: "Northwind Labs (demo)",
        type: "EMPLOYER",
        verificationStatus: "VERIFIED",
        country: "GB",
        website: "https://northwind.example",
        industry: "Software",
        billingEmail: owner.email,
        termsAcceptedAt: new Date(),
        termsVersion: "2026-10-01",
        memberships: { create: [{ userId: owner.id, roleId: roles.OWNER }, { userId: hr.id, roleId: roles.HR_ADMIN }, { userId: recruiter.id, roleId: roles.RECRUITER }] },
      },
    });
    await prisma.applicationStage.createMany({ data: DEFAULT_STAGES.map((s, i) => ({ organisationId: org!.id, key: s.key, name: s.name, kind: s.kind, position: i, isTerminal: !!s.terminal })) });
    const compIds: string[] = [];
    for (const c of DEFAULT_COMPETENCIES) {
      const comp = await prisma.competency.create({ data: { organisationId: org.id, key: c.key, name: c.name, description: c.description, category: c.category } });
      compIds.push(comp.id);
      await prisma.competencyRubric.create({ data: { organisationId: org.id, competencyId: comp.id, version: 1, criteria: [...c.criteria], indicators: c.indicators as never, levels: c.levels as never, evidenceRequirements: c.evidenceRequirements, scoringGuidance: c.scoringGuidance, createdById: owner.id } });
    }
    await prisma.retentionPolicy.createMany({ data: DEFAULT_RETENTION.map((r) => ({ ...r, organisationId: org!.id })) });
    const growth = await prisma.plan.findUniqueOrThrow({ where: { key: "growth" } });
    const now = new Date();
    await prisma.subscription.create({ data: { organisationId: org.id, planId: growth.id, status: "TRIALING", provider: "internal", currentPeriodStart: now, currentPeriodEnd: new Date(now.getTime() + 14 * 86400_000), trialEndsAt: new Date(now.getTime() + 14 * 86400_000) } });
    const acct = await prisma.creditAccount.create({ data: { ownerType: "ORGANISATION", organisationId: org.id, available: 20 } });
    await prisma.creditLedgerEntry.create({ data: { accountId: acct.id, organisationId: org.id, type: "GRANT_SUBSCRIPTION", amountAvailable: 20, balanceAvailable: 20, balanceReserved: 0, idempotencyKey: "seed:trial", reason: "Demo trial credits" } });
    const tpl = await prisma.interviewTemplate.create({
      data: {
        organisationId: org.id,
        name: "Graduate software engineer — screening",
        mode: "STRUCTURED_AUDIO",
        durationMinutes: 15,
        questionCount: 3,
        answerSeconds: 120,
        createdById: owner.id,
        candidateInstructions: "Answer each question in your own words. You can type your answer instead of recording if you prefer.",
        competencies: { create: compIds.slice(0, 3).map((competencyId) => ({ competency: { connect: { id: competencyId } } })) },
        questions: {
          create: [
            { position: 0, prompt: "Tell us about a project where you had to explain a technical idea to someone non-technical. How did you approach it?", competencyId: compIds[0] },
            { position: 1, prompt: "Describe a difficult bug or problem you solved. How did you work out the cause?", competencyId: compIds[1] },
            { position: 2, prompt: "Which programming concepts from your studies or projects do you feel most confident applying, and where have you used them?", competencyId: compIds[2] },
          ],
        },
      },
    });
    const job = await prisma.job.create({
      data: {
        organisationId: org.id,
        title: "Graduate Software Engineer",
        slug: "graduate-software-engineer",
        description: "Join our platform team to build reliable, well-tested services. You'll pair with senior engineers, ship features end-to-end and take part in code review.",
        requiredQualifications: ["Degree in Computer Science or a related field, or equivalent practical experience"],
        requiredSkills: ["TypeScript", "SQL"],
        preferredSkills: ["React", "Testing"],
        location: "London",
        country: "GB",
        remotePolicy: "HYBRID",
        employmentType: "GRADUATE_PROGRAMME",
        salaryMin: 38000,
        salaryMax: 45000,
        salaryCurrency: "GBP",
        salaryPeriod: "YEAR",
        visibility: "PUBLIC",
        campusHiring: true,
        eligibleGraduationYears: [2026, 2027],
        status: "PUBLISHED",
        publishedAt: new Date(),
        createdById: owner.id,
        interviewTemplateId: tpl.id,
      },
    });
    await prisma.jobAssignment.createMany({ data: [{ organisationId: org.id, jobId: job.id, userId: recruiter.id, role: "RECRUITER" }, { organisationId: org.id, jobId: job.id, userId: hr.id, role: "HIRING_MANAGER" }] });
  }

  // University workspace.
  const placement = await user("placement@uni.example", "Priya", "Shah");
  if (!(await prisma.organisation.findUnique({ where: { slug: "riverside-university" } }))) {
    const uni = await prisma.organisation.create({
      data: { slug: "riverside-university", name: "Riverside University (demo)", type: "UNIVERSITY", verificationStatus: "VERIFIED", country: "GB", termsAcceptedAt: new Date(), termsVersion: "2026-10-01", memberships: { create: { userId: placement.id, roleId: roles.OWNER } }, universityProfile: { create: {} } },
    });
    const prog = await prisma.placementProgramme.create({ data: { organisationId: uni.id, name: "Graduate Placement Programme 2027", academicYear: "2026/27", eligibility: { graduationYears: [2027], degrees: [] } } });
    await prisma.studentCohort.create({ data: { organisationId: uni.id, programmeId: prog.id, name: "Computer Science — Class of 2027", graduationYear: 2027 } });
  }

  // Student.
  const student = await user("student@uni.example", "Sam", "Taylor", { signupIntent: "STUDENT" });
  await prisma.studentProfile.upsert({
    where: { userId: student.id },
    create: { userId: student.id, headline: "Final-year Computer Science student", country: "GB", city: "Bristol", graduationYear: 2027, currentInstitution: "Riverside University", currentDegree: "BSc Computer Science", languages: ["English"], links: [], onboardingCompletedAt: new Date(), skills: { create: [{ name: "TypeScript" }, { name: "SQL" }, { name: "React" }] }, education: { create: { institution: "Riverside University", degree: "BSc Computer Science", graduationYear: 2027 } } },
    update: {},
  });

  // DEMO ONLY: explicitly grant platform AI to the demo employer and to personal (student)
  // accounts for whichever deployment providers are configured, so the local demo works.
  // Real organisations start with NO platform AI until a super-admin grants it.
  const llmMap: Record<string, "ANTHROPIC" | "OPENAI" | "GEMINI" | "FIXTURE"> = { anthropic: "ANTHROPIC", openai: "OPENAI", gemini: "GEMINI", fixture: "FIXTURE" };
  const sttMap: Record<string, "OPENAI" | "DEEPGRAM" | "FIXTURE"> = { openai: "OPENAI", deepgram: "DEEPGRAM", fixture: "FIXTURE" };
  const llmProvider = llmMap[process.env.LLM_PROVIDER ?? ""];
  const sttProvider = sttMap[process.env.STT_PROVIDER ?? ""];
  const demoGrant = async (subject: string, organisationId: string | null, capability: string, provider: string) =>
    prisma.platformAiGrant.upsert({
      where: { subject_provider_capability: { subject, provider: provider as never, capability: capability as never } },
      create: { subject, organisationId, provider: provider as never, capability: capability as never, enabled: true },
      update: {},
    });
  const grants: string[] = [];
  if (llmProvider) {
    for (const c of ["JOB_DRAFTING", "QUESTION_GENERATION", "INTERVIEW_CONVERSATION", "ASSESSMENT"]) await demoGrant(org.id, org.id, c, llmProvider);
    for (const c of ["RESUME_PARSING", "PRACTICE_COACHING"]) await demoGrant("PERSONAL", null, c, llmProvider);
    grants.push(`text AI via ${llmProvider}`);
  }
  if (sttProvider) {
    await demoGrant(org.id, org.id, "TRANSCRIPTION", sttProvider);
    await demoGrant("PERSONAL", null, "TRANSCRIPTION", sttProvider);
    grants.push(`speech-to-text via ${sttProvider}`);
  }

  console.log("\nDemo data ready (all accounts use the same password):");
  if (grants.length) console.log(`  demo AI grants:   ${grants.join(", ")} (northwind-labs + personal accounts only)`);
  console.log(`  password: ${password}`);
  console.log("  employer owner:   owner@northwind.example");
  console.log("  HR admin:         hr@northwind.example");
  console.log("  recruiter:        recruiter@northwind.example");
  console.log("  university owner: placement@uni.example");
  console.log("  student:          student@uni.example");
  if (!admin) console.log(`  platform admin:   admin@atlas.example  (TOTP secret: ${totp} — add it to an authenticator app)`);
}

async function main() {
  await seedSystem(prisma);
  console.log("System roles & permissions seeded.");
  if (process.env.SEED_DEMO === "true") await demo();
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
