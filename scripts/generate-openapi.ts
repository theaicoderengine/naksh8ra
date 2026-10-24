import fs from "node:fs";
import { buildOpenApi } from "../src/server/openapi";

const doc = buildOpenApi();
fs.mkdirSync("docs", { recursive: true });
fs.writeFileSync("docs/openapi.json", JSON.stringify(doc, null, 2));
console.log(`Wrote docs/openapi.json (${Object.keys(doc.paths).length} paths)`);
