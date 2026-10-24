import { z } from "zod";
import { route } from "@/server/http/route";
import { addNote } from "@/server/services/applications";

export const POST = route({ auth: "org", permission: "notes.write", body: z.object({ body: z.string().trim().min(1).max(10000) }) }, async ({ org, params, body }) => addNote(org, params.id, body.body));
