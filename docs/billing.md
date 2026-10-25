# Billing, plans and credits

## Model

- **Plans** (`Plan` + `PlanEntitlement` key/values) define seats, monthly interview credits, trial credits and feature flags (`feature.realtime_interviews`, `feature.campus`, `feature.sso`). Managed in Admin → Plans. Each paid plan maps to a Stripe Price (`stripePriceId`).
- **Credit packs** (`CreditPack`) are one-off purchases for employers (interview credits) or students (practice sessions), each mapped to a Stripe Price.
- **Seed plans are placeholders** ("Development placeholder", price 0). Set real names, prices, entitlements and Stripe Price ids before taking payments. Nothing in the seed reflects commercial pricing.

## Credit ledger

`CreditAccount` per organisation (or per student for practice). Every change is an immutable `CreditLedgerEntry` (DB trigger blocks UPDATE/DELETE) with running balances; the account's `available`/`reserved` columns are a cache updated in the same transaction under `SELECT … FOR UPDATE`, with CHECK constraints preventing negatives. Each operation carries an idempotency key unique per account, so retries, duplicate webhooks and double-clicks never double-apply. `billing.reconcile` (hourly) recomputes balances from the ledger and reports mismatches in Admin → Health.

### Billable events

| Event | Ledger effect |
|---|---|
| Employer sends an AI interview invitation | **reserve** 1 credit (fails with 402 if none available) |
| Session completes with ≥1 submitted answer (incl. interrupted sessions that expire after partial answers) | **consume** the reservation |
| Invitation cancelled, application withdrawn, invitation expires unused | **release** |
| Session fails due to a platform or AI-provider fault | **release** (never charged) |
| Re-running an assessment, HR review, retakes within the template's allowance | no charge |
| Student practice interview start | consume 1 practice credit from the student's own account (monthly free allowance `practice.freeMonthly`, then purchased packs). Never billed to an employer or university |

Grants: subscription invoice paid → monthly allowance (`monthly_interview_credits`; annual plans receive 12 × up front), credit-pack checkout completed → pack credits, trial credits on organisation creation, signed manual adjustments by billing admins (reason required, audited). Grants can expire (`credits.expire`).

## AI usage limits (separate from interview credits)

Platform-funded AI is governed by per-organisation grants with optional monthly request/token limits, enforced atomically per operation ([ai-providers.md](ai-providers.md#usage-limits-and-cost)). Organisation-owned keys are billed by the provider directly to that organisation. Estimated AI cost shown in the product is an internal estimate, not provider billing. Interview-credit semantics are unchanged; a failed or denied assessment never consumes an extra credit.

## Stripe integration

- **Checkout:** hosted Stripe Checkout for subscriptions and packs (`POST /api/v1/billing/checkout`, `/billing/practice-checkout`); customers manage payment methods/cancellation in the hosted **Billing Portal** (`/billing/portal`). Card data never reaches this application.
- **Webhook:** `POST /api/v1/webhooks/stripe`, signature-verified with `STRIPE_WEBHOOK_SECRET`. Handled events: `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `customer.subscription.created|updated|deleted`, `invoice.paid|payment_succeeded|payment_failed|finalized|voided|marked_uncollectible`, `charge.refunded`. Other events are acknowledged and ignored. Each event id is stored once in `PaymentEvent` (duplicates are no-ops) and out-of-order subscription updates are tolerated.
- **Lifecycle:** payment failure → subscription `PAST_DUE` (entitlements continue during Stripe's retry window) → recovery on next paid invoice → `CANCELED` on deletion. Refunds reverse purchased credits proportionally, once.
- **Tax:** `STRIPE_AUTOMATIC_TAX=true` enables Stripe Tax on checkout (requires Stripe Tax set up in your account); tax id collection is on.

### Setup

1. Create Products/Prices in Stripe (test mode first); enter Price ids on plans/packs in Admin → Plans.
2. Add a webhook endpoint `https://<your-domain>/api/v1/webhooks/stripe` with the events above; set `STRIPE_WEBHOOK_SECRET`.
3. Configure the Billing Portal in Stripe (allowed actions, cancellation policy).
4. Set `PAYMENT_PROVIDER=stripe` and `STRIPE_SECRET_KEY`.
5. Test with Stripe CLI (`stripe listen --forward-to localhost:3000/api/v1/webhooks/stripe`; `stripe trigger checkout.session.completed`) and verify ledger entries in Billing.

**Verification status:** webhook processing is covered by integration tests using locally signed payloads (`tests/integration/billing.test.ts`). The live Stripe API (checkout creation, portal, real webhooks) has **not** been exercised from this environment.
