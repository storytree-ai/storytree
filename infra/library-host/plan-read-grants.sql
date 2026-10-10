-- What CI's plan-read role, ci_plan_read, may do inside the library on the Mint box (ADR-0952): read
-- the plan of the storytree project's database, storytree_storytree, so CI's capability-list check
-- can run (.github/workflows/capability-list.yml), and nothing else. The database enforces it,
-- whatever code CI runs. Safe to run again.
--
-- RUN IT connected to the database storytree_storytree, as an account that may act as the role that
-- owns that database (on the box: the local superuser). The first statement takes that role on, so
-- everything below is granted by the owner itself; an account that may not is refused at once, with
-- nothing changed. The role itself (LOGIN, its password) is made apart from this file, and its
-- password is the secret PLAN_PG_PASSWORD in the GitHub environment plan-read.
--
-- WHAT IT GRANTS. The database lets the role in (CONNECT), the schema lets it name the tables
-- (USAGE), and then it reads, never writes:
--   - library_meta (is the project current?);
--   - record, the plan's story, capability, contract, arc and increment records only;
--   - record_event, the same records' history: the check asks whether a pending change was read
--     against its record's latest entry (ADR-0966 D5).
-- A read the check gains needs its grant here: contract 7.7 runs the check's reads as a role granted
-- exactly this file.
--
-- ROW-LEVEL SECURITY is ENABLED on record and record_event, not FORCED, as grants.sql leaves it: the
-- owner's accounts are unaffected, and an account with no policy sees no rows at all.

DO $$
DECLARE
  owner text;
BEGIN
  SELECT pg_get_userbyid(datdba) INTO owner FROM pg_database WHERE datname = current_database();
  IF current_database() <> 'storytree_storytree' THEN
    RAISE EXCEPTION 'connected to %, not storytree_storytree: connect to the library''s database and run this again', current_database();
  END IF;
  BEGIN
    EXECUTE format('SET ROLE %I', owner);
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE EXCEPTION '% may not act as %, the role that owns storytree_storytree: sign in as an account that may and run this again', session_user, owner;
  END;
END
$$;

GRANT CONNECT ON DATABASE "storytree_storytree" TO ci_plan_read;
GRANT USAGE ON SCHEMA public TO ci_plan_read;
GRANT SELECT ON library_meta TO ci_plan_read;
GRANT SELECT ON record TO ci_plan_read;
GRANT SELECT ON record_event TO ci_plan_read;

ALTER TABLE record ENABLE ROW LEVEL SECURITY;
ALTER TABLE record_event ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS ci_plan_read ON record;
CREATE POLICY ci_plan_read ON record FOR SELECT TO ci_plan_read
  USING (type = ANY (ARRAY['story', 'capability', 'contract', 'arc', 'increment']));
DROP POLICY IF EXISTS ci_plan_read ON record_event;
CREATE POLICY ci_plan_read ON record_event FOR SELECT TO ci_plan_read
  USING (type = ANY (ARRAY['story', 'capability', 'contract', 'arc', 'increment']));

RESET ROLE;

-- Check: the role's rights, as the database sees them. Expect: may_connect and reads true; writes,
-- may_act_as_owner and may_create false; rls on both tables true, forced false.
SELECT has_database_privilege('ci_plan_read', 'storytree_storytree', 'CONNECT') AS may_connect,
       has_table_privilege('ci_plan_read', 'record', 'SELECT')
         AND has_table_privilege('ci_plan_read', 'record_event', 'SELECT')
         AND has_table_privilege('ci_plan_read', 'library_meta', 'SELECT') AS reads,
       has_table_privilege('ci_plan_read', 'record', 'INSERT, UPDATE, DELETE')
         OR has_table_privilege('ci_plan_read', 'record_event', 'INSERT, UPDATE, DELETE') AS writes,
       pg_has_role('ci_plan_read', datdba, 'SET') AS may_act_as_owner,
       has_schema_privilege('ci_plan_read', 'public', 'CREATE') AS may_create,
       (SELECT bool_and(relrowsecurity) FROM pg_class WHERE relname IN ('record', 'record_event') AND relkind = 'r') AS rls,
       (SELECT bool_or(relforcerowsecurity) FROM pg_class WHERE relname IN ('record', 'record_event') AND relkind = 'r') AS forced
  FROM pg_database WHERE datname = current_database();
