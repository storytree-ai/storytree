/**
 * Capability 15 · Connection by address, ADR-1093 D2: a library at a wss:// address, reached over
 * HTTPS where nothing but HTTPS gets out (a cloud session's container). Its connections are Neon's
 * WebSocket driver, `wss://<host>/v1?address=127.0.0.1:5432`: Cloudflare Access in front, checking the
 * service token the request carries; a tunnel to wsproxy on the library's box; Postgres on that box's
 * loopback, which is the only address wsproxy will reach. When HTTPS_PROXY is set, every socket is
 * opened through it with CONNECT.
 *
 * The outer TLS is checked against Node's authorities (ADR-0997 D1), and is all the TLS there is: the
 * driver never speaks Postgres's own, so an address asking for sslmode or sslrootcert is refused rather
 * than let it seem honoured. Cloudflare sees what goes inside, so the password goes by SCRAM alone,
 * never in plain text nor as an MD5 answer, and is never sent before the server asks (the driver's
 * pipelined connect would). What the spike found and why each choice is made: research_2dd40286e14b.
 */
import { Client as NeonClient, Pool as NeonPool } from "@neondatabase/serverless";
import { resolveKey } from "@storytree/keys";
import { HttpsProxyAgent } from "https-proxy-agent";
import type pg from "pg";
import WebSocket from "ws";

import { ConnectionError } from "./connection-error.js";
import type { Transport } from "./server.js";

/** The keys the Access service token is read from, and the variables each falls back on. */
export const ACCESS_KEYS = { id: ["cf-access-client-id", "CF_ACCESS_CLIENT_ID"], secret: ["cf-access-client-secret", "CF_ACCESS_CLIENT_SECRET"] } as const;

/** Where wsproxy, on the library's box, carries each connection: its Postgres, and nothing else (ADR-1093 D3). */
const BACKEND = "127.0.0.1:5432";

/** Connection-string settings that choose Postgres's own TLS, which a wss:// address has none of. */
const TLS_PARAM = /^(ssl|uselibpqcompat)/i;

/**
 * The transport for the wss:// address `url`: Neon's pool and a client that carries the Access token
 * through HTTPS_PROXY. Refused when the address asks for TLS settings or the token is not saved.
 * `ca`, for tests alone, is an authority trusted besides Node's.
 */
export function webSocketTransport(url: URL, ca?: string): Transport {
  const tls = [...url.searchParams.keys()].find((key) => TLS_PARAM.test(key));
  if (tls !== undefined) {
    throw new ConnectionError("config", `The library's address ${url.href} sets ${tls}, but a wss:// library has no TLS of Postgres's own: its TLS is the HTTPS connection's, checked against this computer's authorities. Take ${tls} out.`);
  }
  const headers = { "CF-Access-Client-Id": accessKey("id"), "CF-Access-Client-Secret": accessKey("secret") };
  const proxy = process.env.HTTPS_PROXY || process.env.https_proxy || undefined;
  const host = url.host;
  const AccessWebSocket = accessWebSocket(headers, proxy, host, ca);

  class WebSocketClient extends NeonClient {
    constructor(config?: ConstructorParameters<typeof NeonClient>[0]) {
      super(config);
      // This client's own settings, not the driver's shared ones, so no other pool in the process changes.
      this.neonConfig.webSocketConstructor = AccessWebSocket;
      this.neonConfig.wsProxy = () => `${host}/v1?address=${BACKEND}`;
      this.neonConfig.pipelineConnect = false;
      // The driver's pg declares its password handlers as properties: they are replaced on each client.
      this._handleAuthCleartextPassword = () => this.#refuse("in plain text");
      (this as unknown as { _handleAuthMD5Password: () => void })._handleAuthMD5Password = () => this.#refuse("as an MD5 answer");
    }

    #refuse(how: string): void {
      const stream = this.connection.stream as unknown as { emit(event: "error", error: Error): void; destroy(): void };
      stream.emit("error", new ConnectionError(
        "untrusted-server",
        `The library's server asked for the password ${how}, so storytree did not send it: over a wss:// address it goes by SCRAM alone. Configure that server to use scram-sha-256 password authentication.`,
      ));
      stream.destroy();
    }
  }

  // The driver's pool puts its own client in place of the one it is given, so this one is put back after it.
  class WebSocketPool extends NeonPool {
    constructor(options?: ConstructorParameters<typeof NeonPool>[0]) {
      super(options);
      this.Client = WebSocketClient;
    }
  }
  return { Pool: WebSocketPool as unknown as typeof pg.Pool };
}

/** The postgres:// form of the wss:// address `url`, for the pool's own settings: its user, host, database and options. */
export function postgresForm(url: URL): URL {
  return new URL(`postgres://${url.username}@${url.host}${url.pathname}${url.search}`);
}

/** The Access token's `part`, or the refusal saying where to save it. */
function accessKey(part: keyof typeof ACCESS_KEYS): string {
  const [key, variable] = ACCESS_KEYS[part];
  const value = resolveKey(key, { variable });
  if (value === undefined) {
    throw new ConnectionError(
      "access",
      `A wss:// library is reached through Cloudflare Access, and its service token's ${part === "id" ? "client id" : "client secret"} is not set: ` +
        `set ${variable}, or save it once with \`storytree auth set ${key}\`, then try again.`,
    );
  }
  return value;
}

/**
 * A WebSocket that carries `headers` and goes through `proxy` when there is one. The driver builds it
 * from a URL alone. A refused upgrade is said as the hop that refused it: the proxy's CONNECT, or the
 * gate (Access) behind it, which ws alone reports alike.
 */
function accessWebSocket(headers: Record<string, string>, proxy: string | undefined, host: string, ca: string | undefined): typeof WebSocket {
  return class AccessWebSocket extends WebSocket {
    readonly #connectStatus: () => number | undefined;

    constructor(address: string | URL, protocols?: string | string[]) {
      const agent = proxy === undefined ? undefined : new HttpsProxyAgent(proxy);
      let status: number | undefined;
      agent?.on("proxyConnect", (connect: { statusCode: number }) => { status = connect.statusCode; });
      super(address, protocols, { headers, ...(agent === undefined ? {} : { agent }), ...(ca === undefined ? {} : { ca }) });
      this.#connectStatus = () => status;
    }

    // The driver listens with addEventListener, which would hand it an ErrorEvent without the error's code: it is given the error itself.
    override addEventListener(...args: Parameters<WebSocket["addEventListener"]>): void {
      const [type, listener] = args;
      if (type !== "error" || typeof listener !== "function") return super.addEventListener(...args);
      this.on("error", (error: Error) => (listener as unknown as (error: Error) => void)(this.#said(error)));
    }

    #said(error: Error): Error {
      const refused = /^Unexpected server response: (\d+)/.exec(error.message);
      if (refused === null) return error;
      const through = this.#connectStatus();
      if (proxy !== undefined && through !== 200) {
        return new ConnectionError(
          "unreachable",
          `The proxy this computer's HTTPS_PROXY names refused to connect to ${host} (HTTP ${through ?? refused[1]}): add that host to what the proxy allows (a cloud environment's Allowed domains), then try again.`,
          error,
        );
      }
      return new ConnectionError(
        "access",
        `${host} refused the connection (HTTP ${refused[1]}): Cloudflare Access did not let it through. Check that CF_ACCESS_CLIENT_ID and CF_ACCESS_CLIENT_SECRET ` +
          "(or the keys cf-access-client-id and cf-access-client-secret) are a service token the library's Access application allows.",
        error,
      );
    }
  } as unknown as typeof WebSocket;
}
