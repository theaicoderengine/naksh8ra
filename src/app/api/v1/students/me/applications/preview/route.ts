import { z } from "zod";
import { route } from "@/server/http/route";
import { buildSharedProfile } from "@/server/services/applications";

/** Exactly what the employer will receive — shown to the applicant before they submit. */
export const POST = route({ auth: "session", body: z.object({ resumeVersionId: z.string().nullable().optional() }) }, async ({ session, body }) => buildSharedProfile(session.user.id, body.resumeVersionId));
