-- What the voice door's role, storytree_voice, may do inside the activity log's database,
-- storytree-activity: read the claim lines arc status shows, nothing else (contract 4.3). The door's
-- children then record no session lines; their reads still answer. Safe to run again.
--
-- RUN IT connected to storytree-activity as an account that may act as the role owning it (on the
-- box: the local superuser; confine.sh runs it).
--
-- WHAT IT GRANTS, measured by running every read the door's tools make (contract 4.3):
--   - storytree_setup: read, so opening the log finds its tables set up and runs no DDL;
--   - activity: read (claims and the lines beside them; the table has no row-level security).
--   - transcript_records, transcript_readings, session_beats: nothing.

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
    RAISE EXCEPTION '% may not act as %, the role that owns storytree-activity: sign in as an account that may and run this again', session_user, owner;
  END;
END
$$;

GRANT CONNECT ON DATABASE "storytree-activity" TO storytree_voice;
GRANT USAGE ON SCHEMA public TO storytree_voice;
GRANT SELECT ON storytree_setup, activity TO storytree_voice;

RESET ROLE;
