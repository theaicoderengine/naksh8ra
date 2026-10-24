import { describe, it, expect } from "vitest";
import { normaliseForMatch, verifyExcerpt, postProcessAssessment } from "@/server/services/assessments";

const answers = [
  { position: 0, text: "In my last role I led a migration of the reporting system, and we cut generation time by half." },
  { position: 1, text: "I resolved a disagreement by listing the trade-offs together." },
];

describe("evidence verification", () => {
  it("normalises punctuation, quotes and case", () => {
    expect(normaliseForMatch("“Led a  Migration,” ")).toBe('"led a migration "'.replace(/"/g, "").trim());
  });
  it("accepts verbatim excerpts and locates their answer", () => {
    expect(verifyExcerpt("led a migration of the reporting system", answers)).toEqual({ verified: true, position: 0 });
    expect(verifyExcerpt("listing the trade-offs together", answers, 0)).toEqual({ verified: true, position: 1 });
  });
  it("rejects paraphrased or invented excerpts", () => {
    expect(verifyExcerpt("I am an excellent leader who migrated systems", answers).verified).toBe(false);
    expect(verifyExcerpt("half", answers).verified).toBe(false); // too short to be meaningful evidence
  });
});

describe("assessment post-processing", () => {
  it("flags ratings without verified evidence and computes coverage", () => {
    const out = postProcessAssessment(
      {
        summary: "s",
        results: [
          { competencyKey: "a", rating: "R4", explanation: "e", evidence: [{ excerpt: "led a migration of the reporting system", answerPosition: 0, supports: "POSITIVE" }], missingEvidence: "", uncertainty: "LOW" },
          { competencyKey: "b", rating: "R5", explanation: "e", evidence: [{ excerpt: "an invented quotation not in the transcript", answerPosition: 1, supports: "POSITIVE" }], missingEvidence: "", uncertainty: "LOW" },
        ],
      },
      ["a", "b", "c"],
      answers,
    );
    expect(out.results.find((r) => r.competencyKey === "a")!.flags).toEqual([]);
    const b = out.results.find((r) => r.competencyKey === "b")!;
    expect(b.flags).toContain("no_verified_evidence");
    expect(b.uncertainty).toBe("HIGH");
    const c = out.results.find((r) => r.competencyKey === "c")!;
    expect(c.rating).toBe("INSUFFICIENT_EVIDENCE");
    expect(out.coverage).toBeCloseTo(1 / 3);
    expect(out.requiresReview).toBe(true);
  });
  it("insufficient evidence is distinct from a low rating", () => {
    const out = postProcessAssessment({ summary: "s", results: [{ competencyKey: "a", rating: "INSUFFICIENT_EVIDENCE", explanation: "no example", evidence: [], missingEvidence: "No example given", uncertainty: "MEDIUM" }] }, ["a"], answers);
    expect(out.results[0].rating).toBe("INSUFFICIENT_EVIDENCE");
    expect(out.results[0].flags).toEqual([]);
    expect(out.coverage).toBe(0);
  });
});
