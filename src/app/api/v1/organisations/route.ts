import { route } from "@/server/http/route";
import { createOrganisation, createOrgSchema, listMyOrganisations } from "@/server/services/organisations";

export const GET = route({ auth: "session" }, async ({ session }) => listMyOrganisations(session.user.id));
export const POST = route({ auth: "verified", body: createOrgSchema }, async ({ body, session, meta }) => {
  const org = await createOrganisation(session, body, meta);
  return { id: org.id, slug: org.slug, name: org.name, type: org.type };
});
