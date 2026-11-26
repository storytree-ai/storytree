// Capability 2 · Library transactions
import pg, { type Pool } from "pg";

import { SchemaRecords } from "../../storage/rules/index.js";
import { PgTransactions, STORE_TABLES, type HistoryEntry, type RecordEnvelope, type Transactions } from "../../storage/store/index.js";

export interface ConnectOptions {
  readonly url: string;
}

export interface Project {
  readonly name: string;
  readonly pool: Pool;
  readonly transactions: Transactions;
  readonly records: SchemaRecords;
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
  close(): Promise<void>;
}

export async function connect(options: ConnectOptions): Promise<Server> {
  const admin = new pg.Pool({ connectionString: options.url });
  const pools = new Set<Pool>();
  const poolFor = (name: string): Pool => {
    const url = new URL(options.url);
    url.pathname = `/${encodeURIComponent(`storytree_${name}`)}`;
    const pool = new pg.Pool({ connectionString: url.href });
    pools.add(pool);
    return pool;
  };
  const end = async (pool: Pool): Promise<void> => {
    if (pools.delete(pool)) await pool.end();
  };
  return {
    async openProject(name) {
      const database = `storytree_${name}`;
      const { rowCount } = await admin.query("SELECT 1 FROM pg_database WHERE datname = $1", [database]);
      if (rowCount === 0) {
        await admin.query(`CREATE DATABASE "${database.replaceAll('"', '""')}"`).catch((error: unknown) => {
          if ((error as { code?: unknown }).code !== "42P04") throw error;
        });
      }
      const pool = poolFor(name);
      for (const statement of STORE_TABLES) await pool.query(statement);
      const transactions = new PgTransactions(pool);
      return { name, pool, transactions, records: new SchemaRecords(transactions), close: () => end(pool) };
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
      await Promise.all([...pools].map(end));
      await admin.end();
    },
  };
}
