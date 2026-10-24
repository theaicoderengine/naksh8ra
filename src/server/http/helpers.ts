import { NextResponse, type NextRequest } from "next/server";
import { AppError } from "../errors";
import { SESSION_COOKIE, sessionCookieOptions } from "../auth/session";
import { env } from "../env";

export function withSessionCookie(res: NextResponse, token: string, expiresAt: Date) {
  res.cookies.set(SESSION_COOKIE, token, sessionCookieOptions(expiresAt));
  return res;
}

export function clearSession(res: NextResponse) {
  res.cookies.set(SESSION_COOKIE, "", { ...sessionCookieOptions(new Date(0)), maxAge: 0 });
  return res;
}

export async function readMultipart(req: NextRequest, maxBytes = env().MAX_UPLOAD_MB * 1024 * 1024) {
  const len = Number(req.headers.get("content-length") ?? 0);
  if (len > maxBytes + 64 * 1024) throw new AppError("BAD_REQUEST", `Upload exceeds ${Math.round(maxBytes / 1024 / 1024)} MB`);
  const ct = req.headers.get("content-type") ?? "";
  if (!ct.includes("multipart/form-data")) throw new AppError("BAD_REQUEST", "Expected multipart/form-data");
  const form = await req.formData();
  const fields: Record<string, string> = {};
  let file: { buffer: Buffer; fileName: string; type: string } | null = null;
  for (const [k, v] of form.entries()) {
    if (typeof v === "string") fields[k] = v.slice(0, 20000);
    else if (!file && v.size > 0) {
      if (v.size > maxBytes) throw new AppError("BAD_REQUEST", `File exceeds ${Math.round(maxBytes / 1024 / 1024)} MB`);
      file = { buffer: Buffer.from(await v.arrayBuffer()), fileName: v.name || "upload", type: v.type };
    }
  }
  return { fields, file };
}

export function csvResponse(csv: string, filename: string) {
  return new NextResponse(csv, { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="${filename}"`, "cache-control": "no-store" } });
}
