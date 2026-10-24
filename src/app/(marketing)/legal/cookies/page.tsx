import { Section, Prose } from "@/components/marketing";

export const metadata = { title: "Cookie policy" };

export default function Cookies() {
  return (
    <Section>
      <h1 className="text-3xl font-semibold">Cookies</h1>
      <Prose>
        <p>We only use cookies that are strictly necessary to provide the service. There are no advertising or cross-site tracking cookies, so there is nothing to opt in to or out of.</p>
        <table className="my-4 w-full text-sm">
          <thead><tr className="text-left"><th className="py-2">Cookie</th><th>Purpose</th><th>Duration</th></tr></thead>
          <tbody>
            <tr className="border-t border-border"><td className="py-2 font-mono">atlas_session</td><td>Keeps you signed in (HttpOnly, SameSite=Lax, Secure in production)</td><td>Up to 7 days; 12 hours for administrators</td></tr>
          </tbody>
        </table>
        <p>If analytics or other non-essential cookies are introduced in future, this page will offer a preference control and they will be off until you consent.</p>
      </Prose>
    </Section>
  );
}
