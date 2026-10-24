import { z } from "zod";
import { route } from "@/server/http/route";
import { createDepartment, listDepartments } from "@/server/services/organisations";

export const GET = route({ auth: "org", permission: "org.view" }, async ({ org }) => listDepartments(org));
export const POST = route({ auth: "org", permission: "departments.manage", body: z.object({ name: z.string().trim().min(2).max(80) }) }, async ({ org, body }) => createDepartment(org, body.name));
