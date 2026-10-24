import { Section, Prose } from "@/components/marketing";
import { Alert } from "@/components/ui/feedback";
import { brand } from "@/lib/brand";

export const metadata = { title: "Terms of service" };

export default function Terms() {
  const b = brand();
  return (
    <Section>
      <h1 className="text-3xl font-semibold">Terms of service</h1>
      <p className="mt-1 text-sm text-subtle">Version 2026-10-01</p>
      <Alert tone="warning" className="my-6" title="Template — requires legal review">This is a starting template provided with the software. It must be reviewed and adapted by qualified counsel for your entity, markets and commercial model before launch.</Alert>
      <Prose>
        <h2>1. Who we are</h2><p>{b.name} is provided by {b.legalEntity} (“we”). These terms govern use of the platform by organisations (“Customers”), their authorised users, and individual users such as students and candidates.</p>
        <h2>2. Accounts</h2><p>You must provide accurate information, keep credentials secure and notify us of unauthorised use. Organisation owners are responsible for the users they invite and the roles they assign.</p>
        <h2>3. Customer responsibilities</h2><p>Customers are controllers of recruitment data they collect, are responsible for lawful use of AI-assisted assessment in their jurisdictions (including notices, consents, accommodations and any required bias audits), and must ensure a human makes hiring decisions.</p>
        <h2>4. Acceptable use</h2><p>No unlawful discrimination, no attempts to access other tenants&apos; data, no reverse engineering of security controls, no uploading of malware, and no use of the platform to infer protected characteristics.</p>
        <h2>5. Subscriptions and credits</h2><p>Fees, seats and allowances are shown at checkout. Credits are consumed according to the published billable-event rules. Credit packs may expire as disclosed at purchase. Taxes are handled by our payment provider where applicable.</p>
        <h2>6. AI features</h2><p>AI outputs may be inaccurate. They are decision-support only, include evidence and uncertainty indicators, and must be reviewed by a human. We do not warrant that AI ratings predict job performance.</p>
        <h2>7. Data protection</h2><p>Our processing of personal data on behalf of Customers is governed by our Data Processing Agreement. Individual users&apos; data is described in the Privacy Policy.</p>
        <h2>8. Suspension and termination</h2><p>We may suspend accounts for non-payment, security risk or breach of these terms. Customers may export data before termination subject to retention rules.</p>
        <h2>9. Liability</h2><p>[To be completed by counsel: limitation of liability, indemnities, governing law and jurisdiction.]</p>
      </Prose>
    </Section>
  );
}
