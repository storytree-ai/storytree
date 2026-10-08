/**
 * Capability 8 · Cloud connection (GCP): the refusal to connect (contract 8.2 in the library story). A
 * server storytree cannot reach or use as it is set up is refused with a message saying what to
 * fix: never a hang, and never a driver's raw error. It is one class, so a caller catches every
 * such refusal the same way, and its `problem` says which one it is.
 */

/** What stopped storytree connecting. */
export type ConnectionProblem =
  /** The options given to connect() do not describe a server: a Cloud SQL instance not written as project:region:instance, say. */
  | "config"
  /** No Google sign-in was found, or the one found has expired or been revoked. */
  | "sign-in"
  /** The Cloud SQL instance does not exist, or the account is not allowed to use it. */
  | "instance"
  /** The Cloud SQL instance exists but is not running (stopped), so the library on it cannot be reached. */
  | "stopped"
  /** The account is not a database user on the Cloud SQL instance. */
  | "database-user"
  /** A new project's database cannot be made: the server's user may not create databases, nor take on a role that may. */
  | "create-database"
  /** The project's tables need setting up or upgrading, and the account may not: only the role that owns its database may. */
  | "project-owner"
  /** The server did not answer in time. */
  | "timeout"
  /** A library reached by address has no password saved: no `postgres` key, and no PGPASSWORD. */
  | "no-password"
  /** A library reached by address refused the password saved for it. */
  | "password"
  /** A library reached by address is at a host that cannot be reached, or did not answer in time. */
  | "unreachable"
  /** A library at a remote address did not prove who it is with a TLS certificate storytree checks, so it was not sent the password. */
  | "untrusted-server";

/** Storytree cannot reach or use the server as it is set up. The message says what to fix. */
export class ConnectionError extends Error {
  /** What stopped storytree connecting. */
  readonly problem: ConnectionProblem;

  /** `cause`, when given, is the failure this refusal explains. */
  constructor(problem: ConnectionProblem, message: string, cause?: unknown) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "ConnectionError";
    this.problem = problem;
  }
}

/**
 * The role the refusal below has the owner make: one that may create databases, which the server's
 * user then borrows. Any such role granted to the user serves; this is only the name suggested.
 */
const CREATOR_ROLE = "storytree_creator";

/**
 * The refusal of a new project's database: the server's user `user` may not create databases, and
 * may take on no role that may (Postgres refused CREATE DATABASE with `cause`, SQLSTATE 42501). It
 * gives the two lines that fix it for good, and who may run them: a role that may create databases,
 * granted to the user, which storytree then borrows to make each project's database.
 *
 * Not `ALTER ROLE <user> CREATEDB`, and not a database made for the user and owned by it: from
 * Postgres 16, both need rights over the user that only a role holding ADMIN OPTION on it has. On
 * Cloud SQL that is Google's cloudsqladmin alone, which made the IAM user, so the instance's
 * `postgres` user can do neither. It can make a role, though, and holds ADMIN OPTION on the role it
 * made, so it may grant that one.
 */
export function cannotCreateDatabases(server: "postgres" | "cloud-sql", user: string, cause: unknown): ConnectionError {
  const role = quoteIdentifier(user);
  const [whose, grantor] =
    server === "cloud-sql"
      ? ["Your Cloud SQL user", "as the instance's `postgres` user"]
      : ["Your Postgres user", "as a superuser (such as `postgres`)"];
  return new ConnectionError(
    "create-database",
    `${whose} cannot create databases, and storytree keeps one database per project. Run these two lines once, ` +
      `${grantor}, to give it a role that can: \`CREATE ROLE ${CREATOR_ROLE} NOLOGIN CREATEDB;\` ` +
      `\`GRANT ${CREATOR_ROLE} TO ${role};\` Storytree then borrows that role to create each project's database.`,
    cause,
  );
}

/**
 * The refusal to open project `project` as `account`: its tables need setting up or upgrading,
 * which Postgres allows only to `owner`, the role that owns its database, and the account is not
 * it and may not act as it (ADR-0747: an account let only write some rows, as CI's health account
 * is, opens only a project whose tables are current).
 */
export function cannotSetUpProject(project: string, account: string, owner: string, cause: unknown): ConnectionError {
  return new ConnectionError(
    "project-owner",
    `Project "${project}"'s tables need to be set up or upgraded, which only the role that owns its database ` +
      `(${quoteIdentifier(owner)}) may do, and ${quoteIdentifier(account)} is not it and may not act as it. ` +
      `Open the project once as its owner (the storytree app, or any account that may act as that role), then try again.`,
    cause,
  );
}

/** Whether `error` is Postgres refusing for want of a privilege (SQLSTATE 42501, insufficient_privilege). */
export function isInsufficientPrivilege(error: unknown): boolean {
  return sqlState(error) === "42501";
}

/** The SQLSTATE of a Postgres error, as pg reports it in `code`; undefined for anything else. */
export function sqlState(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null) return undefined;
  const { code } = error as { code?: unknown };
  return typeof code === "string" && /^[0-9A-Z]{5}$/.test(code) ? code : undefined;
}

function quoteIdentifier(name: string): string {
  return `"${name.replaceAll('"', '""')}"`;
}
