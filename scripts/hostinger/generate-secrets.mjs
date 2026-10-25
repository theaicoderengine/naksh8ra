#!/usr/bin/env node
/**
 * Prints fresh values for the secrets ATLAS generates itself, for pasting into hPanel →
 * Environment variables (and a password manager). Run on your own machine; nothing is stored.
 *   npm run secrets:generate
 * NEVER generate a new ENCRYPTION_KEY for an existing deployment: stored MFA secrets and
 * organisation AI keys would become unreadable. Rotation: docs/operations.md.
 */
import crypto from "node:crypto";

const hex = (n) => crypto.randomBytes(n).toString("hex");
console.log(`# Generated ${new Date().toISOString()} — new deployments only
ENCRYPTION_KEY=${crypto.randomBytes(32).toString("base64")}
CRON_SECRET=${hex(32)}
EMAIL_WEBHOOK_SECRET=${hex(32)}
# Database role passwords (used in scripts/db/bootstrap-roles.sql and the two database URLs):
ATLAS_OWNER_PASSWORD=${hex(24)}
ATLAS_APP_PASSWORD=${hex(24)}`);
