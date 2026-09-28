/**
 * Capability 8 · Cloud connection (GCP) (the library story): instead of a local Postgres,
 * storytree can reach a Cloud SQL for PostgreSQL instance, signing in as the user's own Google
 * account: IAM database authentication through Application Default Credentials, with no stored
 * password. Everything else works the same: one database per project, storytree_<name>, now on
 * the cloud server.
 *
 * Google's connector signs in and looks the instance up once; after that each database's pool is
 * an ordinary pg pool whose sockets the connector opens. Whatever goes wrong on the way is refused
 * with a ConnectionError saying what to fix (contract 8.2), within a bounded time: never a hang.
 */
import type { Duplex } from "node:stream";

import { ConnectionError, sqlState } from "./connection-error.js";
import { actingAs, newPool, type ServerAccess } from "./server.js";

/** A Cloud SQL instance, and the Google account storytree signs in to it as. */
export interface CloudSqlConfig {
  /**
   * The instance's connection name, project:region:instance, as the Cloud Console shows it under
   * "Connection name": `my-project:australia-southeast1:my-instance`.
   */
  readonly instance: string;
  /** The email of the Google account storytree signs in as, which is also its database user on the instance. */
  readonly user: string;
}

/**
 * The part of the Cloud SQL connector (@google-cloud/cloud-sql-connector's Connector) that
 * storytree uses. getOptions signs in and looks the instance up; the stream it hands back opens one
 * authenticated socket to the instance each time it is called.
 */
export interface CloudSqlConnector {
  getOptions(options: {
    readonly instanceConnectionName: string;
    readonly authType: "IAM";
    readonly ipType: "PUBLIC";
  }): Promise<{ readonly stream: () => Duplex }>;
  close(): void;
}

/**
 * What the cloud path can be handed in place of what it reaches for itself. Internal: tests hand
 * it a fake connector, so that nothing reaches Google. The public connect() takes options only.
 */
export interface CloudSqlSeams {
  /** Makes the connector. By default, Google's. */
  readonly connector?: () => Promise<CloudSqlConnector>;
  /** How long reaching the instance may take before it is refused, in milliseconds. By default 20 seconds. */
  readonly timeoutMs?: number;
}

/** How long reaching an instance may take before it is refused: the sign-in, and then each connection. */
const TIMEOUT_MS = 20_000;

/**
 * The database every Cloud SQL for PostgreSQL instance has, and which every user may connect to:
 * the admin pool's, used only to create and list project databases.
 */
const ADMIN_DATABASE = "postgres";

/**
 * An instance's connection name: project:region:instance, in lower-case letters, digits and
 * hyphens. A project that lives in a domain keeps it, as Google writes it:
 * example.com:my-project:region:instance.
 */
const CONNECTION_NAME =
  /^(?:[a-z0-9-]+(?:\.[a-z0-9-]+)+:)?[a-z][a-z0-9-]*[a-z0-9]:[a-z][a-z0-9-]*[a-z0-9]:[a-z](?:[a-z0-9-]*[a-z0-9])?$/;

/**
 * A Google account's email, which is how Cloud SQL names an IAM database user (a service account's
 * without its .gserviceaccount.com): one @, with no spaces or control characters.
 */
const ACCOUNT = /^[^\s@\p{Cc}]+@[^\s@\p{Cc}]+$/u;

/**
 * How pg reports a connection it gave up on at connectionTimeoutMillis: pg-pool's words when its
 * timer ends the attempt, or when no connection came free in time, and the client's own.
 */
const PG_CONNECT_TIMEOUT =
  /^(?:Connection terminated due to connection timeout|timeout exceeded when trying to connect|timeout expired)$/;

/**
 * Reach the Cloud SQL instance `config` names, signed in as its user. The config is checked before
 * anything reaches the network; then the connector signs in and looks the instance up, and every
 * pool on the instance opens its sockets through it. Refused with a ConnectionError saying what to
 * fix when the config is wrong, when there is no Google sign-in or a bad one, when the instance is
 * missing or not allowed, and when the sign-in does not finish in time.
 */
export async function cloudSqlServer(config: unknown, seams: CloudSqlSeams = {}): Promise<ServerAccess> {
  const { instance, user } = checkConfig(config);
  const timeoutMs = seams.timeoutMs ?? TIMEOUT_MS;
  const connector = await (seams.connector ?? (() => googleConnector(instanceParts(instance).project)))();
  const options = await signIn(connector, instance, user, timeoutMs);
  const pool = (database: string, role?: string) => newPool({ ...options, user, database, connectionTimeoutMillis: timeoutMs, ...actingAs(role) });
  return {
    kind: "cloud-sql",
    admin: pool(ADMIN_DATABASE),
    pool,
    explain: (error) => explainConnection(error, instance, user, timeoutMs),
    close: () => connector.close(),
  };
}

/** The config, if it names an instance and an account; a ConnectionError saying what to write otherwise. */
function checkConfig(config: unknown): CloudSqlConfig {
  if (typeof config !== "object" || config === null || Array.isArray(config)) {
    throw new ConnectionError(
      "config",
      "The Cloud SQL settings are { instance, user }: the instance's connection name (project:region:instance) " +
        "and the email of the Google account to sign in as.",
    );
  }
  const { instance, user } = config as { instance?: unknown; user?: unknown };
  if (typeof instance !== "string" || !CONNECTION_NAME.test(instance)) {
    throw new ConnectionError(
      "config",
      `The Cloud SQL instance ${shown(instance)} is not written as project:region:instance. Copy its connection ` +
        "name from the instance's page in the Cloud Console (for example my-project:australia-southeast1:my-instance).",
    );
  }
  if (typeof user !== "string" || !ACCOUNT.test(user)) {
    throw new ConnectionError(
      "config",
      `The Cloud SQL user ${shown(user)} is not a Google account email. Give the email of the Google account ` +
        "you sign in with (for example you@example.com).",
    );
  }
  return { instance, user };
}

/**
 * Google's Cloud SQL connector, imported only now, so the local path never loads Google code. It
 * signs in with Application Default Credentials (`gcloud auth application-default login`), told
 * the instance's own Google Cloud project: left to find one itself, Google's auth library runs
 * `gcloud config config-helper`, which took 30 to 40 seconds on a Windows laptop, longer than the
 * whole bound on reaching the instance.
 */
async function googleConnector(project: string): Promise<CloudSqlConnector> {
  const [{ AuthTypes, Connector, IpAddressTypes }, googleAuth] = await Promise.all([
    import("@google-cloud/cloud-sql-connector"),
    import("google-auth-library"),
  ]);
  // google-auth-library is CommonJS: Node names its exports, and a bundle (the installed command
  // and agent link) hands them over as the module's default instead.
  const { GoogleAuth } = "GoogleAuth" in googleAuth ? googleAuth : (googleAuth as { default: typeof googleAuth }).default;
  const auth = new GoogleAuth({
    projectId: project,
    // What the connector asks for when it signs in itself: the Admin API, and the database sign-in.
    scopes: ["https://www.googleapis.com/auth/sqlservice.admin", "https://www.googleapis.com/auth/sqlservice.login"],
  });
  const connector = new Connector({ auth });
  return {
    getOptions: ({ instanceConnectionName, authType, ipType }) =>
      connector.getOptions({ instanceConnectionName, authType: AuthTypes[authType], ipType: IpAddressTypes[ipType] }),
    close: () => connector.close(),
  };
}

/**
 * Sign in and look the instance up through the connector, by IAM over its public IP, within
 * `timeoutMs`. A failure is refused with what to fix when it is one Google's libraries report
 * (explainSignIn), and a sign-in still unfinished at the bound is refused as a timeout.
 */
async function signIn(
  connector: CloudSqlConnector,
  instance: string,
  user: string,
  timeoutMs: number,
): Promise<{ readonly stream: () => Duplex }> {
  const signingIn = connector.getOptions({ instanceConnectionName: instance, authType: "IAM", ipType: "PUBLIC" });
  const gaveUp = Symbol("gave up");
  let timer: ReturnType<typeof setTimeout> | undefined;
  const bound = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(gaveUp), timeoutMs);
  });
  try {
    return await Promise.race([signingIn, bound]);
  } catch (error) {
    if (error === gaveUp) {
      // Given up on, but still under way. If it ever finishes, it will have started the
      // connector's refresh timer, which keeps a process alive for the best part of an hour.
      signingIn.then(
        () => connector.close(),
        () => {},
      );
      throw timedOut(instance, timeoutMs);
    }
    // A sign-in that failed holds nothing, so the connector is not closed: Google's close()
    // would re-raise the failed lookup it keeps, as an unhandled rejection.
    throw explainSignIn(error, instance, user);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * A failed sign-in, as a refusal saying what to fix when it is one of the failures Google's
 * libraries report; any other error as it is.
 */
function explainSignIn(error: unknown, instance: string, user: string): unknown {
  const message = error instanceof Error ? error.message : String(error);
  // google-auth-library found no Application Default Credentials anywhere.
  if (message.startsWith("Could not load the default credentials")) {
    return new ConnectionError(
      "sign-in",
      "Storytree could not find your Google sign-in. Run `gcloud auth application-default login`, then try again.",
      error,
    );
  }
  // Credentials were found, and Google turned them down: the refresh token behind them has expired
  // or been revoked (invalid_grant, a demand to sign in again among them), or the token was refused.
  const status = httpStatus(error);
  if (status === 401 || message.includes("invalid_grant") || oauthError(error) === "invalid_grant") {
    return new ConnectionError(
      "sign-in",
      "Your Google sign-in was not accepted: it has expired or been revoked. Run `gcloud auth application-default login`, then try again.",
      error,
    );
  }
  // The Admin API does not know the instance, or will not show it to this account.
  if (status === 403 || status === 404) {
    return new ConnectionError(
      "instance",
      `Storytree could not open the Cloud SQL instance "${instance}" as ${user}: it does not exist, or the account ` +
        `is not allowed to use it. Check the instance's name, and that ${user} has the Cloud SQL Client role on it. ` +
        `(Google said: ${message})`,
      error,
    );
  }
  return error;
}

/**
 * A failure of a connection to the instance, as a refusal saying what to fix: the account is not a
 * database user on it, or the instance did not answer in time. Any other error as it is.
 */
function explainConnection(error: unknown, instance: string, user: string, timeoutMs: number): unknown {
  if (error instanceof ConnectionError) return error;
  // Postgres's class 28, invalid authorization: the instance did not let the account in as a
  // database user (Cloud SQL's "IAM user authentication failed", or no role of that name at all).
  if (sqlState(error)?.startsWith("28")) {
    const { project, id } = instanceParts(instance);
    return new ConnectionError(
      "database-user",
      `Cloud SQL did not let ${user} in as a database user on "${instance}". Add the account to the instance as a ` +
        `Cloud SQL IAM user (gcloud sql users create ${user} --instance=${id} --project=${project} ` +
        "--type=cloud_iam_user) with the Cloud SQL Instance User role, and check it is the account you signed in with.",
      error,
    );
  }
  if (error instanceof Error && PG_CONNECT_TIMEOUT.test(error.message)) return timedOut(instance, timeoutMs, error);
  return error;
}

function timedOut(instance: string, timeoutMs: number, cause?: unknown): ConnectionError {
  return new ConnectionError(
    "timeout",
    `Storytree could not reach the Cloud SQL instance "${instance}" within ${timeoutMs / 1000} seconds. Check that ` +
      "the instance is running and has a public IP address, and that this network can reach Google Cloud, then try again.",
    cause,
  );
}

/** The project (with its domain, if it has one) and the instance id of a connection name. */
function instanceParts(instance: string): { project: string; id: string } {
  const idAt = instance.lastIndexOf(":");
  const regionAt = instance.lastIndexOf(":", idAt - 1);
  return { project: instance.slice(0, regionAt), id: instance.slice(idAt + 1) };
}

/** The HTTP status of a failed request, as gaxios (under Google's client libraries) reports it. */
function httpStatus(error: unknown): number | undefined {
  if (typeof error !== "object" || error === null) return undefined;
  const { status, response } = error as { status?: unknown; response?: { status?: unknown } };
  if (typeof status === "number") return status;
  return typeof response?.status === "number" ? response.status : undefined;
}

/** The OAuth error code in a failed token request's reply (`invalid_grant`, say). */
function oauthError(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null) return undefined;
  const data = (error as { response?: { data?: unknown } }).response?.data;
  if (typeof data !== "object" || data === null) return undefined;
  const code = (data as { error?: unknown }).error;
  return typeof code === "string" ? code : undefined;
}

/** A value from the config, as a message shows it. */
function shown(value: unknown): string {
  return typeof value === "string" ? JSON.stringify(value) : String(value);
}
