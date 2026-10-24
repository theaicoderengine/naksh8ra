# Production launch checklist

Tick every item with evidence (link, screenshot, ticket) before onboarding real organisations or candidates.

## Infrastructure
- [ ] Managed PostgreSQL 16 with PITR, encrypted, private network; roles bootstrapped (`scripts/db/bootstrap-roles.sql`); app uses `atlas_app`
- [ ] Managed Redis (`noeviction`), private network
- [ ] Private S3 bucket: encryption, public access blocked, versioning, lifecycle aligned with retention
- [ ] ClamAV deployed; `MALWARE_SCANNER=clamav`; upload of the EICAR test file is rejected
- [ ] Web (≥2 replicas) and worker (≥1) deployed from the same git SHA; health checks wired to the platform
- [ ] TLS at edge, `APP_URL` = exact public origin, `TRUST_PROXY` set correctly
- [ ] Restore drill completed once; RTO/RPO recorded

## Configuration & secrets
- [ ] `APP_ENV=production`; `ALLOW_FIXTURE_PROVIDERS`, `SEED_DEMO`, `EXPOSE_TEST_TOKENS` unset/false
- [ ] `ENCRYPTION_KEY` generated and backed up in the secret manager
- [ ] All secrets in a secret manager; none in images or repo
- [ ] First super admin created with MFA; `PLATFORM_ADMIN_EMAILS` cleared

## Providers (verify each on staging first)
- [ ] LLM: real interviews end-to-end; assessments reviewed by HR against rubrics; latency acceptable
- [ ] STT: accuracy checked on varied accents / audio quality
- [ ] TTS: voice acceptable or browser speech chosen deliberately
- [ ] Email: domain authenticated (SPF/DKIM/DMARC); verification, invitation, interview and reset emails received
- [ ] Stripe: live products/prices on plans/packs; webhook endpoint + secret; test-mode purchase, renewal, failure and refund verified; Billing Portal configured; tax settings decided
- [ ] DPAs signed with each provider; sub-processor list published; data residency confirmed

## Product & content
- [ ] Placeholder plans replaced (names, prices, entitlements)
- [ ] Branding (`APP_NAME`, `NEXT_PUBLIC_*`), support email, legal entity
- [ ] Legal pages, candidate AI notice and consent wording reviewed by counsel
- [ ] Retention defaults set from your legal retention schedule
- [ ] Competency library and rubrics reviewed by HR / I-O psychology specialists

## Responsible AI & compliance
- [ ] AI/data protection impact assessment completed
- [ ] Bias / adverse-impact audit where legally required (e.g. NYC LL 144) and published if required
- [ ] Human-review policy for AI-assisted assessments documented and trained
- [ ] Candidate accommodation and human-contact process staffed

## Security
- [ ] Independent penetration test; findings fixed
- [ ] Dependency majors upgraded or risk accepted (see known-limitations)
- [ ] `security.txt` / vulnerability disclosure contact published
- [ ] Platform admin and support staff access reviewed; MFA enforced

## Operations
- [ ] Alerts configured (see operations.md) and routed to on-call
- [ ] Log retention and access controls set (logs may contain metadata about candidates)
- [ ] Incident response contacts and breach-notification procedure agreed with legal
- [ ] Support ticket workflow staffed
