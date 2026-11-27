// Capability 30 · Outside writers
import type { ClientBase } from "pg";

import { serverOf, type ConnectOptions } from "./address.js";
import { quoted } from "./connection-error.js";

export interface OutsideWriter {
  readonly role: string;
  readonly kinds: readonly string[];
  readonly update?: boolean;
  readonly reads?: readonly string[];
}

const KINDS_OF = `CREATE OR REPLACE FUNCTION record_kinds(id text) RETURNS text[]
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
  AS $kinds$ SELECT coalesce(array_agg(DISTINCT type), '{}') FROM (
    SELECT type FROM record WHERE record.id = record_kinds.id
    UNION ALL SELECT type FROM record_event WHERE record_event.record_id = record_kinds.id
  ) AS kinds $kinds$;`;

function list(kinds: readonly string[]): string {
  return `ARRAY[${kinds.map((kind) => `'${kind.replaceAll("'", "''")}'`).join(", ")}]::text[]`;
}

function fenceSql({ role, kinds, update = false, reads = [] }: OutsideWriter): string {
  const who = quoted(role);
  const own = list(kinds);
  const policy = (name: string, table: string, rule?: string) => {
    const called = quoted(`${role} ${name}`);
    return `DROP POLICY IF EXISTS ${called} ON ${table};${rule === undefined ? "" : `\nCREATE POLICY ${called} ON ${table} ${rule};`}`;
  };
  return [
    `GRANT SELECT, INSERT, UPDATE ON record TO ${who};`,
    `GRANT INSERT ON record_event TO ${who};`,
    `GRANT USAGE ON SEQUENCE record_event_seq_seq TO ${who};`,
    "ALTER TABLE record ENABLE ROW LEVEL SECURITY;",
    "ALTER TABLE record_event ENABLE ROW LEVEL SECURITY;",
    "ALTER POLICY record_writes ON record TO CURRENT_USER;",
    "ALTER POLICY record_event_writes ON record_event TO CURRENT_USER;",
    KINDS_OF,
    policy("read", "record", `FOR SELECT TO ${who} USING (type = ANY (${list([...kinds, ...reads])}))`),
    policy("insert", "record", `FOR INSERT TO ${who} WITH CHECK (type = ANY (${own}))`),
    policy("update", "record", update ? `FOR UPDATE TO ${who} USING (type = ANY (${own})) WITH CHECK (type = ANY (${own}))` : undefined),
    policy("history", "record_event", `FOR INSERT TO ${who} WITH CHECK (type = ANY (${own}) AND record->>'type' = type AND record->>'id' = record_id
      AND CASE action WHEN 'created' THEN record_kinds(record_id) = '{}' WHEN 'updated' THEN ${update} AND record_kinds(record_id) = ARRAY[type] ELSE false END)`),
  ].join("\n");
}

export async function fenceOutsideWriter(client: ClientBase, writer: OutsideWriter): Promise<void> {
  if (writer.kinds.length === 0 || writer.kinds.some((kind) => !/^[^.]+\.[^.]+/.test(kind))) {
    throw new Error(`An outside writer is fenced to only a plugin's kinds (plugin.kind), never ${writer.kinds.join(", ") || "none"}.`);
  }
  const plugins = [...new Set(writer.kinds.map((kind) => kind.split(".")[0]))];
  if (plugins.length > 1) throw new Error(`An outside writer is fenced to the kinds of one plugin, not ${plugins.join(" and ")}.`);
  await client.query("BEGIN");
  try {
    const { rows } = await client.query<{ account: string; owner: string; found: boolean }>(
      "SELECT session_user AS account, pg_get_userbyid(datdba) AS owner, EXISTS (SELECT 1 FROM pg_roles WHERE rolname = $1) AS found FROM pg_database WHERE datname = current_database()",
      [writer.role],
    );
    const { account, owner, found } = rows[0]!;
    if (!found) throw new Error(`${writer.role} is no role on this server: make it first, with LOGIN and its password, apart from storytree, then fence again.`);
    await client.query(`SET LOCAL ROLE ${quoted(owner)}`).catch((error: unknown) => {
      throw new Error(`${account} may not act as ${owner}, the role that owns this project's database: fence it as an account that may.`, { cause: error });
    });
    await client.query(fenceSql(writer));
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
}

export async function fenceProject(options: ConnectOptions, project: string, writers: readonly OutsideWriter[]): Promise<void> {
  const server = serverOf(options);
  const fenced: string[] = [];
  try {
    const client = await server.pool(`storytree_${project}`).connect();
    try {
      for (const writer of writers) {
        try {
          await fenceOutsideWriter(client, writer);
        } catch (error) {
          const already = fenced.length === 0 ? "" : ` Already fenced: ${fenced.join(", ")}.`;
          throw new Error(`${writer.role} was not fenced: ${(error as Error).message}${already}`, { cause: error });
        }
        fenced.push(writer.role);
      }
    } finally {
      client.release();
    }
  } finally {
    await server.close();
  }
}
