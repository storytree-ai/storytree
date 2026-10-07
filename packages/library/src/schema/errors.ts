/**
 * The refusals of the data schema (capability 3). Each one names what is wrong, so whoever wrote
 * the record, an agent included, can put it right.
 */
import { fileURLToPath } from "node:url";
import { codeDistance } from "./code-distance.js";
import { SCHEMA_VERSIONS } from "./types.js";

// CommonJS bundles have no ESM source URL and cannot identify the loaded source revision.
const runningCodeDistance = import.meta.url === undefined
  ? () => undefined
  : codeDistance(fileURLToPath(import.meta.url));

/** One thing wrong with a record's fields. */
export interface FieldProblem {
  /** The field at fault, or undefined when it is the fields as a whole (they are not an object). */
  readonly field: string | undefined;
  /** What is wrong, naming the field: `missing required field "title"`. */
  readonly problem: string;
  /** Set when the field wants a list and was given text, so a caller reading text can offer it as one. */
  readonly textForList?: true;
}

/**
 * A record's fields do not fit its type. The message starts with the type and names every field
 * at fault: `story: missing required field "title"; unknown field "titel"`.
 */
export class SchemaError extends Error {
  /** The type the fields were checked against. */
  readonly type: string;
  /** The fields at fault, each once, in the order their problems were found. */
  readonly fields: readonly string[];
  /** The fields at fault that want a list and were given text (`links: "a,b"`), each once. */
  readonly lists: readonly string[];

  constructor(type: string, problems: readonly FieldProblem[]) {
    super(`${type}: ${problems.map(({ problem }) => problem).join("; ")}`);
    this.name = "SchemaError";
    this.type = type;
    this.fields = [...new Set(problems.flatMap(({ field }) => (field === undefined ? [] : [field])))];
    this.lists = [...new Set(problems.flatMap(({ field, textForList }) => (field === undefined || textForList !== true ? [] : [field])))];
  }
}

/** A record type the schema does not declare: asked for by a caller, or found on a stored record. */
export class UnknownTypeError extends Error {
  /** The type that is not known. */
  readonly type: string;
  /** The stored record carrying it, when it was found on one. */
  readonly id: string | undefined;

  constructor(type: string, id?: string) {
    const known = `the record types are ${Object.keys(SCHEMA_VERSIONS).join(", ")}`;
    super(
      type === "memory"
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

/**
 * A stored record was written on a schema version newer than this code knows for its type. It is
 * refused, never guessed at: read by an older version's rules, it could be silently misread.
 */
export class NewerSchemaError extends Error {
  /** The record's id. */
  readonly id: string;
  /** The record's type. */
  readonly type: string;
  /** The schema version the record was written on. */
  readonly version: number;
  /** The newest version of the type this code knows. */
  readonly knownVersion: number;

  constructor(id: string, type: string, version: number, knownVersion: number) {
    const behind = runningCodeDistance();
    const distance = behind === undefined
      ? "The running code's distance from locally fetched origin/main is unknown."
      : `The running code is ${behind} commit${behind === 1 ? "" : "s"} behind locally fetched origin/main.`;
    super(
      `record ${JSON.stringify(id)} (${type}) was written on schema version ${version}, which is newer than ` +
        `version ${knownVersion}, the newest ${type} version this code knows: it is refused rather than guessed at. ` +
        `${distance} Update the storytree checkout with \`git pull\` and \`pnpm install\`; restart the agent link from a current worktree if it is running.`,
    );
    this.name = "NewerSchemaError";
    this.id = id;
    this.type = type;
    this.version = version;
    this.knownVersion = knownVersion;
  }
}

/**
 * A stored record was written on an older schema version of its type, and no upgrade step brings
 * it from that version to the next. It is refused, never guessed at: read by today's rules, its
 * fields could be silently misread.
 */
export class MissingUpgradeError extends Error {
  /** The record's id. */
  readonly id: string;
  /** The record's type. */
  readonly type: string;
  /** The version no step leads on from. */
  readonly from: number;
  /** The version this code reads the type at. */
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
