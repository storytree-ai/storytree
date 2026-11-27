// Capability 1 · Opening a project
export const PROJECT_SCHEMA: readonly string[] = [
  `CREATE TABLE IF NOT EXISTS library_meta (
    key   text PRIMARY KEY,
    value text NOT NULL
  )`,

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

  `CREATE TABLE IF NOT EXISTS embedding (
    model  text NOT NULL,
    key    text NOT NULL,
    vector bytea NOT NULL,
    PRIMARY KEY (model, key)
  )`,

  `CREATE TABLE IF NOT EXISTS feedback_screenshot (
    record_id text PRIMARY KEY,
    jpeg      bytea NOT NULL
  )`,
  `ALTER TABLE feedback_screenshot ADD COLUMN IF NOT EXISTS element_jpeg bytea`,

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
  `CREATE OR REPLACE FUNCTION record_event_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
  BEGIN
    IF NOT pg_has_role(current_user, (SELECT relowner FROM pg_class WHERE oid = TG_RELID), 'MEMBER') THEN
      RAISE EXCEPTION 'record_event is append-only: % refused for %', TG_OP, current_user USING ERRCODE = 'insufficient_privilege';
    END IF;
    RETURN NULL;
  END $$`,
  `DROP TRIGGER IF EXISTS record_event_append_only ON record_event`,
  `CREATE TRIGGER record_event_append_only BEFORE UPDATE OR DELETE OR TRUNCATE ON record_event FOR EACH STATEMENT EXECUTE FUNCTION record_event_append_only()`,

  `CREATE TABLE IF NOT EXISTS history_repair (
    seq         bigserial PRIMARY KEY,
    operation   text NOT NULL,
    reason      text NOT NULL,
    recorded_by text NOT NULL DEFAULT session_user,
    acting_as   text NOT NULL DEFAULT current_user,
    recorded_at timestamptz NOT NULL DEFAULT now()
  )`,
  `CREATE OR REPLACE FUNCTION history_repair_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
  BEGIN
    RAISE EXCEPTION 'history_repair is append-only: % refused for %', TG_OP, current_user USING ERRCODE = 'insufficient_privilege';
  END $$`,
  `DROP TRIGGER IF EXISTS history_repair_append_only ON history_repair`,
  `CREATE TRIGGER history_repair_append_only BEFORE UPDATE OR DELETE OR TRUNCATE ON history_repair FOR EACH STATEMENT EXECUTE FUNCTION history_repair_append_only()`,
  `CREATE OR REPLACE FUNCTION record_event_repair(reason text) RETURNS void LANGUAGE plpgsql AS $$
  BEGIN
    IF coalesce(btrim(reason), '') = '' THEN
      RAISE EXCEPTION 'record_event_repair needs a reason: why the history must change' USING ERRCODE = 'invalid_parameter_value';
    END IF;
    IF NOT pg_has_role(current_user, (SELECT relowner FROM pg_class WHERE oid = 'record_event'::regclass), 'MEMBER') THEN
      RAISE EXCEPTION 'record_event_repair refused for %: only the history''s owner may repair it', current_user USING ERRCODE = 'insufficient_privilege';
    END IF;
    PERFORM set_config('storytree.history_repair', reason, true);
  END $$`,
  `CREATE OR REPLACE FUNCTION record_event_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
  DECLARE
    repair text := nullif(current_setting('storytree.history_repair', true), '');
  BEGIN
    IF repair IS NULL OR NOT pg_has_role(current_user, (SELECT relowner FROM pg_class WHERE oid = TG_RELID), 'MEMBER') THEN
      RAISE EXCEPTION 'record_event is append-only: % refused for % (a repair goes through record_event_repair)', TG_OP, current_user USING ERRCODE = 'insufficient_privilege';
    END IF;
    INSERT INTO history_repair (operation, reason) VALUES (TG_OP, repair);
    RETURN NULL;
  END $$`,
  `DO $$
  DECLARE
    owner text := (SELECT pg_get_userbyid(relowner) FROM pg_class WHERE oid = 'record_event'::regclass);
    repairing text := $repairing$coalesce(current_setting('storytree.history_repair', true), '') <> ''$repairing$;
  BEGIN
    DROP POLICY IF EXISTS storytree_owner ON record;
    EXECUTE format('CREATE POLICY storytree_owner ON record TO %I USING (true) WITH CHECK (true)', owner);
    DROP POLICY IF EXISTS storytree_owner_read ON record_event;
    EXECUTE format('CREATE POLICY storytree_owner_read ON record_event FOR SELECT TO %I USING (true)', owner);
    DROP POLICY IF EXISTS storytree_owner_add ON record_event;
    EXECUTE format('CREATE POLICY storytree_owner_add ON record_event FOR INSERT TO %I WITH CHECK (true)', owner);
    DROP POLICY IF EXISTS storytree_owner_repair ON record_event;
    EXECUTE format('CREATE POLICY storytree_owner_repair ON record_event FOR UPDATE TO %I USING (%s) WITH CHECK (true)', owner, repairing);
    DROP POLICY IF EXISTS storytree_owner_remove ON record_event;
    EXECUTE format('CREATE POLICY storytree_owner_remove ON record_event FOR DELETE TO %I USING (%s)', owner, repairing);
  END $$`,
  `ALTER TABLE record FORCE ROW LEVEL SECURITY`,
  `ALTER TABLE record_event FORCE ROW LEVEL SECURITY`,

  `ALTER TABLE record_event ADD COLUMN IF NOT EXISTS outside_read jsonb`,

  `CREATE TABLE IF NOT EXISTS media (
    record_id text NOT NULL,
    name      text NOT NULL,
    type      text NOT NULL,
    size      int NOT NULL,
    sha256    text NOT NULL,
    bytes     bytea NOT NULL,
    added_at  timestamptz NOT NULL DEFAULT now(),
    added_by  text,
    PRIMARY KEY (record_id, name)
  )`,
];
