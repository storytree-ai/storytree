/**
 * Capability 1 · Project libraries. A project library's tables, as an ORDERED list of idempotent statements. An openProject that
 * finds the project behind (library_meta's `schema`, the list's length when it was last applied, is
 * short of it) applies the whole list, in order, in one transaction, so a new project gets every
 * table and an existing one gets whatever was added since it was last opened. One that finds it
 * current applies nothing (ADR-0747).
 *
 * Later capabilities APPEND to this list. A statement already here is never edited or reordered,
 * because existing projects have already run it: to change a table, append an idempotent ALTER.
 */
export const PROJECT_SCHEMA: readonly string[] = [
  // Facts about the library itself. Key 'project' holds the project's name.
  `CREATE TABLE IF NOT EXISTS library_meta (
    key   text PRIMARY KEY,
    value text NOT NULL
  )`,

  // Capability 2 · Library transactions. `record` holds each record as it is now; a retired
  // record has no row here. `record_event` is the append-only history every change is written to
  // first, so nothing is ever truly erased.
  `CREATE TABLE IF NOT EXISTS record (
    id         text PRIMARY KEY,
    type       text NOT NULL,
    version    int NOT NULL,
    fields     jsonb NOT NULL,
    created_at timestamptz NOT NULL,
    updated_at timestamptz NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS record_type_idx ON record (type)`,
  `CREATE TABLE IF NOT EXISTS record_event (
    seq       bigserial PRIMARY KEY,
    record_id text NOT NULL,
    type      text NOT NULL,
    action    text NOT NULL CHECK (action IN ('created', 'updated', 'retired')),
    record    jsonb NOT NULL,
    reason    text,
    actor     text,
    at        timestamptz NOT NULL DEFAULT now()
  )`,
  `CREATE INDEX IF NOT EXISTS record_event_record_id_idx ON record_event (record_id)`,

  // Capability 14 · Ranked search. Each chunk's vector, kept under its model and the hash of the
  // chunk's text: a cache the next search fills, not a record, so a snapshot leaves it out.
  `CREATE TABLE IF NOT EXISTS embedding (
    model  text NOT NULL,
    key    text NOT NULL,
    vector bytea NOT NULL,
    PRIMARY KEY (model, key)
  )`,

  // Capability 7 · Library API (7.18). The picture of the window a feedback note was sent with, beside its record rather
  // than in its fields, so the ~150 KB is not copied into `record` and `record_event` on every write. Not a record:
  // a snapshot leaves it out.
  `CREATE TABLE IF NOT EXISTS feedback_screenshot (
    record_id text PRIMARY KEY,
    jpeg      bytea NOT NULL
  )`,
  // Capability 7 · Library API (7.18). The picture cut to the element a note points at, kept with its window picture.
  `ALTER TABLE feedback_screenshot ADD COLUMN IF NOT EXISTS element_jpeg bytea`,

  // Capability 1 · Project libraries (1.22). Each history entry's `at` and `actor` are the writer's own account; beside
  // them the server keeps its own time and the account it saw. Added empty, then given defaults, so an entry written
  // before stays empty rather than taking this upgrade's time; a trigger sets both on every insert, as a default
  // alone is overridable.
  `ALTER TABLE record_event ADD COLUMN IF NOT EXISTS recorded_at timestamptz, ADD COLUMN IF NOT EXISTS recorded_by text`,
  `ALTER TABLE record_event ALTER COLUMN recorded_at SET DEFAULT now(), ALTER COLUMN recorded_by SET DEFAULT session_user`,
  `CREATE OR REPLACE FUNCTION record_event_recorded() RETURNS trigger LANGUAGE plpgsql AS $$
  BEGIN
    NEW.recorded_at := now();
    NEW.recorded_by := session_user;
    RETURN NEW;
  END $$`,
  `DROP TRIGGER IF EXISTS record_event_recorded ON record_event`,
  `CREATE TRIGGER record_event_recorded BEFORE INSERT ON record_event FOR EACH ROW EXECUTE FUNCTION record_event_recorded()`,
  // The history is append-only: only the table's owner (or a role holding its rights) may change or remove an entry.
  `CREATE OR REPLACE FUNCTION record_event_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
  BEGIN
    IF NOT pg_has_role(current_user, (SELECT relowner FROM pg_class WHERE oid = TG_RELID), 'MEMBER') THEN
      RAISE EXCEPTION 'record_event is append-only: % refused for %', TG_OP, current_user USING ERRCODE = 'insufficient_privilege';
    END IF;
    RETURN NULL;
  END $$`,
  `DROP TRIGGER IF EXISTS record_event_append_only ON record_event`,
  `CREATE TRIGGER record_event_append_only BEFORE UPDATE OR DELETE OR TRUNCATE ON record_event FOR EACH STATEMENT EXECUTE FUNCTION record_event_append_only()`,
];
