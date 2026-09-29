-- What CI's health identity may do inside the library (ADR-0747): write health (test-result)
-- records in the storytree project's database, storytree_storytree, and nothing else. The database
-- enforces it, whatever code CI runs. Safe to run again.
--
-- RUN IT connected to the database storytree_storytree (not `postgres`), as an account that may act
-- as the role that owns that database: your own Google account, the one the storytree app signs in
-- as (Cloud SQL Studio, IAM database authentication). The first statement takes that role on, so
-- everything below is granted by the owner itself; an account that may not is refused at once,
-- with nothing changed.
--
-- WHAT IT GRANTS. The database lets the account in (CONNECT), the schema lets it name the tables
-- (USAGE), and then:
--   - it reads every table an open and a health write read: library_meta (is the project current?),
--     record (the contract a health entry is on, the plan it rolls up into) and record_event (a
--     column's history);
--   - it adds and replaces rows of `record` (INSERT, UPDATE), and adds rows to `record_event`
--     (INSERT, and USAGE on its numbering sequence), and row-level security below lets those writes
--     through only for health records;
--   - it deletes nothing, and changes no table: it neither owns them nor may act as their owner, so
--     every CREATE, ALTER or DROP is refused. storytree opens a project without touching its tables
--     when they are current (ADR-0747), so it needs none of that; when they are behind, the open is
--     refused saying the owner must open it first.
--   - `embedding` (ranked search's cache) is not granted: a health write never touches it, only a
--     search fills it, and CI does not search.
--
-- ROW-LEVEL SECURITY, and why the owner is unaffected. It is ENABLED on `record` and `record_event`,
-- not FORCED: Postgres skips it for the tables' owner, and every other account storytree uses (the
-- laptop, the Mint box, the app) connects acting as that owner (contract 8.3). So the policies bind
-- only accounts like CI's, which act as themselves. An account with no policy sees and writes no
-- rows at all.

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
    RAISE EXCEPTION '% may not act as %, the role that owns storytree_storytree: sign in as an account that may (your own Google account, as the storytree app does) and run this again', session_user, owner;
  END;
END
$$;

GRANT CONNECT ON DATABASE "storytree_storytree" TO "storytree-ci-health@storytree-498613.iam";
GRANT USAGE ON SCHEMA public TO "storytree-ci-health@storytree-498613.iam";
-- From Postgres 15 only the schema's owner may create in it; before 15 every account could. Said
-- here so that holds on any version: no table appears in the library but its owner's.
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
GRANT SELECT ON library_meta TO "storytree-ci-health@storytree-498613.iam";
GRANT SELECT, INSERT, UPDATE ON record TO "storytree-ci-health@storytree-498613.iam";
GRANT SELECT, INSERT ON record_event TO "storytree-ci-health@storytree-498613.iam";
GRANT USAGE ON SEQUENCE record_event_seq_seq TO "storytree-ci-health@storytree-498613.iam";

ALTER TABLE record ENABLE ROW LEVEL SECURITY;
ALTER TABLE record_event ENABLE ROW LEVEL SECURITY;

-- It reads every row: a health entry's contract, the plan above it, the history of a column.
DROP POLICY IF EXISTS ci_health_read ON record;
CREATE POLICY ci_health_read ON record FOR SELECT TO "storytree-ci-health@storytree-498613.iam" USING (true);
DROP POLICY IF EXISTS ci_health_read ON record_event;
CREATE POLICY ci_health_read ON record_event FOR SELECT TO "storytree-ci-health@storytree-498613.iam" USING (true);

-- It writes a record only if the record is health, before and after; an update of any other row
-- (a story's, say) is refused, as is turning a health record into another kind.
DROP POLICY IF EXISTS ci_health_insert ON record;
CREATE POLICY ci_health_insert ON record FOR INSERT TO "storytree-ci-health@storytree-498613.iam"
  WITH CHECK (type = 'health');
DROP POLICY IF EXISTS ci_health_update ON record;
CREATE POLICY ci_health_update ON record FOR UPDATE TO "storytree-ci-health@storytree-498613.iam"
  USING (type = 'health') WITH CHECK (type = 'health');

-- It adds history only for a health record: the entry says health, holds a health record, and is
-- not filed under the id of a record of any other kind.
DROP POLICY IF EXISTS ci_health_insert ON record_event;
CREATE POLICY ci_health_insert ON record_event FOR INSERT TO "storytree-ci-health@storytree-498613.iam"
  WITH CHECK (
    type = 'health'
    AND record->>'type' = 'health'
    AND NOT EXISTS (SELECT 1 FROM record AS held WHERE held.id = record_event.record_id AND held.type <> 'health')
  );

RESET ROLE;

-- Check: the account's rights, as the database sees them. Expect: may_connect, reads, writes_record,
-- writes_history all true; may_act_as_owner, may_create false; rls on both tables true, forced false.
SELECT has_database_privilege('storytree-ci-health@storytree-498613.iam', 'storytree_storytree', 'CONNECT') AS may_connect,
       has_table_privilege('storytree-ci-health@storytree-498613.iam', 'record', 'SELECT')
         AND has_table_privilege('storytree-ci-health@storytree-498613.iam', 'library_meta', 'SELECT') AS reads,
       has_table_privilege('storytree-ci-health@storytree-498613.iam', 'record', 'INSERT, UPDATE') AS writes_record,
       has_table_privilege('storytree-ci-health@storytree-498613.iam', 'record_event', 'INSERT') AS writes_history,
       pg_has_role('storytree-ci-health@storytree-498613.iam', datdba, 'SET') AS may_act_as_owner,
       has_schema_privilege('storytree-ci-health@storytree-498613.iam', 'public', 'CREATE') AS may_create,
       (SELECT bool_and(relrowsecurity) FROM pg_class WHERE relname IN ('record', 'record_event') AND relkind = 'r') AS rls,
       (SELECT bool_or(relforcerowsecurity) FROM pg_class WHERE relname IN ('record', 'record_event') AND relkind = 'r') AS forced
  FROM pg_database WHERE datname = current_database();
