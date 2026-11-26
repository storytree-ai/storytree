// Capability 3 · Record rules
import { fileURLToPath } from "node:url";
import { codeDistance } from "./code-distance.js";
import { SCHEMA_VERSIONS } from "../../schema/types.js";

const runningCodeDistance = import.meta.url === undefined
  ? () => undefined
  : codeDistance(fileURLToPath(import.meta.url));

export interface FieldProblem {
  readonly field: string | undefined;
  readonly problem: string;
  readonly textForList?: true;
}

export class SchemaError extends Error {
  readonly type: string;
  readonly fields: readonly string[];
  readonly lists: readonly string[];

  constructor(type: string, problems: readonly FieldProblem[]) {
    super(`${type}: ${problems.map(({ problem }) => problem).join("; ")}`);
    this.name = "SchemaError";
    this.type = type;
    this.fields = [...new Set(problems.flatMap(({ field }) => (field === undefined ? [] : [field])))];
    this.lists = [...new Set(problems.flatMap(({ field, textForList }) => (field === undefined || textForList !== true ? [] : [field])))];
  }
}

export class UnknownTypeError extends Error {
  readonly type: string;
  readonly id: string | undefined;

  constructor(type: string, id?: string) {
    const known = `the record types are ${Object.keys(SCHEMA_VERSIONS).join(", ")}`;
    super(
      type.includes(".")
        ? `${id === undefined ? "" : `record ${JSON.stringify(id)} is of `}record kind ${JSON.stringify(type)}, a plugin's, which no plugin loaded here declares${id === undefined ? "" : ": it reads dormant and cannot be written"} (ADR-1178 D3)`
        : type === "memory"
        ? `memory belongs to the agent harness, not the library (ADR-0650); write an artifact kind such as decision, definition or principle${id === undefined ? "" : `; legacy record ${JSON.stringify(id)} is preserved in history and needs classification`}`
        : id === undefined
        ? `unknown record type ${JSON.stringify(type)}: ${known}`
        : `record ${JSON.stringify(id)} has type ${JSON.stringify(type)}, which this code does not know (${known})`,
    );
    this.name = "UnknownTypeError";
    this.type = type;
    this.id = id;
  }
}

export class NewerSchemaError extends Error {
  readonly id: string;
  readonly type: string;
  readonly version: number;
  readonly knownVersion: number;

  constructor(id: string, type: string, version: number, knownVersion: number) {
    const behind = runningCodeDistance();
    const distance = behind === undefined
      ? "The running code's distance from locally fetched origin/main is unknown."
      : `The running code is ${behind} commit${behind === 1 ? "" : "s"} behind locally fetched origin/main.`;
    super(
      `record ${JSON.stringify(id)} (${type}) was written on schema version ${version}, which is newer than ` +
        `version ${knownVersion}, the newest ${type} version this code knows: it is refused rather than guessed at. ` +
        `${distance} Update the storytree checkout with \`git pull\` and \`pnpm install\`; restart the MCP server from a current worktree if it is running.`,
    );
    this.name = "NewerSchemaError";
    this.id = id;
    this.type = type;
    this.version = version;
    this.knownVersion = knownVersion;
  }
}

export class MissingUpgradeError extends Error {
  readonly id: string;
  readonly type: string;
  readonly from: number;
  readonly knownVersion: number;

  constructor(id: string, type: string, from: number, knownVersion: number) {
    super(
      `record ${JSON.stringify(id)} (${type}) was written on schema version ${from}, and no upgrade step brings a ` +
        `${type} from version ${from} to ${from + 1} (this code reads ${type} at version ${knownVersion}): ` +
        `it is refused rather than guessed at`,
    );
    this.name = "MissingUpgradeError";
    this.id = id;
    this.type = type;
    this.from = from;
    this.knownVersion = knownVersion;
  }
}
