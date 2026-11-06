-- What the cloud sessions' own account may do in the agent activity log's database, storytree-activity
-- (ADR-1264 D1): what a pool lane writes there through storytree's own commands, for its own project,
-- and nothing more. cloud-session-grants.sql is the project database's half, and
-- cloud-session-trunks-grants.sql the trunks database's. Safe to run again. Session management's
-- contract 2.14 runs this file as written, with only its two names filled in.
--
-- RUN IT on the Mint box, connected to the database storytree-activity, as an account that may act
-- as the role that owns that database (the box's own account over the local socket), with the
-- account's name as the psql variable cloud_role and the project its lanes work on as cloud_project:
--   psql -X -v ON_ERROR_STOP=1 -d storytree-activity -v cloud_role=storytree_cloud \
--     -v cloud_project=storytree -f infra/library-host/cloud-session-activity-grants.sql
-- Without either variable, the first statement fails and nothing is changed. The first statement after
-- it takes the owner on, so everything below is granted by the owner itself.
--
-- WHAT IT GRANTS. The database lets the account in (CONNECT), the schema lets it name the tables
-- (USAGE), it reads which table definitions are applied (storytree_setup: a database already set up
-- runs no DDL as it opens), and then, for cloud_project's rows only, through row-level security:
--   - it reads and adds activity lines (claims, releases, session names, close-outs, hook lines), and
--     USAGE on their numbering sequence; it changes and removes none;
--   - it records and reads its sessions' beats (session_beats) and transcript readings
--     (transcript_readings): an upsert, so INSERT and UPDATE, never DELETE;
--   - it stores and reads its transcripts' records (transcript_records: INSERT, never UPDATE or DELETE).
-- It sees and writes no other project's rows, removes nothing (forgetting a project's activity and
-- pruning old transcripts stay the owner's), and changes no table: it neither owns them nor may act as
-- their owner.
--
-- ROW-LEVEL SECURITY. This file ENABLES it on the four tables. The owner's accounts own the tables and
-- so pass through it; the policies below bind only cloud_role.

-- The cloud sessions' account and its project, named before anything is granted, so a run without them stops here.
SELECT :'cloud_role' AS cloud_role, :'cloud_project' AS cloud_project;

DO $$
DECLARE
  owner text;
BEGIN
  SELECT pg_get_userbyid(datdba) INTO owner FROM pg_database WHERE datname = current_database();
  IF current_database() <> 'storytree-activity' THEN
    RAISE EXCEPTION 'connected to %, not storytree-activity: connect to the activity log''s database and run this again', current_database();
  END IF;
  BEGIN
    EXECUTE format('SET ROLE %I', owner);
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE EXCEPTION '% may not act as %, the role that owns storytree-activity: connect as an account that may (the box''s own account over its local socket) and run this again', session_user, owner;
  END;
END
$$;

GRANT CONNECT ON DATABASE "storytree-activity" TO :"cloud_role";
GRANT USAGE ON SCHEMA public TO :"cloud_role";
-- From Postgres 15 only the schema's owner may create in it; said here so that holds on any version.
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
GRANT SELECT ON storytree_setup TO :"cloud_role";
GRANT SELECT, INSERT ON activity TO :"cloud_role";
GRANT USAGE ON SEQUENCE activity_seq_seq TO :"cloud_role";
GRANT SELECT, INSERT ON transcript_records TO :"cloud_role";
GRANT SELECT, INSERT, UPDATE ON transcript_readings TO :"cloud_role";
GRANT SELECT, INSERT, UPDATE ON session_beats TO :"cloud_role";

ALTER TABLE activity ENABLE ROW LEVEL SECURITY;
ALTER TABLE transcript_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE transcript_readings ENABLE ROW LEVEL SECURITY;
ALTER TABLE session_beats ENABLE ROW LEVEL SECURITY;

-- Each table: its own project's rows, read and written; what it may not do to them is the grants' above.
DROP POLICY IF EXISTS cloud_session_project ON activity;
CREATE POLICY cloud_session_project ON activity TO :"cloud_role"
  USING (project = :'cloud_project') WITH CHECK (project = :'cloud_project');
DROP POLICY IF EXISTS cloud_session_project ON transcript_records;
CREATE POLICY cloud_session_project ON transcript_records TO :"cloud_role"
  USING (project = :'cloud_project') WITH CHECK (project = :'cloud_project');
DROP POLICY IF EXISTS cloud_session_project ON transcript_readings;
CREATE POLICY cloud_session_project ON transcript_readings TO :"cloud_role"
  USING (project = :'cloud_project') WITH CHECK (project = :'cloud_project');
DROP POLICY IF EXISTS cloud_session_project ON session_beats;
CREATE POLICY cloud_session_project ON session_beats TO :"cloud_role"
  USING (project = :'cloud_project') WITH CHECK (project = :'cloud_project');

RESET ROLE;

-- Check: the account's rights, as the database sees them. Expect: may_connect, reads, adds_lines,
-- keeps_beats all true; changes_lines, removes, may_act_as_owner, may_create false; rls true.
SELECT has_database_privilege(:'cloud_role', 'storytree-activity', 'CONNECT') AS may_connect,
       has_table_privilege(:'cloud_role', 'activity', 'SELECT')
         AND has_table_privilege(:'cloud_role', 'storytree_setup', 'SELECT') AS reads,
       has_table_privilege(:'cloud_role', 'activity', 'INSERT')
         AND has_table_privilege(:'cloud_role', 'transcript_records', 'INSERT') AS adds_lines,
       has_table_privilege(:'cloud_role', 'session_beats', 'INSERT, UPDATE')
         AND has_table_privilege(:'cloud_role', 'transcript_readings', 'INSERT, UPDATE') AS keeps_beats,
       has_table_privilege(:'cloud_role', 'activity', 'UPDATE')
         OR has_table_privilege(:'cloud_role', 'transcript_records', 'UPDATE') AS changes_lines,
       has_table_privilege(:'cloud_role', 'activity', 'DELETE')
         OR has_table_privilege(:'cloud_role', 'transcript_records', 'DELETE')
         OR has_table_privilege(:'cloud_role', 'transcript_readings', 'DELETE')
         OR has_table_privilege(:'cloud_role', 'session_beats', 'DELETE') AS removes,
       pg_has_role(:'cloud_role', datdba, 'SET') AS may_act_as_owner,
       has_schema_privilege(:'cloud_role', 'public', 'CREATE') AS may_create,
       (SELECT bool_and(relrowsecurity) FROM pg_class
         WHERE relname IN ('activity', 'transcript_records', 'transcript_readings', 'session_beats') AND relkind = 'r') AS rls
  FROM pg_database WHERE datname = current_database();
