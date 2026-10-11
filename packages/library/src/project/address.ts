/**
 * Capability 15 · Connection by address (the library story, ADR-0846 D1): any Postgres reached by
 * its address (Neon, Supabase, RDS, a self-hosted server, Cloud SQL with an ordinary user), its
 * password the `postgres` key, resolved as every key is (ADR-0843: explicit, then auth.json's entry
 * or its !command, then PGPASSWORD) and never written into the address. Past the connection it is
 * any server: one database per project. What goes wrong is refused with what to fix: no password
 * saved, a password the server refused, a host it cannot reach, a remote server that cannot prove
 * who it is.
 *
 * A remote address gets the password only after its server proves who it is (ADR-0943 D1): over TLS,
 * with a certificate that chains to an authority storytree trusts (the address's `sslrootcert` when
 * it names one, otherwise Node's authorities alone: no build trusts a certificate of storytree's own,
 * ADR-0997 D1), or is exactly one of the certificates `sslrootcert` holds, and names the host the
 * address does. A loopback address keeps its own rules
 * (ADR-0943 D2, server.ts's LocalClient).
 */
import { readFileSync } from "node:fs";
import { isIP } from "node:net";
import { X509Certificate } from "node:crypto";
import { checkServerIdentity, rootCertificates, type ConnectionOptions, type TLSSocket } from "node:tls";

import { resolveKey } from "@storytree/keys";
import pg from "pg";

import { ConnectionError, sqlState } from "./connection-error.js";
import { isLoopback, localServer, type ServerAccess, type Transport, type WaitBounds } from "./server.js";

/** The key a library reached by address takes its password from. */
export const PASSWORD_KEY = "postgres";

/**
 * How long reaching a server by address may take: a hosted one (Neon's, waking from sleep, say)
 * can take seconds to answer the first time.
 */
const TIMEOUT_MS = 20_000;

/** Failures to reach a host at all, as Node reports them. */
const UNREACHABLE = new Set(["ECONNREFUSED", "ENOTFOUND", "EAI_AGAIN", "EHOSTUNREACH", "ENETUNREACH", "ETIMEDOUT", "ECONNRESET"]);

const PG_CONNECT_TIMEOUT = /timeout expired|timeout exceeded when trying to connect|Connection terminated due to connection timeout/i;

/** Connection-string settings that would make pg dial somewhere other than the address shows. */
const ENDPOINT_PARAMS = ["host", "hostaddr", "port"];

/** Connection-string settings that choose TLS, of which a remote address may carry only these two. */
const TLS_PARAM = /^(ssl|uselibpqcompat)/i;
const REMOTE_TLS_PARAMS = ["sslmode", "sslrootcert"];

/**
 * Reach the server at `address`, a postgres:// URL with no password, signing in with the
 * `postgres` key. Refused before anything reaches the server when the address is not one, carries
 * a password, asks a remote server for less than a checked certificate, or no password is saved
 * for it. `dialVia` is for tests alone: the socket goes there, while every check stays the address's.
 */
export function addressServer(address: string, connectTimeoutMs = TIMEOUT_MS, bounds: WaitBounds = {}, dialVia?: { readonly host: string; readonly port: number }): ServerAccess {
  const url = checkedAddress(address);
  const transport = isLoopback(url.hostname) ? undefined : remoteTransport(url);
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
  // pg lets a connection string's own TLS settings override the ones it is given: a remote address's are read into its transport instead.
  if (transport !== undefined) for (const key of [...signedIn.searchParams.keys()]) if (TLS_PARAM.test(key)) signedIn.searchParams.delete(key);
  if (dialVia !== undefined) [signedIn.hostname, signedIn.port] = [dialVia.host, String(dialVia.port)];
  const server = localServer(signedIn, connectTimeoutMs, bounds, transport);
  return { ...server, explain: (error) => explain(error, url, connectTimeoutMs) };
}

/**
 * The transport for a remote address: TLS that trusts the address's `sslrootcert` alone when it
 * names one, otherwise Node's authorities alone, and checks the certificate names the address's
 * own host. Refused when the address asks for any weaker TLS.
 *
 * A certificate `sslrootcert` holds is trusted as itself, not only as an authority: a server whose
 * certificate signed itself and is no authority (the Mint library's, ADR-0997 D4) is trusted when it
 * presents exactly that certificate. Node's OpenSSL takes such a certificate as a trust anchor, but
 * Electron's BoringSSL does not, and the desktop app connects from Electron; so with `sslrootcert`
 * the TLS layer only reports, and pinnedClient decides, on every runtime alike.
 */
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
    // Against the address's host, never what the socket was given: pg leaves an IP address unnamed, and Node would check it as localhost.
    checkServerIdentity: (_dialled, certificate) => checkServerIdentity(host, certificate),
  };
  return { ssl, Client: pins === undefined ? RemoteClient : pinnedClient(pins, host) };
}

const PEM_CERTIFICATE = /-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/g;

/** A client that never answers a plain-text password request, even over checked TLS (defence in depth). */
class RemoteClient extends pg.Client {
  _handleAuthCleartextPassword(): void {
    this.connection.stream.destroy(new ConnectionError(
      "untrusted-server",
      "The library's server asked for the password in plain text, so storytree did not send it. Configure that server to use scram-sha-256 password authentication.",
    ));
  }
}

/**
 * A RemoteClient that judges the server's certificate itself, the moment the handshake completes and
 * before any message from the server is read (so before any password could be sent): trusted when
 * its chain checked out and it names `host` (TLS's own verdict), or when it is exactly one of `pins`,
 * compared on the whole certificate, is in date and names `host`. Anything else ends the connection.
 */
function pinnedClient(pins: readonly X509Certificate[], host: string): typeof RemoteClient {
  return class PinnedClient extends RemoteClient {
    constructor(...args: ConstructorParameters<typeof pg.Client>) {
      super(...args);
      // pg swaps its socket for the TLS one, then says sslconnect, all before the handshake starts.
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

/** Why the server on `socket` is not to be trusted, or nothing when it is. */
function untrusted(socket: TLSSocket, pins: readonly X509Certificate[], host: string): Error | undefined {
  if (socket.authorized) return undefined;
  // Not getPeerX509Certificate: once it has been read, this socket answers no later read of the certificate.
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

/** The address, if it is a postgres:// URL naming a host and a user and carrying no password. */
function checkedAddress(address: string): URL {
  let url: URL;
  try {
    url = new URL(address);
  } catch {
    throw new ConnectionError("config", "The library's address is not a postgres:// address: write it postgres://<user>@<host>[:<port>]/<database>.");
  }
  if (!/^postgres(ql)?:$/.test(url.protocol) || url.hostname === "" || url.username === "") {
    throw new ConnectionError("config", `The library's address ${shown(url)} is not written postgres://<user>@<host>[:<port>]/<database>.`);
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
  // 28P01, invalid_password: the server asked for the password and refused the one given.
  if (sqlState(error) === "28P01") {
    return new ConnectionError(
      "password",
      `${shown(url)} refused the password saved for ${user}. Save the right one with \`storytree auth set ${PASSWORD_KEY}\`, then try again.`,
      error,
    );
  }
  // The rest of class 28: the server would not let the user in at all (no such role, or no pg_hba.conf line for it).
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

/** The address as a message shows it: never with a password. */
function shown(url: URL): string {
  const safe = new URL(url.href);
  safe.password = "";
  return safe.href;
}
