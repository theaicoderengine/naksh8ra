import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { ENDPOINTS, buildOpenApi } from "@/server/openapi";

function routeFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) => (d.isDirectory() ? routeFiles(path.join(dir, d.name)) : d.name === "route.ts" ? [path.join(dir, d.name)] : []));
}

describe("API contract", () => {
  const root = path.resolve("src/app/api/v1");
  const implemented = routeFiles(root).flatMap((f) => {
    const src = fs.readFileSync(f, "utf8");
    const p = "/" + path.relative(root, path.dirname(f)).split(path.sep).join("/").replace(/\[(\w+)\]/g, "{$1}");
    return ["GET", "POST", "PATCH", "PUT", "DELETE"].filter((m) => new RegExp(`export (const|async function|function) ${m}\\b`).test(src)).map((m) => `${m.toLowerCase()} ${p}`);
  }).filter((x) => !x.endsWith("/openapi.json"));
  const documented = ENDPOINTS.map((e) => `${e.method} ${e.path}`);

  it("every implemented endpoint is documented in OpenAPI", () => {
    expect(implemented.filter((x) => !documented.includes(x))).toEqual([]);
  });
  it("every documented endpoint is implemented", () => {
    expect(documented.filter((x) => !implemented.includes(x))).toEqual([]);
  });
  it("produces a valid-looking OpenAPI 3 document", () => {
    const doc = buildOpenApi();
    expect(doc.openapi).toBe("3.0.3");
    expect(Object.keys(doc.paths).length).toBeGreaterThan(100);
  });
  it("every state-changing org endpoint declares a required permission or is self-scoped", () => {
    const missing = ENDPOINTS.filter((e) => e.auth === "org" && e.method !== "get" && !e.permission).map((e) => `${e.method} ${e.path}`);
    // These are scoped by service-level checks (e.g. own notifications) — keep the list explicit.
    expect(missing).toEqual([]);
  });
});
