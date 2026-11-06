-- What the cloud sessions' own account may do in the trunks database, storytree-trunks (ADR-1264 D1):
-- what a pool lane's container does there through storytree's own commands as it joins its project
-- (`storytree doctor --join`, run by provision-worktree.mjs), and nothing more. cloud-session-grants.sql
-- is the project database's half, and cloud-session-activity-grants.sql the activity log's. Safe to run
-- again. Machines' contract 11.8 runs this file as written, with only its two names filled in.
--
-- RUN IT on the Mint box, connected to the database storytree-trunks, as an account that may act as
-- the role that owns that database (the box's own account over the local socket), with the account's
-- name as the psql variable cloud_role and the project its lanes work on as cloud_project:
--   psql -X -v ON_ERROR_STOP=1 -d storytree-trunks -v cloud_role=storytree_cloud \
--     -v cloud_project=storytree -f infra/library-host/cloud-session-trunks-grants.sql
-- Without either variable, the first statement fails and nothing is changed. The first statement after
-- it takes the owner on, so everything below is granted by the owner itself.
--
-- WHAT IT GRANTS. The database lets the account in (CONNECT), the schema lets it name the tables
-- (USAGE), it reads which table definitions are applied (storytree_setup: a database already set up
-- runs no DDL as it opens), and then:
--   - it reads every trunk, import and machine name: a join looks for this machine's trunks, and the
--     sessions list shows each line's machine by its name;
--   - it records and approves a trunk (trunks: INSERT, and UPDATE for the approval) only of
--     cloud_project, and only for a machine no one has named, through row-level security: a container
--     is a fresh machine each session, and is never named (Machines refuses the name `cloud`), so the
--     box's and the laptop's trunks, which are named, are out of its reach;
--   - it names no machine, records no import, and removes nothing, and changes no table: it neither
--     owns them nor may act as their owner.
--
-- ROW-LEVEL SECURITY. This file ENABLES it on `trunks`. The owner's accounts own the table and so pass
-- through it; the policies below bind only cloud_role.

-- The cloud sessions' account and its project, named before anything is granted, so a run without them stops here.
SELECT :'cloud_role' AS cloud_role, :'cloud_project' AS cloud_project;

DO $$
DECLARE
  owner text;
BEGIN
  SELECT pg_get_userbyid(datdba) INTO owner FROM pg_database WHERE datname = current_database();
  IF current_database() <> 'storytree-trunks' THEN
    RAISE EXCEPTION 'connected to %, not storytree-trunks: connect to the trunks database and run this again', current_database();
  END IF;
  BEGIN
    EXECUTE format('SET ROLE %I', owner);
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE EXCEPTION '% may not act as %, the role that owns storytree-trunks: connect as an account that may (the box''s own account over its local socket) and run this again', session_user, owner;
  END;
END
$$;

GRANT CONNECT ON DATABASE "storytree-trunks" TO :"cloud_role";
GRANT USAGE ON SCHEMA public TO :"cloud_role";
-- From Postgres 15 only the schema's owner may create in it; said here so that holds on any version.
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
GRANT SELECT ON storytree_setup TO :"cloud_role";
GRANT SELECT ON imports, machines TO :"cloud_role";
GRANT SELECT, INSERT, UPDATE ON trunks TO :"cloud_role";

ALTER TABLE trunks ENABLE ROW LEVEL SECURITY;

-- It reads every trunk.
DROP POLICY IF EXISTS cloud_session_read ON trunks;
CREATE POLICY cloud_session_read ON trunks FOR SELECT TO :"cloud_role" USING (true);
-- It records and approves its project's trunk on an unnamed machine, and moves none onto a named one.
DROP POLICY IF EXISTS cloud_session_insert ON trunks;
CREATE POLICY cloud_session_insert ON trunks FOR INSERT TO :"cloud_role"
  WITH CHECK (project = :'cloud_project' AND machine NOT IN (SELECT id FROM machines));
DROP POLICY IF EXISTS cloud_session_update ON trunks;
CREATE POLICY cloud_session_update ON trunks FOR UPDATE TO :"cloud_role"
  USING (project = :'cloud_project' AND machine NOT IN (SELECT id FROM machines))
  WITH CHECK (project = :'cloud_project' AND machine NOT IN (SELECT id FROM machines));

RESET ROLE;

-- Check: the account's rights, as the database sees them. Expect: may_connect, reads, joins all true;
-- names_or_imports, removes, may_act_as_owner, may_create false; rls true.
SELECT has_database_privilege(:'cloud_role', 'storytree-trunks', 'CONNECT') AS may_connect,
       has_table_privilege(:'cloud_role', 'trunks', 'SELECT')
         AND has_table_privilege(:'cloud_role', 'imports', 'SELECT')
         AND has_table_privilege(:'cloud_role', 'machines', 'SELECT')
         AND has_table_privilege(:'cloud_role', 'storytree_setup', 'SELECT') AS reads,
       has_table_privilege(:'cloud_role', 'trunks', 'INSERT, UPDATE') AS joins,
       has_table_privilege(:'cloud_role', 'machines', 'INSERT, UPDATE')
         OR has_table_privilege(:'cloud_role', 'imports', 'INSERT, UPDATE') AS names_or_imports,
       has_table_privilege(:'cloud_role', 'trunks', 'DELETE')
         OR has_table_privilege(:'cloud_role', 'imports', 'DELETE')
         OR has_table_privilege(:'cloud_role', 'machines', 'DELETE') AS removes,
       pg_has_role(:'cloud_role', datdba, 'SET') AS may_act_as_owner,
       has_schema_privilege(:'cloud_role', 'public', 'CREATE') AS may_create,
       (SELECT relrowsecurity FROM pg_class WHERE relname = 'trunks' AND relkind = 'r') AS rls
  FROM pg_database WHERE datname = current_database();
