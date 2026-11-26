// Capability 1 · Project libraries
const RULE = "a project name is lower-case letters, digits and single hyphens, 1–40 characters, starting with a letter or digit and ending with one";

const NAME = /^(?=.{1,40}$)[a-z0-9]+(?:-[a-z0-9]+)*$/;

export class ProjectNameError extends Error {
  override readonly name = "ProjectNameError";
  readonly projectName: unknown;
  readonly rule = RULE;

  constructor(projectName: unknown) {
    super(`${JSON.stringify(projectName) ?? String(projectName)} is not a project name: ${RULE}`);
    this.projectName = projectName;
  }
}

export function checkName(name: unknown): string {
  if (typeof name !== "string" || !NAME.test(name)) throw new ProjectNameError(name);
  return name;
}

export class ProjectGoneError extends Error {
  override readonly name = "ProjectGoneError";
  readonly project: string;

  constructor(project: string) {
    super(`no project "${project}" on this server: it was deleted, or never made, and an open that only reaches an existing project makes none`);
    this.project = project;
  }
}

export function databaseOf(project: string): string {
  return `storytree_${project}`;
}
