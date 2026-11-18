// Capability 1 · Project libraries

export const PROJECT_DATABASE_PREFIX = "storytree_";

const PROJECT_NAME = /^[a-z0-9](?:[a-z0-9]|-(?!-)){0,39}$/;

export const PROJECT_NAME_RULE =
  "a project name is lower-case letters, digits and single hyphens " +
  "(1-40 characters, starting with a letter or digit and not ending with a hyphen)";

export class ProjectNameError extends Error {
  readonly projectName: unknown;
  readonly rule: string;

  constructor(projectName: unknown) {
    super(`project name ${JSON.stringify(projectName)} is not allowed: ${PROJECT_NAME_RULE}`);
    this.name = "ProjectNameError";
    this.projectName = projectName;
    this.rule = PROJECT_NAME_RULE;
  }
}

export function assertProjectName(name: unknown): asserts name is string {
  if (typeof name !== "string" || !PROJECT_NAME.test(name) || name.endsWith("-")) {
    throw new ProjectNameError(name);
  }
}

export function projectDatabase(name: string): string {
  return PROJECT_DATABASE_PREFIX + name;
}

export class ProjectGoneError extends Error {
  readonly project: string;

  constructor(project: string) {
    super(`There is no project "${project}" in the library: it was deleted, or was never set up on this library.`);
    this.name = "ProjectGoneError";
    this.project = project;
  }
}
