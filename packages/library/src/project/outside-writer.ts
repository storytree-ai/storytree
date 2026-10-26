/**
 * Capability 1 · Project libraries (1.23-1.25, ADR-1178 D1 and D5). The role template for a writer that runs outside
 * storytree and connects to a project's library as its own database role, generalised from CI's (infra/library-host/
 * grants.sql): row-level security lets it insert only records of its plugin's declared kinds, update them only when
 * its plugin declares so, and read only those kinds and the ones its grant names. It deletes nothing and changes no
 * table. The database's own `recorded_by` stamp on each history entry (1.22) is how a reader tells which door a record
 * came through.
 *
 * It is applied by storytree, as the project database's owner, from what a plugin declares: never by running SQL a
 * plugin ships, which would hand the plugin the owner's reach (research_52f88d6d30d8, 2B). The role itself (LOGIN,
 * its password) is made apart from this.
 *
 * Row-level security is ENABLED on `record` and `record_event`, not FORCED, as grants.sql leaves it: the owner's
 * accounts are unaffected, and an account with no policy sees and writes no rows at all.
 */
import type { ClientBase } from "pg";

/** One outside writer's grant, read from its plugin's declared kinds. */
export interface OutsideWriter {
  /** The database role it connects as. */
  readonly role: string;
  /** The kinds it writes, all its one plugin's, each `<plugin>.<kind>`. */
  readonly kinds: readonly string[];
  /** Whether its plugin declares that it may change a record of its kinds after inserting it. */
  readonly update?: boolean;
  /** Other kinds it may read, beside its own. */
  readonly reads?: readonly string[];
}

const PLUGIN_KIND = /^[a-z][a-z0-9-]*\.[a-z][a-z0-9-]*$/;
const KIND = /^[a-z][a-z0-9-]*(\.[a-z][a-z0-9-]*)?$/;
/** Room for a policy name, `<role> insert`, inside Postgres's 63-byte names. */
const ROLE_MAX = 48;

/**
 * Fence an outside writer to its plugin's kinds in the project database `client` is connected to. The client's account
 * must be able to act as the database's owner; the grants are made as that owner, in one transaction. Safe to apply
 * again, and applying a narrower grant takes back what a wider one gave.
 */
export async function fenceOutsideWriter(client: ClientBase, writer: OutsideWriter): Promise<void> {
  const sql = outsideWriterSql(writer);
  await client.query("BEGIN");
  try {
    await client.query(sql);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
}

/** The statements fenceOutsideWriter runs, inside its transaction. */
export function outsideWriterSql(writer: OutsideWriter): string {
  const { role, kinds, update = false, reads = [] } = writer;
  if (role === "" || Buffer.byteLength(role) > ROLE_MAX || /[\0"]/.test(role)) {
    throw new Error(`An outside writer's role must be a name of 1 to ${ROLE_MAX} bytes with no double quote: ${JSON.stringify(role)}`);
  }
  if (kinds.length === 0) throw new Error(`${role} is given no kinds to write`);
  for (const kind of kinds) {
    if (!PLUGIN_KIND.test(kind)) throw new Error(`${role} may write only a plugin's kinds, <plugin>.<kind>: ${JSON.stringify(kind)} is not one`);
  }
  const plugins = new Set(kinds.map((kind) => kind.split(".")[0]));
  if (plugins.size > 1) throw new Error(`${role} may write the kinds of one plugin, not ${[...plugins].join(" and ")}`);
  for (const kind of reads) {
    if (!KIND.test(kind)) throw new Error(`${role} is granted a read of ${JSON.stringify(kind)}, which is not a kind`);
  }

  const who = `"${role}"`;
  const policy = (verb: string) => `"${role} ${verb}"`;
  const literal = (role: string) => `'${role.replaceAll("'", "''")}'`;
  const array = (each: readonly string[]) => `ARRAY[${[...new Set(each)].map((kind) => `'${kind}'`).join(", ")}]::text[]`;
  const own = array(kinds);
  const readable = array([...kinds, ...reads]);
  // An entry's id must name nothing yet, or (when it may update) only a record of the entry's own kind: asked of
  // outside_writer_id_kinds(), which runs as the owner, so it sees the records and history the writer cannot.
  const history = update
    ? `action IN ('created', 'updated') AND outside_writer_id_kinds(record_id) <@ ARRAY[type]`
    : `action = 'created' AND cardinality(outside_writer_id_kinds(record_id)) = 0`;

  return `
DO $$
DECLARE
  owner text;
BEGIN
  SELECT pg_get_userbyid(datdba) INTO owner FROM pg_database WHERE datname = current_database();
  BEGIN
    EXECUTE format('SET LOCAL ROLE %I', owner);
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE EXCEPTION '% may not act as %, the role that owns %: connect as an account that may, and apply the grant again', session_user, owner, current_database();
  END;
END
$$;

DO $$
BEGIN
  EXECUTE format('GRANT CONNECT ON DATABASE %I TO %s', current_database(), ${literal(who)});
END
$$;
GRANT USAGE ON SCHEMA public TO ${who};
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
GRANT SELECT ON library_meta TO ${who};
-- UPDATE on record is granted either way: storytree's own write puts a record with INSERT ... ON CONFLICT DO UPDATE,
-- which needs it, and with no update policy below no row is there for it to change.
GRANT SELECT, INSERT, UPDATE ON record TO ${who};
GRANT SELECT, INSERT ON record_event TO ${who};
GRANT USAGE ON SEQUENCE record_event_seq_seq TO ${who};

ALTER TABLE record ENABLE ROW LEVEL SECURITY;
ALTER TABLE record_event ENABLE ROW LEVEL SECURITY;

-- The kinds an id has been, in the record table and its history, seen as the owner sees them.
CREATE OR REPLACE FUNCTION outside_writer_id_kinds(id text) RETURNS text[]
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
  AS $kinds$ SELECT coalesce(array_agg(DISTINCT type), '{}') FROM (
    SELECT type FROM record WHERE record.id = outside_writer_id_kinds.id
    UNION ALL SELECT type FROM record_event WHERE record_event.record_id = outside_writer_id_kinds.id
  ) AS kinds $kinds$;
REVOKE ALL ON FUNCTION outside_writer_id_kinds(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION outside_writer_id_kinds(text) TO ${who};

DROP POLICY IF EXISTS ${policy("read")} ON record;
CREATE POLICY ${policy("read")} ON record FOR SELECT TO ${who} USING (type = ANY (${readable}));
DROP POLICY IF EXISTS ${policy("read")} ON record_event;
CREATE POLICY ${policy("read")} ON record_event FOR SELECT TO ${who} USING (type = ANY (${readable}));

DROP POLICY IF EXISTS ${policy("insert")} ON record;
CREATE POLICY ${policy("insert")} ON record FOR INSERT TO ${who} WITH CHECK (type = ANY (${own}));
DROP POLICY IF EXISTS ${policy("update")} ON record;
${update ? `CREATE POLICY ${policy("update")} ON record FOR UPDATE TO ${who} USING (type = ANY (${own})) WITH CHECK (type = ANY (${own}));` : ""}

DROP POLICY IF EXISTS ${policy("insert")} ON record_event;
CREATE POLICY ${policy("insert")} ON record_event FOR INSERT TO ${who}
  WITH CHECK (type = ANY (${own}) AND record->>'type' = type AND record->>'id' = record_id AND ${history});
`;
}
