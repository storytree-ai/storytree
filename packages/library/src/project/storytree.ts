/**
 * Capability 1 · Project libraries (the library story): one Postgres server holds many
 * projects, each in its own database, created the first time the project is opened. The server is
 * at a URL, or it is a Cloud SQL instance reached with Google sign-in (capability 8): either way it
 * is reached through a ServerAccess, and everything here works the same on both.
 *
 * A server user that may not create databases (as a Cloud SQL IAM user may not, and cannot be let
 * to) borrows a role granted to it that may, for the CREATE DATABASE alone. With none to borrow,
 * opening a new project is refused with the two lines that grant one.
 *
 * Setting a project's tables up, or upgrading them, is its owner's alone. Opening a project whose
 * tables are current does neither, so an account let only read or write some rows (CI's health
 * account, ADR-0747) opens it too; one whose tables are behind is refused saying who may.
 */
import type { Pool, PoolClient } from "pg";

import { HealthRecord } from "../health/health-record.js";
import type { EmbedderSource } from "../knowledge/embedding.js";
import { Knowledge } from "../knowledge/knowledge.js";
import { SchemaRecords } from "../schema/records.js";
import { PgTransactions, WRITE_LOCK } from "../transactions/pg.js";
import type { Transactions } from "../transactions/types.js";
import { WorkInFlight } from "../work/work-in-flight.js";
import { WorkModel } from "../work/work-model.js";
import { cloudSqlServer, type CloudSqlConfig, type CloudSqlSeams } from "./cloud-sql.js";
import { PgVectors } from "./embeddings.js";
import { cannotCreateDatabases, cannotSetUpProject, ConnectionError, isInsufficientPrivilege, sqlState } from "./connection-error.js";
import { assertProjectName, PROJECT_DATABASE_PREFIX, projectDatabase } from "./names.js";
import { pendingMemories, upgradeMemories } from "./memory-upgrade.js";
import { PROJECT_SCHEMA } from "./schema.js";
import { readSnapshot, writeSnapshot, type ProjectSnapshot } from "./snapshot.js";
import { localServer, type ServerAccess } from "./server.js";

/** Where the Postgres server is: at a URL, or a Cloud SQL instance reached with Google sign-in. */
export type ConnectOptions =
  | {
      /**
       * A postgres:// URL for the server. Its own database is only used to create and list project
       * databases; each project's records live in that project's database.
       */
      readonly url: string;
      /** A new local database connection must answer within this long; defaults to 3 seconds. */
      readonly connectTimeoutMs?: number;
      readonly cloudSql?: undefined;
    }
  | {
      /**
       * A Cloud SQL for PostgreSQL instance, signed in to as your own Google account (capability 8).
       * Its `postgres` database is only used to create and list project databases.
       */
      readonly cloudSql: CloudSqlConfig;
      readonly url?: undefined;
    };

/** A connection to one Postgres server and the storytree projects on it. */
export interface Storytree {
  /**
   * Open the library of the project called `name`, creating its database and tables the first
   * time. A name that breaks the project-name rule is refused before anything touches the server.
   */
  openProject(name: string): Promise<Project>;
  /** The names of the storytree projects on the server, sorted. No other database is listed. */
  listProjects(): Promise<string[]>;
  /** Every record of the project called `name` and its whole history, read at one moment (contract 1.6). */
  snapshot(name: string): Promise<ProjectSnapshot>;
  /** Restore a snapshot into the project called `name`, only if it holds no record and no history (1.7, 1.8). */
  restore(name: string, snapshot: ProjectSnapshot): Promise<void>;
  /**
   * A database of the caller's own called `name`, beside the projects on the same server, local or
   * Cloud SQL (contract 7.7, ADR-0735 D3): created the first time as a project's is, never listed
   * as a project, and closed with this connection. A project's database is never handed out.
   */
  ownDatabase(name: string): Promise<Pool>;
  /** Close this connection, every project opened through it, and its own databases. */
  close(): Promise<void>;
}

/** One project's library: its own database on the server. */
export interface Project {
  readonly name: string;
  /**
   * The connection pool to this project's database. Internal: tests and later capabilities use
   * it, and capability 7 keeps it out of the public API.
   */
  readonly pool: Pool;
  /** This project's records: the only data actions the library allows (capability 2). */
  readonly transactions: Transactions;
  /** The same records, typed and checked against the data schema (capability 3). */
  readonly records: SchemaRecords;
  /** The project's plan of work: stories, capabilities, contracts and arcs (capability 4). */
  readonly work: WorkModel;
  /** Each arc's increments, and its state worked out from them (capability 10). */
  readonly flight: WorkInFlight;
  /** What the project has learned: decisions, definitions and other artifacts (capability 6). */
  readonly knowledge: Knowledge;
  /** How healthy each story, capability and contract is, reported and verified (capability 5). */
  readonly health: HealthRecord;
  /** Close this project's connections. */
  close(): Promise<void>;
}

/**
 * Connect to a Postgres server. Nothing touches the server until a call needs it. A Cloud SQL
 * instance is signed in to and looked up first, so a missing or bad Google sign-in, or an instance
 * the account cannot use, is refused here with a ConnectionError saying what to fix. `seams` is
 * internal: tests hand the cloud path a fake connector through it, and ranked search a fake embedder.
 */
export async function connect(options: ConnectOptions, seams: ProjectSeams = {}): Promise<Storytree> {
  if (options.cloudSql === undefined) return new ServerConnection(localServer(new URL(options.url), options.connectTimeoutMs), seams.embedder);
  if (options.url !== undefined) {
    throw new ConnectionError("config", "Give connect() either a url or a cloudSql instance, not both.");
  }
  return new ServerConnection(await cloudSqlServer(options.cloudSql, seams), seams.embedder);
}

/** What tests may hand connect() in place of the real thing: the Cloud SQL connector, and the embedder. */
export type ProjectSeams = CloudSqlSeams & { readonly embedder?: EmbedderSource };

class ServerConnection implements Storytree {
  readonly #server: ServerAccess;
  readonly #projects = new Set<ProjectLibrary>();
  readonly #own = new Map<string, Promise<Pool>>();
  readonly #embedder: EmbedderSource | undefined;
  #closed = false;

  constructor(server: ServerAccess, embedder?: EmbedderSource) {
    this.#server = server;
    this.#embedder = embedder;
  }

  async openProject(name: string): Promise<Project> {
    assertProjectName(name); // before anything touches the server
    const database = projectDatabase(name);
    try {
      await this.#createDatabaseIfMissing(database);
      const pool = this.#server.pool(database, await this.#owningRole(database));
      try {
        await openTables(pool, name);
      } catch (error) {
        await pool.end();
        throw error;
      }
      const project = new ProjectLibrary(name, pool, () => this.#projects.delete(project), this.#embedder);
      this.#projects.add(project);
      return project;
    } catch (error) {
      throw this.#server.explain(error);
    }
  }

  ownDatabase(name: string): Promise<Pool> {
    if (name.startsWith(PROJECT_DATABASE_PREFIX) || name === "" || name === "postgres") {
      return Promise.reject(new Error(`"${name}" is not a database of its own to hand out: it is a project's, or the server's.`));
    }
    let pool = this.#own.get(name);
    if (pool === undefined) {
      pool = this.#createDatabaseIfMissing(name).then(
        async () => this.#server.pool(name, await this.#owningRole(name)),
        (error: unknown) => Promise.reject(this.#server.explain(error)),
      );
      // A failed opening is forgotten, so the next ask tries again.
      pool.catch(() => this.#own.delete(name));
      this.#own.set(name, pool);
    }
    return pool;
  }

  async listProjects(): Promise<string[]> {
    try {
      const { rows } = await this.#server.admin.query<{ datname: string }>(
        "SELECT datname FROM pg_database WHERE starts_with(datname, $1)",
        [PROJECT_DATABASE_PREFIX],
      );
      return rows.map((row) => row.datname.slice(PROJECT_DATABASE_PREFIX.length)).sort();
    } catch (error) {
      throw this.#server.explain(error);
    }
  }

  async snapshot(name: string): Promise<ProjectSnapshot> {
    assertProjectName(name); // before anything touches the server
    if (!(await this.listProjects()).includes(name)) throw new Error(`There is no project "${name}" to take a snapshot of.`);
    const project = await this.openProject(name);
    try {
      return await readSnapshot(project.pool, name);
    } finally {
      await project.close();
    }
  }

  async restore(name: string, snapshot: ProjectSnapshot): Promise<void> {
    const project = await this.openProject(name);
    try {
      await writeSnapshot(project.pool, name, snapshot);
    } finally {
      await project.close();
    }
  }

  async close(): Promise<void> {
    if (this.#closed) return;
    this.#closed = true;
    try {
      await Promise.all([...this.#projects].map((project) => project.close()));
      const own = await Promise.allSettled(this.#own.values());
      await Promise.all(own.map((opened) => (opened.status === "fulfilled" && !opened.value.ended ? opened.value.end() : undefined)));
      await this.#server.admin.end();
    } finally {
      this.#server.close();
    }
  }

  /**
   * The role that owns `database`, when this connection's user is not it and may take it on: the
   * role its connections then act as (contract 8.3). Two accounts sharing one server both reach
   * each project's database through the role that created it, so every table either makes belongs
   * to that role, and neither ever needs the other's ownership to open the project again (a
   * CREATE INDEX IF NOT EXISTS checks the table's owner even when the index is there).
   */
  async #owningRole(database: string): Promise<string | undefined> {
    const { rows } = await this.#server.admin.query<{ owner: string; mine: boolean; may: boolean }>(
      `SELECT pg_get_userbyid(datdba) AS owner, datdba = (SELECT oid FROM pg_roles WHERE rolname = current_user) AS mine,
              pg_has_role(current_user, datdba, 'SET') AS may
         FROM pg_database WHERE datname = $1`,
      [database],
    );
    const [found] = rows;
    return found === undefined || found.mine || !found.may ? undefined : found.owner;
  }

  async #createDatabaseIfMissing(database: string): Promise<void> {
    const { admin } = this.#server;
    const existing = await admin.query("SELECT 1 FROM pg_database WHERE datname = $1", [database]);
    if (existing.rows.length > 0) return;
    try {
      await createDatabase(admin, database);
    } catch (error) {
      if (!isInsufficientPrivilege(error)) throw error;
      // The server's user may not create databases. Whether it may is CREATEDB, an attribute of a
      // role that membership never passes on, so a role granted to the user that may is taken on
      // (SET ROLE) for the CREATE DATABASE itself.
      const creator = await this.#creatorRole();
      if (creator !== undefined) return createDatabaseAs(admin, creator, database);
      // None to borrow: say how to grant one.
      const user = await this.#serverUser().catch(() => undefined);
      if (user !== undefined) throw cannotCreateDatabases(this.#server.kind, user, error);
      throw error;
    }
  }

  /**
   * A role that may create databases and that the server's user may take on with SET ROLE, which
   * Postgres judges against the session's user: what a user that may not create databases borrows
   * to make a project's database. pg_has_role(…, 'SET') follows pg_auth_members recursively,
   * through grants that carry SET only, exactly as SET ROLE will (Postgres 16 and later; before 16
   * any member may SET ROLE, so MEMBER asks the same there). When the user may take on more than
   * one such role, the first by name, in byte order, is borrowed, so that it is always the same one.
   */
  async #creatorRole(): Promise<string | undefined> {
    const { rows } = await this.#server.admin.query<{ name: string }>(
      `SELECT rolname AS name FROM pg_roles
        WHERE rolcreatedb
          AND pg_has_role(session_user, oid,
                CASE WHEN current_setting('server_version_num')::int >= 160000 THEN 'SET' ELSE 'MEMBER' END)
        ORDER BY rolname COLLATE "C"
        LIMIT 1`,
    );
    return rows[0]?.name;
  }

  /** The role the server's connections sign in as: the session's user, whom a role is granted to. */
  async #serverUser(): Promise<string | undefined> {
    const { rows } = await this.#server.admin.query<{ name: string }>("SELECT session_user AS name");
    return rows[0]?.name;
  }
}

class ProjectLibrary implements Project {
  readonly name: string;
  readonly pool: Pool;
  readonly transactions: Transactions;
  readonly records: SchemaRecords;
  readonly work: WorkModel;
  readonly flight: WorkInFlight;
  readonly knowledge: Knowledge;
  readonly health: HealthRecord;
  readonly #forget: () => void;
  #closing: Promise<void> | undefined;

  constructor(name: string, pool: Pool, forget: () => void, embedder?: EmbedderSource) {
    this.name = name;
    this.pool = pool;
    this.transactions = new PgTransactions(pool);
    this.records = new SchemaRecords(this.transactions);
    this.work = new WorkModel(this.records);
    this.flight = new WorkInFlight(this.records);
    this.knowledge = new Knowledge(this.records, name, { vectors: new PgVectors(pool), ...(embedder === undefined ? {} : { embedder }) });
    this.health = new HealthRecord(this.records, this.work);
    this.#forget = forget;
  }

  close(): Promise<void> {
    this.#closing ??= this.pool.end().finally(this.#forget);
    return this.#closing;
  }
}

/**
 * Set the project's tables up, or bring them up to date, unless they are current already: then
 * nothing is written, and no owner's rights are needed (contract 1.10). When they are behind and
 * the account may not change them, say so and who may (1.11).
 */
async function openTables(pool: Pool, name: string): Promise<void> {
  if (await tablesCurrent(pool, name)) return;
  try {
    await applySchema(pool, name);
  } catch (error) {
    if (!isInsufficientPrivilege(error)) throw error;
    const { rows } = await pool.query<{ account: string; owner: string }>(
      "SELECT session_user AS account, pg_get_userbyid(datdba) AS owner FROM pg_database WHERE datname = current_database()",
    );
    const [found] = rows;
    throw found === undefined ? error : cannotSetUpProject(name, found.account, found.owner, error);
  }
}

/**
 * Whether the project's tables hold every statement of the schema, as the version its last setup
 * recorded says, and no memory is waiting to be converted. Read only: the memories that cannot be
 * converted are reported here, as a setup reports them.
 */
async function tablesCurrent(pool: Pool, name: string): Promise<boolean> {
  const client = await pool.connect();
  try {
    const version = await client.query<{ value: string }>("SELECT value FROM library_meta WHERE key = 'schema'").then(
      ({ rows }) => rows[0]?.value,
      (error: unknown) => {
        if (sqlState(error) === "42P01") return undefined; // undefined_table: a new project, not set up yet
        throw error;
      },
    );
    if (version === undefined || Number(version) < PROJECT_SCHEMA.length) return false;
    const { convertible, warnings } = await pendingMemories(client, name, false);
    if (convertible.length > 0) return false;
    for (const warning of warnings) console.warn(warning);
    return true;
  } finally {
    client.release();
  }
}

/**
 * Apply the project schema in one transaction and record the project's name, and how much of the
 * schema it now holds: the version the next open reads to know it is current. Opens of one project
 * can race (two processes, or two first opens), so they take turns on an advisory lock: two
 * concurrent CREATE TABLE IF NOT EXISTS can otherwise collide.
 */
async function applySchema(pool: Pool, name: string): Promise<void> {
  const client = await pool.connect();
  let failed = false;
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtext('storytree.project-schema'))");
    // Even CREATE INDEX IF NOT EXISTS locks its table. Take the writer's lock before any DDL:
    // schema visits record then record_event, while a save appends its event before its record.
    // Otherwise reopening beside a live write can deadlock (PR 75's concurrent CLI decisions).
    await client.query(WRITE_LOCK);
    for (const statement of PROJECT_SCHEMA) await client.query(statement);
    await client.query(
      "INSERT INTO library_meta (key, value) VALUES ('project', $1) ON CONFLICT (key) DO NOTHING",
      [name],
    );
    // Never lowered: an older storytree opening a project a newer one set up leaves its version.
    await client.query(
      `INSERT INTO library_meta (key, value) VALUES ('schema', $1) ON CONFLICT (key)
         DO UPDATE SET value = excluded.value WHERE library_meta.value::int < excluded.value::int`,
      [String(PROJECT_SCHEMA.length)],
    );
    const warnings = await upgradeMemories(client, name);
    await client.query("COMMIT");
    for (const warning of warnings) console.warn(warning);
  } catch (error) {
    failed = true;
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release(failed);
  }
}

/**
 * Create `database`. Another open of the same project creating it first is the outcome wanted, so
 * losing that race is not a failure.
 */
async function createDatabase(client: Pool | PoolClient, database: string): Promise<void> {
  try {
    await client.query(`CREATE DATABASE ${quoteIdentifier(database)}`);
  } catch (error) {
    if (!isDuplicateDatabase(error)) throw error;
  }
}

/**
 * Create `database` as `role`, borrowed on one connection of the admin pool: SET ROLE, CREATE
 * DATABASE, RESET ROLE. The database is then the role's. The server's user, a member of it, holds
 * its owner's rights there by inheritance, among them CREATE on the public schema (from Postgres 15
 * the owner's alone), so the project's tables are still made as the user, with no further grant. A
 * connection that cannot be handed back to the user's own role is closed, never pooled, so no later
 * query runs as the borrowed role.
 */
async function createDatabaseAs(admin: Pool, role: string, database: string): Promise<void> {
  const client = await admin.connect();
  let handedBack = false;
  try {
    await client.query(`SET ROLE ${quoteIdentifier(role)}`);
    try {
      await createDatabase(client, database);
    } finally {
      handedBack = await client.query("RESET ROLE").then(
        () => true,
        () => false,
      );
    }
  } finally {
    client.release(!handedBack);
  }
}

function quoteIdentifier(name: string): string {
  return `"${name.replaceAll('"', '""')}"`;
}

/**
 * CREATE DATABASE lost a race with another open of the same project. Postgres reports that as
 * duplicate_database or, when both creates passed its own existence check, as a unique violation
 * on pg_database's name index.
 */
function isDuplicateDatabase(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const { code, constraint } = error as { code?: unknown; constraint?: unknown };
  return code === "42P04" || (code === "23505" && constraint === "pg_database_datname_index");
}
