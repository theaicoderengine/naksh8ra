/**
 * Re-encrypt stored secrets with the current ENCRYPTION_KEY (key rotation).
 *   npm run secrets:reencrypt              # dry run: report only
 *   npm run secrets:reencrypt -- --apply   # write
 * See docs/operations.md → "Encryption key rotation". Prints counts and row ids only.
 */
import { reencryptSecrets } from "../src/server/security/reencrypt";
import { prisma } from "../src/server/db/client";

const apply = process.argv.includes("--apply");
reencryptSecrets(apply)
  .then(async (r) => {
    for (const [table, s] of Object.entries(r.tables)) {
      console.log(`${table}: total ${s.total}, on current key ${s.current}, ${apply ? "re-encrypted" : "would re-encrypt"} ${s.reencrypted}, undecryptable ${s.undecryptable.length}${s.undecryptable.length ? ` (ids: ${s.undecryptable.join(", ")})` : ""}`);
    }
    if (!apply) console.log("\nDry run. Re-run with --apply to write.");
    await prisma.$disconnect();
    if (Object.values(r.tables).some((s) => s.undecryptable.length)) process.exitCode = 2;
  })
  .catch(async (e) => {
    console.error(e instanceof Error ? e.message : e);
    await prisma.$disconnect();
    process.exit(1);
  });
