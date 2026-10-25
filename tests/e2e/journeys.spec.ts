import { test, expect, type Page } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { decrypt } from "../../src/server/auth/crypto";
import { totp } from "../../src/server/auth/totp";

const PW = "E2e-password-2026!";
const run = Date.now().toString(36);
const owner = `owner-${run}@e2e.test`;
const hr = `hr-${run}@e2e.test`;
const student = `student-${run}@e2e.test`;
const orgName = `E2E Corp ${run}`;
const jobTitle = `E2E Analyst ${run}`;
let orgSlug = "";
let applicationUrl = "";

async function mailLink(page: Page, to: string, re: RegExp) {
  for (let i = 0; i < 10; i++) {
    await page.goto("/dev/mailbox");
    const items = page.locator("li", { hasText: to });
    const n = await items.count();
    for (let j = 0; j < n; j++) {
      const m = (await items.nth(j).innerText()).match(re);
      if (m) return m[0];
    }
    await page.waitForTimeout(500);
  }
  throw new Error(`no email for ${to}`);
}

async function register(page: Page, path: string, email: string, first: string) {
  await page.goto(path);
  await page.fill("#firstName", first);
  await page.fill("#lastName", "Tester");
  await page.fill("#email", email);
  await page.fill("#password", PW);
  await page.check("#acceptTerms");
  await page.click("button[type=submit]");
  await expect(page.getByText("Check your inbox")).toBeVisible();
  const link = await mailLink(page, email, /http:\/\/localhost:3000\/verify-email\?token=[\w-]+/);
  await page.goto(link);
  await expect(page.getByText("Email verified")).toBeVisible();
}

async function login(page: Page, email: string, password = PW) {
  await page.context().clearCookies();
  await page.goto("/login");
  await page.fill("#email", email);
  await page.fill("#password", password);
  await page.click("button[type=submit]");
  await Promise.race([
    page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 30_000 }),
    page.locator("form [role=alert]").waitFor({ timeout: 30_000 }).then(async () => {
      throw new Error(`Login failed: ${await page.locator("form [role=alert]").innerText()}`);
    }),
  ]);
}

test.describe.serial("End-to-end journeys", () => {
  test("1–2. organisation registration, onboarding and inviting HR", async ({ page }) => {
    await register(page, "/register/organisation", owner, "Olga");
    await login(page, owner);
    await page.waitForURL(/onboarding\/organisation/);
    await page.fill("#name", orgName);
    await page.click("text=Continue");
    await page.click("text=Continue"); // plan step (trial default)
    await page.check("#terms");
    await page.click("text=Create workspace");
    await expect(page.getByText("Workspace created")).toBeVisible();
    await page.fill("#invites", hr);
    await page.click("text=Send invitations");
    await page.click("text=Go to dashboard");
    await page.waitForURL(/\/w\/[\w-]+$/);
    orgSlug = new URL(page.url()).pathname.split("/")[2];
    await expect(page.getByRole("heading", { name: /Welcome/ })).toBeVisible();

    const invite = await mailLink(page, hr, /http:\/\/localhost:3000\/accept-invite\?token=[\w-]+/);
    await page.context().clearCookies();
    await page.goto(invite);
    await expect(page.getByText(`Join ${orgName}`)).toBeVisible();
    await page.goto(`${invite}&register=1`);
    await page.fill("#firstName", "Hana");
    await page.fill("#lastName", "HR");
    await page.fill("#password", PW);
    await page.check("#acceptTerms");
    await page.click("button[type=submit]");
    await expect(page.getByText("Check your inbox")).toBeVisible();
    await page.goto(await mailLink(page, hr, /http:\/\/localhost:3000\/verify-email\?token=[\w-]+/));
    await login(page, hr);
    await page.goto(invite);
    await page.click("text=Accept invitation");
    await page.waitForURL(new RegExp(`/w/${orgSlug}`));
    await page.goto(`/w/${orgSlug}/team`);
    await expect(page.getByText(hr)).toBeVisible();
  });

  test("3–4. HR creates and publishes a vacancy and configures an interview template", async ({ page }) => {
    await login(page, hr);
    await page.goto(`/w/${orgSlug}/templates/new`);
    await page.fill("#name", "E2E structured screen");
    await page.fill("#qc", "2");
    await page.click("label:has-text('Structured communication')");
    await page.click("text=Add question");
    await page.locator("textarea[aria-label='Question 1 text']").fill("Tell us about a project you are proud of.");
    await page.click("text=Add question");
    await page.locator("textarea[aria-label='Question 2 text']").fill("Describe a problem you solved recently.");
    await page.click("text=Save template");
    await page.waitForURL(new RegExp(`/w/${orgSlug}/templates$`));
    await expect(page.getByText("E2E structured screen")).toBeVisible();

    await page.goto(`/w/${orgSlug}/jobs/new`);
    await page.fill("#title", jobTitle);
    await page.fill("#desc", "Analyse data and present insights to stakeholders in a growing team.");
    await page.fill("#rs", "SQL, Python");
    await page.selectOption("#rp", "REMOTE");
    await page.selectOption("#tpl", { label: "E2E structured screen" });
    await page.click("text=Create draft");
    await page.waitForURL(new RegExp(`/w/${orgSlug}/jobs/\\w+`));
    await page.getByRole("button", { name: "Publish" }).click();
    await expect(page.getByText("Published", { exact: true })).toBeVisible();
  });

  test("AI access: a new organisation has no platform AI; the owner connects its own key, tested before activation", async ({ page }) => {
    await login(page, owner);
    await page.goto(`/w/${orgSlug}`);
    await expect(page.getByText("AI is not set up for this organisation")).toBeVisible();
    await page.goto(`/w/${orgSlug}/settings/ai`);
    await page.waitForURL(/settings\?tab=ai/);
    await expect(page.getByRole("heading", { name: "Your provider keys" })).toBeVisible();
    await expect(page.getByText("None. Connect your own key above")).toBeVisible();
    const card = page.getByTestId("provider-FIXTURE");
    // A rejected key fails the connection test and is never activated.
    await card.locator("input[type=password]").fill("fixture-bad");
    await card.getByRole("button", { name: "Test connection" }).click();
    await expect(card.getByText(/rejected the API key/)).toBeVisible();
    await card.getByRole("button", { name: "Test & activate" }).click();
    await expect(page.getByText(/Connection test failed/).first()).toBeVisible();
    await expect(card.getByText("Not connected")).toBeVisible();
    // A working key is tested, encrypted and activated; only a mask is shown afterwards.
    await card.locator("input[type=password]").fill("fixture-ok");
    await card.getByRole("button", { name: "Test & activate" }).click();
    await expect(page.getByText("Provider connected")).toBeVisible();
    await expect(card.getByText("••••e-ok")).toBeVisible();
    await expect(card.getByText("Active")).toBeVisible();
    expect(await page.locator("body").innerText()).not.toContain("fixture-ok");
    // Every organisation capability now resolves to the organisation's own key.
    await expect(page.getByRole("row", { name: /Evidence-based assessment/ }).getByText("Your key", { exact: true })).toBeVisible();
  });

  test("9–10. student registers, completes profile, discovers and applies with preview & consent", async ({ page }) => {
    await register(page, "/register/student", student, "Stu");
    await login(page, student);
    await page.waitForURL(/onboarding\/student/);
    await page.click("text=I understand — continue");
    await page.fill("#headline", "Data student");
    await page.click("text=Continue");
    await page.fill("#inst", "E2E University");
    await page.fill("#deg", "BSc Data Science");
    await page.fill("#gy", "2027");
    await page.click("text=Continue");
    await page.fill("#skills", "SQL, Python, Statistics");
    await page.click("text=Continue");
    await page.fill("#roles", "analyst");
    await page.click("text=Finish");
    await page.waitForURL(/\/student$/);
    await page.waitForLoadState("networkidle");
    await page.goto(`/student/jobs?q=${encodeURIComponent(jobTitle)}`);
    await page.click(`text=${jobTitle}`);
    await page.click("text=Preview & submit");
    await expect(page.getByText("Review what the employer will receive")).toBeVisible();
    await expect(page.getByText("Not shared: accessibility requests, practice interviews")).toBeVisible();
    await page.check("#consent");
    await page.click("text=Submit application");
    await expect(page.getByText("Application submitted")).toBeVisible();
  });

  test("5–8, 11, 13. HR invites; student completes the interview in the browser; HR reviews, discloses feedback and decides", async ({ page }) => {
    await login(page, hr);
    await page.goto(`/w/${orgSlug}/candidates`);
    await page.click("text=Stu Tester");
    await page.waitForURL(new RegExp(`/w/${orgSlug}/candidates/\\w+`));
    applicationUrl = page.url();
    await page.click("text=Send AI interview");
    await page.click("text=Send invitation");
    await expect(page.getByText("Interview invitation sent")).toBeVisible();

    await login(page, student);
    await page.goto("/student");
    await page.click(`text=${jobTitle} at`);
    await expect(page.getByText("Before you start")).toBeVisible();
    await page.check("#c-ai");
    await page.check("#c-tr");
    await page.click("text=Continue");
    // This organisation runs on its own text-generation key with no platform speech grant,
    // so spoken answers are unavailable and the room runs typed-only (the template allows typing).
    await expect(page.getByText("Typed answers for this interview")).toBeVisible();
    await page.click("text=Start interview");
    await expect(page.getByText("Tell us about a project you are proud of.")).toBeVisible();
    await page.fill("#answer", "I built a dashboard that tracked course attendance and presented the findings to faculty, which led to new support sessions.");
    await page.click("text=Submit answer");
    await expect(page.getByText("Describe a problem you solved recently.")).toBeVisible();
    await page.fill("#answer", "I fixed a data pipeline that dropped rows by adding validation checks and alerting, which cut errors to zero.");
    await page.click("text=Submit answer");
    await expect(page.getByText("Interview submitted")).toBeVisible();

    await login(page, hr);
    await page.goto(applicationUrl);
    await page.click("text=Open review →");
    await expect(page.getByText("Competency evidence")).toBeVisible();
    await expect(page.getByText("Fixture provider — not a real AI")).toBeVisible();
    await expect(page.getByText("verbatim ✓").first()).toBeVisible();
    await page.click("text=Record review");
    await expect(page.getByText("Review recorded")).toBeVisible();

    await page.goto(applicationUrl);
    await page.getByPlaceholder("Internal note — never visible to the candidate").fill("PRIVATE NOTE: strong candidate");
    await page.click("text=Add note");
    await page.getByPlaceholder("Constructive, job-related feedback").fill("Your examples were specific and well structured. Thank you!");
    await page.click("text=Save draft");
    await page.click("text=Approve & share");
    await expect(page.getByText("Updated")).toBeVisible();
  });

  test("13. student sees approved feedback but never internal notes or ratings", async ({ page }) => {
    await login(page, student);
    await page.goto("/student/applications");
    await page.click(`text=${jobTitle}`);
    await expect(page.getByText("Your examples were specific and well structured.")).toBeVisible();
    const body = await page.locator("body").innerText();
    expect(body).not.toContain("PRIVATE NOTE");
    expect(body).not.toMatch(/Competent|Strong|evidence coverage|rubric/i);
  });

  test("18b. a super-admin grants platform AI to an organisation in the admin console (audited)", async ({ page }) => {
    // The demo admin's TOTP secret lives encrypted in the database (printed once by the seed).
    const db = new PrismaClient();
    const admin = await db.user.findUniqueOrThrow({ where: { email: "admin@atlas.example" } });
    await db.$disconnect();
    await page.context().clearCookies();
    await page.goto("/login");
    await page.fill("#email", "admin@atlas.example");
    await page.fill("#password", process.env.SEED_DEMO_PASSWORD || "Demo-password-2026!");
    await page.click("button[type=submit]");
    await page.waitForURL(/login\/mfa/);
    await page.fill("#code", totp(decrypt(admin.mfaSecret!)));
    await page.click("button[type=submit]");
    await page.waitForURL(/\/admin/);
    await page.goto(`/admin/ai?q=${encodeURIComponent(orgName)}`);
    const row = page.getByRole("row", { name: new RegExp(orgName) });
    await expect(row.getByText("denied (default)")).toBeVisible();
    await row.getByRole("link", { name: "Manage" }).click();
    await expect(page.getByText(/Organisation ID/)).toBeVisible();
    await expect(page.getByText("not enabled")).toBeVisible();
    // Organisation key health is visible, masked.
    await expect(page.getByText("••••e-ok")).toBeVisible();
    await page.getByTestId("grant-JOB_DRAFTING:FIXTURE").getByLabel("Allow platform Fixture (test only)").check();
    await page.getByTestId("grant-JOB_DRAFTING:FIXTURE").getByLabel("Monthly request limit").fill("50");
    await page.fill("#ai-reason", "E2E pilot access for vacancy drafting");
    await page.getByRole("button", { name: /Save 1 change/ }).click();
    await expect(page.getByText("AI access updated")).toBeVisible();
    await expect(page.getByText("platform.ai.access_granted")).toBeVisible();
    await expect(page.getByText(/E2E pilot access for vacancy drafting/)).toBeVisible();

    // The organisation sees the grant read-only and cannot change it.
    await login(page, owner);
    await page.goto(`/w/${orgSlug}/settings?tab=ai`);
    await expect(page.getByRole("table", { name: "Platform AI grants" }).getByText("Vacancy drafting")).toBeVisible();
    await expect(page.getByRole("table", { name: "Platform AI grants" }).getByText("0 / 50 requests")).toBeVisible();
  });

  test("12. student completes a private practice interview", async ({ page }) => {
    await login(page, student);
    await page.goto("/student/practice/new");
    await page.fill("#role", "Data analyst");
    await page.selectOption("#qc", "2");
    await page.click("text=Start practice");
    await page.waitForURL(/student\/practice\/\w+/);
    await page.click("text=Type instead");
    await page.locator("textarea[aria-label='Your answer']").fill("I would clarify the goal, gather the data and present clear recommendations.");
    await page.click("text=Submit answer");
    await expect(page.getByText("Question 2 of 2")).toBeVisible();
    await expect(page.locator("textarea[aria-label='Your answer']")).toBeEnabled();
    await page.locator("textarea[aria-label='Your answer']").fill("I learned to validate data before drawing conclusions.");
    await page.click("text=Submit answer");
    await expect(page.getByText("Coaching summary")).toBeVisible();
  });

  test("19. another tenant cannot open this organisation's pages or records", async ({ page }) => {
    await login(page, "owner@northwind.example", process.env.SEED_DEMO_PASSWORD ?? "Demo-password-2026!"); // seeded demo organisation (SEED_DEMO=true)
    // Same record id, attacker's own workspace slug: must render "not found" and leak nothing.
    await page.goto(applicationUrl.replace(/\/w\/[\w-]+\//, "/w/northwind-labs/"));
    await expect(page.getByText("We couldn't find that page")).toBeVisible();
    expect(await page.locator("body").innerText()).not.toContain("Stu Tester");
    // The victim's workspace itself: membership check fails before anything renders.
    const res = await page.goto(`/w/${orgSlug}`);
    expect(res?.status()).toBe(404);
    expect(await page.locator("body").innerText()).not.toContain(orgName);
    // And the API refuses the record outright.
    const api = await page.request.get(`/api/v1/applications/${applicationUrl.split("/").pop()}`, { headers: { "x-atlas-org": "northwind-labs" } });
    expect(api.status()).toBe(404);
  });
});
