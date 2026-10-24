import { NextResponse } from "next/server";
import { route } from "@/server/http/route";
import { authoriseDownload } from "@/server/services/files";
import { storage } from "@/server/providers/storage";

export const GET = route({ auth: "session" }, async ({ session, params, meta }) => {
  const f = await authoriseDownload(session, params.id, meta);
  const url = await storage().signedUrl(f.storageKey, f.fileName, 60);
  if (url) return NextResponse.redirect(url, { headers: { "cache-control": "no-store" } });
  const buf = await storage().get(f.storageKey);
  const inline = f.mimeType.startsWith("audio/");
  return new NextResponse(new Uint8Array(buf), {
    headers: {
      "content-type": f.mimeType,
      "content-length": String(buf.length),
      "content-disposition": `${inline ? "inline" : "attachment"}; filename="${f.fileName.replace(/[^\w.\- ]/g, "_")}"`,
      "cache-control": "private, no-store",
      "x-content-type-options": "nosniff",
      "content-security-policy": "default-src 'none'; sandbox",
    },
  });
});
