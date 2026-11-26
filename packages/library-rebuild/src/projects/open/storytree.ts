// Capability 1 · Project libraries
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import type { Pool, QueryResult, QueryResultRow } from "pg";

import { HealthRecord } from "../../health/index.js";
import { convertMemories, Knowledge } from "../../knowledge/notes/index.js";
import { defaultEmbedder, modelsFolder, PgVectors, vectorServerIdentity, type EmbedderSource } from "../../knowledge/search/index.js";
import { LIBRARY_SCHEMA, pluginSchema, SchemaRecords, type PluginRecordKind } from "../../storage/rules/index.js";
import { PgBackend, PgTransactions, Store } from "../../storage/store/index.js";
import { FactoryCircle } from "./circle.js";
import { WorkModel } from "../../plan/index.js";
import { WorkInFlight } from "../../work/arcs/index.js";
import { ConnectionError, createDatabase, serverOf, sqlState, type ConnectOptions } from "../shared/index.js";
import { linkOf, ProjectLineage } from "./lineage.js";
import { checkName, databaseOf, ProjectGoneError } from "./names.js";
import type { Project } from "./project.js";
import { RecordCache } from "./record-cache.js";
import { ProjectRecords, type SystemSwitches } from "./records.js";
import { readMeta, setUp } from "./schema.js";
import { schemaMerged, type SchemaStanding } from "./schema-merged.js";
import { restoreSnapshot, takeSnapshot, type ProjectSnapshot } from "./snapshot.js";

export type { ConnectOptions } from "../shared/index.js";

export interface Seams {
  readonly sharedLibrary?: boolean;
  readonly schemaMerged?: (file: string) => SchemaStanding;
  readonly recordCache?: string | null;
  readonly embedder?: EmbedderSource;
  readonly vectorCache?: string | null;
}

export interface OpenOptions {
  readonly create?: boolean;
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
  snapshot(name: string): Promise<ProjectSnapshot>;
  restore(name: string, snapshot: ProjectSnapshot): Promise<void>;
  dropProject(name: string): Promise<void>;
  ownDatabase(name: string, options?: OwnDatabaseOptions): Promise<Pool>;
  close(): Promise<void>;
}

const warned = new Set<string>();

function warnOnce(key: string, line: string): void {
  if (warned.has(key)) return;
  warned.add(key);
  console.warn(line);
}

function storytreeHome(): string {
  const home = process.env.STORYTREE_HOME;
  return home !== undefined && home !== "" ? path.resolve(home) : path.join(homedir(), ".storytree", "0.3");
}

function quoted(name: string): string {
  return `"${name.replaceAll('"', '""')}"`;
}

function standingOf(declaredIn: readonly (string | undefined)[] | undefined, probe: (file: string) => SchemaStanding): SchemaStanding {
  if (declaredIn === undefined || declaredIn.length === 0) return { merged: false, why: "no file declares the statements" };
  for (const entry of declaredIn) {
    if (entry === undefined) continue;
    const standing = probe(entry.startsWith("file:") ? fileURLToPath(entry) : entry);
    if (!standing.merged) return standing;
  }
  return { merged: true };
}

export async function connect(options: ConnectOptions, seams: Seams = {}): Promise<Storytree> {
  const server = serverOf(options);
  const shared = seams.sharedLibrary === true;
  const probe = seams.schemaMerged ?? schemaMerged;
  const cacheFile = seams.recordCache !== undefined
    ? seams.recordCache
    : shared && !process.env.STORYTREE_TEST_PG_URL ? path.join(storytreeHome(), "records.sqlite") : null;
  const cache = cacheFile === null ? undefined : new RecordCache(cacheFile);
  const embedder = seams.embedder ?? defaultEmbedder();
  const vectorCache = seams.vectorCache !== undefined ? seams.vectorCache : seams.embedder === undefined ? path.join(modelsFolder(process.env), "vectors.sqlite") : null;
  const admin = server.admin;
  const pools = new Map<Pool, string>();
  const inFlight = new Set<Promise<unknown>>();
  const dropping = new Set<string>();
  let closing: Promise<void> | undefined;

  const ask = <R extends QueryResultRow>(text: string, values?: unknown[]): Promise<QueryResult<R>> => admin.query<R>(text, values);

  const poolFor = (database: string): Pool => {
    const pool = server.pool(database);
    pools.set(pool, database);
    return pool;
  };

  const end = async (pool: Pool): Promise<void> => {
    if (pools.delete(pool)) await pool.end();
  };

  const track = <T>(work: () => Promise<T>): Promise<T> => {
    if (closing !== undefined) return Promise.reject(new Error("this storytree connection is closed, so it opens nothing more"));
    const running = work();
    inFlight.add(running);
    running.then(() => inFlight.delete(running), () => inFlight.delete(running));
    return running;
  };

  const exists = async (database: string, create: boolean): Promise<boolean> => {
    const { rows } = await ask<{ datconnlimit: number }>("SELECT datconnlimit FROM pg_database WHERE datname = $1", [database]);
    if (rows.length > 0 && rows[0]!.datconnlimit !== -2) return true;
    if (!create) return false;
    await createDatabase(admin, database);
    return true;
  };

  const listProjects = async (): Promise<string[]> => {
    const { rows } = await ask<{ datname: string }>(
      `SELECT datname FROM pg_database WHERE datname LIKE 'storytree\\_%' AND datconnlimit <> -2 ORDER BY datname COLLATE "C"`,
    );
    return rows.map((row) => row.datname.slice("storytree_".length)).filter((name) => {
      try {
        return checkName(name) === name;
      } catch {
        return false;
      }
    });
  };

  const assemble = async (name: string, pool: Pool, meta: Readonly<Record<string, string>> | undefined, open: OpenOptions): Promise<Project> => {
    const schema = open.kinds === undefined || open.kinds.length === 0 ? LIBRARY_SCHEMA : pluginSchema(open.kinds);
    const { rows } = await pool.query<{ identity: string }>("SELECT oid::text AS identity FROM pg_database WHERE datname = current_database()");
    const domain = { server: vectorServerIdentity(pool), database: databaseOf(name), identity: rows[0]!.identity };
    const transactions = cache === undefined
      ? new PgTransactions(pool)
      : new Store(cache.backend(new PgBackend(pool), pool, JSON.stringify(domain)));
    const link = linkOf(name, meta?.["factory"]);
    let factory: Project | undefined;
    if (link.kind === "product") {
      try {
        factory = await openProject(link.factory, { create: false });
      } catch (error) {
        if (!(error instanceof ProjectGoneError)) throw error;
      }
    }
    const records = new ProjectRecords(transactions, schema, factory === undefined ? undefined : new SchemaRecords(factory.transactions, schema), open.system);
    await convertMemories(records, transactions);
    let circle: FactoryCircle<Project> | undefined;
    const work = new WorkModel(records);
    const flight = new WorkInFlight(records, work);
    const project: Project = {
      name,
      identity: domain.identity,
      pool,
      transactions,
      records,
      knowledge: new Knowledge(records, name, { embedder, vectors: new PgVectors(pool, vectorCache, domain) }),
      work,
      flight,
      health: new HealthRecord(records, work, flight),
      lineage: new ProjectLineage(pool, name),
      reach: (other) => circle!.reach(other),
      reachAll: () => circle!.reachAll(),
      async close() {
        await circle?.close();
        await factory?.close();
        await end(pool);
      },
    };
    circle = new FactoryCircle(project, (other) => openProject(other, { ...open, create: false }), listProjects);
    return project;
  };

  const openProject = (name: string, open: OpenOptions = {}): Promise<Project> =>
    track(async () => {
      checkName(name);
      const database = databaseOf(name);
      const create = open.create !== false;
      if (!(await exists(database, create))) throw new ProjectGoneError(name);
      const pool = poolFor(database);
      try {
        const meta = await setUp(pool, name, await readMeta(pool), { shared, schemaMerged: probe, warn: warnOnce });
        return await assemble(name, pool, meta, open);
      } catch (error) {
        await end(pool);
        if (!create && (dropping.has(database) || !(await exists(database, false).catch(() => true)))) throw new ProjectGoneError(name);
        throw error;
      }
    });

  return {
    openProject,
    listProjects,

    snapshot: (name) =>
      track(async () => {
        checkName(name);
        const pool = poolFor(databaseOf(name));
        try {
          return await takeSnapshot(pool, name);
        } finally {
          await end(pool);
        }
      }),

    async restore(name, snapshot) {
      const project = await openProject(name);
      try {
        await restoreSnapshot(project.pool, name, snapshot);
      } finally {
        await project.close();
      }
    },

    async dropProject(name) {
      checkName(name);
      const database = databaseOf(name);
      if (!(await exists(database, false))) throw new Error(`no project "${name}" on this server to delete`);
      dropping.add(database);
      try {
        await Promise.all([...pools].filter(([, held]) => held === database).map(([pool]) => end(pool)));
        let statement = `DROP DATABASE IF EXISTS ${quoted(database)} WITH (FORCE)`;
        for (;;) {
          try {
            await ask(statement);
            return;
          } catch (error) {
            if (sqlState(error) === "42501" && statement.endsWith("(FORCE)")) statement = `DROP DATABASE IF EXISTS ${quoted(database)}`;
            else throw error;
          }
        }
      } finally {
        dropping.delete(database);
      }
    },

    ownDatabase: (name, own = {}) =>
      track(async () => {
        await exists(name, true);
        const pool = poolFor(name);
        try {
          const tables = own.tables ?? [];
          if (tables.length === 0) return pool;
          const standing = shared ? standingOf(own.declaredIn, probe) : { merged: true as const };
          if (standing.merged) {
            for (const statement of tables) await pool.query(statement);
            return pool;
          }
          const { rows } = await pool.query<{ n: number }>("SELECT count(*)::int AS n FROM pg_tables WHERE schemaname = current_schema()");
          if (rows[0]!.n === 0) {
            throw new ConnectionError("config", `The database "${name}" has no tables yet, and the code declaring them is not merged, so a shared library sets none up: ${standing.why}`);
          }
          warnOnce(`own:${name}`, `storytree: the database "${name}" is not given this code's table statements, which are not merged: ${standing.why}`);
          return pool;
        } catch (error) {
          await end(pool);
          throw error;
        }
      }),

    close() {
      closing ??= (async () => {
        await Promise.allSettled([...inFlight]);
        await Promise.all([...pools.keys()].map(end));
        await server.close();
        cache?.close();
      })();
      return closing;
    },
  };
}
