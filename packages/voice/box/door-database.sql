-- The voice door's own database, storytree-voice: the switch that turns voice writes off (contract
-- 4.5), and later its pending drafts. Safe to run again.
--
-- RUN IT connected to storytree-voice as an account that may act as the role owning it (on the box:
-- the local superuser; confine.sh runs it).
--
-- THE LOCK. Writes are off while voice_lock holds a row. The door's role may add a row (lock_voice)
-- and read them, never change or remove one, so a misled or compromised door cannot turn writes back
-- on. Only the box's own account clears it:
--   psql -X -d storytree-voice -c 'DELETE FROM voice_lock'

DO $$
DECLARE
  owner text;
BEGIN
  SELECT pg_get_userbyid(datdba) INTO owner FROM pg_database WHERE datname = current_database();
  IF current_database() <> 'storytree-voice' THEN
    RAISE EXCEPTION 'connected to %, not storytree-voice: connect to the door''s database and run this again', current_database();
  END IF;
  BEGIN
    EXECUTE format('SET ROLE %I', owner);
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE EXCEPTION '% may not act as %, the role that owns storytree-voice: sign in as an account that may and run this again', session_user, owner;
  END;
END
$$;

CREATE TABLE IF NOT EXISTS voice_lock (
  locked_at timestamptz NOT NULL DEFAULT now(),
  reason text NOT NULL CHECK (char_length(reason) BETWEEN 1 AND 500)
);

REVOKE ALL ON DATABASE "storytree-voice" FROM PUBLIC;
GRANT CONNECT ON DATABASE "storytree-voice" TO storytree_voice;
GRANT USAGE ON SCHEMA public TO storytree_voice;
GRANT SELECT, INSERT ON voice_lock TO storytree_voice;

RESET ROLE;
