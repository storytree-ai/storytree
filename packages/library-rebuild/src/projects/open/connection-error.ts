// Capability 1 · Project libraries
export type ConnectionProblem = "config" | "database-user" | "create-database" | "project-owner" | "timeout" | "no-password" | "password" | "unreachable" | "untrusted-server" | "access";

export class ConnectionError extends Error {
  override readonly name = "ConnectionError";
  readonly problem: ConnectionProblem;

  constructor(problem: ConnectionProblem, message: string, cause?: unknown) {
    super(message, cause === undefined ? undefined : { cause });
    this.problem = problem;
  }
}

export const LIBRARY_UNREACHABLE = "The library cannot be reached";

const NETWORK_CODES = ["ECONNREFUSED", "ENOTFOUND", "EHOSTUNREACH", "ENETUNREACH", "ETIMEDOUT", "ECONNRESET", "EAI_AGAIN"];

export function isUnreachable(error: unknown): boolean {
  if (error instanceof ConnectionError) return error.problem === "unreachable";
  const code = typeof error === "object" && error !== null ? (error as { code?: unknown }).code : undefined;
  return typeof code === "string" && NETWORK_CODES.includes(code);
}

export function sqlState(error: unknown): string | undefined {
  const code = typeof error === "object" && error !== null ? (error as { code?: unknown }).code : undefined;
  return typeof code === "string" && /^[0-9A-Z]{5}$/.test(code) ? code : undefined;
}

export function cannotSetUpProject(project: string, account: string, owner: string, cause: unknown): ConnectionError {
  return new ConnectionError(
    "project-owner",
    `The project "${project}" has no tables yet, and its tables can be set up or upgraded only by its owner, ${owner}, the role owning its database: ${account} may not. Open it once as ${owner}, then ${account} can use it.`,
    cause,
  );
}
