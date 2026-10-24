-- What CI's two library roles may use of the Mint box's Postgres, whatever code CI runs: CI's health
-- role ("storytree-ci-health@storytree-498613.iam", grants.sql) and its plan-read role (ci_plan_read,
-- plan-read-grants.sql). Those files say what each may read and write inside storytree_storytree;
-- this one caps how much of the server each may hold, so a run gone wrong, or one acting for someone
-- else, cannot take every connection, fill the disk or hold the library up. Safe to run again.
--
-- RUN IT on the Mint box as a superuser, connected to any database: only a superuser may set
-- temp_file_limit on a role, which is why it is kept out of grants.sql, which the database's owner
-- runs. On the box:
--   sudo -u postgres psql -X -v ON_ERROR_STOP=1 -d postgres -f infra/library-host/ci-role-limits.sql
-- A role setting takes hold at the role's next sign-in; a session already open keeps what it had.
--
-- WHAT IT SETS, on each role:
--   - CONNECTION LIMIT: 15 for the health role, 25 for plan-read. storytree's pool waits for a free
--     slot rather than failing (packages/library/src/project/server.ts), so a busy run queues; it
--     never takes the owner's slots.
--   - statement_timeout 60s: no CI query runs longer; the owner's do not change.
--   - temp_file_limit 1GB: a query that would spill more to disk is cancelled.
--   - idle_session_timeout 15min: a connection left idle that long is closed. A health run holds
--     its connection while a story's tests run, so this is kept well above the longest story's.
-- And on every database of the box, it takes TEMPORARY from PUBLIC: Postgres lets every role make
-- temporary tables by default, and nothing in storytree makes one. Each database's owner keeps it.
-- A database made after this ran (a new project's) has the default again: run this file again.

DO $$
DECLARE
  role text;
BEGIN
  IF NOT (SELECT rolsuper FROM pg_roles WHERE rolname = current_user) THEN
    RAISE EXCEPTION '% is not a superuser: run this as the box''s postgres account (sudo -u postgres psql …)', current_user;
  END IF;
  FOREACH role IN ARRAY ARRAY['storytree-ci-health@storytree-498613.iam', 'ci_plan_read'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = role) THEN
      RAISE EXCEPTION 'no role %: make CI''s roles first (infra/library-host/README.md), then run this again', role;
    END IF;
  END LOOP;
END
$$;

ALTER ROLE "storytree-ci-health@storytree-498613.iam" CONNECTION LIMIT 15;
ALTER ROLE ci_plan_read CONNECTION LIMIT 25;

ALTER ROLE "storytree-ci-health@storytree-498613.iam" SET statement_timeout = '60s';
ALTER ROLE "storytree-ci-health@storytree-498613.iam" SET temp_file_limit = '1GB';
ALTER ROLE "storytree-ci-health@storytree-498613.iam" SET idle_session_timeout = '15min';
ALTER ROLE ci_plan_read SET statement_timeout = '60s';
ALTER ROLE ci_plan_read SET temp_file_limit = '1GB';
ALTER ROLE ci_plan_read SET idle_session_timeout = '15min';

DO $$
DECLARE
  database text;
BEGIN
  FOR database IN SELECT datname FROM pg_database WHERE datallowconn AND NOT datistemplate LOOP
    EXECUTE format('REVOKE TEMPORARY ON DATABASE %I FROM PUBLIC', database);
  END LOOP;
END
$$;

-- Check: each role's limits as the server holds them, and the databases where PUBLIC may still
-- make temporary tables. Expect two rows of limits, and no row in the second result.
SELECT rolname, rolconnlimit, rolconfig FROM pg_roles
 WHERE rolname IN ('storytree-ci-health@storytree-498613.iam', 'ci_plan_read') ORDER BY rolname;
SELECT datname AS public_may_make_temp FROM pg_database
 WHERE datallowconn AND NOT datistemplate AND has_database_privilege('public', datname, 'TEMPORARY');
