// Capability 28 · Shared server
import { hostname } from "node:os";
import type { TLSSocket } from "node:tls";

import pg, { type Pool, type PoolClient } from "pg";

import { WRITE_LOCK } from "../../storage/store/index.js";
import { cannotCreateDatabases, ConnectionError, isInsufficientPrivilege, quoted, sqlState } from "./connection-error.js";
import { countReads, lastWordsOf, processReaderName } from "./reads.js";

export const CONNECT_TIMEOUT_MS = 10_000;

export function explainConnectTimeout(error: unknown, connectTimeoutMs: number = CONNECT_TIMEOUT_MS): unknown {
  if (error instanceof ConnectionError || !(error instanceof Error)) return error;
  if (!/timeout exceeded when trying to connect|timeout expired/i.test(error.message)) return error;
  return new ConnectionError("timeout", `The library did not answer within ${connectTimeoutMs / 1000} seconds.`, error);
}
const WAIT_MS = 30_000;
const IDLE_WRITER_MS = 10_000;
const TRY_LOCK = `${WRITE_LOCK.replace("pg_advisory_xact_lock", "pg_try_advisory_xact_lock")} AS got`;
const ACT_AS_OWNER = `SELECT set_config('role', pg_get_userbyid(datdba), false) FROM pg_database
  WHERE datname = current_database() AND pg_get_userbyid(datdba) <> session_user AND pg_has_role(session_user, datdba, 'SET')`;
const BORROWABLE = `SELECT session_user AS account, (SELECT rolname FROM pg_roles
  WHERE rolcreatedb AND pg_has_role(session_user, oid, 'SET') ORDER BY rolname COLLATE "C" LIMIT 1) AS creator`;

export interface ServerOptions {
  readonly statementTimeoutMs?: number;
  readonly waitMs?: number;
  readonly onWait?: (what: string) => void;
}

export interface Server {
  readonly admin: Pool;
  pool(database: string): Pool;
  explain(error: unknown): unknown;
  close(): Promise<void>;
}

export type Method = "cleartext" | "md5" | "none";

export interface Dialling {
  readonly admin: string;
  readonly config: (database: string) => pg.ClientConfig;
  readonly deadlineMs: number;
  readonly secure?: (socket: TLSSocket) => Error | undefined;
  readonly refusal: (method: Method) => ConnectionError | undefined;
  readonly explain: (error: unknown) => unknown;
  readonly resets: boolean;
}

type Internal = pg.Client & {
  _connecting: boolean;
  _handleErrorEvent(error: unknown): void;
  _handleReadyForQuery(message: unknown): void;
  _handleAuthCleartextPassword(message: unknown): void;
  _handleAuthMD5Password(message: unknown): void;
  _handleAuthSASLFinal(message: unknown): void;
};

const Base = pg.Client as unknown as new (config?: pg.ClientConfig) => Internal;

function applicationName(): string {
  return `storytree ${hostname().replace(/[^\w.-]/g, "").slice(0, 24)} ${process.pid} ${processReaderName()}`.slice(0, 63);
}

function sayWait(what: string): void {
  console.error(`storytree: ${what}`);
}

function seconds(ms: number): string {
  return String(ms / 1000);
}

export function deadlineOf(url: URL, connectTimeoutMs: number): number {
  const named = Number(url.searchParams.get("connect_timeout") ?? "") * 1000;
  return Number.isFinite(named) ? Math.max(connectTimeoutMs, named) : connectTimeoutMs;
}

export function localRefusal(where: string, secret: boolean): (method: Method) => ConnectionError | undefined {
  return (method) => {
    if (method === "none") {
      return secret ? new ConnectionError("config", `The local database at ${where} let storytree in without SCRAM, though its address carries a password, so storytree sends it nothing: it may not be the database you meant.`) : undefined;
    }
    return new ConnectionError("config", `The local database at ${where} asked for the password by ${method === "md5" ? "MD5" : "cleartext"}, and storytree gives a local database its password only by SCRAM, so it sent none: set the server's pg_hba.conf to scram-sha-256.`);
  };
}

function clientFor(dialling: Dialling, options: ServerOptions, owner: boolean): new (config?: pg.ClientConfig) => pg.Client {
  const waitMs = options.waitMs ?? WAIT_MS;
  return class extends Base {
    #refused = false;
    #scram = false;

    constructor(config: pg.ClientConfig = {}) {
      super({
        ...config,
        ...(config.password === undefined ? {} : { password: config.password }),
        connectionTimeoutMillis: dialling.deadlineMs,
        application_name: applicationName(),
        idle_in_transaction_session_timeout: IDLE_WRITER_MS,
        ...(options.statementTimeoutMs === undefined ? {} : { statement_timeout: options.statementTimeoutMs }),
      });
      this.connection.once("sslconnect", () => {
        const secured = this.connection.stream as TLSSocket;
        secured.once("secureConnect", () => {
          const refused = dialling.secure?.(secured);
          if (refused !== undefined) secured.destroy(refused);
        });
      });
      const query = this.query.bind(this) as (...args: unknown[]) => unknown;
      let acting: Promise<unknown> | undefined;
      this.query = ((...args: unknown[]) => {
        if (owner) acting ??= (query(ACT_AS_OWNER) as Promise<unknown>).then(() => undefined, () => undefined);
        const run = () => args.length === 1 && args[0] === WRITE_LOCK ? this.#lock(query) : query(...args);
        return acting === undefined ? run() : acting.then(run);
      }) as pg.Client["query"];
      countReads(this);
    }

    async #lock(query: (...args: unknown[]) => unknown): Promise<unknown> {
      const run = (text: string) => query(text) as Promise<pg.QueryResult<{ got?: boolean }>>;
      const tried = await run(TRY_LOCK);
      if (tried.rows[0]?.got === true) return tried;
      (options.onWait ?? sayWait)(`waiting for its turn to write: another session is writing to this project (for up to ${seconds(waitMs)} s)`);
      await run(`SET LOCAL lock_timeout = ${Math.ceil(waitMs)}`);
      try {
        const locked = await run(WRITE_LOCK);
        await run("SET LOCAL lock_timeout = DEFAULT");
        return locked;
      } catch (error) {
        if (sqlState(error) !== "55P03") throw error;
        throw new Error(`another session was still writing to this project after ${seconds(waitMs)} s, so this write gave up and wrote nothing: ${(error as Error).message}`, { cause: error });
      }
    }

    #refuses(method: Method): boolean {
      const refusal = dialling.refusal(method);
      if (refusal === undefined) return false;
      this.#refused = true;
      this._handleErrorEvent(refusal);
      this.connection.stream.destroy();
      return true;
    }

    override _handleAuthCleartextPassword(message: unknown): void {
      if (!this.#refuses("cleartext")) super._handleAuthCleartextPassword(message);
    }

    override _handleAuthMD5Password(message: unknown): void {
      if (!this.#refuses("md5")) super._handleAuthMD5Password(message);
    }

    override _handleAuthSASLFinal(message: unknown): void {
      this.#scram = true;
      super._handleAuthSASLFinal(message);
    }

    override _handleReadyForQuery(message: unknown): void {
      if (this.#refused || (this._connecting && !this.#scram && this.#refuses("none"))) return;
      super._handleReadyForQuery(message);
    }
  };
}

function busy(error: unknown, resets: boolean): boolean {
  return sqlState(error) === "53300" || (resets && (error as { code?: unknown }).code === "ECONNRESET");
}

function patient(pool: Pool, dialling: Dialling, options: ServerOptions): void {
  const connect = pool.connect.bind(pool) as () => Promise<PoolClient>;
  let waiting = 0;
  const waited = async (): Promise<PoolClient> => {
    const until = Date.now() + (options.waitMs ?? WAIT_MS);
    let pause = 50;
    let counted = false;
    try {
      for (;;) {
        try {
          return await connect();
        } catch (error) {
          if (!busy(error, dialling.resets) || Date.now() + pause > until) throw dialling.explain(error);
          if (!counted && waiting++ === 0) (options.onWait ?? sayWait)(`waiting for a connection slot on the library's server: ${(error as Error).message}`);
          counted = true;
          await new Promise((resolve) => setTimeout(resolve, pause));
          pause = Math.min(pause * 2, 1_000);
        }
      }
    } finally {
      if (counted) waiting--;
    }
  };
  pool.connect = ((callback?: (error: Error | undefined, client: PoolClient | undefined, done: (release?: unknown) => void) => void) => {
    if (callback === undefined) return waited();
    waited().then(
      (client) => callback(undefined, client, (release) => client.release(release as Error | boolean | undefined)),
      (error: Error) => callback(error, undefined, () => undefined),
    );
  }) as Pool["connect"];
}

export function serve(dialling: Dialling, options: ServerOptions): Server {
  const pools = new Set<Pool>();
  const open = (database: string, owner: boolean): Pool => {
    const pool = new pg.Pool({
      ...dialling.config(database),
      Client: clientFor(dialling, options, owner),
    });
    pool.on("error", () => undefined);
    pool.on("connect", (client) => client.on("error", () => undefined));
    patient(pool, dialling, options);
    const end = pool.end.bind(pool) as (...args: unknown[]) => Promise<void>;
    pool.end = ((...args: unknown[]) => {
      pools.delete(pool);
      const last = lastWordsOf(pool);
      return last === undefined ? end(...args) : last().then(() => end(...args), () => end(...args));
    }) as Pool["end"];
    pools.add(pool);
    return pool;
  };
  return {
    admin: open(dialling.admin, false),
    pool: (database) => open(database, true),
    explain: dialling.explain,
    close: async () => {
      await Promise.all([...pools].map((pool) => pool.end()));
    },
  };
}

export function localServer(url: URL, connectTimeoutMs = CONNECT_TIMEOUT_MS, options: ServerOptions = {}): Server {
  const base = new URL(url.href);
  const deadlineMs = deadlineOf(base, connectTimeoutMs);
  base.searchParams.delete("connect_timeout");
  return serve({
    admin: decodeURIComponent(base.pathname.slice(1)) || "postgres",
    config: (database) => {
      const at = new URL(base.href);
      at.pathname = `/${encodeURIComponent(database)}`;
      return { connectionString: at.href };
    },
    deadlineMs,
    refusal: localRefusal(base.host, base.password !== ""),
    explain: (error) => error instanceof Error && error.message === "timeout expired"
      ? new ConnectionError("timeout", `storytree isn't reachable: its database took longer than ${seconds(deadlineMs)} seconds to answer, and this computer may be busy. Check that the storytree app is responding, then try again.`, error)
      : error,
    resets: true,
  }, options);
}

export async function createDatabase(admin: Pool, database: string): Promise<void> {
  const statement = `CREATE DATABASE ${quoted(database)}`;
  const made = (error: unknown) => sqlState(error) === "42P04" || sqlState(error) === "23505";
  let refused: unknown;
  try {
    await admin.query(statement);
    return;
  } catch (error) {
    if (made(error)) return;
    if (!isInsufficientPrivilege(error)) throw error;
    refused = error;
  }
  const client = await admin.connect();
  try {
    const { rows } = await client.query<{ account: string; creator: string | null }>(BORROWABLE);
    const creator = rows[0]?.creator;
    if (creator === undefined || creator === null) throw cannotCreateDatabases(rows[0]?.account ?? "", refused);
    await client.query(`SET ROLE ${quoted(creator)}`);
    try {
      await client.query(statement);
    } catch (error) {
      if (!made(error)) throw error;
    } finally {
      await client.query("RESET ROLE");
    }
  } finally {
    client.release();
  }
}
