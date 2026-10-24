-- What the voice door's role, storytree_voice, may do inside the storytree project's database,
-- storytree_storytree: read the plan and the knowledge the door's tools read, and add to the search
-- cache, nothing else (contracts 4.3 and 4.4). The database enforces it, whatever the door runs.
-- Safe to run again.
--
-- RUN IT connected to storytree_storytree as an account that may act as the role owning it (on the
-- box: the local superuser; confine.sh runs it). The first statement takes that role on, so the
-- grants below are the owner's own.
--
-- WHAT IT GRANTS, measured by running every read the door's tools make as a role granted exactly
-- this file (contract 4.3):
--   - library_meta, record and record_event: read. Row-level security is enabled on record and
--     record_event (grants.sql), so the role needs its own policy to see any row.
--   - embedding: read and add (model, key, vector). A meaning search stores the vectors it computes,
--     ON CONFLICT DO NOTHING; the role may never change or remove one (contract 4.4).
--   - feedback_screenshot: nothing.

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

GRANT CONNECT ON DATABASE "storytree_storytree" TO storytree_voice;
GRANT USAGE ON SCHEMA public TO storytree_voice;
GRANT SELECT ON library_meta, record, record_event TO storytree_voice;
GRANT SELECT (model, key, vector), INSERT (model, key, vector) ON embedding TO storytree_voice;

ALTER TABLE record ENABLE ROW LEVEL SECURITY;
ALTER TABLE record_event ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS storytree_voice ON record;
CREATE POLICY storytree_voice ON record FOR SELECT TO storytree_voice USING (true);
DROP POLICY IF EXISTS storytree_voice ON record_event;
CREATE POLICY storytree_voice ON record_event FOR SELECT TO storytree_voice USING (true);

RESET ROLE;
