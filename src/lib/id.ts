import crypto from "node:crypto";

/** Collision-resistant id compatible with Prisma cuid-style string ids. */
export function createId(): string {
  return "c" + crypto.randomBytes(12).toString("base64url").replace(/[-_]/g, "x").toLowerCase();
}

export function slugify(s: string, max = 48): string {
  return (
    s
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, max) || "item"
  );
}
