// Capability 28 · Shared server
export type ConnectionProblem = "config" | "database-user" | "create-database" | "project-owner" | "timeout" | "no-password" | "password" | "unreachable" | "untrusted-server" | "access";

export class ConnectionError extends Error {
  override name = "ConnectionError";
  readonly problem: ConnectionProblem;

  constructor(problem: ConnectionProblem, message: string, cause?: unknown) {
    super(message, cause === undefined ? undefined : { cause });
    this.problem = problem;
  }
}

export const LIBRARY_UNREACHABLE = "The library cannot be reached";

const NETWORK_CODES = ["ECONNREFUSED", "ENOTFOUND", "EHOSTUNREACH", "ENETUNREACH", "ETIMEDOUT", "ECONNRESET", "EAI_AGAIN"];

const LOST = /timeout exceeded when trying to connect|timeout expired|Connection terminated|Cannot use a pool after calling end/i;

export function isUnreachable(error: unknown): boolean {
  if (error instanceof ConnectionError) return error.problem === "unreachable" || error.problem === "timeout";
  if (!(error instanceof Error)) return false;
  const code = (error as { code?: unknown }).code;
  if (typeof code === "string" && NETWORK_CODES.includes(code)) return true;
  return LOST.test(error.message) || (error.cause !== undefined && isUnreachable(error.cause));
}

export function saysUnreachable(error: unknown): boolean {
  const text = typeof error === "string" ? error : error instanceof Error ? error.message : "";
  return text.includes(LIBRARY_UNREACHABLE);
}

export interface OutageSaidOnce {
  failed(what: string, error: unknown): void;
  answered(): void;
}

export function outageSaidOnce(say: (line: string, error?: unknown) => void): OutageSaidOnce {
  let out = false;
  return {
    failed(what, error) {
      if (!isUnreachable(error) && !saysUnreachable(error)) {
        say(what, error);
        return;
      }
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

export function sqlState(error: unknown): string | undefined {
  const code = typeof error === "object" && error !== null ? (error as { code?: unknown }).code : undefined;
  return typeof code === "string" && /^[0-9A-Z]{5}$/.test(code) ? code : undefined;
}

export function isInsufficientPrivilege(error: unknown): boolean {
  return sqlState(error) === "42501";
}

export function quoted(name: string): string {
  return `"${name.replaceAll('"', '""')}"`;
}

export function cannotCreateDatabases(user: string, cause: unknown): ConnectionError {
  return new ConnectionError(
    "create-database",
    "Your Postgres user cannot create databases, and storytree keeps one database per project. Run these two lines " +
      "once, as a superuser (such as `postgres`), to give it a role that can: `CREATE ROLE storytree_creator NOLOGIN CREATEDB;` " +
      `\`GRANT storytree_creator TO ${quoted(user)};\` Storytree then borrows that role to create each project's database.`,
    cause,
  );
}

export function cannotSetUpProject(project: string, account: string, owner: string, cause: unknown): ConnectionError {
  return new ConnectionError(
    "project-owner",
    `The project "${project}" has no tables yet, and its tables can be set up or upgraded only by its owner, ${owner}, the role owning its database: ${account} may not. Open it once as ${owner}, then ${account} can use it.`,
    cause,
  );
}
