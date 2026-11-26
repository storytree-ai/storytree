// Capability 1 · Project libraries
import { hostname } from "node:os";

import pg from "pg";
import type { Pool, PoolClient, PoolConfig } from "pg";

import { seconds, waitsOf, type PoolWaits } from "../records/index.js";
import { ConnectionError, sqlState } from "./connection-error.js";
import { countReads, lastWordsOf, processReaderName } from "./reads.js";

export const PROJECT_DATABASE_PREFIX = "storytree_";

export function projectDatabase(name: string): string {
  return PROJECT_DATABASE_PREFIX + name;
}

export type PoolFactory = (database: string, role?: string) => Pool;

export interface ServerAccess {
  readonly admin: Pool;
  readonly pool: PoolFactory;
  explain(error: unknown): unknown;
  close(): void;
}

export const CONNECT_TIMEOUT_MS = 10_000;

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

export function localServer(url: URL, givenTimeoutMs = CONNECT_TIMEOUT_MS, bounds: WaitBounds = {}, transport: Transport = loopbackTransport(url.hostname)): ServerAccess {
  const connectTimeoutMs = Math.max(givenTimeoutMs, urlConnectTimeoutMs(url));
  const { Pool: base, ...connection } = transport;
  const pool = (connectionString: string, role?: string) =>
    newPool({ connectionString, ...connection, connectionTimeoutMillis: connectTimeoutMs, ...statementBound(bounds), ...actingAs(role) }, base);
  return {
    admin: pool(url.href),
    pool: (database, role) => pool(databaseUrl(url, database), role),
    explain: (error) => explainConnectTimeout(error, connectTimeoutMs),
    close: () => {},
  };
}

function urlConnectTimeoutMs(url: URL): number {
  const seconds = Number(url.searchParams.get("connect_timeout") ?? "");
  return Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : 0;
}

export type Transport = Pick<PoolConfig, "Client" | "ssl"> & { readonly Pool?: typeof pg.Pool };

export function isLoopback(hostname: string): boolean {
  return ["127.0.0.1", "[::1]", "localhost"].includes(hostname);
}

function loopbackTransport(hostname: string): Transport {
  return isLoopback(hostname) ? { Client: LocalClient } : {};
}

interface PgClientInternals {
  readonly _connecting: boolean;
  readonly saslSession: unknown;
  _handleAuthSASLFinal(msg: unknown): void;
  _handleReadyForQuery(msg: unknown): void;
}

class LocalClient extends (pg.Client as unknown as new (...args: ConstructorParameters<typeof pg.Client>) => pg.Client & PgClientInternals) {
  #scramVerified = false;

  _handleAuthCleartextPassword(): void { this.#refuse("requested unsafe password authentication"); }
  _handleAuthMD5Password(): void { this.#refuse("requested unsafe password authentication"); }

  _handleAuthSASLFinal(msg: unknown): void {
    super._handleAuthSASLFinal(msg);
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

export interface WaitBounds {
  readonly statementTimeoutMs?: number;
  readonly waitMs?: number;
  readonly onWait?: (what: string) => void;
}

export type WaitingPoolConfig = PoolConfig & PoolWaits;

export function statementBound({ statementTimeoutMs, waitMs, onWait }: WaitBounds = {}): WaitingPoolConfig {
  return {
    ...(statementTimeoutMs === undefined ? {} : { statement_timeout: statementTimeoutMs }),
    ...(waitMs === undefined ? {} : { waitMs }),
    ...(onWait === undefined ? {} : { onWait }),
  };
}

export function actingAs(role: string | undefined): PoolConfig {
  return role === undefined ? {} : { options: `-c role=${role.replace(/[\\ ]/g, (c) => `\\${c}`)}` };
}

const RESET_TRIES = 5;

export const IDLE_IN_TRANSACTION_MS = 10_000;

export function newPool(config: WaitingPoolConfig, base: typeof pg.Pool = pg.Pool): Pool {
  const pool = new (slotWaiting(base))({ application_name: clientName(), idle_in_transaction_session_timeout: IDLE_IN_TRANSACTION_MS, ...config });
  pool.on("error", () => {});
  pool.on("connect", (client) => {
    client.on("error", () => {});
    countReads(client);
  });
  return pool;
}

function clientName(): string {
  const reader = processReaderName().replace(/[^\w. -]/g, "").replace(/ +/g, " ").trim().slice(0, 32);
  return ["storytree", hostname().replace(/[^\w.-]/g, "").slice(0, 24), String(process.pid), reader]
    .filter(Boolean)
    .join(" ")
    .slice(0, 63);
}

type ConnectCallback = (error: Error | undefined, client: PoolClient | undefined, done: (release?: unknown) => void) => void;

function slotWaiting(base: typeof pg.Pool): typeof pg.Pool {
  let made = slotWaitingPools.get(base);
  if (made === undefined) slotWaitingPools.set(base, made = slotWaitingPool(base));
  return made;
}

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

    override end(): Promise<void>;
    override end(callback: () => void): void;
    override end(callback?: () => void): Promise<void> | void {
      const last = lastWordsOf(this);
      const ended = (last === undefined ? Promise.resolve() : last().then(() => {}, () => {})).then(() => super.end());
      if (callback === undefined) return ended;
      ended.then(() => callback(), () => callback());
    }

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

function errorCode(error: unknown): unknown {
  return typeof error === "object" && error !== null ? (error as { code?: unknown }).code : undefined;
}

export function databaseUrl(server: URL, database: string): string {
  const url = new URL(server.href);
  url.pathname = `/${encodeURIComponent(database)}`;
  return url.href;
}
