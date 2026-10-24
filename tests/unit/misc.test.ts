import { describe, it, expect } from "vitest";
import { totp, verifyTotp, base32Decode, base32Encode, generateTotpSecret } from "@/server/auth/totp";
import { encrypt, decrypt, hashPassword, verifyPassword, randomToken } from "@/server/auth/crypto";
import { parseStudentCsv } from "@/server/services/universities";
import { eligibilityFor } from "@/server/services/jobs";
import { profileCompletion } from "@/server/services/students";
import { sniffType, RESUME_TYPES, AUDIO_TYPES } from "@/server/providers/scan";
import { heuristicParse } from "@/server/services/resumes";
import { candidateFacingSessionStatus } from "@/server/services/applications";
import { toErrorBody, AppError } from "@/server/errors";
import { passwordSchema } from "@/server/services/auth";

describe("TOTP (RFC 6238)", () => {
  it("matches the RFC test vector", () => {
    // RFC 6238 SHA-1 secret "12345678901234567890" at T=59s → 94287082 (8 digits); 6-digit = 287082
    const secret = base32Encode(Buffer.from("12345678901234567890"));
    expect(totp(secret, 59_000)).toBe("287082");
    expect(base32Decode(secret).toString()).toBe("12345678901234567890");
  });
  it("verifies within ±1 step only", () => {
    const s = generateTotpSecret();
    const now = Date.now();
    expect(verifyTotp(s, totp(s, now - 30_000), now)).toBe(true);
    expect(verifyTotp(s, totp(s, now - 120_000), now)).toBe(false);
    expect(verifyTotp(s, "abc123", now)).toBe(false);
  });
});

describe("crypto", () => {
  it("AES-GCM round trip and tamper detection", () => {
    const c = encrypt("secret value");
    expect(decrypt(c)).toBe("secret value");
    const parts = c.split(".");
    parts[3] = Buffer.from("tampered").toString("base64url");
    expect(() => decrypt(parts.join("."))).toThrow();
  });
  it("password hashing", async () => {
    const h = await hashPassword("Correct-horse-battery-9");
    expect(await verifyPassword("Correct-horse-battery-9", h)).toBe(true);
    expect(await verifyPassword("wrong", h)).toBe(false);
    expect(await verifyPassword("x", null)).toBe(false);
  });
  it("tokens are long and unique", () => {
    expect(randomToken().length).toBeGreaterThanOrEqual(43);
    expect(randomToken()).not.toBe(randomToken());
  });
  it("password policy", () => {
    expect(passwordSchema.safeParse("short1!").success).toBe(false);
    expect(passwordSchema.safeParse("alllettersnonumbers").success).toBe(false);
    expect(passwordSchema.safeParse("long-enough-pass-9").success).toBe(true);
  });
});

describe("CSV import validation", () => {
  it("validates header, emails and duplicates", () => {
    expect(parseStudentCsv("name\nx").errors[0].message).toMatch(/email/);
    const r = parseStudentCsv("email,student_number\na@x.io,1\nbad,2\nA@x.io,3\nb@x.io,");
    expect(r.rows).toEqual([{ email: "a@x.io", studentNumber: "1" }, { email: "b@x.io", studentNumber: null }]);
    expect(r.errors.map((e) => e.line)).toEqual([3, 4]);
  });
});

describe("eligibility is explainable and qualification-based", () => {
  const job = { eligibleGraduationYears: [2027], eligibleDegrees: ["Computer Science"], eligibleProgrammeIds: [], visibility: "PUBLIC" as const };
  it("explains matches", () => {
    const r = eligibilityFor(job, { graduationYear: 2027, degrees: ["BSc Computer Science"], programmeIds: [] });
    expect(r.eligible).toBe(true);
    expect(r.reasons.length).toBe(2);
  });
  it("explains unmet criteria", () => {
    const r = eligibilityFor(job, { graduationYear: 2025, degrees: ["BA History"], programmeIds: [] });
    expect(r.eligible).toBe(false);
    expect(r.unmet.length).toBe(2);
  });
  it("jobs without criteria are open to everyone", () => {
    expect(eligibilityFor({ eligibleGraduationYears: [], eligibleDegrees: [], eligibleProgrammeIds: [], visibility: "PUBLIC" }, null).eligible).toBe(true);
  });
});

describe("profile completion", () => {
  it("reports missing items", () => {
    const r = profileCompletion({ email: "a", emailVerified: true, profile: { firstName: "A", lastName: "B" } as never, student: null }, 0);
    expect(r.percent).toBe(20);
    expect(r.missing).toContain("Resume");
  });
});

describe("file type sniffing ignores client-declared types", () => {
  it("detects real types and rejects disguised executables", () => {
    expect(sniffType(Buffer.from("%PDF-1.7 rest of file"), RESUME_TYPES)).toBe("application/pdf");
    expect(sniffType(Buffer.from("MZ\x90\x00\x03\x00\x00\x00\x04\x00\x00\x00binary\x00\x00"), RESUME_TYPES)).toBeNull();
    expect(sniffType(Buffer.from("OggS\x00\x02\x00\x00\x00\x00"), AUDIO_TYPES)).toBe("audio/ogg");
    expect(sniffType(Buffer.from("%PDF-1.7 rest of file"), AUDIO_TYPES)).toBeNull();
  });
});

describe("resume heuristics never invent data", () => {
  it("extracts only what is present", () => {
    const r = heuristicParse("Jane Doe\nData analyst\njane@example.com\nSkills: SQL, Python");
    expect(r.name).toBe("Jane Doe");
    expect(r.email).toBe("jane@example.com");
    expect(r.skills).toEqual(["SQL", "Python"]);
    expect(r.experience).toEqual([]);
  });
});

describe("candidate-facing statuses hide internal review states", () => {
  it("maps assessment states to COMPLETED", () => {
    for (const s of ["PROCESSING", "ASSESSED", "REQUIRES_REVIEW", "REVIEWED"]) expect(candidateFacingSessionStatus(s)).toBe("COMPLETED");
  });
});

describe("error responses never leak internals", () => {
  it("maps unknown errors to a generic 500", () => {
    const r = toErrorBody(new Error("SELECT * FROM secret_table failed at 10.0.0.5"));
    expect(r.status).toBe(500);
    expect(JSON.stringify(r.body)).not.toMatch(/secret_table|10\.0\.0\.5/);
  });
  it("maps app errors", () => {
    expect(toErrorBody(new AppError("NOT_FOUND", "Job not found")).status).toBe(404);
  });
});
