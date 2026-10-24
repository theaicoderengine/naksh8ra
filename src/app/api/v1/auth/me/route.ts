import { route } from "@/server/http/route";
import { listMyOrganisations } from "@/server/services/organisations";

export const GET = route({ auth: "session", allowPartialMfa: true }, async ({ session }) => ({
  user: { id: session.user.id, email: session.user.email, firstName: session.user.firstName, lastName: session.user.lastName, emailVerified: !!session.user.emailVerifiedAt, mfaEnabled: !!session.user.mfaEnabledAt, platformRole: session.user.platformRole, isStudent: session.user.isStudent },
  session: { mfaVerified: session.mfaVerified, activeOrgId: session.activeOrgId, expiresAt: session.expiresAt },
  organisations: await listMyOrganisations(session.user.id),
}));
