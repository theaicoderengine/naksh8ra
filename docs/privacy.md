# Privacy, consent and retention

The platform provides mechanisms that support privacy obligations. Whether a deployment meets a given law (GDPR, UK GDPR, CCPA, DPDP, EEOC/OFCCP guidance, the EU AI Act, NYC Local Law 144, etc.) depends on configuration, contracts and processes **and must be assessed by qualified counsel**. No compliance claim is made.

## Roles

- **Employer organisations** are controllers of candidate records they hold (applications, interviews, assessments, notes).
- **Students/candidates** control their platform profile, resumes and practice data. Universities see students only through cohort memberships the student has accepted, and never see employer assessments or notes.
- The platform operator processes data on behalf of organisations; platform support staff have no access to candidate content (see [security.md](security.md)).

## Consent and notices

`ConsentRecord` (append-only) records terms/privacy acceptance at sign-up, application data sharing (the student previews the exact profile shared), and interview consents captured before an interview can start: **recording**, **AI assessment**, **transcript**. If recording consent is withheld, audio is not retained (transcript only). Candidates can request accommodations (extended time, typed answers, captions) and contact a human; candidate-facing pages state that an AI assists the interview and that humans make decisions.

## Data subject requests

| Request | Implementation |
|---|---|
| Export | `POST /api/v1/privacy/requests {type: EXPORT}` → worker builds a JSON export of the user's personal data (no secrets/hashes) → private file link (expires after 7 days). |
| Deletion | Deletes resumes, files, practice data, student profile, saved jobs, notifications, profile; anonymises the user row; revokes sessions; unlinks employer candidate records and **forwards an erasure request to each employer**, who completes it in Settings → Privacy (`eraseCandidate`) — employers may have legal holds, so the platform does not silently delete their records. |
| Correction | Recorded as a request for staff/employer handling; most fields are self-service. |

Platform admins track all requests (Admin → Privacy) with due dates. Every step is audited.

## Retention

Organisation-configurable per category (Settings → Privacy), bounded by platform limits:

| Category | Default | Min | Max |
|---|---|---|---|
| Interview audio | 180 days | 30 | 730 |
| Transcripts & answers | 365 days | 30 | 1095 |
| Assessments | 365 days | 30 | 1095 |
| Applications / candidate records (concluded) | 730 days | 30 | 1825 |
| Resumes / candidate documents | 730 days | 30 | 1825 |
| Audit events | 2555 days | 365 | 3650 |

The daily `retention.sweep` job deletes expired data (files from storage first, then rows) and logs a `DeletionJob` summary. Generated exports are deleted after 7 days. Defaults are engineering placeholders — set them from your legal retention schedule.

## Data minimisation in AI processing

- The assessment prompt receives the transcript, questions and rubric — not the candidate's name, photo, age, gender or other protected attributes. Resume parsing extracts job-relevant fields only.
- Provider requests are server-side; choose providers and regions with appropriate data-processing terms and zero-retention options where available. Record the providers in your sub-processor list.

## Before launch

- Have counsel review `/legal/terms`, `/legal/privacy`, `/legal/cookies` (templates) and candidate notices.
- Conduct a DPIA / AI impact assessment and, where required, a bias audit.
- Sign DPAs with each provider; configure data residency (database, storage, AI region).
