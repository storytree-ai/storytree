export type ConnectionProblem = "config" | "database-user" | "create-database" | "project-owner" | "timeout" | "no-password" | "password" | "unreachable" | "untrusted-server" | "access";
export declare class ConnectionError extends Error {
	readonly problem: ConnectionProblem;
	constructor(problem: ConnectionProblem, message: string, cause?: unknown);
}
export declare const LIBRARY_UNREACHABLE = "The library cannot be reached";
export declare function isUnreachable(error: unknown): boolean;
export declare function saysUnreachable(error: unknown): boolean;
export interface OutageSaidOnce {
	failed(what: string, error: unknown): void;
	answered(): void;
}
export declare function outageSaidOnce(say: (line: string, error?: unknown) => void): OutageSaidOnce;
export declare function cannotCreateDatabases(user: string, cause: unknown): ConnectionError;
export declare function cannotSetUpProject(project: string, account: string, owner: string, cause: unknown): ConnectionError;
export declare function isInsufficientPrivilege(error: unknown): boolean;
export declare function sqlState(error: unknown): string | undefined;

export {};
