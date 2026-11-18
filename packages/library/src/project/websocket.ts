// Capability 15 · Connection by address
import { isIPv4 } from "node:net";

import { Client as NeonClient, Pool as NeonPool } from "@neondatabase/serverless";
import { resolveKey } from "@storytree/keys";
import { HttpsProxyAgent } from "https-proxy-agent";
import type pg from "pg";
import WebSocket from "ws";

import { ConnectionError } from "./connection-error.js";
import type { Transport } from "./server.js";

export const ACCESS_KEYS = { id: ["cf-access-client-id", "CF_ACCESS_CLIENT_ID"], secret: ["cf-access-client-secret", "CF_ACCESS_CLIENT_SECRET"] } as const;

const BACKEND = "127.0.0.1:5432";

const TLS_PARAM = /^(ssl|uselibpqcompat)/i;

export function webSocketTransport(url: URL, ca?: string): Transport {
  const tls = [...url.searchParams.keys()].find((key) => TLS_PARAM.test(key));
  if (tls !== undefined) {
    throw new ConnectionError("config", `The library's address ${url.href} sets ${tls}, but a wss:// library has no TLS of Postgres's own: its TLS is the HTTPS connection's, checked against this computer's authorities. Take ${tls} out.`);
  }
  const headers = { "CF-Access-Client-Id": accessKey("id"), "CF-Access-Client-Secret": accessKey("secret") };
  const proxy = proxyFor(url);
  const host = url.host;
  const AccessWebSocket = accessWebSocket(headers, proxy, host, ca);

  class WebSocketClient extends NeonClient {
    constructor(config?: ConstructorParameters<typeof NeonClient>[0]) {
      super(config);
      this.neonConfig.webSocketConstructor = AccessWebSocket;
      this.neonConfig.wsProxy = () => `${host}/v1?address=${BACKEND}`;
      this.neonConfig.pipelineConnect = false;
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

  class WebSocketPool extends NeonPool {
    constructor(options?: ConstructorParameters<typeof NeonPool>[0]) {
      super(options);
      this.Client = WebSocketClient;
    }
  }
  return { Pool: WebSocketPool as unknown as typeof pg.Pool };
}

export function proxyFor(url: URL, env: NodeJS.ProcessEnv = process.env): string | undefined {
  const proxy = env.HTTPS_PROXY || env.https_proxy || undefined;
  if (proxy === undefined) return undefined;
  const host = bare(url.hostname);
  if (loopback(host)) return undefined;
  const port = url.port || "443";
  const named = (env.NO_PROXY || env.no_proxy || "").split(",").map((entry) => entry.trim().toLowerCase()).filter((entry) => entry !== "");
  return named.some((entry) => covers(entry, host, port)) ? undefined : proxy;
}

function covers(entry: string, host: string, port: string): boolean {
  if (entry === "*") return true;
  const ported = /^(\[[^\]]+\]|[^:]+):(\d+)$/.exec(entry);
  if (ported !== null && ported[2] !== port) return false;
  const name = bare(ported === null ? entry : ported[1]!).replace(/^\*?\./, "");
  return host === name || host.endsWith(`.${name}`);
}

function bare(hostname: string): string {
  return hostname.toLowerCase().replace(/^\[(.*)\]$/, "$1").replace(/\.$/, "");
}

function loopback(host: string): boolean {
  if (host === "localhost" || host.endsWith(".localhost") || host === "::1") return true;
  return isIPv4(host) && host.startsWith("127.");
}

export function postgresForm(url: URL): URL {
  return new URL(`postgres://${url.username}@${url.host}${url.pathname}${url.search}`);
}

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
