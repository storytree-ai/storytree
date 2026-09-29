/**
 * A project library's tables, as an ORDERED list of idempotent statements. An openProject that
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
];
