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

-- Works as a real superuser and as the non-superuser admin of managed Postgres services
-- (Neon, Supabase, RDS, …: CREATEROLE + CREATEDB). Attributes are set when a role is created;
-- re-runs only update passwords.
SELECT 'CREATE ROLE atlas_owner LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS' WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'atlas_owner') \gexec
SELECT 'CREATE ROLE atlas_app LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS' WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'atlas_app') \gexec
ALTER ROLE atlas_owner WITH LOGIN PASSWORD :owner_password;
ALTER ROLE atlas_app WITH LOGIN PASSWORD :app_password;
-- RLS is only enforced if the runtime role cannot bypass it.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'atlas_app' AND (rolsuper OR rolbypassrls)) THEN
    RAISE EXCEPTION 'atlas_app must not be SUPERUSER or BYPASSRLS: row-level security would not apply';
  END IF;
END $$;
-- A non-superuser admin must be able to SET ROLE atlas_owner to create a database it owns
-- (PostgreSQL 16+ gives a role's creator ADMIN but not SET; older versions check membership).
SELECT format('GRANT atlas_owner TO %I', current_user)
  WHERE NOT (SELECT rolsuper FROM pg_roles WHERE rolname = current_user)
    AND NOT CASE WHEN current_setting('server_version_num')::int >= 160000
                 THEN pg_has_role(current_user, 'atlas_owner', 'SET')
                 ELSE pg_has_role(current_user, 'atlas_owner', 'MEMBER') END \gexec

SELECT format('CREATE DATABASE %I OWNER atlas_owner', :'db_name') WHERE NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = :'db_name') \gexec
\connect :db_name
ALTER SCHEMA public OWNER TO atlas_owner;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO atlas_app;
