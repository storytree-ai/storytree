/**
 * How storytree reaches a Postgres server: the seam between where the server is (a postgres://
 * URL, or a Cloud SQL instance reached with Google sign-in, capability 8) and what storytree does
 * there (capability 1). Wherever the server is, every database on it is reached through a pool its
 * PoolFactory makes.
 */
import { hostname } from "node:os";
import { basename } from "node:path";

import pg from "pg";
import type { Pool, PoolClient, PoolConfig } from "pg";

import { ConnectionError, sqlState } from "./connection-error.js";

/**
 * Makes a connection pool for one database on the server; with `role`, every connection in it acts
 * as that role (a startup `role` setting), so what it creates belongs to the role, not the account.
 */
export type PoolFactory = (database: string, role?: string) => Pool;

/** One Postgres server, as storytree reaches it. */
export interface ServerAccess {
  /** What kind of server it is, for the messages that say what to fix. */
  readonly kind: "postgres" | "cloud-sql";
  /** A pool on the server's own database, used only to create and list project databases. */
  readonly admin: Pool;
  /** Makes the pool for one database on the server: a project's. */
  readonly pool: PoolFactory;
  /**
   * A failure to reach or use the server, as a ConnectionError saying what to fix when it is one
   * this server knows how to explain; any other error as it is.
   */
  explain(error: unknown): unknown;
  /** Release what reaching the server holds besides its pools (the Cloud SQL connector). */
  close(): void;
}

/**
 * The server at a postgres:// URL. Its own database (the URL's) is the admin pool's, and each
 * project's pool is the same URL with the database swapped: user, host, port and options stay.
 * Each new handshake has a deadline, including the project's own pool. Timeouts say what to
 * check; other failures are left as they are. Database-creation privileges are explained where
 * databases are created, on either kind of server.
 */
export function localServer(url: URL, connectTimeoutMs = 3_000, statementTimeoutMs?: number): ServerAccess {
  const pool = (connectionString: string, role?: string) =>
    newPool({ connectionString, connectionTimeoutMillis: connectTimeoutMs, ...statementBound(statementTimeoutMs), ...actingAs(role) });
  return {
    kind: "postgres",
    admin: pool(url.href),
    pool: (database, role) => pool(databaseUrl(url, database), role),
    explain: (error) => {
      if (error instanceof Error && /timeout expired|timeout exceeded when trying to connect|Connection terminated due to connection timeout/i.test(error.message)) {
        return new ConnectionError(
          "timeout",
          `storytree isn't reachable: its database did not answer within ${connectTimeoutMs / 1000} seconds. Check that the storytree app is responding, then try again.`,
          error,
        );
      }
      return error;
    },
    close: () => {},
  };
}

/** The pg config that has the server end each of a connection's statements still running after `ms`, or none. */
export function statementBound(ms: number | undefined): PoolConfig {
  return ms === undefined ? {} : { statement_timeout: ms };
}

/** The pg config that makes each connection act as `role` from its start, or none. */
export function actingAs(role: string | undefined): PoolConfig {
  // A startup option: backslash-escape what libpq's option parser would split on.
  return role === undefined ? {} : { options: `-c role=${role.replace(/[\\ ]/g, (c) => `\\${c}`)}` };
}

/**
 * How long a pool keeps asking for a connection the server refused for want of a free slot
 * (SQLSTATE 53300: too many clients, or the slots left are reserved) before it passes the refusal
 * on. A server shared by parallel sessions frees a slot within seconds as their idle connections
 * close, so a call waits through the rush rather than failing in it.
 */
const SLOT_WAIT_MS = 30_000;

/**
 * How many times a pool asks again when the server resets a connection while it is being opened.
 * On Windows, Postgres can reset the socket before its refusal for want of a slot reaches pg,
 * which then reports only `read ECONNRESET` (seen on GitHub's Windows runners, 2026-10-01). A reset
 * cannot say why, so it is asked through a few times, a few seconds at most, not the whole wait: a
 * server that resets every connection, or a login it turns down, still fails within seconds.
 */
const RESET_TRIES = 5;

/**
 * A pool for `config`, whose connections wait for a free slot on the server rather than fail for
 * want of one, and each name the machine and process holding it unless `config` names them.
 */
export function newPool(config: PoolConfig): Pool {
  const pool = new SlotWaitingPool({ application_name: CLIENT_NAME, ...config });
  // An idle connection that drops (a server restart, a dropped database) is discarded by the pool
  // and the next query reconnects or fails loudly. Without a listener Node would crash instead.
  pool.on("error", () => {});
  return pool;
}

/**
 * What each connection is called on the server (Postgres's application_name): storytree, the
 * machine, the process id and the script it runs, so a server whose slots run out shows who holds
 * them (pg_stat_activity). Nothing secret; letters, digits, dots, dashes and underscores only, and
 * cut to the 63 characters Postgres keeps.
 */
const CLIENT_NAME = ["storytree", hostname(), String(process.pid), basename(process.argv[1] ?? "")]
  .map((part, i) => part.replace(/[^\w.-]/g, "").slice(0, i === 1 ? 24 : 32))
  .filter(Boolean)
  .join(" ")
  .slice(0, 63);

type ConnectCallback = (error: Error | undefined, client: PoolClient | undefined, done: (release?: unknown) => void) => void;

/**
 * A pg pool that asks again, backing off, when the server refuses a new connection for want of a
 * slot, or (a few times) resets one while it is being opened. Each attempt goes back through the pool, so a connection another of its calls hands back
 * meanwhile is taken first. pool.query() reaches the server through connect() too.
 */
class SlotWaitingPool extends pg.Pool {
  override connect(): Promise<PoolClient>;
  override connect(callback: ConnectCallback): void;
  override connect(callback?: ConnectCallback): Promise<PoolClient> | void {
    const connecting = this.#connectWaiting();
    if (callback === undefined) return connecting;
    connecting.then(
      (client) => callback(undefined, client, (release) => client.release(release as Error | boolean | undefined)),
      (error: Error) => callback(error, undefined, () => {}),
    );
  }

  async #connectWaiting(): Promise<PoolClient> {
    const giveUpAt = Date.now() + SLOT_WAIT_MS;
    let resets = 0;
    for (let pause = 50; ; pause = Math.min(pause * 2, 2_000)) {
      try {
        return await super.connect();
      } catch (error) {
        const reset = errorCode(error) === "ECONNRESET" && ++resets <= RESET_TRIES;
        if ((sqlState(error) !== "53300" && !reset) || Date.now() + pause > giveUpAt) throw error;
        await new Promise((resolve) => setTimeout(resolve, pause * (0.5 + Math.random())));
      }
    }
  }
}

/** The code Node or pg gives an error, if any. */
function errorCode(error: unknown): unknown {
  return typeof error === "object" && error !== null ? (error as { code?: unknown }).code : undefined;
}

/** The server URL with its database swapped for `database`; user, host, port and options stay. */
function databaseUrl(server: URL, database: string): string {
  const url = new URL(server.href);
  url.pathname = `/${encodeURIComponent(database)}`;
  return url.href;
}
