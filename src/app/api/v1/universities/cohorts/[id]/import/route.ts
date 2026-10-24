import { z } from "zod";
import { route } from "@/server/http/route";
import { inviteStudents, parseStudentCsv } from "@/server/services/universities";

/** Body: { csv } with header `email[,student_number]`, or { emails: [...] }. Validation errors are returned and nothing is imported. */
export const POST = route(
  { auth: "org", permission: "university.import", rateLimit: "upload", body: z.object({ csv: z.string().max(2_000_000).optional(), emails: z.array(z.string().email()).max(500).optional() }) },
  async ({ org, params, body, meta }) => {
    const parsed = body.csv ? parseStudentCsv(body.csv) : { rows: (body.emails ?? []).map((e) => ({ email: e.toLowerCase(), studentNumber: null })), errors: [] };
    if (parsed.errors.length) return { invited: 0, skipped: 0, errors: parsed.errors };
    return inviteStudents(org, params.id, parsed.rows, meta);
  },
);
