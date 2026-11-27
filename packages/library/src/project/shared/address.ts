// Capability 28 · Shared library
import { readFileSync } from "node:fs";
import { isIP } from "node:net";
import { X509Certificate } from "node:crypto";
import { checkServerIdentity, rootCertificates, type ConnectionOptions, type TLSSocket } from "node:tls";

import { resolveKey } from "@storytree/keys";
import pg from "pg";

import { ConnectionError, sqlState } from "./connection-error.js";
import { databaseUrl, isLoopback, localServer, type ServerAccess, type Transport, type WaitBounds } from "./server.js";
import { postgresForm, webSocketTransport } from "./websocket.js";

export type ConnectOptions = (
  | {
      readonly url: string;
      readonly connectTimeoutMs?: number;
      readonly address?: undefined;
    }
  | {
      readonly address: string;
      readonly connectTimeoutMs?: number;
      readonly url?: undefined;
    }
) & {
  readonly statementTimeoutMs?: number;
  readonly waitMs?: number;
  readonly onWait?: (what: string) => void;
};

export const PASSWORD_KEY = "postgres";

const TIMEOUT_MS = 20_000;

const UNREACHABLE = new Set(["ECONNREFUSED", "ENOTFOUND", "EAI_AGAIN", "EHOSTUNREACH", "ENETUNREACH", "ETIMEDOUT", "ECONNRESET"]);

const PG_CONNECT_TIMEOUT = /timeout expired|timeout exceeded when trying to connect|Connection terminated due to connection timeout/i;

const ENDPOINT_PARAMS = ["host", "hostaddr", "port"];

const TLS_PARAM = /^(ssl|uselibpqcompat)/i;
const REMOTE_TLS_PARAMS = ["sslmode", "sslrootcert"];

export function addressServer(address: string, connectTimeoutMs = TIMEOUT_MS, bounds: WaitBounds = {}, dialVia?: { readonly host: string; readonly port: number }, ca?: string): ServerAccess {
  const url = checkedAddress(address);
  if (url.protocol === "wss:") {
    const transport = webSocketTransport(url, ca);
    const server = localServer(withPassword(postgresForm(url)), connectTimeoutMs, bounds, transport);
    return { ...server, explain: (error) => explain(error, url, connectTimeoutMs) };
  }
  const transport = isLoopback(url.hostname) ? undefined : remoteTransport(url);
  const signedIn = withPassword(url);
  if (transport !== undefined) for (const key of [...signedIn.searchParams.keys()]) if (TLS_PARAM.test(key)) signedIn.searchParams.delete(key);
  if (dialVia !== undefined) [signedIn.hostname, signedIn.port] = [dialVia.host, String(dialVia.port)];
  const server = localServer(signedIn, connectTimeoutMs, bounds, transport);
  return { ...server, explain: (error) => explain(error, url, connectTimeoutMs) };
}

export function connectionString(options: ConnectOptions, database?: string): string {
  if (options.address !== undefined && checkedAddress(options.address).protocol === "wss:") {
    throw new ConnectionError("config", "The library is reached over a WebSocket (a wss:// address), which psql cannot speak: there is no postgres:// connection string to hand on.");
  }
  const url = options.address === undefined ? new URL(options.url) : withPassword(checkedAddress(options.address));
  if (options.address !== undefined && !isLoopback(url.hostname)) {
    url.searchParams.set("sslmode", "verify-full");
    if (!url.searchParams.has("sslrootcert")) url.searchParams.set("sslrootcert", "system");
  }
  return database === undefined ? url.href : databaseUrl(url, database);
}

function withPassword(url: URL): URL {
  const password = resolveKey(PASSWORD_KEY);
  if (password === undefined) {
    throw new ConnectionError(
      "no-password",
      `There is no password saved for this library (${shown(url)}). Save it once with \`storytree auth set ${PASSWORD_KEY}\` ` +
        "(or point that key at your own store with `!<command>`), or set PGPASSWORD, then try again.",
    );
  }
  const signedIn = new URL(url.href);
  signedIn.password = password;
  return signedIn;
}

function remoteTransport(url: URL): Transport {
  for (const key of url.searchParams.keys()) {
    if (TLS_PARAM.test(key) && !REMOTE_TLS_PARAMS.includes(key)) {
      throw new ConnectionError("config", `The library's address ${shown(url)} sets ${key}: a remote library is reached over TLS that checks its certificate, set by nothing but sslmode=verify-full and sslrootcert. Take ${key} out.`);
    }
  }
  const mode = url.searchParams.get("sslmode");
  if (mode !== null && mode !== "verify-full") {
    throw new ConnectionError("config", `The library's address ${shown(url)} sets sslmode=${mode}: a remote library's certificate is always checked (sslmode=verify-full). Take sslmode out, or set it to verify-full.`);
  }
  const rootFile = url.searchParams.get("sslrootcert");
  let ca: string | string[];
  let pins: X509Certificate[] | undefined;
  try {
    ca = rootFile === null ? [...rootCertificates] : readFileSync(rootFile, "utf8");
    if (typeof ca === "string") pins = (ca.match(PEM_CERTIFICATE) ?? []).map((pem) => new X509Certificate(pem));
  } catch (error) {
    throw new ConnectionError("config", `Storytree could not read ${rootFile}, the certificate the library's address ${shown(url)} trusts (sslrootcert): check that it exists, can be read and holds PEM certificates.`, error);
  }
  const host = url.hostname.replace(/^\[(.*)\]$/, "$1");
  const ssl: ConnectionOptions = {
    ca,
    rejectUnauthorized: pins === undefined,
    ...(isIP(host) === 0 ? { servername: host } : {}),
    checkServerIdentity: (_dialled, certificate) => checkServerIdentity(host, certificate),
  };
  return { ssl, Client: pins === undefined ? RemoteClient : pinnedClient(pins, host) };
}

const PEM_CERTIFICATE = /-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/g;

class RemoteClient extends pg.Client {
  _handleAuthCleartextPassword(): void {
    this.connection.stream.destroy(new ConnectionError(
      "untrusted-server",
      "The library's server asked for the password in plain text, so storytree did not send it. Configure that server to use scram-sha-256 password authentication.",
    ));
  }
}

function pinnedClient(pins: readonly X509Certificate[], host: string): typeof RemoteClient {
  return class PinnedClient extends RemoteClient {
    constructor(...args: ConstructorParameters<typeof pg.Client>) {
      super(...args);
      this.connection.once("sslconnect", () => {
        const socket = this.connection.stream as TLSSocket;
        socket.once("secureConnect", () => {
          const refusal = untrusted(socket, pins, host);
          if (refusal !== undefined) socket.destroy(refusal);
        });
      });
    }
  };
}

function untrusted(socket: TLSSocket, pins: readonly X509Certificate[], host: string): Error | undefined {
  if (socket.authorized) return undefined;
  const presented = socket.getPeerCertificate();
  if (presented.raw === undefined || !pins.some((pin) => pin.raw.equals(presented.raw))) {
    return Object.assign(new Error(`The server's certificate was not trusted: ${socket.authorizationError}`), { code: String(socket.authorizationError) });
  }
  const { validFromDate, validToDate } = new X509Certificate(presented.raw);
  const now = Date.now();
  if (now < validFromDate.getTime()) return Object.assign(new Error("The server's certificate is not yet valid"), { code: "CERT_NOT_YET_VALID" });
  if (now > validToDate.getTime()) return Object.assign(new Error("The server's certificate has expired"), { code: "CERT_HAS_EXPIRED" });
  return checkServerIdentity(host, presented);
}

function checkedAddress(address: string): URL {
  let url: URL;
  try {
    url = new URL(address);
  } catch {
    throw new ConnectionError("config", "The library's address is not a postgres:// address: write it postgres://<user>@<host>[:<port>]/<database>.");
  }
  if (!/^(postgres(ql)?|wss):$/.test(url.protocol) || url.hostname === "" || url.username === "") {
    throw new ConnectionError("config", `The library's address ${shown(url)} is not written postgres://<user>@<host>[:<port>]/<database> (or wss://… for one reached over HTTPS).`);
  }
  if (url.password !== "") {
    throw new ConnectionError("config", `The library's address carries a password: take it out, and save it with \`storytree auth set ${PASSWORD_KEY}\` instead.`);
  }
  const redirect = ENDPOINT_PARAMS.find((key) => url.searchParams.has(key));
  if (redirect !== undefined) {
    throw new ConnectionError("config", `The library's address ${shown(url)} sets ${redirect}, which would reach a server other than the one it shows: write the host and port before the database instead.`);
  }
  return url;
}

function explain(error: unknown, url: URL, connectTimeoutMs: number): unknown {
  if (error instanceof ConnectionError) return error;
  const user = decodeURIComponent(url.username);
  if (sqlState(error) === "28P01") {
    return new ConnectionError(
      "password",
      `${shown(url)} refused the password saved for ${user}. Save the right one with \`storytree auth set ${PASSWORD_KEY}\`, then try again.`,
      error,
    );
  }
  if (sqlState(error)?.startsWith("28")) {
    return new ConnectionError(
      "database-user",
      `${shown(url)} did not let ${user} in: check that the user exists there and may connect from this computer (its pg_hba.conf, or the host's allow list).`,
      error,
    );
  }
  const code = typeof error === "object" && error !== null ? (error as { code?: unknown }).code : undefined;
  if (error instanceof Error && /does not support SSL connections|error establishing an SSL connection/.test(error.message)) {
    return new ConnectionError(
      "untrusted-server",
      `${shown(url)} did not offer TLS, so storytree did not send it the password: a library at a remote address must prove who it is with a TLS certificate. Turn on ssl on that server, then try again.`,
      error,
    );
  }
  if (code === "ERR_TLS_CERT_ALTNAME_INVALID") {
    return new ConnectionError(
      "untrusted-server",
      `The certificate the server at ${shown(url)} presented does not name ${url.hostname}, so storytree did not send it the password. Reach the library by a name its certificate carries, or re-issue the certificate for this one.`,
      error,
    );
  }
  if (typeof code === "string" && /CERT|SELF_SIGNED|UNABLE_TO_|ERR_TLS_|ERR_SSL_/.test(code)) {
    return new ConnectionError(
      "untrusted-server",
      `The server at ${shown(url)} presented a certificate no authority storytree trusts signed (${code}), so storytree did not send it the password. If it is your own server, add its certificate to the address as ?sslrootcert=<path to its .crt>.`,
      error,
    );
  }
  const timedOut = error instanceof Error && PG_CONNECT_TIMEOUT.test(error.message);
  if (timedOut || (typeof code === "string" && UNREACHABLE.has(code))) {
    return new ConnectionError(
      "unreachable",
      `Storytree could not reach the library at ${shown(url)}${timedOut ? ` within ${connectTimeoutMs / 1000} seconds` : ""}. ` +
        "Check the host and port, that the server is running, and that this network can reach it, then try again.",
      error,
    );
  }
  return error;
}

function shown(url: URL): string {
  const safe = new URL(url.href);
  safe.password = "";
  return safe.href;
}
