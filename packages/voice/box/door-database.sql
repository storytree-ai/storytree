-- The voice door's own database, storytree-voice: the switch that turns voice writes off (contract
-- 4.5) and the drafts of its writes and the owner's notes (contracts 5.1-5.8). Safe to run again.
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
-- times; every time is the database's own (the trigger below), so a misled door cannot stretch the
-- fifteen minutes a draft lasts unconfirmed, and it may not mark a draft done or write its outcome or
-- reply. A confirmed draft is due at once, with no window (ADR-1155 D3): confirming a manager run
-- notifies voice_run, and the box's listener (voice-listen.service) starts it within seconds.
--
-- THE NOTES (contracts 5.7, 5.8). A note is a row of kind 'note': what the owner said, kept at once,
-- born confirmed with no read-back and no window, never carried out by the committer and never
-- cancelled. A manager run sweeps it: the committer sets swept_by_run (and the database swept_at) when
-- it launches the run whose brief carries the note, or the scheduled session manager sets swept_by
-- ('scheduled YYYY-MM-DD', ADR-1155 D4) on a note it takes, once, and never one a run swept. A note
-- with either mark, or an outcome, is swept: no run carries it again. The door's role may never set
-- any of them. At most 50 notes from one day's voice session wait unswept.
--
-- HEARD (contract 5.11). A manager run's reply is offered by catch_up until the owner says it is fine:
-- then the door's role marks it heard. Only an ended run is heard, once, at the database's time, and
-- the mark is never cleared.
CREATE TABLE IF NOT EXISTS voice_draft (
  id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  kind text NOT NULL,
  note_kind text,
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
  swept_at timestamptz,
  swept_by_run integer REFERENCES voice_draft (id),
  swept_by text,
  heard_at timestamptz
);

-- A table made by this script before notes: their columns, and the kinds' rules in place of its own.
ALTER TABLE voice_draft ADD COLUMN IF NOT EXISTS note_kind text;
ALTER TABLE voice_draft ADD COLUMN IF NOT EXISTS swept_at timestamptz;
ALTER TABLE voice_draft ADD COLUMN IF NOT EXISTS swept_by_run integer REFERENCES voice_draft (id);
ALTER TABLE voice_draft ADD COLUMN IF NOT EXISTS swept_by text;
ALTER TABLE voice_draft ADD COLUMN IF NOT EXISTS heard_at timestamptz;
ALTER TABLE voice_draft DROP CONSTRAINT IF EXISTS voice_draft_kind_check;
ALTER TABLE voice_draft DROP CONSTRAINT IF EXISTS voice_draft_check;
ALTER TABLE voice_draft DROP CONSTRAINT IF EXISTS voice_draft_kinds;
ALTER TABLE voice_draft ADD CONSTRAINT voice_draft_kinds CHECK (
  kind IN ('manager_run', 'note')
  AND (kind = 'note') = (note_kind IS NOT NULL)
  AND note_kind IN ('decision', 'change', 'idea', 'question', 'instruction', 'answer')
  AND (question IS NOT NULL) = (note_kind IS NOT DISTINCT FROM 'answer')
  AND (kind = 'note' OR (swept_by_run IS NULL AND swept_by IS NULL))
  AND swept_by ~ '^scheduled [0-9]{4}-[0-9]{2}-[0-9]{2}$'
);

CREATE OR REPLACE FUNCTION voice_draft_guard() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF EXISTS (SELECT 1 FROM voice_lock) THEN RAISE EXCEPTION 'voice writes are locked'; END IF;
    NEW.drafted_at := now();
    NEW.expires_at := now() + interval '15 minutes';
    NEW.confirmed_at := NULL; NEW.commit_at := NULL; NEW.cancelled_at := NULL; NEW.committed_at := NULL;
    NEW.outcome := NULL; NEW.run_ended_at := NULL; NEW.reply := NULL; NEW.swept_at := NULL; NEW.swept_by_run := NULL; NEW.swept_by := NULL; NEW.heard_at := NULL;
    IF NEW.kind = 'note' THEN
      IF (SELECT count(*) FROM voice_draft WHERE kind = 'note' AND session = NEW.session
          AND swept_by_run IS NULL AND swept_by IS NULL AND outcome IS NULL) >= 50 THEN
        RAISE EXCEPTION '50 notes from today are waiting unswept: send them to the manager first';
      END IF;
      NEW.expires_at := now();
      NEW.confirmed_at := now();
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.kind <> OLD.kind OR NEW.note_kind IS DISTINCT FROM OLD.note_kind OR NEW.question IS DISTINCT FROM OLD.question
     OR NEW.words <> OLD.words OR NEW.body <> OLD.body
     OR NEW.session <> OLD.session OR NEW.drafted_at <> OLD.drafted_at OR NEW.expires_at <> OLD.expires_at THEN
    RAISE EXCEPTION 'draft % cannot be changed, only confirmed or cancelled', OLD.id;
  END IF;
  IF OLD.kind = 'note' AND (NEW.confirmed_at IS DISTINCT FROM OLD.confirmed_at OR NEW.cancelled_at IS DISTINCT FROM OLD.cancelled_at
     OR NEW.commit_at IS DISTINCT FROM OLD.commit_at OR NEW.committed_at IS DISTINCT FROM OLD.committed_at) THEN
    RAISE EXCEPTION 'note % is kept as it was said: say what changed in another note', OLD.id;
  END IF;
  IF NEW.swept_by_run IS DISTINCT FROM OLD.swept_by_run OR NEW.swept_by IS DISTINCT FROM OLD.swept_by THEN
    IF OLD.swept_by_run IS NOT NULL THEN RAISE EXCEPTION 'note % was already swept by run %', OLD.id, OLD.swept_by_run; END IF;
    IF OLD.swept_by IS NOT NULL THEN RAISE EXCEPTION 'note % was already swept, %', OLD.id, OLD.swept_by; END IF;
    IF NEW.swept_by_run IS NOT NULL AND NEW.swept_by IS NOT NULL THEN
      RAISE EXCEPTION 'note % is swept by a run or by the scheduled session manager, not both', OLD.id;
    END IF;
    IF NEW.swept_by_run IS NOT NULL AND NOT EXISTS (SELECT 1 FROM voice_draft WHERE id = NEW.swept_by_run AND kind = 'manager_run' AND committed_at IS NOT NULL) THEN
      RAISE EXCEPTION 'note % can be swept only by a manager run that started', OLD.id;
    END IF;
    NEW.swept_at := now();
  ELSIF NEW.swept_at IS DISTINCT FROM OLD.swept_at THEN
    RAISE EXCEPTION 'note %''s sweep time is set by sweeping it', OLD.id;
  END IF;
  IF NEW.heard_at IS DISTINCT FROM OLD.heard_at THEN
    IF OLD.heard_at IS NOT NULL THEN RAISE EXCEPTION 'draft %''s reply was already heard', OLD.id; END IF;
    IF OLD.kind <> 'manager_run' OR OLD.run_ended_at IS NULL THEN RAISE EXCEPTION 'draft % has no reply to hear yet', OLD.id; END IF;
    NEW.heard_at := now();
  END IF;
  IF NEW.confirmed_at IS DISTINCT FROM OLD.confirmed_at THEN
    IF OLD.cancelled_at IS NOT NULL THEN RAISE EXCEPTION 'draft % was cancelled', OLD.id; END IF;
    IF OLD.confirmed_at IS NOT NULL THEN RAISE EXCEPTION 'draft % is already confirmed', OLD.id; END IF;
    IF now() >= OLD.expires_at THEN RAISE EXCEPTION 'draft % lapsed unconfirmed after 15 minutes', OLD.id; END IF;
    IF EXISTS (SELECT 1 FROM voice_lock) THEN RAISE EXCEPTION 'voice writes are locked'; END IF;
    NEW.confirmed_at := now();
    NEW.commit_at := now();
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
    IF EXISTS (SELECT 1 FROM voice_lock) THEN RAISE EXCEPTION 'voice writes are locked'; END IF;
    NEW.committed_at := now();
  END IF;
  RETURN NEW;
END
$guard$;

DROP TRIGGER IF EXISTS voice_draft_guard ON voice_draft;
CREATE TRIGGER voice_draft_guard BEFORE INSERT OR UPDATE ON voice_draft FOR EACH ROW EXECUTE FUNCTION voice_draft_guard();

-- THE HAND-OFF (contract 5.9): a manager run confirmed notifies voice_run once its update commits.
CREATE OR REPLACE FUNCTION voice_run_notify() RETURNS trigger LANGUAGE plpgsql AS $notify$
BEGIN
  PERFORM pg_notify('voice_run', NEW.id::text);
  RETURN NULL;
END
$notify$;

DROP TRIGGER IF EXISTS voice_run_notify ON voice_draft;
CREATE TRIGGER voice_run_notify AFTER UPDATE OF confirmed_at ON voice_draft FOR EACH ROW
  WHEN (NEW.kind = 'manager_run' AND OLD.confirmed_at IS NULL AND NEW.confirmed_at IS NOT NULL)
  EXECUTE FUNCTION voice_run_notify();

-- FYIS HEARD (contract 5.15). The voice door cannot write the library (ADR-1155), so an FYI the owner
-- has heard by voice is marked here: the door's role may add a row naming the FYI, never change or
-- remove one, and the database sets its time. catch_up leaves a marked FYI out at once; the box's
-- committer marks it heard in the library (`storytree fyi heard`) and sets carried_at, the box's
-- account alone. Adding a mark notifies voice_run, so the listener carries it within seconds.
CREATE TABLE IF NOT EXISTS voice_fyi_heard (
  fyi text PRIMARY KEY CHECK (fyi ~ '^fyi_[0-9a-f]{12}$'),
  heard_at timestamptz NOT NULL DEFAULT now(),
  carried_at timestamptz
);

CREATE OR REPLACE FUNCTION voice_fyi_notify() RETURNS trigger LANGUAGE plpgsql AS $notify$
BEGIN
  PERFORM pg_notify('voice_run', 'fyi');
  RETURN NULL;
END
$notify$;

DROP TRIGGER IF EXISTS voice_fyi_notify ON voice_fyi_heard;
CREATE TRIGGER voice_fyi_notify AFTER INSERT ON voice_fyi_heard FOR EACH STATEMENT EXECUTE FUNCTION voice_fyi_notify();

REVOKE ALL ON DATABASE "storytree-voice" FROM PUBLIC;
GRANT CONNECT ON DATABASE "storytree-voice" TO storytree_voice;
GRANT USAGE ON SCHEMA public TO storytree_voice;
GRANT SELECT, INSERT ON voice_lock TO storytree_voice;
GRANT SELECT ON voice_draft TO storytree_voice;
GRANT INSERT (kind, note_kind, question, words, body, session) ON voice_draft TO storytree_voice;
GRANT UPDATE (confirmed_at, cancelled_at, heard_at) ON voice_draft TO storytree_voice;
GRANT SELECT, INSERT (fyi) ON voice_fyi_heard TO storytree_voice;

RESET ROLE;
