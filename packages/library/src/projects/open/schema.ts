// Capability 1 · Project libraries
import { fileURLToPath } from "node:url";

import type { Pool } from "pg";

import { VECTOR_TABLES } from "../../knowledge/search/index.js";
import { STORE_TABLES } from "../../storage/store/index.js";
import { cannotSetUpProject, ConnectionError, sqlState } from "../shared/index.js";
import type { SchemaStanding } from "./schema-merged.js";

const APPEND_ONLY = (table: string, log: boolean) => `CREATE OR REPLACE FUNCTION ${table}_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE why text := ${log ? "current_setting('storytree.history_repair', true)" : "''"};
BEGIN
  IF coalesce(why, '') = '' THEN
    RAISE EXCEPTION '% is append-only: % is refused%', '${table}', TG_OP, ${log ? "'; a repair goes through record_event_repair(reason)'" : "''"};
  END IF;
  INSERT INTO history_repair (operation, reason) VALUES (TG_OP, why);
  RETURN NULL;
END $$`;

const ROW_SECURITY = (table: string) => `DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = current_schema() AND tablename = '${table}' AND policyname = '${table}_writes') THEN
    CREATE POLICY ${table}_writes ON ${table} TO CURRENT_USER USING (true) WITH CHECK (true);
  ELSE
    ALTER POLICY ${table}_writes ON ${table} TO CURRENT_USER;
  END IF;
END $$`;

export const PROJECT_SCHEMA: readonly string[] = [
  "CREATE TABLE IF NOT EXISTS library_meta (key text PRIMARY KEY, value text NOT NULL)",
  ...STORE_TABLES,
  "ALTER TABLE record_event ADD COLUMN IF NOT EXISTS outside_read jsonb",
  "ALTER TABLE record_event ADD COLUMN IF NOT EXISTS recorded_by text",
  "ALTER TABLE record_event ADD COLUMN IF NOT EXISTS recorded_at timestamptz",
  `CREATE OR REPLACE FUNCTION record_event_recorded() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.recorded_by := session_user;
  NEW.recorded_at := clock_timestamp();
  RETURN NEW;
END $$`,
  "CREATE OR REPLACE TRIGGER record_event_recorded BEFORE INSERT ON record_event FOR EACH ROW EXECUTE FUNCTION record_event_recorded()",
  `CREATE TABLE IF NOT EXISTS history_repair (
    seq bigserial PRIMARY KEY,
    operation text NOT NULL,
    reason text NOT NULL,
    recorded_by text NOT NULL DEFAULT session_user,
    recorded_at timestamptz NOT NULL DEFAULT clock_timestamp()
  )`,
  `CREATE OR REPLACE FUNCTION record_event_repair(reason text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF reason IS NULL OR btrim(reason) = '' THEN
    RAISE EXCEPTION 'a history repair names its reason';
  END IF;
  PERFORM set_config('storytree.history_repair', reason, true);
END $$`,
  APPEND_ONLY("record_event", true),
  "CREATE OR REPLACE TRIGGER record_event_append_only BEFORE UPDATE OR DELETE OR TRUNCATE ON record_event FOR EACH STATEMENT EXECUTE FUNCTION record_event_append_only()",
  APPEND_ONLY("history_repair", false),
  "CREATE OR REPLACE TRIGGER history_repair_append_only BEFORE UPDATE OR DELETE OR TRUNCATE ON history_repair FOR EACH STATEMENT EXECUTE FUNCTION history_repair_append_only()",
  "CREATE TABLE IF NOT EXISTS feedback_screenshot (record_id text PRIMARY KEY, jpeg bytea NOT NULL)",
  "ALTER TABLE feedback_screenshot ADD COLUMN IF NOT EXISTS element_jpeg bytea",
  `CREATE TABLE IF NOT EXISTS media (
    record_id text NOT NULL,
    name text NOT NULL,
    type text NOT NULL,
    size bigint NOT NULL,
    sha256 text NOT NULL,
    added_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    added_by text,
    bytes bytea NOT NULL,
    PRIMARY KEY (record_id, name)
  )`,
  ...VECTOR_TABLES,
  ROW_SECURITY("record"),
  ROW_SECURITY("record_event"),
  "ALTER TABLE record FORCE ROW LEVEL SECURITY",
  "ALTER TABLE record_event FORCE ROW LEVEL SECURITY",
];

const SCHEMA_FILE = typeof import.meta.url === "string" ? fileURLToPath(import.meta.url) : undefined;

const VERSION = String(PROJECT_SCHEMA.length);

export type Meta = Readonly<Record<string, string>>;

export async function readMeta(pool: Pool): Promise<Meta | undefined> {
  try {
    const { rows } = await pool.query<{ key: string; value: string }>("SELECT key, value FROM library_meta");
    return Object.fromEntries(rows.map((row) => [row.key, row.value]));
  } catch (error) {
    if (sqlState(error) === "42P01") return undefined;
    throw error;
  }
}

export interface SetUp {
  readonly shared: boolean;
  readonly schemaMerged: (file: string) => SchemaStanding;
  readonly warn: (key: string, line: string) => void;
}

export async function setUp(pool: Pool, project: string, meta: Meta | undefined, how: SetUp): Promise<Meta | undefined> {
  if (meta !== undefined && Number(meta["schema"]) >= PROJECT_SCHEMA.length) return meta;
  if (how.shared) {
    const standing: SchemaStanding = SCHEMA_FILE === undefined ? { merged: true } : how.schemaMerged(SCHEMA_FILE);
    if (!standing.merged) {
      if (meta === undefined) {
        throw new ConnectionError("config", `The project "${project}" has no tables yet, and this code's schema is not merged, so it sets none up in a shared library: ${standing.why}`);
      }
      how.warn(`schema:${project}`, `storytree: the project "${project}"'s tables are behind this code, whose schema is not merged, so the shared library is left as it stands: ${standing.why}`);
      return meta;
    }
  }
  const { rows } = await pool.query<{ account: string; owner: string; may: boolean | null }>(
    `SELECT session_user AS account, pg_get_userbyid(d.datdba) AS owner,
       has_schema_privilege(current_schema(), 'CREATE')
         AND coalesce((SELECT pg_has_role(c.relowner, 'USAGE') FROM pg_class c WHERE c.oid = to_regclass('record')), true) AS may
     FROM pg_database d WHERE d.datname = current_database()`,
  );
  const { account, owner, may } = rows[0]!;
  if (may !== true) {
    if (meta === undefined) throw cannotSetUpProject(project, account, owner, undefined);
    how.warn(`owner:${project}`, `storytree: the project "${project}"'s tables are behind this code, and ${account} may not set them up or upgrade them: only ${owner}, the role owning its database, may. It opens as its tables stand.`);
    return meta;
  }
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    try {
      await client.query("SELECT pg_advisory_xact_lock(hashtext('storytree.record-writes'))");
      for (const statement of PROJECT_SCHEMA) await client.query(statement);
      await client.query("INSERT INTO library_meta (key, value) VALUES ('project', $1) ON CONFLICT (key) DO NOTHING", [project]);
      await client.query("INSERT INTO library_meta (key, value) VALUES ('schema', $1) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value", [VERSION]);
      const { rows: stored } = await client.query<{ key: string; value: string }>("SELECT key, value FROM library_meta");
      await client.query("COMMIT");
      return Object.fromEntries(stored.map((row) => [row.key, row.value]));
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    }
  } finally {
    client.release();
  }
}
