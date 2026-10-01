/** Project names, and the database each project lives in. */

/** A project's database is this prefix followed by the project's name. */
export const PROJECT_DATABASE_PREFIX = "storytree_";

// 1-40 characters of lower-case letters, digits and single hyphens, starting with a letter or
// digit (and, below, not ending with a hyphen). Forty keeps storytree_<name> well inside
// Postgres's 63-byte limit on names, so a database name is never silently truncated.
const PROJECT_NAME = /^[a-z0-9](?:[a-z0-9]|-(?!-)){0,39}$/;

export const PROJECT_NAME_RULE =
  "a project name is lower-case letters, digits and single hyphens " +
  "(1-40 characters, starting with a letter or digit and not ending with a hyphen)";

/** A project name that breaks the project-name rule. The message names the rule. */
export class ProjectNameError extends Error {
  /** The name that was refused, as it was given. */
  readonly projectName: unknown;
  /** The rule it breaks. */
  readonly rule: string;

  constructor(projectName: unknown) {
    super(`project name ${JSON.stringify(projectName)} is not allowed: ${PROJECT_NAME_RULE}`);
    this.name = "ProjectNameError";
    this.projectName = projectName;
    this.rule = PROJECT_NAME_RULE;
  }
}

/** Throws a ProjectNameError, naming the rule, unless `name` is a valid project name. */
export function assertProjectName(name: unknown): asserts name is string {
  if (typeof name !== "string" || !PROJECT_NAME.test(name) || name.endsWith("-")) {
    throw new ProjectNameError(name);
  }
}

/** The database that holds project `name`'s library. */
export function projectDatabase(name: string): string {
  return PROJECT_DATABASE_PREFIX + name;
}

/**
 * An open that only reaches an existing project (`create: false`) found no database for it: the
 * project was deleted, for every computer using the library (ADR-0831), or never set up on it.
 */
export class ProjectGoneError extends Error {
  /** The project that was asked for. */
  readonly project: string;

  constructor(project: string) {
    super(`There is no project "${project}" in the library: it was deleted, or was never set up on this library.`);
    this.name = "ProjectGoneError";
    this.project = project;
  }
}
