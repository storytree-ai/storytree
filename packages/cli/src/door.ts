/**
 * Capability 1 · Front door (the command line story): `storytree <family> <verb>` works out which project
 * the folder you are in belongs to, opens that project's library, and hands the command to the
 * owning story's function, keeping no rule of its own. Every answer is a short plain sentence or
 * listing followed by what you might run next, and a failure exits non-zero and says what to do.
 *
 * - The project is the agent link's project routing (its capability 1) from the folder the command
 *   runs in: the nearest `.storytree.json` at or above it. Where storytree is, is the same routing's
 *   reading of the storytree home (STORYTREE_HOME, else ~/.storytree/0.3). "Not a project" and
 *   "not running" are its words, and come back before anything reaches a database.
 * - The library is reached only through its public API, opened on first use, so a command that
 *   needs none (the help) never connects.
 * - Exit codes: 0 answered; 1 refused (by the library, which is printed in its own words, or by
 *   the door, which says what to do); 2 a command used wrongly, with its usage.
 */
import { openActivityLog, readClaims, route, type ActivityLog, type Claim, type ClaimContext } from "@storytree/agent-link";
import type { ConnectOptions, Library, Storytree, WriteOptions } from "@storytree/library";

import { Refusal, render, type Answer } from "./answer.js";
import { parseArgs, type Args } from "./args.js";
import { FAMILIES } from "./families/index.js";
import { commandSession, commandWriter, person } from "./writer.js";

/** Where a command runs, and where its answer goes. */
export interface Io {
  readonly cwd: string;
  /** The command's own script, as Node ran it: storytree's other commands sit beside an installed one. */
  readonly script?: string;
  out(text: string): void;
  err(text: string): void;
}

/** What a verb is handed besides its words: the folder, and the project's library on first use. */
export interface Context {
  readonly cwd: string;
  /** The command's own script, when known. */
  readonly script?: string;
  /** The project's library: the project the folder belongs to, on the running storytree. */
  library(): Promise<Library>;
  /** The writer to pass to every write; using it also names that writer in the answer. */
  writer(): WriteOptions;
  /** Who holds what in the project right now: the agent link's reading of its activity log. */
  claims(): Promise<Claim[]>;
  /** The caller and activity log, including a person closing an increment from their terminal. */
  activityContext(): Promise<ClaimContext & { readonly folder: string }>;
  /** The calling agent and the resources its claims use; refuses a shell with no agent session. */
  claimContext(): Promise<ClaimContext & { readonly folder: string }>;
}

/** One verb of a family: `storytree <family> <name> …`. */
export interface Verb {
  readonly name: string;
  /** How it is used, after `storytree `: `library search <words…>`. */
  readonly usage: string;
  readonly summary: string;
  /** Its flags that take no value. */
  readonly switches?: readonly string[];
  act(args: Args, context: Context): Promise<Answer>;
}

/** A family of verbs: `storytree <name> <verb>`. */
export interface Family {
  readonly name: string;
  /** Former names it still answers to, left out of the families list. */
  readonly aliases?: readonly string[];
  readonly summary: string;
  readonly verbs: readonly Verb[];
  /** Families within it: `storytree arc increment <verb>`. */
  readonly families?: readonly Family[];
  /** What runs for `storytree <name> …` when the next word names none of its verbs. */
  readonly bare?: Verb;
  /** Why the family has no verbs yet: the function its owning story has still to give. */
  readonly waitsOn?: string;
}

/** Run one `storytree` command, and return the exit code. */
export async function run(argv: readonly string[], io: Io): Promise<number> {
  const opened = new Opened(io.cwd);
  let writer: WriteOptions | undefined;
  try {
    const answer = await dispatch(argv, {
      cwd: io.cwd,
      ...(io.script === undefined ? {} : { script: io.script }),
      library: () => opened.library(),
      claims: () => opened.claims(),
      activityContext: () => opened.activityContext(),
      claimContext: () => opened.claimContext(),
      writer: () => (writer ??= commandWriter()),
    });
    io.out(render(writer === undefined ? answer : { ...answer, text: `${answer.text}\nWriter: ${writer.actor}` }));
    return 0;
  } catch (error) {
    if (error instanceof Refusal) {
      io.err(render({ text: error.message, next: error.next }));
      return error.code;
    }
    // Everything else is the owning story's own refusal, in its own words.
    io.err(`${error instanceof Error ? error.message : String(error)}\n`);
    return 1;
  } finally {
    await opened.close();
  }
}

async function dispatch(argv: readonly string[], context: Context): Promise<Answer> {
  const [first, ...rest] = argv;
  if (first === undefined || first === "--help" || first === "-h" || first === "help") return families();
  const family = FAMILIES.find((candidate) => candidate.name === first || candidate.aliases?.includes(first));
  if (family === undefined) {
    throw new Refusal(`storytree has no "${first}"`, { code: 2, next: [{ command: "storytree", why: "the families it has" }] });
  }
  return dispatchIn(family, family.name, rest, context);
}

/** Run `words` in `family`, which `storytree <path>` names. */
async function dispatchIn(family: Family, path: string, words: readonly string[], context: Context): Promise<Answer> {
  if (family.waitsOn !== undefined) throw new Refusal(`storytree ${path} is not built yet: ${family.waitsOn}`);
  const [second, ...rest] = words;
  const inner = family.families?.find((candidate) => candidate.name === second);
  if (inner !== undefined) return dispatchIn(inner, `${path} ${inner.name}`, rest, context);
  const verb = family.verbs.find((candidate) => candidate.name === second);
  if (verb !== undefined) return verb.act(parseArgs(rest, verb.switches ?? [], context.cwd), context);
  const help = second === undefined || second === "--help" || second === "-h";
  if (family.bare !== undefined && !(help && second !== undefined)) {
    return family.bare.act(parseArgs(words, family.bare.switches ?? [], context.cwd), context);
  }
  if (help) return verbsOf(family, path);
  throw new Refusal(`storytree ${path} has no "${second}"`, { code: 2, next: [{ command: `storytree ${path}`, why: "its verbs" }] });
}

/** `storytree` alone: the families. */
function families(): Answer {
  const width = Math.max(...FAMILIES.map((family) => family.name.length));
  const lines = FAMILIES.map((family) => `  ${family.name.padEnd(width)}   ${family.summary}${family.waitsOn === undefined ? "" : " (not built yet)"}`);
  return {
    text: ["storytree: read and change your project's records from a terminal.", "", "Families:", ...lines].join("\n"),
    next: [
      { command: "storytree <family>", why: "a family's verbs" },
      { command: "storytree setup install", why: "register storytree's hooks and command" },
    ],
  };
}

/** `storytree <family>`: its verbs, and those of the families within it. */
function verbsOf(family: Family, path: string): Answer {
  const verbs = [...(family.bare === undefined ? [] : [family.bare]), ...family.verbs, ...(family.families ?? []).flatMap((inner) => inner.verbs)];
  const lines = verbs.flatMap((verb) => [`  storytree ${verb.usage}`, `      ${verb.summary}`]);
  return { text: [`storytree ${family.name}: ${family.summary}.`, "", ...lines].join("\n") };
}

/** The connection to storytree and the project's library, made on first use and closed at the end. */
class Opened {
  readonly #cwd: string;
  #storytree: Promise<Storytree> | undefined;
  #library: Promise<Library> | undefined;
  #log: Promise<ActivityLog> | undefined;

  constructor(cwd: string) {
    this.#cwd = cwd;
  }

  library(): Promise<Library> {
    return (this.#library ??= this.#open());
  }

  async claims(): Promise<Claim[]> {
    const where = this.#routed();
    const log = await openActivityLog(await this.#server());
    try {
      return await readClaims(log, where.project);
    } finally {
      await log.close();
    }
  }

  async claimContext(): Promise<ClaimContext & { readonly folder: string }> {
    const caller = commandSession();
    if (caller === undefined) throw new Refusal("Run workspace from the agent's shell: a claim belongs to the agent session that will work there.");
    return this.activityContext();
  }

  async activityContext(): Promise<ClaimContext & { readonly folder: string }> {
    const caller = commandSession() ?? { session: `person:${person()}` };
    const where = this.#routed();
    const library = await this.library();
    const log = await (this.#log ??= this.#server().then((storytree) => openActivityLog(storytree)));
    return { log, library, project: where.project, folder: this.#cwd, ...caller };
  }

  async #open(): Promise<Library> {
    const where = this.#routed();
    return (await this.#server()).openProject(where.project);
  }

  /** The connection to the library where routing says it is: the app's local database, or the Cloud SQL instance the user set. */
  #server(): Promise<Storytree> {
    return (this.#storytree ??= (async () => {
      const { connect } = await import("@storytree/library");
      return connect(this.#routed().library);
    })());
  }

  /** The project and where its library is, or the refusal saying why there are none. */
  #routed(): { project: string; library: ConnectOptions } {
    const where = route(this.#cwd);
    if (where.status === "not-a-project") {
      throw new Refusal(`${where.message}: no .storytree.json in ${this.#cwd} or any folder above it`, {
        next: [{ command: "cd <your project's folder>", why: "run it where your project is" }],
      });
    }
    if (where.status === "not-running") {
      throw new Refusal(`${where.message}: open the storytree app, then run this again`);
    }
    return where;
  }

  async close(): Promise<void> {
    await Promise.allSettled([this.#log?.then((log) => log.close())]);
    await Promise.allSettled([this.#library?.then((library) => library.close())]);
    await Promise.allSettled([this.#storytree?.then((storytree) => storytree.close())]);
  }
}
