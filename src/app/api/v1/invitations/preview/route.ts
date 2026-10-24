import { z } from "zod";
import { route } from "@/server/http/route";
import { previewInvitation } from "@/server/services/organisations";
import { notFound } from "@/server/errors";

export const GET = route({ auth: "none", rateLimit: "invitationOpen", query: z.object({ token: z.string().min(20).max(200) }) }, async ({ query }) => {
  const p = await previewInvitation(query.token);
  if (!p) throw notFound("Invitation");
  return p;
});
