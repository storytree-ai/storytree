/**
 * Capability 1 · Project libraries. How storytree reaches a Postgres server: the seam between where the server is (a postgres://
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

/** How long a fresh handshake to a server at a postgres:// URL may take unless the caller gives another (ADR-1163 D1). */
export const CONNECT_TIMEOUT_MS = 10_000;

/**
 * `error` as a ConnectionError saying the database took longer than `connectTimeoutMs` to answer
 * when it is pg's word for a handshake past its deadline; any other error as it is. The one wording
 * for every caller that reaches a local server, so each says the same thing (ADR-1163 D1).
 */
export function explainConnectTimeout(error: unknown, connectTimeoutMs = CONNECT_TIMEOUT_MS): unknown {
  if (error instanceof Error && /timeout expired|timeout exceeded when trying to connect|Connection terminated due to connection timeout/i.test(error.message)) {
    return new ConnectionError(
      "timeout",
      `storytree isn't reachable: its database took longer than ${connectTimeoutMs / 1000} seconds to answer, and this computer may be busy. ` +
        "Check that the storytree app is responding, then try again.",
      error,
    );
  }
  return error;
}

/**
 * The server at a postgres:// URL. Its own database (the URL's) is the admin pool's, and each
 * project's pool is the same URL with the database swapped: user, host, port and options stay.
 * Each new handshake has a deadline (ten seconds unless given another), including the project's own
 * pool: room for a busy machine, short enough to report a database that is really down (ADR-1163
 * D1). Timeouts say what to check; other failures are left as they are. Database-creation
 * privileges are explained where databases are created, on either kind of server. A URL naming a longer connect_timeout (libpq's,
 * in seconds) gets that deadline instead: how a test run gives its throwaway server room on a loaded
 * machine without loosening the bound every other library keeps.
 */
export function localServer(url: URL, givenTimeoutMs = CONNECT_TIMEOUT_MS, bounds: WaitBounds = {}, transport: Transport = loopbackTransport(url.hostname)): ServerAccess {
  const connectTimeoutMs = Math.max(givenTimeoutMs, urlConnectTimeoutMs(url));
  const { Pool: base, ...connection } = transport;
  const pool = (connectionString: string, role?: string) =>
    newPool({ connectionString, ...connection, connectionTimeoutMillis: connectTimeoutMs, ...statementBound(bounds), ...actingAs(role) }, base);
  return {
    kind: "postgres",
    admin: pool(url.href),
    pool: (database, role) => pool(databaseUrl(url, database), role),
    explain: (error) => explainConnectTimeout(error, connectTimeoutMs),
    close: () => {},
  };
}

/** The connect_timeout a URL names, in milliseconds; 0 when it names none, or one that is not a positive number of seconds. */
function urlConnectTimeoutMs(url: URL): number {
  const seconds = Number(url.searchParams.get("connect_timeout") ?? "");
  return Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : 0;
}

/**
 * How every connection to a server is made: its client and, for a server that must prove who it is,
 * its TLS; or, for one reached over a WebSocket, the pool that reaches it (pg's, unless one is given).
 */
export type Transport = Pick<PoolConfig, "Client" | "ssl"> & { readonly Pool?: typeof pg.Pool };

/** Whether `hostname`, as a URL writes it, is this machine's loopback. */
export function isLoopback(hostname: string): boolean {
  return ["127.0.0.1", "[::1]", "localhost"].includes(hostname);
}

/** The transport for a server at `hostname` that says nothing else: loopback's downgrade refusal, or pg's own. */
function loopbackTransport(hostname: string): Transport {
  return isLoopback(hostname) ? { Client: LocalClient } : {};
}

/** The pg 8 Client internals LocalClient hooks, which pg's types leave out. */
interface PgClientInternals {
  readonly _connecting: boolean;
  readonly saslSession: unknown;
  _handleAuthSASLFinal(msg: unknown): void;
  _handleReadyForQuery(msg: unknown): void;
}

/**
 * A loopback port does not authenticate its listener. A replacement listener must never get the
 * installation password by asking for cleartext or an MD5 response. pg's Pool supports a custom
 * Client, but pg 8 has no authentication-method allowlist: override its two password handlers,
 * before either can resolve or send a password. Real SCRAM stays with pg, including its server
 * proof check. Nor may a listener skip authentication: with a password configured, the connection
 * is refused at ReadyForQuery, before any query is sent, unless SCRAM completed with a verified
 * server signature. Only a URL with no password, and no PGPASSWORD to fall back on (the test harness), reaches a
 * passwordless server.
 */
class LocalClient extends (pg.Client as unknown as new (...args: ConstructorParameters<typeof pg.Client>) => pg.Client & PgClientInternals) {
  #scramVerified = false;

  _handleAuthCleartextPassword(): void { this.#refuse("requested unsafe password authentication"); }
  _handleAuthMD5Password(): void { this.#refuse("requested unsafe password authentication"); }

  _handleAuthSASLFinal(msg: unknown): void {
    super._handleAuthSASLFinal(msg);
    // pg clears its session only once the server's signature checks out.
    this.#scramVerified = this.saslSession === null;
  }

  _handleReadyForQuery(msg: unknown): void {
    if (this._connecting && this.password && !this.#scramVerified) return this.#refuse("accepted the connection without SCRAM authentication");
    super._handleReadyForQuery(msg);
  }

  #refuse(what: string): void {
    this.connection.stream.destroy(new ConnectionError(
      "config",
      `The local database ${what}; SCRAM-SHA-256 is required with a password. Restart the storytree app and check its database authentication settings.`,
    ));
  }
}

/** How a caller bounds its connections' waits, and hears of them (ConnectOptions says each). */
export interface WaitBounds {
  readonly statementTimeoutMs?: number;
  readonly waitMs?: number;
  readonly onWait?: (what: string) => void;
}

/** A pool's pg config, with how long its calls wait (waitMs) and who hears of each wait (onWait). */
export type WaitingPoolConfig = PoolConfig & Pick<WaitBounds, "waitMs" | "onWait">;

/** The pg config for `bounds`: the server ends each statement still running at its bound; the pool waits and says so as `bounds` asks. */
export function statementBound({ statementTimeoutMs, waitMs, onWait }: WaitBounds = {}): WaitingPoolConfig {
  return {
    ...(statementTimeoutMs === undefined ? {} : { statement_timeout: statementTimeoutMs }),
    ...(waitMs === undefined ? {} : { waitMs }),
    ...(onWait === undefined ? {} : { onWait }),
  };
}

/** The pg config that makes each connection act as `role` from its start, or none. */
export function actingAs(role: string | undefined): PoolConfig {
  // A startup option: backslash-escape what libpq's option parser would split on.
  return role === undefined ? {} : { options: `-c role=${role.replace(/[\\ ]/g, (c) => `\\${c}`)}` };
}

/**
 * How long a pool keeps asking for a connection the server refused for want of a free slot
 * (SQLSTATE 53300: too many clients, or the slots left are reserved) before it passes the refusal
 * on, and how long a write waits for another session's to finish, unless the caller bounds it
 * (waitMs). A server shared by parallel sessions frees a slot within seconds as their idle
 * connections close, so a call waits through the rush rather than failing in it.
 */
export const WAIT_MS = 30_000;

/**
 * How long calls on `pool` wait, for a slot or for the write lock, and the caller's ear for each
 * wait: told once, as it starts, what the call waits for (seen 2026-10-07: commands on a full
 * storytree-pg waited minutes and said nothing).
 */
export function waitsOf(pool: Pool): { readonly waitMs: number; say(what: string): void } {
  const { waitMs, onWait } = pool.options as WaitingPoolConfig;
  return { waitMs: waitMs ?? WAIT_MS, say: (what) => onWait?.(what) };
}

/**
 * How many times a pool asks again when the server resets a connection while it is being opened.
 * On Windows, Postgres can reset the socket before its refusal for want of a slot reaches pg,
 * which then reports only `read ECONNRESET` (seen on GitHub's Windows runners, 2026-10-01). A reset
 * cannot say why, so it is asked through a few times, a few seconds at most, not the whole wait: a
 * server that resets every connection, or a login it turns down, still fails within seconds.
 */
const RESET_TRIES = 5;

/**
 * How long the server lets a library connection sit idle inside a transaction before it ends that
 * session. Every storytree transaction runs its statements back to back, so one idle this long
 * belongs to a client that is gone: a process killed, or a network cut, between its write and its
 * commit, whose write lock would otherwise block every other session until TCP keepalive notices,
 * hours later (friction_fb2ec81f0582: a cancelled CI own-health run held it for minutes).
 */
export const IDLE_IN_TRANSACTION_MS = 10_000;

/**
 * A pool for `config`, whose connections wait for a free slot on the server rather than fail for
 * want of one, each name the machine and process holding it unless `config` names them, and each
 * is ended by the server when left idle in a transaction (IDLE_IN_TRANSACTION_MS).
 */
export function newPool(config: WaitingPoolConfig, base: typeof pg.Pool = pg.Pool): Pool {
  const pool = new (slotWaiting(base))({ application_name: CLIENT_NAME, idle_in_transaction_session_timeout: IDLE_IN_TRANSACTION_MS, ...config });
  // An idle connection that drops (a server restart, a dropped database) is discarded by the pool
  // and the next query reconnects or fails loudly. Without a listener Node would crash instead.
  pool.on("error", () => {});
  // So is one a caller holds between queries, which the pool stops listening to while it is out:
  // the holder's next query fails instead.
  pool.on("connect", (client) => client.on("error", () => {}));
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
 * `base` (pg's pool, or one that reaches the server another way) as a pool that asks again, backing off, when the server refuses a new connection for want of a
 * slot, or (a few times) resets one while it is being opened. Each attempt goes back through the pool, so a connection another of its calls hands back
 * meanwhile is taken first. pool.query() reaches the server through connect() too.
 */
function slotWaiting(base: typeof pg.Pool): typeof pg.Pool {
  let made = slotWaitingPools.get(base);
  if (made === undefined) slotWaitingPools.set(base, made = slotWaitingPool(base));
  return made;
}

/** The slot-waiting pool made from each base pool, made once. */
const slotWaitingPools = new WeakMap<typeof pg.Pool, typeof pg.Pool>();

function slotWaitingPool(base: typeof pg.Pool): typeof pg.Pool {
  return class SlotWaitingPool extends base {
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

    /** When this pool last said it waits for a slot: it says so again only once that wait would have ended. */
    #saidAt = -Infinity;

    async #connectWaiting(): Promise<PoolClient> {
      const { waitMs, say } = waitsOf(this);
      const giveUpAt = Date.now() + waitMs;
      let resets = 0;
      for (let pause = 50; ; pause = Math.min(pause * 2, 2_000)) {
        try {
          return await super.connect();
        } catch (error) {
          const full = sqlState(error) === "53300";
          const reset = errorCode(error) === "ECONNRESET" && ++resets <= RESET_TRIES;
          if ((!full && !reset) || Date.now() + pause > giveUpAt) throw error;
          if (full && Date.now() - this.#saidAt > waitMs) {
            this.#saidAt = Date.now();
            say(`the library's server has no free connection slot (${(error as Error).message}); waiting up to ${seconds(waitMs)} for one`);
          }
          await new Promise((resolve) => setTimeout(resolve, pause * (0.5 + Math.random())));
        }
      }
    }
  };
}

/** `ms` as a person reads it: "30 s", "0.3 s". */
export function seconds(ms: number): string {
  return `${Math.round(ms / 100) / 10} s`;
}

/** The code Node or pg gives an error, if any. */
function errorCode(error: unknown): unknown {
  return typeof error === "object" && error !== null ? (error as { code?: unknown }).code : undefined;
}

/** The server URL with its database swapped for `database`; user, host, port and options stay. */
export function databaseUrl(server: URL, database: string): string {
  const url = new URL(server.href);
  url.pathname = `/${encodeURIComponent(database)}`;
  return url.href;
}
