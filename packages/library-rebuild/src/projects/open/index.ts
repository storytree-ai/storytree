// Capability 2 · Library transactions
import path from "node:path";

import pg, { type Pool } from "pg";

import { convertMemories, Knowledge } from "../../knowledge/notes/index.js";
import { defaultEmbedder, modelsFolder, PgVectors, VECTOR_TABLES, vectorServerIdentity, type EmbedderSource } from "../../knowledge/search/index.js";
import { SchemaRecords } from "../../storage/rules/index.js";
import { PgTransactions, STORE_TABLES, type HistoryEntry, type RecordEnvelope, type Transactions } from "../../storage/store/index.js";

export interface ConnectOptions {
  readonly url: string;
}

export interface Seams {
  readonly embedder?: EmbedderSource;
  readonly vectorCache?: string | null;
}

export interface Project {
  readonly name: string;
  readonly identity: string;
  readonly pool: Pool;
  readonly transactions: Transactions;
  readonly records: SchemaRecords;
  readonly knowledge: Knowledge;
  close(): Promise<void>;
}

export interface ProjectSnapshot {
  format: "storytree-project-snapshot";
  version: 1;
  project: string;
  takenAt: string;
  records: RecordEnvelope[];
  history: HistoryEntry[];
}

export interface Server {
  openProject(name: string): Promise<Project>;
  snapshot(name: string): Promise<ProjectSnapshot>;
  restore(name: string, snapshot: ProjectSnapshot): Promise<void>;
  dropProject(name: string): Promise<void>;
  close(): Promise<void>;
}

export type Storytree = Server;

export async function connect(options: ConnectOptions, seams: Seams = {}): Promise<Server> {
  const embedder = seams.embedder ?? defaultEmbedder();
  const vectorCache = seams.vectorCache !== undefined ? seams.vectorCache : seams.embedder === undefined ? path.join(modelsFolder(process.env), "vectors.sqlite") : null;
  const admin = new pg.Pool({ connectionString: options.url });
  const pools = new Map<Pool, string>();
  let closing: Promise<void> | undefined;
  const poolFor = (name: string): Pool => {
    const url = new URL(options.url);
    url.pathname = `/${encodeURIComponent(`storytree_${name}`)}`;
    const pool = new pg.Pool({ connectionString: url.href });
    pools.set(pool, name);
    return pool;
  };
  const end = async (pool: Pool): Promise<void> => {
    if (pools.delete(pool)) await pool.end();
  };
  const server: Server = {
    async openProject(name) {
      const database = `storytree_${name}`;
      const { rowCount } = await admin.query("SELECT 1 FROM pg_database WHERE datname = $1", [database]);
      if (rowCount === 0) {
        await admin.query(`CREATE DATABASE "${database.replaceAll('"', '""')}"`).catch((error: unknown) => {
          if ((error as { code?: unknown }).code !== "42P04") throw error;
        });
      }
      const pool = poolFor(name);
      for (const statement of [...STORE_TABLES, ...VECTOR_TABLES]) await pool.query(statement);
      const { rows } = await pool.query<{ identity: string }>("SELECT oid::text AS identity FROM pg_database WHERE datname = current_database()");
      const identity = rows[0]!.identity;
      const transactions = new PgTransactions(pool);
      const records = new SchemaRecords(transactions);
      await convertMemories(records, transactions);
      const vectors = new PgVectors(pool, vectorCache, { server: vectorServerIdentity(pool), database, identity });
      const knowledge = new Knowledge(records, name, { embedder, vectors });
      return { name, identity, pool, transactions, records, knowledge, close: () => end(pool) };
    },
    async restore(name, snapshot) {
      const project = await server.openProject(name);
      try {
        const { rows } = await project.pool.query("SELECT 1 FROM record UNION ALL SELECT 1 FROM record_event LIMIT 1");
        if (rows.length > 0) throw new Error(`project ${name} already holds records or history: a snapshot is restored only into an empty project`);
        const client = await project.pool.connect();
        try {
          await client.query("BEGIN");
          for (const record of snapshot.records) {
            await client.query("INSERT INTO record (id, type, version, fields, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6)",
              [record.id, record.type, record.version, JSON.stringify(record.fields), record.createdAt, record.updatedAt]);
          }
          for (const entry of snapshot.history) {
            await client.query(
              "INSERT INTO record_event (seq, record_id, type, action, record, reason, actor, at, recorded_by) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, coalesce($9, session_user))",
              [entry.seq, entry.recordId, entry.type, entry.action, JSON.stringify(entry.record), entry.reason ?? null, entry.actor ?? null, entry.at, entry.recordedBy ?? null]);
          }
          await client.query("SELECT setval(pg_get_serial_sequence('record_event', 'seq'), coalesce((SELECT max(seq) FROM record_event), 1), (SELECT count(*) > 0 FROM record_event))");
          await client.query("COMMIT");
        } catch (error) {
          await client.query("ROLLBACK");
          throw error;
        } finally {
          client.release();
        }
      } finally {
        await project.close();
      }
    },
    async dropProject(name) {
      const database = `storytree_${name}`;
      const { rowCount } = await admin.query("SELECT 1 FROM pg_database WHERE datname = $1", [database]);
      if (rowCount === 0) throw new Error(`no project ${name} to drop`);
      await Promise.all([...pools].filter(([, project]) => project === name).map(([pool]) => end(pool)));
      await admin.query(`DROP DATABASE "${database.replaceAll('"', '""')}" WITH (FORCE)`);
    },
    async snapshot(name) {
      const pool = poolFor(name);
      try {
        const store = new PgTransactions(pool);
        const history = await store.history();
        const { rows } = await pool.query<{ type: string }>("SELECT DISTINCT type FROM record");
        const records = await store.list(rows.map((row) => row.type));
        return { format: "storytree-project-snapshot", version: 1, project: name, takenAt: new Date().toISOString(), records, history };
      } finally {
        await end(pool);
      }
    },
    async close() {
      closing ??= (async () => {
        await Promise.all([...pools.keys()].map(end));
        await admin.end();
      })();
      await closing;
    },
  };
  return server;
}
