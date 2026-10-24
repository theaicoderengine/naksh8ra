-- One-time database bootstrap, run by a Postgres superuser / cloud admin BEFORE
-- the first migration. Replace the passwords (use your secret manager); never
-- commit real values.
--
--   psql "$ADMIN_DATABASE_URL" \
--     -v owner_password="'...'" -v app_password="'...'" -v db_name=atlas \
--     -f scripts/db/bootstrap-roles.sql
--
-- atlas_owner : owns the schema; used ONLY by `prisma migrate deploy` and the seed.
-- atlas_app   : runtime role for web + worker. NOT the owner and NOBYPASSRLS, so
--               row-level security is enforced for every application query.

SELECT 'CREATE ROLE atlas_owner LOGIN' WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'atlas_owner') \gexec
SELECT 'CREATE ROLE atlas_app LOGIN NOBYPASSRLS' WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'atlas_app') \gexec
ALTER ROLE atlas_owner WITH LOGIN PASSWORD :owner_password;
ALTER ROLE atlas_app WITH LOGIN NOBYPASSRLS NOSUPERUSER NOCREATEDB NOCREATEROLE PASSWORD :app_password;

SELECT format('CREATE DATABASE %I OWNER atlas_owner', :'db_name') WHERE NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = :'db_name') \gexec
\connect :db_name
ALTER SCHEMA public OWNER TO atlas_owner;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO atlas_app;
