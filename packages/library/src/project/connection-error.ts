// Capability 28 · Shared server

export type ConnectionProblem =
  | "config"
  | "database-user"
  | "create-database"
  | "project-owner"
  | "timeout"
  | "no-password"
  | "password"
  | "unreachable"
  | "untrusted-server"
  | "access";

export class ConnectionError extends Error {
  readonly problem: ConnectionProblem;

  constructor(problem: ConnectionProblem, message: string, cause?: unknown) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "ConnectionError";
    this.problem = problem;
  }
}

const UNREACHABLE_CODES: ReadonlySet<string> = new Set(["ECONNREFUSED", "ENOTFOUND", "EAI_AGAIN", "EHOSTUNREACH", "ENETUNREACH", "ETIMEDOUT", "ECONNRESET"]);

const PG_CONNECT_TIMEOUT = /timeout expired|timeout exceeded when trying to connect|Connection terminated due to connection timeout/i;

const CONNECTION_GONE = /Connection terminated unexpectedly|Cannot use a pool after calling end on the pool/i;

export const LIBRARY_UNREACHABLE = "The library cannot be reached";

export function isUnreachable(error: unknown): boolean {
  for (let at = error, depth = 0; typeof at === "object" && at !== null && depth < 5; at = (at as { cause?: unknown }).cause, depth++) {
    if (at instanceof ConnectionError) return at.problem === "unreachable" || at.problem === "timeout";
    const { code, message } = at as { code?: unknown; message?: unknown };
    if (typeof code === "string" && UNREACHABLE_CODES.has(code)) return true;
    if (typeof message === "string" && (PG_CONNECT_TIMEOUT.test(message) || CONNECTION_GONE.test(message))) return true;
  }
  return false;
}

export function saysUnreachable(error: unknown): boolean {
  const message = error instanceof Error ? error.message : typeof error === "string" ? error : "";
  return message.startsWith(LIBRARY_UNREACHABLE);
}

export interface OutageSaidOnce {
  failed(what: string, error: unknown): void;
  answered(): void;
}

export function outageSaidOnce(say: (line: string, error?: unknown) => void): OutageSaidOnce {
  let out = false;
  return {
    failed(what, error) {
      if (!isUnreachable(error) && !saysUnreachable(error)) return say(what, error);
      if (out) return;
      out = true;
      say(`${what}: ${error instanceof Error ? error.message : String(error)} Said once until it answers again.`);
    },
    answered() {
      if (!out) return;
      out = false;
      say("the library answers again");
    },
  };
}

const CREATOR_ROLE = "storytree_creator";

export function cannotCreateDatabases(user: string, cause: unknown): ConnectionError {
  const role = quoteIdentifier(user);
  return new ConnectionError(
    "create-database",
    `Your Postgres user cannot create databases, and storytree keeps one database per project. Run these two lines once, ` +
      `as a superuser (such as \`postgres\`), to give it a role that can: \`CREATE ROLE ${CREATOR_ROLE} NOLOGIN CREATEDB;\` ` +
      `\`GRANT ${CREATOR_ROLE} TO ${role};\` Storytree then borrows that role to create each project's database.`,
    cause,
  );
}

export function cannotSetUpProject(project: string, account: string, owner: string, cause: unknown): ConnectionError {
  return new ConnectionError(
    "project-owner",
    `Project "${project}"'s tables need to be set up or upgraded, which only the role that owns its database ` +
      `(${quoteIdentifier(owner)}) may do, and ${quoteIdentifier(account)} is not it and may not act as it. ` +
      `Open the project once as its owner (the storytree app, or any account that may act as that role), then try again.`,
    cause,
  );
}

export function isInsufficientPrivilege(error: unknown): boolean {
  return sqlState(error) === "42501";
}

export function sqlState(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null) return undefined;
  const { code } = error as { code?: unknown };
  return typeof code === "string" && /^[0-9A-Z]{5}$/.test(code) ? code : undefined;
}

function quoteIdentifier(name: string): string {
  return `"${name.replaceAll('"', '""')}"`;
}
