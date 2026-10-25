#!/usr/bin/env bash
# Rehearses a Hostinger deployment on one machine (CI, or locally):
#   1. env built from .env.hostinger.example (production mode, Postgres queue, S3 storage)
#   2. `npm run build` with DEPLOY_TARGET=hostinger: preflight → build → migrate → seed → verify
#   3. the build again (must be repeatable)
#   4. `npm start` as Hostinger runs it, then scripts/hostinger/verify-deployment.mjs
#   5. a real background job: registration → email.send via the Postgres queue → SMTP received
#
# Needs: PostgreSQL with roles from scripts/db/bootstrap-roles.sql and an empty database
# ($REHEARSAL_DB, default atlas_hostinger), an S3-compatible endpoint with bucket atlas-files
# ($S3_ENDPOINT, default http://127.0.0.1:5005) and an SMTP sink ($SMTP_PORT, default 2525)
# writing to $SMTP_LOG. Uses throwaway credentials only.
set -euo pipefail
cd "$(dirname "$0")/../.."
DB="${REHEARSAL_DB:-atlas_hostinger}"
PORT="${REHEARSAL_PORT:-3300}"
WORK="$(mktemp -d)"
# The server runs in its own process group so the whole tree (npm → next) is stopped on exit.
trap '[ -n "${SERVER_PID:-}" ] && kill -- "-$SERVER_PID" 2>/dev/null; rm -rf "$WORK"' EXIT
umask 077

CRON="$(openssl rand -hex 32)"
python3 - "$WORK/env" <<EOF
import sys, base64, os
over = {
  "APP_URL": "https://atlas.rehearsal.test",
  "DATABASE_URL": "postgresql://atlas_app:atlas_app_dev@localhost:5432/$DB?schema=public&pgbouncer=true&connection_limit=5",
  "MIGRATION_DATABASE_URL": "postgresql://atlas_owner:atlas_owner_dev@localhost:5432/$DB?schema=public",
  "ENCRYPTION_KEY": base64.b64encode(os.urandom(32)).decode(),
  "CRON_SECRET": "$CRON",
  "S3_REGION": "us-east-1", "S3_ENDPOINT": "${S3_ENDPOINT:-http://127.0.0.1:5005}",
  "S3_ACCESS_KEY_ID": "test", "S3_SECRET_ACCESS_KEY": "test",
  "EMAIL_PROVIDER": "smtp", "SMTP_URL": "smtp://127.0.0.1:${SMTP_PORT:-2525}",
  "EMAIL_WEBHOOK_SECRET": os.urandom(16).hex(), "POSTMARK_SERVER_TOKEN": "",
}
out, seen = [], set()
for line in open(".env.hostinger.example").read().splitlines():
    s = line.split(" #")[0].strip()
    if not s or s.startswith("#") or "=" not in s: continue
    k, v = s.split("=", 1)
    v = over.get(k, v.strip().strip('"'))
    seen.add(k); out.append(f"{k}='{v}'")
out += [f"{k}='{v}'" for k, v in over.items() if k not in seen]
open(sys.argv[1], "w").write("\n".join(out) + "\n")
EOF

run() { env -u NODE_ENV bash -c "set -a; . '$WORK/env'; set +a; $*"; }

echo "── 1. Hostinger build (preflight, build, migrate, seed, verify)"
run npm run build
echo "── 2. Build again (repeatable deploy)"
run npm run build >/dev/null
run npx tsx scripts/db/verify-ai-access.ts --expect-no-grants | tail -1

echo "── 3. Start as Hostinger does (npm start)"
setsid bash -c "set -a; . '$WORK/env'; set +a; unset NODE_ENV; PORT=$PORT exec npm start" > "$WORK/server.log" 2>&1 &
SERVER_PID=$!
for _ in $(seq 1 60); do curl -sf "http://127.0.0.1:$PORT/api/health" >/dev/null && break; sleep 1; done
sleep 6 # first in-process runner cycle
node scripts/hostinger/verify-deployment.mjs "http://127.0.0.1:$PORT" --allow-http --cron-secret="$CRON"

echo "── 4. Background job through the Postgres queue"
EMAIL="rehearsal-$(openssl rand -hex 4)@example.test"
curl -sf -X POST "http://127.0.0.1:$PORT/api/v1/auth/register" -H 'content-type: application/json' \
  -H 'origin: https://atlas.rehearsal.test' -H 'x-forwarded-for: 203.0.113.10' \
  -d "{\"email\":\"$EMAIL\",\"password\":\"Correct-horse-battery-9\",\"firstName\":\"Re\",\"lastName\":\"Hearsal\",\"intent\":\"EMPLOYER\",\"acceptTerms\":true}" >/dev/null
for _ in $(seq 1 30); do grep -q "$EMAIL" "${SMTP_LOG:?SMTP_LOG must point at the SMTP sink log}" && break; sleep 1; done
grep -q "$EMAIL" "$SMTP_LOG" || { echo "✖ verification email was not delivered"; tail -20 "$WORK/server.log"; exit 1; }
echo "✔ verification email delivered by the in-process runner"
STATUS=$(psql "postgresql://atlas_owner:atlas_owner_dev@localhost:5432/$DB" -tAc "SELECT string_agg(DISTINCT status, ',') FROM \"JobRun\" WHERE queue = 'atlas-pg'")
echo "job statuses: $STATUS"
[ "$STATUS" = "COMPLETED" ] || { echo "✖ unexpected job statuses"; exit 1; }
if grep -q '"level":50' "$WORK/server.log"; then echo "✖ server logged errors:"; grep '"level":50' "$WORK/server.log" | head -5; exit 1; fi
echo "✔ Hostinger rehearsal passed"
