// Capability 15 · Connection by address
import { X509Certificate } from "node:crypto";
import { readFileSync } from "node:fs";
import { checkServerIdentity, type TLSSocket } from "node:tls";

import { resolveKey } from "@storytree/keys";
import type pg from "pg";

import { ConnectionError, isUnreachable, LIBRARY_UNREACHABLE } from "./connection-error.js";
import { CONNECT_TIMEOUT_MS, deadlineOf, localRefusal, localServer, serve, type Server, type ServerOptions } from "./server.js";
import { bare, loopback, proxyFor, Tunnel } from "./websocket.js";

export type ConnectOptions = ({
  readonly url: string;
  readonly connectTimeoutMs?: number;
  readonly address?: undefined;
} | {
  readonly address: string;
  readonly connectTimeoutMs?: number;
  readonly url?: undefined;
}) & ServerOptions;

const GATEWAY_PATH = "/v1?address=127.0.0.1:5432";
const TOKEN_HELP = "set CF_ACCESS_CLIENT_ID and CF_ACCESS_CLIENT_SECRET, or save them with `storytree auth set cf-access-client-id` and `storytree auth set cf-access-client-secret`";

function checked(address: string): URL {
  const url = new URL(address);
  const wss = url.protocol === "wss:";
  for (const [key, value] of url.searchParams) {
    if (wss && (key === "sslmode" || key === "sslrootcert")) {
      throw new ConnectionError("config", "A wss:// library address takes its TLS from wss itself, so it names no sslmode or sslrootcert: take them out of the address.");
    }
    if (key === "sslrootcert" || key === "connect_timeout" || (key === "sslmode" && value === "verify-full")) continue;
    if (key === "host" || key === "hostaddr" || key === "port" || key.startsWith("ssl")) {
      throw new ConnectionError("config", `The library address asks for ${key}, which would weaken how storytree checks the server or change where it dials: take it out of the address.`);
    }
  }
  return url;
}

function password(): string {
  const saved = resolveKey("postgres");
  if (saved === undefined) {
    throw new ConnectionError("no-password", "There is no password saved for this library: save it with `storytree auth set postgres`, or set PGPASSWORD. Storytree never takes it from the address.");
  }
  return saved;
}

export function addressServer(address: string, connectTimeoutMs = CONNECT_TIMEOUT_MS, options: ServerOptions = {}, dial?: { readonly host: string; readonly port: number }, ca?: string): Server {
  const url = checked(address);
  const wss = url.protocol === "wss:";
  const secret = password();
  const hostname = bare(url.hostname);
  const remote = !loopback(hostname);
  const deadlineMs = deadlineOf(url, connectTimeoutMs);
  const pins = url.searchParams.get("sslrootcert");
  const trusted = pins !== null && pins !== "system" ? { ca: readFileSync(pins, "utf8") } : ca === undefined ? {} : { ca };
  let reach: Partial<pg.ClientConfig> = { ssl: remote ? { rejectUnauthorized: false, servername: hostname, ...trusted } : false };
  const pinned = (trusted.ca ?? "").split(/(?<=-----END CERTIFICATE-----)/).filter((pem) => pem.includes("BEGIN CERTIFICATE")).map((pem) => new X509Certificate(pem).raw);
  const secure = (socket: TLSSocket): Error | undefined => {
    if (socket.authorized) return undefined;
    const peer = socket.getPeerCertificate();
    if (pinned.some((raw) => raw.equals(peer.raw)) && checkServerIdentity(hostname, peer) === undefined) return undefined;
    const code = String(socket.authorizationError);
    return Object.assign(new Error(`the library's certificate was refused: ${code}`), { code });
  };
  if (wss) {
    const id = resolveKey("cf-access-client-id");
    const token = resolveKey("cf-access-client-secret");
    if (id === undefined || token === undefined) throw new ConnectionError("access", `Cloudflare Access guards ${url.host}, and storytree has no service token for it: ${TOKEN_HELP}.`);
    const proxy = proxyFor(url, process.env);
    const target = { url: `wss://${url.host}${GATEWAY_PATH}`, headers: { "cf-access-client-id": id, "cf-access-client-secret": token }, ...(ca === undefined ? {} : { ca }), ...(proxy === undefined ? {} : { proxy }) };
    reach = { ssl: false, stream: () => new Tunnel(target) };
  }
  const untrusted = (why: string, error: unknown) => new ConnectionError("untrusted-server", `The library at ${url.host} ${why}, so storytree sent it no password.`, error);
  const explain = (error: unknown): unknown => {
    if (error instanceof ConnectionError || !(error instanceof Error)) return error;
    const { code, hop, status } = error as Error & { code?: unknown; hop?: string; status?: number };
    if (hop === "proxy") return new ConnectionError("unreachable", `${LIBRARY_UNREACHABLE}: the proxy HTTPS_PROXY names would not reach ${url.host} (it answered ${status}).`, error);
    if (hop === "gate") return new ConnectionError("access", `Cloudflare Access at ${url.host} refused storytree's service token (it answered ${status}): ${TOKEN_HELP}.`, error);
    if (code === "28P01") return new ConnectionError("password", `The library at ${url.host} refused the password saved for it: save the right one with \`storytree auth set postgres\`.`, error);
    if (error.message === "The server does not support SSL connections") return untrusted("answered without TLS", error);
    if (code === "ERR_TLS_CERT_ALTNAME_INVALID") return untrusted(`presented a certificate for another name than ${hostname}`, error);
    if (typeof code === "string" && /CERT|SIGNATURE|ISSUER|SSL|TLS/.test(code)) return untrusted(`presented a certificate no authority storytree trusts has signed (${code})`, error);
    if (error.message === "timeout expired") return new ConnectionError("timeout", `The library at ${url.host} did not answer within ${deadlineMs / 1000} seconds.`, error);
    if (isUnreachable(error)) return new ConnectionError("unreachable", `${LIBRARY_UNREACHABLE}: could not reach the library at ${url.host}.`, error);
    return error;
  };
  return serve({
    admin: decodeURIComponent(url.pathname.slice(1)) || "postgres",
    config: (database) => ({
      user: decodeURIComponent(url.username),
      password: secret,
      database,
      host: dial?.host ?? hostname,
      port: dial?.port ?? Number(url.port || 5432),
      ...reach,
    }),
    deadlineMs,
    ...(remote && !wss ? { secure } : {}),
    refusal: remote
      ? (method) => method === "cleartext" ? new ConnectionError("untrusted-server", `The library at ${url.host} asks for the password in plain text, so storytree does not send it.`) : undefined
      : localRefusal(url.host, true),
    explain,
    resets: !wss,
  }, options);
}

export function serverOf(options: ConnectOptions): Server {
  if (options.address !== undefined && options.url !== undefined) throw new ConnectionError("config", "A library is reached by a url or by an address, not both: give one.");
  return options.address === undefined
    ? localServer(new URL(options.url), options.connectTimeoutMs, options)
    : addressServer(options.address, options.connectTimeoutMs, options);
}

export function connectionString(options: ConnectOptions, database?: string): string {
  const url = new URL(options.address ?? options.url);
  if (options.address !== undefined) {
    checked(options.address);
    if (url.protocol === "wss:") throw new ConnectionError("config", "A wss:// library is reached over a WebSocket, which psql cannot use, so it has no connection string.");
    url.password = password();
    if (!loopback(bare(url.hostname)) && !url.searchParams.has("sslmode")) url.searchParams.set("sslmode", "verify-full");
  }
  if (database !== undefined) url.pathname = `/${encodeURIComponent(database)}`;
  return url.href;
}
