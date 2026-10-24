import { Section } from "@/components/marketing";
import { ContactForm } from "@/components/contact-form";
import { Card, CardBody } from "@/components/ui/card";

export const metadata = { title: "Contact" };

export default function Contact() {
  return (
    <Section>
      <div className="grid gap-10 lg:grid-cols-[1fr_1.2fr]">
        <div>
          <h1 className="text-3xl font-semibold">Talk to us</h1>
          <p className="mt-3 text-subtle">Questions about pricing, enterprise rollout, data processing agreements or campus partnerships? Send us a message and the right team will reply.</p>
          <ul className="mt-6 space-y-2 text-sm text-subtle">
            <li>• Data processing agreement and subprocessor list on request</li>
            <li>• Regional data hosting planning for enterprise customers</li>
            <li>• University and placement-cell partnerships</li>
          </ul>
        </div>
        <Card><CardBody className="p-6"><ContactForm /></CardBody></Card>
      </div>
    </Section>
  );
}
