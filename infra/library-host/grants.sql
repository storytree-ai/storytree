-- What CI's health identity may do inside the library (ADR-0747): write health (test-result)
-- records in the storytree project's database, storytree_storytree, and nothing else. The database
-- enforces it, whatever code CI runs. Safe to run again.
--
-- RUN IT on the Mint box, connected to the database storytree_storytree (not `postgres`), as an
-- account that may act as the role that owns that database, the box's own account over the local socket:
--   psql -X -v ON_ERROR_STOP=1 -d storytree_storytree \
--     -v ci_role="$(psql -XAt -d storytree_storytree -c "SELECT rolname FROM pg_roles WHERE rolname LIKE 'storytree-ci-health@%'")" \
--     -f infra/library-host/grants.sql
-- CI's role is the psql variable ci_role: its name, storytree-ci-health@<project>.iam, carries the
-- cloud project's id, so it is read from the server's roles rather than written here. Without it,
-- the first statement fails and nothing is changed.
-- The first statement takes that role on, so everything below is granted by the owner itself; an
-- account that may not is refused at once, with nothing changed.
--
-- How much of the server the role may hold (connections, query time, temporary files) is set apart,
-- by a superuser: infra/library-host/ci-role-limits.sql.
--
-- WHAT IT GRANTS. The database lets the account in (CONNECT), the schema lets it name the tables
-- (USAGE), and then:
--   - it reads what an open and a health run read, and no other record: library_meta (is the
--     project current?), and in record and record_event (a column's history) only the health
--     records and the plan a run walks (story, capability, contract, arc, increment, anchor), so a
--     decision, a note or a question is not there for it;
--   - it adds and replaces rows of `record` (INSERT, UPDATE), and adds rows to `record_event`
--     (INSERT, and USAGE on its numbering sequence), and row-level security below lets those writes
--     through only for health records. Whether a history entry's id names a record of another kind
--     is asked of ci_health_record_kind(), which runs as the owner: it sees the records CI cannot,
--     and answers with a record's kind only;
--   - it deletes nothing, and changes no table: it neither owns them nor may act as their owner, so
--     every CREATE, ALTER or DROP is refused. storytree opens a project without touching its tables
--     when they are current (ADR-0747), so it needs none of that; when they are behind, the open is
--     refused saying the owner must open it first.
--   - `embedding` (ranked search's cache) is not granted: a health write never touches it, only a
--     search fills it, and CI does not search.
--
-- ROW-LEVEL SECURITY. This file ENABLES it on `record` and `record_event`; storytree's schema FORCES it
-- there (library contract 1.28), so the tables' owner meets it too. Every other account storytree uses (the
-- laptop, the Mint box, the app) connects acting as that owner (contract 8.3), and the schema gives the
-- owner its own policies: it reads and writes records and adds history, but changes or removes a history
-- entry only through the logged repair switch, record_event_repair(reason). CI's policies below bind
-- accounts like CI's, which act as themselves. An account with no policy sees and writes no rows at all.
-- A superuser (the box's own account, which the backups dump as) passes row-level security even forced.

-- CI's role, named before anything is granted, so a run without it stops here.
SELECT :'ci_role' AS ci_role;

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
    RAISE EXCEPTION '% may not act as %, the role that owns storytree_storytree: connect as an account that may (the box''s own account over its local socket) and run this again', session_user, owner;
  END;
END
$$;

GRANT CONNECT ON DATABASE "storytree_storytree" TO :"ci_role";
GRANT USAGE ON SCHEMA public TO :"ci_role";
-- From Postgres 15 only the schema's owner may create in it; before 15 every account could. Said
-- here so that holds on any version: no table appears in the library but its owner's.
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
GRANT SELECT ON library_meta TO :"ci_role";
GRANT SELECT, INSERT, UPDATE ON record TO :"ci_role";
GRANT SELECT, INSERT ON record_event TO :"ci_role";
GRANT USAGE ON SEQUENCE record_event_seq_seq TO :"ci_role";

ALTER TABLE record ENABLE ROW LEVEL SECURITY;
ALTER TABLE record_event ENABLE ROW LEVEL SECURITY;

-- It reads health and the plan a run walks: a health entry's contract, the plan above it, the
-- history of a column. No other kind of record, nor its history.
DROP POLICY IF EXISTS ci_health_read ON record;
CREATE POLICY ci_health_read ON record FOR SELECT TO :"ci_role"
  USING (type = ANY (ARRAY['health', 'story', 'capability', 'contract', 'arc', 'increment', 'anchor']));
DROP POLICY IF EXISTS ci_health_read ON record_event;
CREATE POLICY ci_health_read ON record_event FOR SELECT TO :"ci_role"
  USING (type = ANY (ARRAY['health', 'story', 'capability', 'contract', 'arc', 'increment', 'anchor']));

-- The kind of the record an id names, or null when none does, seen as the owner sees it: the
-- history rule below asks it about ids CI may not read. It runs as the role that made it, the
-- owner, and only CI's role may call it.
CREATE OR REPLACE FUNCTION ci_health_record_kind(id text) RETURNS text
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
  AS $kind$ SELECT type FROM record WHERE record.id = ci_health_record_kind.id $kind$;
REVOKE ALL ON FUNCTION ci_health_record_kind(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION ci_health_record_kind(text) TO :"ci_role";

-- It writes a record only if the record is health, before and after; an update of any other row
-- (a story's, say) is refused, as is turning a health record into another kind.
DROP POLICY IF EXISTS ci_health_insert ON record;
CREATE POLICY ci_health_insert ON record FOR INSERT TO :"ci_role"
  WITH CHECK (type = 'health');
DROP POLICY IF EXISTS ci_health_update ON record;
CREATE POLICY ci_health_update ON record FOR UPDATE TO :"ci_role"
  USING (type = 'health') WITH CHECK (type = 'health');

-- It adds history only for a health record: the entry says health, holds a health record, and is
-- not filed under the id of a record of any other kind.
DROP POLICY IF EXISTS ci_health_insert ON record_event;
CREATE POLICY ci_health_insert ON record_event FOR INSERT TO :"ci_role"
  WITH CHECK (
    type = 'health'
    AND record->>'type' = 'health'
    AND coalesce(ci_health_record_kind(record_id), 'health') = 'health'
  );

RESET ROLE;

-- Check: the account's rights, as the database sees them. Expect: may_connect, reads, writes_record,
-- writes_history, asks_kind all true; may_act_as_owner, may_create false; rls on both tables true; forced true once storytree has
-- opened the project with its current schema.
SELECT has_database_privilege(:'ci_role', 'storytree_storytree', 'CONNECT') AS may_connect,
       has_table_privilege(:'ci_role', 'record', 'SELECT')
         AND has_table_privilege(:'ci_role', 'library_meta', 'SELECT') AS reads,
       has_table_privilege(:'ci_role', 'record', 'INSERT, UPDATE') AS writes_record,
       has_table_privilege(:'ci_role', 'record_event', 'INSERT') AS writes_history,
       has_function_privilege(:'ci_role', 'ci_health_record_kind(text)', 'EXECUTE') AS asks_kind,
       pg_has_role(:'ci_role', datdba, 'SET') AS may_act_as_owner,
       has_schema_privilege(:'ci_role', 'public', 'CREATE') AS may_create,
       (SELECT bool_and(relrowsecurity) FROM pg_class WHERE relname IN ('record', 'record_event') AND relkind = 'r') AS rls,
       (SELECT bool_or(relforcerowsecurity) FROM pg_class WHERE relname IN ('record', 'record_event') AND relkind = 'r') AS forced
  FROM pg_database WHERE datname = current_database();
