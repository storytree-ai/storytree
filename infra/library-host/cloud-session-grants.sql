-- What the cloud sessions' own account may do inside the library (ADR-1264 D1, question_80125ab9092e
-- settled as its option A): what a pool lane does in the storytree project's database,
-- storytree_storytree, through storytree's own writes, and nothing more. Until it is applied, a cloud
-- session signs in as storytree_library, the role that owns every table (ADR-1093). The database
-- enforces it, whatever code a cloud session runs. Safe to run again. Library contracts 30.6 and 30.7
-- run this file as written, with only its two names filled in.
--
-- RUN IT on the Mint box, connected to the database storytree_storytree (not `postgres`), as an
-- account that may act as the role that owns that database (the box's own account over the local
-- socket), with the account's name as the psql variable cloud_role:
--   psql -X -v ON_ERROR_STOP=1 -d storytree_storytree -v cloud_role=storytree_cloud \
--     -f infra/library-host/cloud-session-grants.sql
-- The account itself (LOGIN, its password) is made apart from this file, by a superuser, and its
-- password goes into the cloud environment as PGPASSWORD, its name as PGUSER (infra/library-host/
-- README.md, "A cloud session on the route"). Without cloud_role, the first statement fails and
-- nothing is changed. The first statement after it takes the owner on, so everything below is granted
-- by the owner itself; an account that may not is refused at once, with nothing changed.
--
-- This file is the project database's half. A lane also writes the session-management databases,
-- granted by cloud-session-activity-grants.sql (storytree-activity: claims and the sessions list) and
-- cloud-session-trunks-grants.sql (storytree-trunks: the machine it joins as), and, where it runs the
-- factory's plugin, that plugin's own (storytree-quality), whose grants are the plugin's.
--
-- WHAT IT GRANTS. The database lets the account in (CONNECT), the schema lets it name the tables
-- (USAGE), and then:
--   - it reads every record and its history, and library_meta (is the project current?): a lane reads
--     the plan, the decisions and notes it stands on, and the history a new decision's number is
--     taken from;
--   - it adds, replaces and removes rows of `record` (INSERT, UPDATE, DELETE) and adds rows to
--     `record_event` (INSERT, and USAGE on its numbering sequence), and row-level security below lets
--     those writes through only for the kinds a lane writes (LANE_KINDS), each record keeping its kind;
--     a live record is removed only once its newest history entry is its retirement, which storytree's
--     retire writes first, so nothing it removes leaves the history;
--   - it reads and adds to `embedding`, ranked search's cache, which a search fills;
--   - it changes and removes no history, and has nothing of history_repair, media or feedback_screenshot;
--   - it changes no table: it neither owns them nor may act as their owner, so every CREATE, ALTER or
--     DROP is refused. storytree opens a project without touching its tables when they are current
--     (ADR-0747); when they are behind, the open is refused saying the owner must open it first.
-- Not granted, so a cloud session cannot write them: agent roles and their notes (ADR-1264 D1 sends
-- no such work to the cloud), the decision-numbering floor, a factory's processes and checks, a
-- plugin's kinds (a voice note), feedback, and any kind not named in LANE_KINDS.
--
-- ROW-LEVEL SECURITY. This file ENABLES it on `record` and `record_event`; storytree's schema FORCES it
-- there (library contract 1.28). The owner's accounts pass through the owner's own policies; the
-- policies below bind only cloud_role, which acts as itself.

-- The cloud sessions' account, named before anything is granted, so a run without it stops here.
SELECT :'cloud_role' AS cloud_role;

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

GRANT CONNECT ON DATABASE "storytree_storytree" TO :"cloud_role";
GRANT USAGE ON SCHEMA public TO :"cloud_role";
-- From Postgres 15 only the schema's owner may create in it; said here so that holds on any version.
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
GRANT SELECT ON library_meta TO :"cloud_role";
GRANT SELECT, INSERT, UPDATE, DELETE ON record TO :"cloud_role";
GRANT SELECT, INSERT ON record_event TO :"cloud_role";
GRANT USAGE ON SEQUENCE record_event_seq_seq TO :"cloud_role";
GRANT SELECT, INSERT ON embedding TO :"cloud_role";

ALTER TABLE record ENABLE ROW LEVEL SECURITY;
ALTER TABLE record_event ENABLE ROW LEVEL SECURITY;

-- LANE_KINDS: the kinds a pool lane writes. The plan, questions, friction and resteers, health, and
-- knowledge notes. A kind is added here, and to contract 30.6's test, when a lane comes to write it.
CREATE OR REPLACE FUNCTION cloud_session_kinds() RETURNS text[]
  LANGUAGE sql IMMUTABLE
  AS $kinds$ SELECT ARRAY['story', 'capability', 'contract', 'arc', 'increment', 'question', 'friction', 'resteer',
    'health', 'decision', 'principle', 'research', 'pattern', 'definition', 'fyi', 'guardrail', 'prediction']::text[] $kinds$;
REVOKE ALL ON FUNCTION cloud_session_kinds() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION cloud_session_kinds() TO :"cloud_role";

-- The kinds an id has been, in the record table and its history, seen as the owner sees them: the
-- rules below ask it whether a write keeps a record's kind.
CREATE OR REPLACE FUNCTION cloud_session_id_kinds(id text) RETURNS text[]
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
  AS $kinds$ SELECT coalesce(array_agg(DISTINCT type), '{}') FROM (
    SELECT type FROM record WHERE record.id = cloud_session_id_kinds.id
    UNION ALL SELECT type FROM record_event WHERE record_event.record_id = cloud_session_id_kinds.id
  ) AS kinds $kinds$;
REVOKE ALL ON FUNCTION cloud_session_id_kinds(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION cloud_session_id_kinds(text) TO :"cloud_role";

-- Whether the newest history entry under an id is its retirement, seen as the owner sees it.
CREATE OR REPLACE FUNCTION cloud_session_retired(id text) RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
  AS $retired$ SELECT coalesce((SELECT action = 'retired' FROM record_event
    WHERE record_event.record_id = cloud_session_retired.id ORDER BY seq DESC LIMIT 1), false) $retired$;
REVOKE ALL ON FUNCTION cloud_session_retired(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION cloud_session_retired(text) TO :"cloud_role";

-- It reads every record and every history entry.
DROP POLICY IF EXISTS cloud_session_read ON record;
CREATE POLICY cloud_session_read ON record FOR SELECT TO :"cloud_role" USING (true);
DROP POLICY IF EXISTS cloud_session_read ON record_event;
CREATE POLICY cloud_session_read ON record_event FOR SELECT TO :"cloud_role" USING (true);

-- It writes a record of a lane's kind, and only as the kind its id has always been.
DROP POLICY IF EXISTS cloud_session_insert ON record;
CREATE POLICY cloud_session_insert ON record FOR INSERT TO :"cloud_role"
  WITH CHECK (type = ANY (cloud_session_kinds()) AND cloud_session_id_kinds(id) <@ ARRAY[type]);
DROP POLICY IF EXISTS cloud_session_update ON record;
CREATE POLICY cloud_session_update ON record FOR UPDATE TO :"cloud_role"
  USING (type = ANY (cloud_session_kinds()))
  WITH CHECK (type = ANY (cloud_session_kinds()) AND cloud_session_id_kinds(id) <@ ARRAY[type]);
-- It removes a live record of a lane's kind only after writing its retirement into the history.
DROP POLICY IF EXISTS cloud_session_delete ON record;
CREATE POLICY cloud_session_delete ON record FOR DELETE TO :"cloud_role"
  USING (type = ANY (cloud_session_kinds()) AND cloud_session_retired(id));

-- It adds history only for a record of a lane's kind: the entry holds that record, under its own id,
-- and the id has been no other kind.
DROP POLICY IF EXISTS cloud_session_insert ON record_event;
CREATE POLICY cloud_session_insert ON record_event FOR INSERT TO :"cloud_role"
  WITH CHECK (
    type = ANY (cloud_session_kinds())
    AND record->>'type' = type
    AND record->>'id' = record_id
    AND cloud_session_id_kinds(record_id) <@ ARRAY[type]
  );

RESET ROLE;

-- Check: the account's rights, as the database sees them. Expect: may_connect, reads, writes_record,
-- writes_history, fills_search all true; may_act_as_owner, may_create, changes_history false; rls on
-- both tables true; forced true once storytree has opened the project with its current schema.
SELECT has_database_privilege(:'cloud_role', 'storytree_storytree', 'CONNECT') AS may_connect,
       has_table_privilege(:'cloud_role', 'record', 'SELECT')
         AND has_table_privilege(:'cloud_role', 'record_event', 'SELECT')
         AND has_table_privilege(:'cloud_role', 'library_meta', 'SELECT') AS reads,
       has_table_privilege(:'cloud_role', 'record', 'INSERT, UPDATE, DELETE') AS writes_record,
       has_table_privilege(:'cloud_role', 'record_event', 'INSERT') AS writes_history,
       has_table_privilege(:'cloud_role', 'embedding', 'INSERT') AS fills_search,
       has_table_privilege(:'cloud_role', 'record_event', 'UPDATE')
         OR has_table_privilege(:'cloud_role', 'record_event', 'DELETE') AS changes_history,
       pg_has_role(:'cloud_role', datdba, 'SET') AS may_act_as_owner,
       has_schema_privilege(:'cloud_role', 'public', 'CREATE') AS may_create,
       (SELECT bool_and(relrowsecurity) FROM pg_class WHERE relname IN ('record', 'record_event') AND relkind = 'r') AS rls,
       (SELECT bool_or(relforcerowsecurity) FROM pg_class WHERE relname IN ('record', 'record_event') AND relkind = 'r') AS forced
  FROM pg_database WHERE datname = current_database();
