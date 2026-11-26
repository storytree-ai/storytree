// Capability 1 · Project libraries
import { createHash } from "node:crypto";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Pool, PoolClient } from "pg";

import { HealthRecord } from "../health/index.js";
import { Knowledge, modelsFolder, PgVectors, pendingMemories, upgradeMemories, vectorServerIdentity, type EmbedderSource, type VectorDomain } from "../knowledge/index.js";
import { PgTransactions, type PluginRecordKind, SchemaRecords, takeWriteLock, type Transactions } from "../records/index.js";
import { pluginSchema } from "../schema/index.js";
import { WorkModel } from "../plan/index.js";
import { WorkInFlight } from "../work/index.js";
import { addressServer, type ConnectOptions } from "./address.js";
import { CachedTransactions } from "./record-cache.js";
import { cannotCreateDatabases, cannotSetUpProject, ConnectionError, isInsufficientPrivilege, sqlState } from "./connection-error.js";
import { assertProjectName, ProjectGoneError } from "./names.js";
import { FactoryCircle, InheritedRecords, OutsideCircleError, ProjectLineage, type Reached } from "./factory.js";
import { SwitchedRecords, type SystemSwitches } from "./switches.js";
import { PROJECT_SCHEMA } from "./schema.js";
import { schemaMerged, type SchemaMerged } from "./schema-merged.js";
import { readSnapshot, writeSnapshot, type ProjectSnapshot } from "./snapshot.js";
import { localServer, PROJECT_DATABASE_PREFIX, projectDatabase, type ServerAccess, type WaitBounds } from "./server.js";

export type { ConnectOptions };

export interface OpenOptions {
  readonly create?: boolean;
  readonly identity?: string;
  readonly system?: SystemSwitches;
  readonly kinds?: readonly PluginRecordKind[];
}

export interface OwnDatabaseOptions {
  readonly tables?: readonly string[];
  readonly declaredIn?: readonly (string | undefined)[];
}

export interface Storytree {
  openProject(name: string, options?: OpenOptions): Promise<Project>;
  listProjects(): Promise<string[]>;
  projectIdentities(): Promise<Record<string, string>>;
  snapshot(name: string): Promise<ProjectSnapshot>;
  restore(name: string, snapshot: ProjectSnapshot): Promise<void>;
  dropProject(name: string): Promise<void>;
  ownDatabase(name: string, options?: OwnDatabaseOptions): Promise<Pool>;
  close(): Promise<void>;
}

export interface Project {
  readonly name: string;
  readonly identity: string;
  readonly pool: Pool;
  readonly transactions: Transactions;
  readonly records: SchemaRecords;
  readonly work: WorkModel;
  readonly flight: WorkInFlight;
  readonly knowledge: Knowledge;
  readonly health: HealthRecord;
  readonly lineage: ProjectLineage;
  readonly factory: Project | undefined;
  reach(name: string): Promise<Project>;
  reachAll(): Promise<Reached<Project>[]>;
  close(): Promise<void>;
}

export async function connect(options: ConnectOptions, seams: ProjectSeams = {}): Promise<Storytree> {
  if (options.url !== undefined && options.address !== undefined) {
    throw new ConnectionError("config", "Give connect() one of a url or an address, not both.");
  }
  const bounds: WaitBounds = options;
  if (options.address !== undefined) {
    return new ServerConnection(addressServer(options.address, options.connectTimeoutMs, bounds), { sharedLibrary: !onTestServer(options.address), ...seams });
  }
  return new ServerConnection(localServer(new URL(options.url), options.connectTimeoutMs, bounds), seams);
}

function onTestServer(address: string): boolean {
  const at = (url: string | undefined): string | undefined => {
    if (url === undefined || url === "") return undefined;
    try {
      const parsed = new URL(url);
      return `${parsed.hostname === "localhost" ? "127.0.0.1" : parsed.hostname}:${parsed.port || "5432"}`;
    } catch {
      return undefined;
    }
  };
  const here = at(address);
  return here !== undefined && [process.env.STORYTREE_TEST_PG_URL, process.env.STORYTREE_TEST_PG_ADMIN_URL].some((url) => at(url) === here);
}

const SCHEMA_FILE = import.meta.url === undefined ? undefined : path.join(path.dirname(fileURLToPath(import.meta.url)), "schema.ts");

const mergedOnce = new Map<string, SchemaMerged>();
function schemaMergedOnce(file: string): SchemaMerged {
  let standing = mergedOnce.get(file);
  if (standing === undefined) mergedOnce.set(file, (standing = schemaMerged(file)));
  return standing;
}

export type ProjectSeams = {
  readonly embedder?: EmbedderSource;
  readonly vectorCache?: string | null;
  readonly recordCache?: string | null;
  readonly sharedLibrary?: boolean;
  readonly schemaMerged?: (file: string) => SchemaMerged;
};

class ServerConnection implements Storytree {
  readonly #server: ServerAccess;
  readonly #projects = new Set<ProjectLibrary>();
  readonly #opening = new Set<Promise<Project>>();
  readonly #own = new Map<string, Promise<Pool>>();
  readonly #ownSetUp = new Map<string, Promise<void>>();
  readonly #embedder: EmbedderSource | undefined;
  readonly #vectorCache: string | null;
  readonly #recordCache: string | null;
  readonly #merged: ((file: string) => SchemaMerged) | undefined;
  #closing: Promise<void> | undefined;

  constructor(server: ServerAccess, seams: ProjectSeams) {
    this.#server = server;
    this.#embedder = seams.embedder;
    this.#merged = seams.sharedLibrary === true ? (seams.schemaMerged ?? schemaMergedOnce) : undefined;
    this.#vectorCache = seams.vectorCache === undefined
      ? (seams.embedder === undefined ? path.join(modelsFolder(), "vectors.sqlite") : null)
      : seams.vectorCache;
    this.#recordCache = seams.recordCache === undefined
      ? (seams.sharedLibrary === true && !process.env.STORYTREE_TEST_PG_URL ? path.join(process.env.STORYTREE_HOME ?? path.join(homedir(), ".storytree/0.3"), "records.sqlite") : null)
      : seams.recordCache;
  }

  async openProject(name: string, options: OpenOptions = {}): Promise<Project> {
    this.#assertOpen();
    const opening = this.#openProject(name, options);
    this.#opening.add(opening);
    try {
      return await opening;
    } finally {
      this.#opening.delete(opening);
    }
  }

  async #openProject(name: string, options: OpenOptions & { readonly inherit?: boolean }): Promise<Project> {
    assertProjectName(name);
    const database = projectDatabase(name);
    let identity: string | undefined;
    try {
      if (options.create !== false) await this.#createDatabaseIfMissing(database);
      identity = await this.#databaseIdentity(database);
      if (identity === undefined || (options.create === false && options.identity !== undefined && identity !== options.identity)) throw new ProjectGoneError(name);
      return await this.#openFound(name, database, identity, options);
    } catch (error) {
      const lost = identity !== undefined && !(error instanceof ProjectGoneError) && [undefined, "57P01", "3D000", "55000"].includes(sqlState(error));
      if (options.create === false && lost && (await this.#goneWithin(database, 5_000))) throw new ProjectGoneError(name);
      throw this.#server.explain(error);
    }
  }

  async #goneWithin(database: string, ms: number): Promise<boolean> {
    const look = "SELECT 1 FROM pg_database WHERE datname = $1 AND datconnlimit <> -2";
    for (const until = Date.now() + ms; ; await new Promise((resolve) => setTimeout(resolve, 50))) {
      const live = await this.#server.admin.query(look, [database]).then(({ rowCount }) => (rowCount ?? 0) > 0, () => true);
      if (!live) return true;
      if (Date.now() >= until) return false;
    }
  }

  async #openFound(name: string, database: string, identity: string, options: OpenOptions & { readonly inherit?: boolean }): Promise<Project> {
    const pool = this.#server.pool(database, await this.#owningRole(database));
    try {
      const merged = this.#merged;
      await openTables(pool, name, merged && (() => (SCHEMA_FILE === undefined ? { merged: true } : merged(SCHEMA_FILE))));
    } catch (error) {
      await pool.end();
      throw error;
    }
    const factory = options.inherit === false ? undefined : await this.#factoryOf(pool, name).catch(async (error: unknown) => {
      await pool.end();
      throw error;
    });
    const domain = { server: vectorServerIdentity(pool), database, identity };
    const others = {
      open: (other: string) => this.openProject(other, { create: false, ...(options.system === undefined ? {} : { system: options.system }), ...(options.kinds === undefined ? {} : { kinds: options.kinds }) }),
      list: () => this.listProjects(),
    };
    const project = new ProjectLibrary(name, identity, pool, () => this.#projects.delete(project), this.#vectorCache, domain, this.#embedder, factory, options.system, options.kinds, this.#recordCache, others);
    this.#projects.add(project);
    return project;
  }

  async #factoryOf(pool: Pool, name: string): Promise<Project | undefined> {
    const link = await new ProjectLineage(pool, name).factory();
    if (link.kind !== "product") return undefined;
    const factory = await this.#openProject(link.factory, { create: false, inherit: false }).catch((error: unknown) => {
      if (error instanceof ProjectGoneError) return undefined;
      throw error;
    });
    if (factory === undefined || (await factory.lineage.factory()).kind === "factory") return factory;
    await factory.close();
    return undefined;
  }

  async ownDatabase(name: string, options: OwnDatabaseOptions = {}): Promise<Pool> {
    this.#assertOpen();
    if (name.startsWith(PROJECT_DATABASE_PREFIX) || name === "" || name === "postgres") {
      return Promise.reject(new Error(`"${name}" is not a database of its own to hand out: it is a project's, or the server's.`));
    }
    let pool = this.#own.get(name);
    if (pool === undefined) {
      pool = this.#createDatabaseIfMissing(name).then(
        async () => this.#server.pool(name, await this.#owningRole(name)),
        (error: unknown) => Promise.reject(this.#server.explain(error)),
      );
      pool.catch(() => this.#own.delete(name));
      this.#own.set(name, pool);
    }
    if (options.tables === undefined || options.tables.length === 0) return pool;
    const tables = options.tables;
    const declaredIn = (options.declaredIn ?? []).map((file) => (file?.startsWith("file:") ? fileURLToPath(file) : file));
    const merged = this.#merged;
    const standing = merged && ((): SchemaMerged =>
      declaredIn.length === 0
        ? { merged: false, why: "its caller names no file declaring its tables" }
        : (declaredIn.map((file): SchemaMerged => (file === undefined ? { merged: true } : merged(file))).find((one) => !one.merged) ?? { merged: true }));
    const key = `${name}\0${declaredIn.join("\0")}\0${tables.join("\0")}`;
    let setUp = this.#ownSetUp.get(key);
    if (setUp === undefined) {
      setUp = pool.then((opened) => setUpOwnDatabase(opened, name, tables, standing).catch((error: unknown) => Promise.reject(this.#server.explain(error))));
      setUp.catch(() => this.#ownSetUp.delete(key));
      this.#ownSetUp.set(key, setUp);
    }
    await setUp;
    return pool;
  }

  async listProjects(): Promise<string[]> {
    this.#assertOpen();
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

  async projectIdentities(): Promise<Record<string, string>> {
    this.#assertOpen();
    try {
      const { rows } = await this.#server.admin.query<{ datname: string; identity: string }>(
        "SELECT datname, oid::text AS identity FROM pg_database WHERE starts_with(datname, $1) ORDER BY datname",
        [PROJECT_DATABASE_PREFIX],
      );
      return Object.fromEntries(rows.map((row) => [row.datname.slice(PROJECT_DATABASE_PREFIX.length), row.identity]));
    } catch (error) {
      throw this.#server.explain(error);
    }
  }

  async snapshot(name: string): Promise<ProjectSnapshot> {
    assertProjectName(name);
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

  async dropProject(name: string): Promise<void> {
    assertProjectName(name);
    if (!(await this.listProjects()).includes(name)) throw new Error(`There is no project "${name}" to delete.`);
    await Promise.all([...this.#projects].filter((project) => project.name === name).map((project) => project.close()));
    for (let attempt = 1; ; attempt++) {
      try {
        await this.#server.admin.query(`DROP DATABASE IF EXISTS ${quoteIdentifier(projectDatabase(name))} WITH (FORCE)`);
        return;
      } catch (error) {
        if ((error as { code?: unknown }).code !== "42501" || attempt >= 20) throw this.#server.explain(error);
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
    }
  }

  close(): Promise<void> {
    this.#closing ??= this.#close();
    return this.#closing;
  }

  async #close(): Promise<void> {
    try {
      await Promise.allSettled(this.#opening);
      const own = await Promise.allSettled(this.#own.values());
      const closed = await Promise.allSettled([
        ...[...this.#projects].map((project) => project.close()),
        ...own.map((opened) => (opened.status === "fulfilled" && !opened.value.ended ? opened.value.end() : undefined)),
        this.#server.admin.end(),
      ]);
      const failed = closed.find((result) => result.status === "rejected");
      if (failed?.status === "rejected") throw failed.reason;
    } finally {
      this.#server.close();
    }
  }

  #assertOpen(): void {
    if (this.#closing !== undefined) throw new Error("This library server connection is closed.");
  }

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

  async #databaseExists(database: string): Promise<boolean> {
    return (await this.#server.admin.query("SELECT 1 FROM pg_database WHERE datname = $1", [database])).rows.length > 0;
  }

  async #databaseIdentity(database: string): Promise<string | undefined> {
    return (await this.#server.admin.query<{ identity: string }>("SELECT oid::text AS identity FROM pg_database WHERE datname = $1", [database])).rows[0]?.identity;
  }

  async #createDatabaseIfMissing(database: string): Promise<void> {
    const { admin } = this.#server;
    if (await this.#databaseExists(database)) return;
    try {
      await createDatabase(admin, database);
    } catch (error) {
      if (!isInsufficientPrivilege(error)) throw error;
      const creator = await this.#creatorRole();
      if (creator !== undefined) return createDatabaseAs(admin, creator, database);
      const user = await this.#serverUser().catch(() => undefined);
      if (user !== undefined) throw cannotCreateDatabases(user, error);
      throw error;
    }
  }

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

  async #serverUser(): Promise<string | undefined> {
    const { rows } = await this.#server.admin.query<{ name: string }>("SELECT session_user AS name");
    return rows[0]?.name;
  }
}

class ProjectLibrary implements Project {
  readonly name: string;
  readonly identity: string;
  readonly pool: Pool;
  readonly transactions: Transactions;
  readonly records: SchemaRecords;
  readonly work: WorkModel;
  readonly flight: WorkInFlight;
  readonly knowledge: Knowledge;
  readonly health: HealthRecord;
  readonly lineage: ProjectLineage;
  readonly factory: Project | undefined;
  readonly #circle: FactoryCircle<Project> | undefined;
  readonly #forget: () => void;
  #closing: Promise<void> | undefined;

  readonly #cache: CachedTransactions | undefined;

  constructor(name: string, identity: string, pool: Pool, forget: () => void, vectorCache: string | null, domain: VectorDomain, embedder?: EmbedderSource, factory?: Project, system?: SystemSwitches, kinds: readonly PluginRecordKind[] = [], recordCache: string | null = null, others?: { open(name: string): Promise<Project>; list(): Promise<string[]> }) {
    this.name = name;
    this.identity = identity;
    this.pool = pool;
    this.#cache = recordCache === null ? undefined : new CachedTransactions(new PgTransactions(pool), pool, recordCache, domain);
    this.transactions = this.#cache ?? new PgTransactions(pool);
    const schema = pluginSchema(kinds);
    const records = factory === undefined ? new SchemaRecords(this.transactions, schema) : new InheritedRecords(this.transactions, factory.records, schema);
    this.records = system === undefined ? records : new SwitchedRecords(this.transactions, records, system, schema);
    this.factory = factory;
    this.work = new WorkModel(this.records);
    this.flight = new WorkInFlight(this.records, this.work);
    this.knowledge = new Knowledge(this.records, name, { vectors: new PgVectors(pool, vectorCache, domain), ...(embedder === undefined ? {} : { embedder }) });
    this.health = new HealthRecord(this.records, this.work, this.flight);
    this.lineage = new ProjectLineage(pool, name);
    this.#circle = others === undefined ? undefined : new FactoryCircle<Project>(this, others.open, others.list);
    this.#forget = forget;
  }

  async reach(name: string): Promise<Project> {
    if (this.#circle === undefined) throw new OutsideCircleError(`Project "${this.name}" reads only its own library, never "${name}"'s.`);
    return this.#circle.reach(name);
  }

  async reachAll(): Promise<Reached<Project>[]> {
    return this.#circle === undefined ? [] : this.#circle.reachAll();
  }

  close(): Promise<void> {
    this.#cache?.close();
    this.#closing ??= Promise.all([this.pool.end(), this.factory?.close(), this.#circle?.close()]).then(() => undefined).finally(this.#forget);
    return this.#closing;
  }
}

async function openTables(pool: Pool, name: string, merged: (() => SchemaMerged) | undefined): Promise<void> {
  if (await tablesCurrent(pool, name)) return;
  const standing = merged?.();
  if (standing !== undefined && !standing.merged) {
    const setUp = await pool.query<{ setUp: boolean }>("SELECT to_regclass('public.library_meta') IS NOT NULL AS \"setUp\"");
    const why = `this storytree's project schema is not merged (${standing.why}), and a shared library takes schema changes only from merged code`;
    if (setUp.rows[0]?.setUp !== true) throw new ConnectionError("project-owner", `Project "${name}" is not set up, and ${why}. Set it up from code on origin/main.`);
    if (!behindWarned.has(name)) {
      behindWarned.add(name);
      console.warn(`Project "${name}"'s tables are behind this storytree's, and ${why}, so it opens them as they stand.`);
    }
    return;
  }
  const rights = await schemaRights(pool);
  if (!rights.mayChange) {
    if (!rights.setUp) throw cannotSetUpProject(name, rights.account, rights.owner, undefined);
    if (!behindWarned.has(name)) {
      behindWarned.add(name);
      console.warn(
        `Project "${name}"'s tables are behind this storytree's, and ${quoteIdentifier(rights.account)} may not change them, ` +
          `so it opens them as they stand. Open it once as the role that owns its database (${quoteIdentifier(rights.owner)}) to bring them up to date.`,
      );
    }
    return;
  }
  try {
    await applySchema(pool, name);
  } catch (error) {
    if (!isInsufficientPrivilege(error)) throw error;
    throw cannotSetUpProject(name, rights.account, rights.owner, error);
  }
}

const behindWarned = new Set<string>();
const ownBehindWarned = new Set<string>();

const SCHEMA_TABLES = PROJECT_SCHEMA.flatMap((statement) => /CREATE TABLE IF NOT EXISTS (\w+)/.exec(statement)?.[1] ?? []);

async function schemaRights(pool: Pool): Promise<{ mayChange: boolean; setUp: boolean; account: string; owner: string }> {
  const { rows } = await pool.query<{ mayChange: boolean; setUp: boolean; account: string; owner: string }>(
    `SELECT has_schema_privilege('public', 'CREATE')
              AND COALESCE(bool_and(pg_has_role(current_user, c.relowner, 'USAGE')), true) AS "mayChange",
            to_regclass('public.library_meta') IS NOT NULL AS "setUp",
            session_user AS account, pg_get_userbyid(d.datdba) AS owner
       FROM pg_database d
       LEFT JOIN pg_class c ON c.relnamespace = 'public'::regnamespace AND c.relname = ANY($1::text[])
      WHERE d.datname = current_database()
      GROUP BY d.datdba`,
    [SCHEMA_TABLES],
  );
  const [found] = rows;
  if (found === undefined) throw new Error("The project's database was not found on its own connection.");
  return found;
}

async function tablesCurrent(pool: Pool, name: string): Promise<boolean> {
  const client = await pool.connect();
  try {
    const version = await client.query<{ value: string }>("SELECT value FROM library_meta WHERE key = 'schema'").then(
      ({ rows }) => rows[0]?.value,
      (error: unknown) => {
        if (sqlState(error) === "42P01") return undefined;
        throw error;
      },
    );
    if (!(Number(version) >= PROJECT_SCHEMA.length)) return false;
    const { convertible, warnings } = await pendingMemories(client, name, false);
    if (convertible.length > 0) return false;
    for (const warning of warnings) console.warn(warning);
    return true;
  } finally {
    client.release();
  }
}

async function setUpOwnDatabase(pool: Pool, name: string, tables: readonly string[], merged: (() => SchemaMerged) | undefined): Promise<void> {
  if ((await unappliedStatements(pool, tables)).length === 0) return;
  const standing = merged?.();
  if (standing !== undefined && !standing.merged) {
    const setUp = await pool.query<{ setUp: boolean }>("SELECT to_regclass('public.storytree_setup') IS NOT NULL AS \"setUp\"");
    const why = `the file declaring its tables is not merged (${standing.why}), and a shared library takes table changes only from merged code`;
    if (setUp.rows[0]?.setUp !== true) throw new ConnectionError("project-owner", `Database "${name}" is not set up, and ${why}. Set it up from code on origin/main.`);
    if (!ownBehindWarned.has(name)) {
      ownBehindWarned.add(name);
      console.warn(`Database "${name}"'s tables are behind this storytree's, and ${why}, so it opens them as they stand.`);
    }
    return;
  }
  const client = await pool.connect();
  let failed = false;
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtext('storytree.own-database'), hashtext($1))", [name]);
    await client.query("CREATE TABLE IF NOT EXISTS storytree_setup (digest text PRIMARY KEY, at timestamptz NOT NULL DEFAULT now())");
    for (const statement of await unappliedStatements(client, tables)) {
      await client.query(statement);
      await client.query("INSERT INTO storytree_setup (digest) VALUES (md5($1))", [statement]);
    }
    await client.query("COMMIT");
  } catch (error) {
    failed = true;
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release(failed);
  }
}

async function unappliedStatements(client: Pool | PoolClient, tables: readonly string[]): Promise<string[]> {
  const applied = await client.query<{ digest: string }>("SELECT digest FROM storytree_setup").then(
    ({ rows }) => new Set(rows.map((row) => row.digest)),
    (error: unknown) => {
      if (sqlState(error) === "42P01") return new Set<string>();
      throw error;
    },
  );
  return tables.filter((statement) => !applied.has(createHash("md5").update(statement).digest("hex")));
}

async function applySchema(pool: Pool, name: string): Promise<void> {
  const client = await pool.connect();
  let failed = false;
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtext('storytree.project-schema'))");
    await takeWriteLock(client, pool);
    for (const statement of PROJECT_SCHEMA) await client.query(statement);
    await client.query(
      "INSERT INTO library_meta (key, value) VALUES ('project', $1) ON CONFLICT (key) DO NOTHING",
      [name],
    );
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

async function createDatabase(client: Pool | PoolClient, database: string): Promise<void> {
  try {
    await client.query(`CREATE DATABASE ${quoteIdentifier(database)}`);
  } catch (error) {
    if (!isDuplicateDatabase(error)) throw error;
  }
}

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

function isDuplicateDatabase(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const { code, constraint } = error as { code?: unknown; constraint?: unknown };
  return code === "42P04" || (code === "23505" && constraint === "pg_database_datname_index");
}
