#!/usr/bin/env node
/**
 * `npm run build`.
 *   Everywhere:                Prisma client + Next.js production build.
 *   DEPLOY_TARGET=hostinger:   preflight checks first; after a successful build, database
 *                              migrations, the system seed and the AI-access verification —
 *                              so a failed build never touches the database, and a failed
 *                              migration fails the deployment (Hostinger keeps the previous
 *                              release running). Every step is idempotent and safe to re-run.
 */
import { spawnSync } from "node:child_process";

const hostinger = process.env.DEPLOY_TARGET === "hostinger";

function step(label, cmd, args, env = {}) {
  console.log(`\n▶ ${label}`);
  const r = spawnSync(cmd, args, { stdio: "inherit", env: { ...process.env, ...env }, shell: process.platform === "win32" });
  if (r.status !== 0) {
    console.error(`\n✖ ${label} failed (exit ${r.status ?? r.signal}). Deployment stopped.`);
    process.exit(r.status ?? 1);
  }
}

if (hostinger) step("Preflight checks", "npx", ["tsx", "scripts/hostinger/preflight.ts"]);
step("Generate Prisma client", "npx", ["prisma", "generate"]);
// Next.js must build with NODE_ENV=production even if the shell sets something else.
step("Build Next.js", "npx", ["next", "build"], { NODE_ENV: "production" });
if (hostinger) {
  step("Apply database migrations", "npx", ["prisma", "migrate", "deploy"]);
  step("System seed (roles, permissions, defaults)", "npx", ["tsx", "prisma/seed.ts"], { SEED_DEMO: "false" });
  step("Verify AI access invariants", "npx", ["tsx", "scripts/db/verify-ai-access.ts"]);
  console.log("\n✔ Hostinger build complete. Start command: npm start");
}
