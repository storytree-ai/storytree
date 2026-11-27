// Capability 3 · Data schema
import { fileURLToPath } from "node:url";

import { codeDistance } from "./code-distance.js";

export interface FieldProblem {
  readonly field: string | undefined;
  readonly problem: string;
  readonly textForList?: true;
}

export class SchemaError extends Error {
  override readonly name = "SchemaError";
  readonly type: string;
  readonly fields: readonly string[];
  readonly lists: readonly string[];

  constructor(type: string, problems: readonly FieldProblem[]) {
    super(`${type}: ${problems.map((problem) => problem.problem).join("; ")}`);
    this.type = type;
    this.fields = [...new Set(problems.flatMap((problem) => (problem.field === undefined ? [] : [problem.field])))];
    this.lists = [...new Set(problems.flatMap((problem) => (problem.textForList && problem.field !== undefined ? [problem.field] : [])))];
  }
}

export class UnknownTypeError extends Error {
  override readonly name = "UnknownTypeError";
  readonly type: string;
  readonly id: string | undefined;

  constructor(type: string, id?: string) {
    super(`unknown record type ${JSON.stringify(type)}${id === undefined ? "" : ` (record ${JSON.stringify(id)})`}`);
    this.type = type;
    this.id = id;
  }
}

const here = typeof import.meta.url === "string" ? fileURLToPath(import.meta.url) : undefined;
const distance = here === undefined ? () => undefined : codeDistance(here);

export class NewerSchemaError extends Error {
  override readonly name = "NewerSchemaError";
  readonly id: string;
  readonly type: string;
  readonly version: number;
  readonly knownVersion: number;

  constructor(id: string, type: string, version: number, knownVersion: number) {
    const behind = distance();
    const running = behind === undefined
      ? "The running code's distance from locally fetched origin/main is unknown."
      : `The running code is ${behind} commit${behind === 1 ? "" : "s"} behind locally fetched origin/main.`;
    super(
      `${JSON.stringify(id)} (${type}) is stamped with schema version ${version}, newer than version ${knownVersion} this code knows, ` +
        `so it is not read. ${running} Update the code: git pull, then pnpm install, then restart the MCP server from a current worktree.`,
    );
    this.id = id;
    this.type = type;
    this.version = version;
    this.knownVersion = knownVersion;
  }
}

export class MissingUpgradeError extends Error {
  override readonly name = "MissingUpgradeError";
  readonly id: string;
  readonly type: string;
  readonly from: number;
  readonly knownVersion: number;

  constructor(id: string, type: string, from: number, knownVersion: number) {
    super(`${JSON.stringify(id)} (${type}) is on schema version ${from}, and no upgrade step takes a ${type} from version ${from} to ${from + 1} (this code knows version ${knownVersion})`);
    this.id = id;
    this.type = type;
    this.from = from;
    this.knownVersion = knownVersion;
  }
}
