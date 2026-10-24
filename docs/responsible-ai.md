# Responsible AI: interviews and assessment

AI in this product **assists** human reviewers. It never makes hiring decisions: stage moves to HIRED/REJECTED are human actions requiring `applications.decide` and a recorded reason.

## Design principles (implemented)

1. **Job-related, structured evaluation.** Each interview template links competencies; each competency has a versioned rubric with five behaviourally anchored levels (R1–R5). Results store the rubric version used.
2. **Evidence, not opaque scores.** There is no overall score. Each competency result has a rating, an explanation, and evidence excerpts. The server verifies every excerpt is a verbatim substring of the candidate's answers (`verifyExcerpt`, whitespace/punctuation-normalised). Unverified excerpts are flagged; a rating with no verified evidence is forced to HIGH uncertainty and the session goes to `REQUIRES_REVIEW`.
3. **Insufficient evidence is explicit.** `INSUFFICIENT_EVIDENCE` is a distinct outcome, displayed separately from low ratings, with what was missing. A coverage metric shows how many competencies had sufficient evidence.
4. **No protected-characteristic inference.** The assessment prompt prohibits considering accent, dialect, non-native grammar, tone, emotion, speaking speed, personality, appearance or any protected characteristic. Only transcripts (text) are assessed — audio is never sent to the assessment model. Names and demographic fields are not included in the assessment input.
5. **Human review and override.** Reviewers with `assessments.review` can accept or override each competency rating; overrides require a reason and are audited. The original AI output is preserved alongside.
6. **Candidate transparency.** Candidates are told an AI assists the interview, consent separately to recording / AI assessment / transcript, can request accommodations and typed answers, and only ever see feedback a human has explicitly approved for disclosure. Declining AI assessment routes the interview to human review only.
7. **Prompt-injection resistance.** Resumes, answers and job text are wrapped as untrusted data blocks; outputs must match a JSON schema and are validated before use. The interviewer cannot end, extend or change the interview — the server enforces the plan, limits and timing.
8. **Traceability.** Every assessment stores provider, model, prompt version, rubric versions and timestamps; sessions that used fixture providers are labelled **FIXTURE** in the UI.
9. **Practice is private.** Practice interviews give coaching feedback (relevance/clarity/completeness with suggestions) to the student only; employers never see them and they never affect applications.

## What has NOT been done (required before relying on assessments)

- **No validation study.** Rubric ratings have not been validated against job performance, and inter-rater agreement between the AI and trained human reviewers has not been measured.
- **No bias/adverse-impact audit.** Outcome disparities across demographic groups have not been measured. Several jurisdictions require an independent bias audit before automated employment decision tools are used (e.g. NYC Local Law 144) or classify such systems as high-risk (EU AI Act). Obtain legal advice.
- **STT accuracy across accents/dialects is unmeasured.** Transcription errors can disadvantage candidates; reviewers should consult audio (where consented) when uncertainty is flagged.
- **Live-model behaviour is unverified.** Tests use deterministic fixture providers. Evaluate the chosen model on a representative, consented, non-production dataset (`assess.v1` prompt) and review outputs with HR specialists before launch.

## Recommended operating practice

- Train reviewers to read the evidence, not the rating label; require a human review step for every candidate in early rollout.
- Monitor `REQUIRES_REVIEW` rate, override rate (by competency and by reviewer), and coverage; investigate spikes.
- Re-version prompts/rubrics rather than editing in place; re-assessment uses the session's frozen template and rubric versions.
