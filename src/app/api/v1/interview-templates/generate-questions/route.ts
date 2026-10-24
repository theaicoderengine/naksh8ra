import { route } from "@/server/http/route";
import { generateQuestions, generateQuestionsSchema } from "@/server/services/templates";

export const POST = route({ auth: "org", permission: "interviews.configure", rateLimit: "ai", body: generateQuestionsSchema }, async ({ org, body }) => generateQuestions(org, body));
