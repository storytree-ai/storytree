/**
 * Capability 1 · Front door (the command line story): `storytree <family> <verb>` works out which project
 * the folder you are in belongs to, opens that project's library, and hands the command to the
 * owning story's function, keeping no rule of its own. Every answer is a short plain sentence or
 * listing, offering next only the commands that open what it named (ADR-0786), and a failure exits
 * non-zero and says what to do; a command it does not have answers with the real one for that job.
 *
 * - The project is the agent link's project routing (its capability 1) from the folder the command
 *   runs in: the nearest `.storytree.json` at or above it. Where storytree is, is the same routing's
 *   reading of the storytree home (STORYTREE_HOME, else ~/.storytree/0.3). "Not a project" and
 *   "not running" are its words, and come back before anything reaches a database.
 * - The library is reached only through its public API, opened on first use, so a command that
 *   needs none (the help) never connects.
 * - `--help` (or `-h`) after a command answers its usage and summary and runs nothing, whatever
 *   else the command would need.
 * - Exit codes: 0 answered; 1 refused (by the library, which is printed in its own words, or by
 *   the door, which says what to do); 2 a command used wrongly, with its usage.
 */
import { currentBranch, openActivityLog, openNamedProject, readClaims, route, thisMachine, type ActivityLog, type Claim, type ClaimContext } from "@storytree/agent-link";
import { sourceVersion } from "@storytree/app/version";
import type { ConnectOptions, Library, Storytree, WriteOptions } from "@storytree/library";

import { Refusal, render, type Answer } from "./answer.js";
import { parseArgs, type Args } from "./args.js";
import { FAMILIES, GUESSES } from "./families/index.js";
import { commandSession, commandWriter, person } from "./writer.js";

/** Where a command runs, and where its answer goes. */
export interface Io {
  readonly cwd: string;
  /** The command's own script, as Node ran it: storytree's other commands sit beside an installed one. */
  readonly script?: string;
  /** The words as pnpm was handed them, when pnpm's script ran this command (./handed.ts). */
  readonly handed?: readonly string[];
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
  /**
   * Words agents try for a job another command does, each with that command (after `storytree `):
   * the refusal names it rather than running it, so each job keeps one name.
   */
  readonly guesses?: Readonly<Record<string, string>>;
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
  const changed = io.handed === undefined ? -1 : changedWord(argv, io.handed);
  if (changed !== -1) {
    const word = io.handed?.[changed] ?? "";
    const line = word.split(/\r?\n/, 1)[0] ?? "";
    const preview = line.length > 40 || line.length < word.length ? `${line.slice(0, 40)}…` : line;
    io.err(render({ text: `storytree did nothing: the shell pnpm runs scripts through changed word ${changed + 1} ("${preview}") on its way here, as it does a $ or a line break. Put that text in a file and pass @<file> in its place, as in --answer @answer.txt.` }));
    return 1;
  }
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

/** The index of the first handed word that did not arrive as handed, or -1 when every one did (contract 1.11). */
function changedWord(argv: readonly string[], handed: readonly string[]): number {
  const at = handed.findIndex((word, index) => argv[index] !== word);
  return at !== -1 || argv.length === handed.length ? at : handed.length;
}

async function dispatch(argv: readonly string[], context: Context): Promise<Answer> {
  const [first, ...rest] = argv;
  if (first === undefined || first === "--help" || first === "-h" || first === "help") return families();
  if (first === "--version") return version();
  const family = FAMILIES.find((candidate) => candidate.name === first || candidate.aliases?.includes(first));
  if (family === undefined) {
    const named = FAMILIES.filter((candidate) => candidate.waitsOn === undefined).map((candidate) => ({ name: candidate.name, command: candidate.name }));
    throw unknown("storytree", first, (Object.hasOwn(GUESSES, first) ? GUESSES[first] : undefined) ?? nearest(first, named), "Its families", named);
  }
  return dispatchIn(family, family.name, rest, context);
}

/** `storytree --version`: the 0.3.<n> of the build this command comes from (ADR-0753 D2). */
function version(): Answer {
  const build = sourceVersion();
  if (build === undefined) throw new Refusal("storytree cannot tell its version: this build is not in a storytree checkout and carries no release version.");
  return { text: `storytree ${build.version} (${build.commit})` };
}

/** Run `words` in `family`, which `storytree <path>` names. */
async function dispatchIn(family: Family, path: string, words: readonly string[], context: Context): Promise<Answer> {
  if (family.waitsOn !== undefined) throw new Refusal(`storytree ${path} is not built yet: ${family.waitsOn}`);
  const [second, ...rest] = words;
  const inner = family.families?.find((candidate) => candidate.name === second);
  if (inner !== undefined) return dispatchIn(inner, `${path} ${inner.name}`, rest, context);
  const verb = family.verbs.find((candidate) => candidate.name === second);
  if (verb !== undefined) return asksHelp(rest) ? helpOf(verb) : verb.act(parseArgs(rest, verb.switches ?? [], context.cwd), context);
  const help = second === undefined || second === "--help" || second === "-h";
  if (family.bare !== undefined && !(help && second !== undefined)) {
    return family.bare.act(parseArgs(words, family.bare.switches ?? [], context.cwd), context);
  }
  if (help) return verbsOf(family, path);
  const named = [
    ...family.verbs.map((verb) => ({ name: verb.name, command: verb.usage })),
    ...(family.families ?? []).map((inner) => ({ name: inner.name, command: `${path} ${inner.name}` })),
  ];
  const guessed = Object.hasOwn(family.guesses ?? {}, second) ? family.guesses?.[second] : undefined;
  throw unknown(`storytree ${path}`, second, guessed ?? nearest(second, named), "Its commands", named);
}

/**
 * The door's answer to a word it does not have: the real command for that job when agents are
 * known to guess the word, else the nearest real one by spelling, and what there is to choose from.
 */
function unknown(where: string, word: string, instead: string | undefined, listed: string, named: readonly { name: string }[]): Refusal {
  const said = instead === undefined ? "" : `: run storytree ${instead}`;
  const choices = `${listed}: ${named.map((one) => one.name).join(", ")}.`;
  return new Refusal(`${where} has no "${word}"${said}\n${choices}`, {
    code: 2,
    next: instead === undefined ? [{ command: where, why: "each command, with its usage" }] : [],
  });
}

/** The command whose name is closest to `word`, when it is close enough to be the one meant. */
function nearest(word: string, named: readonly { name: string; command: string }[]): string | undefined {
  let best: { distance: number; command: string } | undefined;
  for (const one of named) {
    const distance = editDistance(word.toLowerCase(), one.name);
    if (best === undefined || distance < best.distance) best = { distance, command: one.command };
  }
  return best !== undefined && best.distance <= Math.max(1, Math.floor(word.length / 3)) ? best.command : undefined;
}

/** Edits (insert, delete, change, or swap two neighbours) that turn `a` into `b`. */
function editDistance(a: string, b: string): number {
  const rows = Array.from({ length: a.length + 1 }, (_, i) => Array.from({ length: b.length + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)));
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let best = Math.min(rows[i - 1]![j]! + 1, rows[i]![j - 1]! + 1, rows[i - 1]![j - 1]! + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) best = Math.min(best, rows[i - 2]![j - 2]! + 1);
      rows[i]![j] = best;
    }
  }
  return rows[a.length]![b.length]!;
}

/** Whether a verb's words ask for its help: `--help` or `-h` before any `--`. */
function asksHelp(words: readonly string[]): boolean {
  const end = words.indexOf("--");
  return (end === -1 ? words : words.slice(0, end)).some((word) => word === "--help" || word === "-h");
}

/** `storytree <family> <verb> --help`: its usage and summary, as its family's menu shows them. */
function helpOf(verb: Verb): Answer {
  return { text: `storytree ${verb.usage}\n    ${verb.summary}` };
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
    const machine = thisMachine();
    // Lines written from a terminal name its machine and its folder's branch, as a hook's do (ADR-0754 D4).
    const log = await (this.#log ??= this.#server().then((storytree) => openActivityLog(storytree, { branchOf: currentBranch, ...(machine === undefined ? {} : { machine }) })));
    return { log, library, project: where.project, folder: this.#cwd, ...caller };
  }

  async #open(): Promise<Library> {
    const where = this.#routed();
    return openNamedProject(await this.#server(), where.project, where.identity);
  }

  /** The connection to the library where routing says it is: the app's local database, or the Cloud SQL instance the user set. */
  #server(): Promise<Storytree> {
    return (this.#storytree ??= (async () => {
      const { connect } = await import("@storytree/library");
      return connect(this.#routed().library);
    })());
  }

  /** The project and where its library is, or the refusal saying why there are none. */
  #routed(): { project: string; identity?: string; library: ConnectOptions } {
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
