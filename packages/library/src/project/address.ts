/**
 * Capability 15 · Connection by address (the library story, ADR-0846 D1): any Postgres reached by
 * its address (Neon, Supabase, RDS, a self-hosted server, Cloud SQL with an ordinary user), its
 * password the `postgres` key, resolved as every key is (ADR-0843: explicit, then auth.json's entry
 * or its !command, then PGPASSWORD) and never written into the address. Past the connection it is
 * any server: one database per project. What goes wrong is refused with what to fix: no password
 * saved, a password the server refused, a host it cannot reach.
 */
import { resolveKey } from "@storytree/keys";

import { ConnectionError, sqlState } from "./connection-error.js";
import { localServer, type ServerAccess } from "./server.js";

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

/**
 * Reach the server at `address`, a postgres:// URL with no password, signing in with the
 * `postgres` key. Refused before anything reaches the server when the address is not one, carries
 * a password, or no password is saved for it.
 */
export function addressServer(address: string, connectTimeoutMs = TIMEOUT_MS, statementTimeoutMs?: number): ServerAccess {
  const url = checkedAddress(address);
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
  const server = localServer(signedIn, connectTimeoutMs, statementTimeoutMs);
  return { ...server, explain: (error) => explain(error, url, connectTimeoutMs) };
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
