/**
 * How storytree reaches a Postgres server: the seam between where the server is (a postgres://
 * URL, or a Cloud SQL instance reached with Google sign-in, capability 8) and what storytree does
 * there (capability 1). Wherever the server is, every database on it is reached through a pool its
 * PoolFactory makes.
 */
import pg from "pg";
import type { Pool, PoolConfig } from "pg";

import { ConnectionError } from "./connection-error.js";

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
export function localServer(url: URL, connectTimeoutMs = 3_000): ServerAccess {
  const pool = (connectionString: string, role?: string) =>
    newPool({ connectionString, connectionTimeoutMillis: connectTimeoutMs, ...actingAs(role) });
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

/** The pg config that makes each connection act as `role` from its start, or none. */
export function actingAs(role: string | undefined): PoolConfig {
  // A startup option: backslash-escape what libpq's option parser would split on.
  return role === undefined ? {} : { options: `-c role=${role.replace(/[\\ ]/g, (c) => `\\${c}`)}` };
}

/** A pool for `config`. */
export function newPool(config: PoolConfig): Pool {
  const pool = new pg.Pool(config);
  // An idle connection that drops (a server restart, a dropped database) is discarded by the pool
  // and the next query reconnects or fails loudly. Without a listener Node would crash instead.
  pool.on("error", () => {});
  return pool;
}

/** The server URL with its database swapped for `database`; user, host, port and options stay. */
function databaseUrl(server: URL, database: string): string {
  const url = new URL(server.href);
  url.pathname = `/${encodeURIComponent(database)}`;
  return url.href;
}
