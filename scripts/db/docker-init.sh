#!/bin/sh
# Used by docker-compose's postgres container on first start (local/dev only).
set -e
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname postgres \
  -v owner_password="'${ATLAS_OWNER_PASSWORD}'" -v app_password="'${ATLAS_APP_PASSWORD}'" -v db_name="${ATLAS_DB_NAME:-atlas}" \
  -f /bootstrap/bootstrap-roles.sql
