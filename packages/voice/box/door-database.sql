-- The voice door's own database, storytree-voice: the switch that turns voice writes off (contract
-- 4.5) and the drafts of its writes (contracts 5.1-5.6). Safe to run again.
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

-- THE DRAFTS. A voice write is a row here until the box's committer (voice-commit, run by the owner's
-- account) carries it out. The door's role may add a draft and set only its confirmed and cancelled
-- times; every time is the database's own (the trigger below), so a misled door cannot shorten the
-- fifteen minutes a draft lasts unconfirmed or the ten-minute window after confirm, and it may not mark
-- a draft done or write its outcome or reply.
CREATE TABLE IF NOT EXISTS voice_draft (
  id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  kind text NOT NULL CHECK (kind IN ('answer', 'manager_run')),
  question text CHECK (question ~ '^question_[0-9a-f]{12}$'),
  words text NOT NULL CHECK (char_length(words) BETWEEN 1 AND 2000),
  body text NOT NULL CHECK (char_length(body) BETWEEN 1 AND 20000),
  session text NOT NULL CHECK (session ~ '^voice-[0-9]{4}-[0-9]{2}-[0-9]{2}$'),
  drafted_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT now() + interval '15 minutes',
  confirmed_at timestamptz,
  commit_at timestamptz,
  cancelled_at timestamptz,
  committed_at timestamptz,
  outcome text CHECK (char_length(outcome) <= 500),
  run_ended_at timestamptz,
  reply text CHECK (char_length(reply) <= 4000),
  CHECK ((kind = 'answer') = (question IS NOT NULL))
);

CREATE OR REPLACE FUNCTION voice_draft_guard() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF EXISTS (SELECT 1 FROM voice_lock) THEN RAISE EXCEPTION 'voice writes are locked'; END IF;
    NEW.drafted_at := now();
    NEW.expires_at := now() + interval '15 minutes';
    NEW.confirmed_at := NULL; NEW.commit_at := NULL; NEW.cancelled_at := NULL; NEW.committed_at := NULL;
    NEW.outcome := NULL; NEW.run_ended_at := NULL; NEW.reply := NULL;
    RETURN NEW;
  END IF;
  IF NEW.kind <> OLD.kind OR NEW.question IS DISTINCT FROM OLD.question OR NEW.words <> OLD.words OR NEW.body <> OLD.body
     OR NEW.session <> OLD.session OR NEW.drafted_at <> OLD.drafted_at OR NEW.expires_at <> OLD.expires_at THEN
    RAISE EXCEPTION 'draft % cannot be changed, only confirmed or cancelled', OLD.id;
  END IF;
  IF NEW.confirmed_at IS DISTINCT FROM OLD.confirmed_at THEN
    IF OLD.cancelled_at IS NOT NULL THEN RAISE EXCEPTION 'draft % was cancelled', OLD.id; END IF;
    IF OLD.confirmed_at IS NOT NULL THEN RAISE EXCEPTION 'draft % is already confirmed', OLD.id; END IF;
    IF now() >= OLD.expires_at THEN RAISE EXCEPTION 'draft % lapsed unconfirmed after 15 minutes', OLD.id; END IF;
    IF EXISTS (SELECT 1 FROM voice_lock) THEN RAISE EXCEPTION 'voice writes are locked'; END IF;
    NEW.confirmed_at := now();
    NEW.commit_at := now() + interval '10 minutes';
  ELSIF NEW.commit_at IS DISTINCT FROM OLD.commit_at THEN
    RAISE EXCEPTION 'draft %''s time to take effect is set by confirming it', OLD.id;
  END IF;
  IF NEW.cancelled_at IS DISTINCT FROM OLD.cancelled_at THEN
    IF OLD.cancelled_at IS NOT NULL THEN RAISE EXCEPTION 'draft % is already cancelled', OLD.id; END IF;
    IF OLD.committed_at IS NOT NULL THEN RAISE EXCEPTION 'draft % already took effect', OLD.id; END IF;
    NEW.cancelled_at := now();
  END IF;
  IF NEW.committed_at IS DISTINCT FROM OLD.committed_at THEN
    IF OLD.committed_at IS NOT NULL OR OLD.cancelled_at IS NOT NULL OR OLD.commit_at IS NULL OR now() < OLD.commit_at THEN
      RAISE EXCEPTION 'draft % is not due', OLD.id;
    END IF;
    NEW.committed_at := now();
  END IF;
  RETURN NEW;
END
$guard$;

DROP TRIGGER IF EXISTS voice_draft_guard ON voice_draft;
CREATE TRIGGER voice_draft_guard BEFORE INSERT OR UPDATE ON voice_draft FOR EACH ROW EXECUTE FUNCTION voice_draft_guard();

REVOKE ALL ON DATABASE "storytree-voice" FROM PUBLIC;
GRANT CONNECT ON DATABASE "storytree-voice" TO storytree_voice;
GRANT USAGE ON SCHEMA public TO storytree_voice;
GRANT SELECT, INSERT ON voice_lock TO storytree_voice;
GRANT SELECT ON voice_draft TO storytree_voice;
GRANT INSERT (kind, question, words, body, session) ON voice_draft TO storytree_voice;
GRANT UPDATE (confirmed_at, cancelled_at) ON voice_draft TO storytree_voice;

RESET ROLE;
