/**
 * Capability 1 · Front door (the command line story): `storytree <family> <verb>` works out which project
 * the folder you are in belongs to, opens that project's library, and hands the command to the
 * owning story's function, keeping no rule of its own. Every answer is a short plain sentence or
 * listing, offering next only the commands that open what it named (ADR-0786), and a failure exits
 * non-zero and says what to do; a command it does not have answers with the real one for that job.
 *
 * - The project is Session management's project routing (its capability 1) from the folder the command
 *   runs in: the nearest `.storytree.json` at or above it. Where storytree is, is the same routing's
 *   reading of the storytree home (STORYTREE_HOME, else ~/.storytree/0.3). "Not a project" and
 *   "not running" are its words, and come back before anything reaches a database.
 * - The library is reached only through its public API, opened on first use, so a command that
 *   needs none (the help) never connects.
 * - A verb imports the other stories' code it calls inside its act, never at the top of its family's
 *   file: the door and the menus statically load only Session management's light routing entry, so the
 *   help and the "not a project" and "not running" answers parse no more than that (contract 1.3).
 * - `--help` (or `-h`) after a command answers its usage and summary and runs nothing, whatever
 *   else the command would need.
 * - Exit codes: 0 answered; 1 refused (by the library, which is printed in its own words, or by
 *   the door, which says what to do); 2 a command used wrongly, with its usage.
 */
import type { ActivityLog } from "@storytree/session-management";
import { openNamedProject, ProjectFolderError, requireApproval, route } from "@storytree/project-and-caller/routing";
import { sourceVersion } from "@storytree/app/version";
import type { ConnectOptions, Library, Storytree, WriteOptions } from "@storytree/library";
import type { Consumer } from "@storytree/library/verbs";
import { printable } from "@storytree/library/printable";

import { Refusal, render, UnknownCommand, type Answer, type Next } from "./answer.js";
import { parseArgs, type Args } from "./args.js";
import { changedByQuoting } from "./handed.js";
import { FAMILIES, familiesOff, GUESSES, POINTERS } from "./families/index.js";
import { recordKindsMounted } from "./mount.js";
import { commandSession, commandWriter, person } from "./writer.js";

/**
 * Who is claiming, releasing or landing, and where, as the door fills it in for Session management's
 * claim calls: the door's own copy of the fields it sets (ADR-1017 D2).
 */
export type ClaimContext = {
  readonly log: ActivityLog;
  readonly library: Library;
  readonly project: string;
  readonly session: string;
  readonly harness?: string;
  readonly folder: string;
  readonly branch?: string;
};

/**
 * A claim as the commands read it, from Session management's reading of its activity log: the door's own copy
 * of the fields they read (ADR-1017 D2).
 */
export type Claim = {
  readonly session: string;
  readonly label: string;
  readonly reason: string;
  readonly since: string;
  readonly branch?: string | undefined;
  readonly holder: "live" | "idle";
  readonly increment?: string | undefined;
  readonly capability?: string | undefined;
};

type JourneyRuntime = ReturnType<typeof import("@storytree/app-setup/journey-events/runtime").createJourneyRuntime>;

/** Where a command runs, and where its answer goes. */
export interface Io {
  readonly cwd: string;
  /** The command's own script, as Node ran it: storytree's other commands sit beside an installed one. */
  readonly script?: string;
  /** The words as pnpm was handed them, when pnpm's script ran this command (./handed.ts). */
  readonly handed?: readonly string[];
  /** The line the Windows launcher was handed, after its own name, when it started this command (./handed.ts). */
  readonly launched?: string;
  /**
   * Whether `err` reaches a person's terminal. Only then is a wait on the library said as it starts:
   * Windows PowerShell 5.1 reads any captured stderr as a failed command, and a pipe cut short after
   * that first line ends the command before it writes (seen 2026-10-08).
   */
  readonly terminal?: boolean;
  out(text: string): void;
  err(text: string): void;
}

/** What a verb is handed besides its words: the folder, and the project's library on first use. */
export interface Context {
  readonly cwd: string;
  /** The command's own script, when known. */
  readonly script?: string;
  /** Say something before the answer, as a command that waits on the person (a sign-in code) must. */
  out(text: string): void;
  /** The project's library: the project the folder belongs to, on the running storytree. */
  library(): Promise<Library>;
  /** The connection the library is opened on, which hands out a story's own database (ADR-0973). */
  server(): Promise<Storytree>;
  /** The writer to pass to every write; using it also names that writer in the answer. */
  writer(): WriteOptions;
  /** Who holds what in the project right now: Session management's reading of its activity log. */
  claims(): Promise<Claim[]>;
  /** The caller and activity log, including a person closing an increment from their terminal. */
  activityContext(): Promise<ClaimContext & { readonly server?: Storytree }>;
  /** The calling agent and the resources its claims use; refuses a shell with no agent session. */
  claimContext(): Promise<ClaimContext>;
  /** The journey story's shared consent controls, opened only when a command acts. */
  journey(): Promise<JourneyRuntime>;
}

/** One verb of a family: `storytree <family> <name> …`. */
export interface Verb {
  readonly name: string;
  /** How it is used, after `storytree `: `library search <words…>`. */
  readonly usage: string;
  readonly summary: string;
  /** Its flags that take no value. */
  readonly switches?: readonly string[];
  /** Who calls it (ADR-1045 D1): left out, both an agent and a person. */
  readonly consumers?: readonly Consumer[];
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
  /** Words for a step storytree has retired, each with why and the command for the job now (after `storytree `). */
  readonly retired?: Readonly<Record<string, { readonly why: string; readonly instead: string }>>;
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
export async function run(argv: readonly string[], given: Io): Promise<number> {
  // Everything printed is library text at heart, so no control character in it reaches the terminal (contract 1.43).
  const io: Io = { ...given, out: (text) => given.out(printable(text)), err: (text) => given.err(printable(text)) };
  const changed = io.handed === undefined ? -1 : changedWord(argv, io.handed);
  if (changed !== -1) {
    io.err(render({ text: `storytree did nothing: the shell pnpm runs scripts through changed word ${changed + 1} ("${preview(io.handed?.[changed] ?? "")}") on its way here, as it does a $ or a line break. Put that text in a file and pass @<file> in its place, as in --answer @answer.txt.` }));
    return 1;
  }
  const requoted = io.launched === undefined ? undefined : changedByQuoting(io.launched, argv);
  if (requoted !== undefined) {
    io.err(render({ text: `storytree did nothing: word ${requoted + 1} ("${preview(argv[requoted] ?? "")}") arrived with its double quotes changed, as Windows PowerShell 5.1 hands on a word that holds a space and a double quote. Put that text in a file and pass @<file> in its place, as in --answer @answer.txt, or write each double quote inside it as \\".` }));
    return 1;
  }
  const opened = new Opened(io.cwd, io.terminal === true ? (what) => io.err(`storytree: ${what}\n`) : () => {});
  let writer: WriteOptions | undefined;
  let journey: Promise<JourneyRuntime> | undefined;
  // The command as this door names it, as far as its words reached, and how it was answered (ADR-0983 D1).
  const heard: Heard = { verb: "storytree" };
  let outcome: DoorOutcome | undefined;
  // The word a pointer ran its command for, and where it was typed (ADR-1045 D4).
  let pointed: { readonly word: string; readonly pointedFrom: string } | undefined;
  try {
    const context: Context = {
      cwd: io.cwd,
      ...(io.script === undefined ? {} : { script: io.script }),
      out: (text) => io.out(render({ text })),
      library: () => opened.library(),
      server: () => opened.server(),
      claims: () => opened.claims(),
      activityContext: () => opened.activityContext(),
      claimContext: () => opened.claimContext(),
      writer: () => (writer ??= commandWriter()),
      journey: () => (journey ??= import("@storytree/app-setup/journey-events/runtime").then(({ createJourneyRuntime }) =>
        createJourneyRuntime({ appVersion: sourceVersion()?.version ?? "0.3.0" }))),
    };
    const answer = await dispatch(argv, heard, context).catch(async (thrown: unknown) => {
      // A word the doors learner pointed in this place runs its command with the words after it, and says so (ADR-1045 D4).
      const to = thrown instanceof Unheard ? await opened.pointer(thrown.where, thrown.word) : undefined;
      if (to === undefined) throw thrown;
      const unheard = thrown as Unheard;
      pointed = { word: unheard.word, pointedFrom: unheard.where };
      const ran = await dispatch([...to.split(" ").slice(1), ...unheard.rest], heard, context);
      return { ...ran, text: `"${unheard.where} ${unheard.word}" is pointed to ${to} (ADR-1045 D4): the sessions it was refused in before went on to run that.\n${ran.text}` };
    });
    io.out(render(writer === undefined ? answer : { ...answer, text: `${answer.text}\nWriter: ${writer.actor}` }));
    outcome = { outcome: "answered", next: stepVerbs(answer.next), ...pointed };
    return 0;
  } catch (thrown) {
    // A word the door does not have is worded only now, with the hints its own history offers (ADR-1045 D2, D3).
    const error = thrown instanceof Unheard && pointed === undefined ? await repointed(thrown, opened, io.cwd) : thrown;
    outcome = { ...outcomeOf(error), ...pointed };
    if (error instanceof Refusal) {
      io.err(render({ text: error.message, next: error.next }));
      return error.code;
    }
    // Everything else is the owning story's own refusal, in its own words.
    io.err(`${error instanceof Error ? error.message : String(error)}\n`);
    return 1;
  } finally {
    // Recorded once the answer is out, and never in its way.
    if (outcome !== undefined) await opened.answered({ verb: heard.verb, ...outcome }).catch(() => {});
    await opened.close();
    // Observation must finish before this short-lived process exits, without changing its answer.
    await journey?.then((runtime) => runtime.finish()).catch(() => {});
  }
}

/** A word as a refusal names it: its first line, cut at 40 characters. */
function preview(word: string): string {
  const line = word.split(/\r?\n/, 1)[0] ?? "";
  return line.length > 40 || line.length < word.length ? `${line.slice(0, 40)}…` : line;
}

/** The index of the first handed word that did not arrive as handed, or -1 when every one did (contract 1.11). */
function changedWord(argv: readonly string[], handed: readonly string[]): number {
  const at = handed.findIndex((word, index) => argv[index] !== word);
  return at !== -1 || argv.length === handed.length ? at : handed.length;
}

/** The command as the door names it, `storytree arc increment close`, as far as the words reached a family or verb. */
interface Heard {
  verb: string;
}

/** The door's "no" to a command the lane's experiment arm denies: recorded as denied-by-arm, not as a refusal. */
class DeniedByArm extends Refusal {}

/** How a command was answered, as its `door-answered` line records it. */
interface DoorOutcome {
  readonly outcome: "answered" | "unknown" | "refused" | "failed" | "denied-by-arm";
  readonly word?: string;
  readonly pointedFrom?: string;
  readonly named?: string;
  readonly class?: string;
  readonly next: string[];
}

/**
 * A refusal or failure as its line records it: an unknown word with the command named for it, the door's own
 * "no" (a verb's included), or anything else the owning story threw, with its class, which tells a library refusal from a crash.
 */
function outcomeOf(error: unknown): DoorOutcome {
  if (error instanceof DeniedByArm) return { outcome: "denied-by-arm", next: [] };
  if (error instanceof UnknownCommand) {
    const named = error.named === undefined ? undefined : verbOf(`storytree ${error.named}`) ?? error.named;
    return { outcome: "unknown", word: error.word, ...(named === undefined ? {} : { named }), next: stepVerbs(error.next) };
  }
  if (error instanceof Refusal) return { outcome: "refused", next: stepVerbs(error.next) };
  const name = error instanceof Error && error.name !== "" ? error.name : undefined;
  return { outcome: "failed", ...(name === undefined ? {} : { class: name }), next: [] };
}

/** The offered steps that are storytree commands, each as the verb it runs. */
function stepVerbs(next: readonly Next[] | undefined): string[] {
  return (next ?? []).flatMap((step) => {
    const verb = verbOf(step.command);
    return verb === undefined ? [] : [verb];
  });
}

/** The family or verb `command` runs, walked over the door's own table, or nothing when it names none. */
function verbOf(command: string): string | undefined {
  const [first, ...words] = command.trim().split(/\s+/);
  if (first !== "storytree") return undefined;
  let family = FAMILIES.find((candidate) => candidate.name === words[0] || candidate.aliases?.includes(words[0] ?? ""));
  if (family === undefined) return undefined;
  let path = `storytree ${family.name}`;
  for (const word of words.slice(1)) {
    const inner: Family | undefined = family.families?.find((candidate) => candidate.name === word);
    if (inner !== undefined) {
      family = inner;
      path = `${path} ${inner.name}`;
      continue;
    }
    if (family.verbs.some((verb) => verb.name === word)) return `${path} ${word}`;
    break;
  }
  return path;
}

async function dispatch(argv: readonly string[], heard: Heard, context: Context): Promise<Answer> {
  const [first, ...rest] = argv;
  if (first === undefined || first === "--help" || first === "-h" || first === "help") return await families();
  if (first === "--version") return version();
  const family = FAMILIES.find((candidate) => candidate.name === first || candidate.aliases?.includes(first));
  const off = family === undefined ? undefined : (await switchedOffNow()).get(family.name);
  if (off !== undefined) {
    heard.verb = `storytree ${family!.name}`;
    const { offSaid } = await import("@storytree/plugin-loader");
    throw new Refusal(`storytree ${family!.name} is not mounted: ${offSaid(off)}`, { next: [{ command: `storytree settings set part ${off.because} on`, why: "switch it on" }] });
  }
  if (family === undefined) {
    if (Object.hasOwn(POINTERS, first)) return pointedBy(first, rest, heard, context);
    const named = FAMILIES.filter((candidate) => candidate.waitsOn === undefined).map((candidate) => ({ name: candidate.name, command: candidate.name }));
    const guessed = [`${first} ${rest[0]}`, first].find((words) => Object.hasOwn(GUESSES, words));
    throw unknown("storytree", first, guessed === undefined ? undefined : GUESSES[guessed], "Its families", named, rest);
  }
  return dispatchIn(family, family.name, rest, heard, context);
}

/** Run the command `words` (after `storytree`) are hand-pointed to, with the words after them, saying so unless the answer is raw. */
async function pointedBy(words: string, rest: readonly string[], heard: Heard, context: Context): Promise<Answer> {
  const to = POINTERS[words]!;
  const ran = await dispatch([...to.split(" "), ...rest], heard, context);
  return ran.raw === true ? ran : { ...ran, text: `storytree ${words} is storytree ${to}\n${ran.text}` };
}

/** `storytree --version`: the 0.3.<n> of the build this command comes from (ADR-0753 D2). */
function version(): Answer {
  const build = sourceVersion();
  if (build === undefined) throw new Refusal("storytree cannot tell its version: this build is not in a storytree checkout and carries no release version.");
  return { text: `storytree ${build.version} (${build.commit})` };
}

/** Run `words` in `family`, which `storytree <path>` names. */
async function dispatchIn(family: Family, path: string, words: readonly string[], heard: Heard, context: Context): Promise<Answer> {
  heard.verb = `storytree ${path}`;
  if (family.waitsOn !== undefined) throw new Refusal(`storytree ${path} is not built yet: ${family.waitsOn}`);
  const [second, ...rest] = words;
  const inner = family.families?.find((candidate) => candidate.name === second);
  if (inner !== undefined) return dispatchIn(inner, `${path} ${inner.name}`, rest, heard, context);
  const verb = family.verbs.find((candidate) => candidate.name === second);
  if (verb !== undefined) heard.verb = `storytree ${path} ${verb.name}`;
  if (verb !== undefined) return asksHelp(rest) ? helpOf(verb) : act(verb, parseArgs(rest, verb.switches ?? [], context.cwd), context, heard);
  const pointer = `${path} ${second}`;
  if (second !== undefined && Object.hasOwn(POINTERS, pointer)) return pointedBy(pointer, rest, heard, context);
  // A word the family names as a guess points to the command for that job before its bare verb would take it as its own.
  const guessed = second !== undefined && Object.hasOwn(family.guesses ?? {}, second) ? family.guesses?.[second] : undefined;
  const help = second === undefined || second === "--help" || second === "-h";
  if (family.bare !== undefined && guessed === undefined && !(help && second !== undefined)) {
    return act(family.bare, parseArgs(words, family.bare.switches ?? [], context.cwd), context, heard);
  }
  if (help) return verbsOf(family, path);
  const named = [
    ...family.verbs.map((verb) => ({ name: verb.name, command: verb.usage })),
    ...(family.families ?? []).map((inner) => ({ name: inner.name, command: `${path} ${inner.name}` })),
  ];
  const retired = Object.hasOwn(family.retired ?? {}, second) ? family.retired?.[second] : undefined;
  if (retired !== undefined) throw new Refusal(`storytree ${path} ${second} is retired: ${retired.why}\nRun storytree ${retired.instead}`, { code: 2, next: [] });
  throw unknown(`storytree ${path}`, second, guessed, "Its commands", named, rest);
}

/**
 * Run a verb, unless an arm check the mounted parts contribute denies it (ADR-1064 D2: the experiment arm this storytree
 * home names); with none mounted, every verb runs. A successful invocation may record only the installed app version,
 * never the command's words.
 */
async function act(verb: Verb, args: Args, context: Context, heard: Heard): Promise<Answer> {
  const { armChecks } = await import("./mount.js");
  const verdict = (await armChecks()).map((check) => check.verdict("command", heard.verb)).find((one) => !one.allowed);
  if (verdict !== undefined && !verdict.allowed) throw new DeniedByArm(verdict.message);
  const answer = await verb.act(args, context);
  try { (await context.journey()).record("app_version"); } catch { /* Optional observation cannot fail a command. */ }
  return answer;
}

/**
 * A word the door does not have, before its refusal is worded (`repointed`): where it was given, the real command for
 * that job when agents are known to guess the word, the real ones near it by spelling, and what there is to choose from.
 */
class Unheard extends UnknownCommand {
  readonly where: string;
  readonly handPicked: string | undefined;
  readonly spelled: readonly string[];
  readonly choices: string;
  /** The words typed after it. */
  readonly rest: readonly string[];

  constructor(where: string, word: string, handPicked: string | undefined, spelled: readonly string[], choices: string, rest: readonly string[]) {
    super(`${where} has no "${word}"\n${choices}`, word, undefined, { code: 2 });
    this.where = where;
    this.rest = rest;
    this.handPicked = handPicked;
    this.spelled = spelled;
    this.choices = choices;
  }
}

function unknown(where: string, word: string, handPicked: string | undefined, listed: string, named: readonly { name: string; command: string }[], rest: readonly string[]): Unheard {
  return new Unheard(where, word, handPicked, nearby(word, named), `${listed}: ${named.map((one) => one.name).join(", ")}.`, rest);
}

/**
 * The door's answer to a word it does not have (ADR-1045 D2, D3): up to three next steps, the commands sessions ran
 * after the word was refused there before, the hand-picked one and the nearest by spelling, rotated so position does
 * not choose. A mistake (a real verb, of either door, in the wrong place) leads with, says and names its right command
 * for the job; a guess (a word nowhere) names only its hand-picked command, when it has one (ADR-1090 D1).
 */
async function repointed(unheard: Unheard, opened: Opened, folder: string): Promise<UnknownCommand> {
  const { repointHints } = await import("./usage/repoint.js");
  const learned = await opened.learned(unheard.where, unheard.word);
  // Each hint is keyed by the command it runs, shown with its usage, or the hand-picked text where one was given.
  const shown = new Map<string, string>();
  const hint = (command: string, why: string) => {
    const key = verbOf(`storytree ${command}`) ?? `storytree ${command}`;
    if (!shown.has(key)) shown.set(key, `storytree ${command}`);
    return { command: key, why };
  };
  const handPicked = unheard.handPicked === undefined ? undefined : hint(unheard.handPicked, "the command for this job");
  const spelled = unheard.spelled.map((command) => hint(command, "nearest by spelling"));
  const taught = learned.map(({ verb, count }) => ({ command: verb, why: `run next after this word ${count} time${count === 1 ? "" : "s"}` }));
  const mistake = await isVerb(unheard.word, folder);
  const right = mistake && taught[0] !== undefined ? { ...taught[0], why: "the command for this job" } : handPicked;
  const hints = repointHints({
    ...(right === undefined ? {} : { right }),
    learned: taught,
    ...(handPicked === undefined ? {} : { handPicked }),
    spelled,
    turn: Math.floor(Date.now() / 1000),
  });
  const display = (key: string) => shown.get(key) ?? usageOf(key);
  const said = right === undefined ? "" : `: run ${display(right.command)}`;
  return new UnknownCommand(`${unheard.where} has no "${unheard.word}"${said}\n${unheard.choices}`, unheard.word, right?.command.replace(/^storytree /, ""), {
    code: 2,
    next: hints.length === 0
      ? [{ command: unheard.where, why: "each command, with its usage" }]
      : hints.map((one) => ({ command: display(one.command), why: one.why })),
  });
}

/** Whether `word` is a real verb of either door: a family, a family within one or a verb anywhere in the door's table, or a tool. */
async function isVerb(word: string, folder: string): Promise<boolean> {
  const named = (family: Family): boolean =>
    family.name === word || (family.aliases ?? []).includes(word) || family.verbs.some((verb) => verb.name === word) || (family.families ?? []).some(named);
  if (FAMILIES.some(named)) return true;
  try {
    const { servedTools } = await import("@storytree/mcp-server");
    return (await servedTools(folder)).some((tool) => tool.name === word);
  } catch {
    return false;
  }
}

/** `verb` (a path the door names, `storytree library search`) as its usage shows it, else as it is. */
function usageOf(verb: string): string {
  const [, ...words] = verb.split(" ");
  let family = FAMILIES.find((candidate) => candidate.name === words[0]);
  if (family === undefined) return verb;
  for (const word of words.slice(1)) {
    const inner: Family | undefined = family.families?.find((candidate) => candidate.name === word);
    if (inner !== undefined) {
      family = inner;
      continue;
    }
    const found = family.verbs.find((candidate) => candidate.name === word);
    return found === undefined ? verb : `storytree ${found.usage}`;
  }
  return family.bare === undefined ? verb : `storytree ${family.bare.usage}`;
}

/** The commands whose names are close enough to `word` to be the one meant, closest first. */
function nearby(word: string, named: readonly { name: string; command: string }[]): string[] {
  const most = Math.max(1, Math.floor(word.length / 3));
  return named
    .map((one) => ({ distance: editDistance(word.toLowerCase(), one.name), command: one.command }))
    .filter((one) => one.distance <= most)
    .sort((a, b) => a.distance - b.distance)
    .map((one) => one.command);
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

/** The declared families this computer's setting switches off (ADR-1095), read afresh for each command. */
async function switchedOffNow(): Promise<ReturnType<typeof familiesOff>> {
  const { readPartsOff } = await import("@storytree/project-and-caller");
  return familiesOff(readPartsOff());
}

/** `storytree` alone: the families, but those a switched-off part declares. */
async function families(): Promise<Answer> {
  const off = await switchedOffNow();
  const listed = FAMILIES.filter((family) => !off.has(family.name));
  const width = Math.max(...listed.map((family) => family.name.length));
  const lines = listed.map((family) => `  ${family.name.padEnd(width)}   ${family.summary}${family.waitsOn === undefined ? "" : " (not built yet)"}`);
  return {
    text: ["storytree: read and change your project's records from a terminal.", "", "Families:", ...lines].join("\n"),
    next: [{ command: "storytree <family>", why: "a family's verbs" }],
  };
}

/** `storytree <family>`: its verbs, and those of the families within it. */
function verbsOf(family: Family, path: string): Answer {
  const verbs = [...(family.bare === undefined ? [] : [family.bare]), ...family.verbs, ...(family.families ?? []).flatMap((inner) => inner.verbs)];
  const lines = verbs.flatMap((verb) => [`  storytree ${verb.usage}`, `      ${verb.summary}`]);
  return { text: [`storytree ${path}: ${family.summary}.`, "", ...lines].join("\n") };
}

/** The connection to storytree and the project's library, made on first use and closed at the end. */
class Opened {
  readonly #cwd: string;
  /** Where a wait on the library is said as it starts (stderr, on a terminal), so a person never waits in silence. */
  readonly #say: (what: string) => void;
  #storytree: Promise<Storytree> | undefined;
  #approved: Promise<Storytree> | undefined;
  #library: Promise<Library> | undefined;
  #log: Promise<ActivityLog> | undefined;

  constructor(cwd: string, say: (what: string) => void) {
    this.#cwd = cwd;
    this.#say = say;
  }

  library(): Promise<Library> {
    return (this.#library ??= this.#open());
  }

  server(): Promise<Storytree> {
    return this.#server();
  }

  async claims(): Promise<Claim[]> {
    const where = this.#routed();
    const { openActivityLog, readClaims } = await import("@storytree/session-management");
    const log = await openActivityLog(await this.#server());
    try {
      return await readClaims(log, where.project);
    } finally {
      await log.close();
    }
  }

  async claimContext(): Promise<ClaimContext> {
    const caller = commandSession();
    if (caller === undefined) throw new Refusal("Run workspace from the agent's shell: a claim belongs to the agent session that will work there.");
    return this.activityContext();
  }

  /**
   * Record how the command was answered on the agent session that ran it (ADR-0983 D1): nothing from a
   * person's own terminal, which would add a row to the sessions list, nor in a folder that is no project,
   * where storytree is not running, or where this checkout is not approved.
   */
  async answered(answer: { verb: string } & DoorOutcome): Promise<void> {
    const caller = commandSession();
    if (caller === undefined || route(this.#cwd).status !== "routed") return;
    await (await this.#activityLog()).append(this.#routed().project, { ...caller, source: "tool", folder: this.#cwd, kind: "door-answered", door: "command", ...answer });
  }

  /** What sessions ran next after `word` was refused in `where` (ADR-1045 D3): none where the folder does not route, or on any error. */
  async learned(where: string, word: string): Promise<{ verb: string; count: number }[]> {
    if (route(this.#cwd).status !== "routed") return [];
    try {
      const { readLearned } = await import("./usage/read.js");
      return await readLearned(await this.#activityLog(), this.#routed().project, where, word, new Date());
    } catch {
      return [];
    }
  }

  /** The command `word`, typed in `where`, is pointed to (ADR-1045 D4): none where the folder does not route, its pointer fell back, or on any error. */
  async pointer(where: string, word: string): Promise<string | undefined> {
    if (route(this.#cwd).status !== "routed") return undefined;
    try {
      const { readPointer } = await import("./usage/read.js");
      return await readPointer(await this.#activityLog(), this.#routed().project, where, word);
    } catch {
      return undefined;
    }
  }

  async activityContext(): Promise<ClaimContext & { readonly server: Storytree }> {
    const caller = commandSession() ?? { session: `person:${person()}` };
    const where = this.#routed();
    const library = await this.library();
    // The folder's branch, as the MCP door's claim context carries it: a fix session on a handed-over pull request's branch takes over its held claims (ADR-1037 D2).
    const { currentBranch } = await import("@storytree/session-management");
    const branch = currentBranch(this.#cwd);
    return { log: await this.#activityLog(), library, server: await this.#server(), project: where.project, folder: this.#cwd, ...caller, ...(branch === undefined ? {} : { branch }) };
  }

  /** The project's activity log, opened once with no library. */
  async #activityLog(): Promise<ActivityLog> {
    const { currentBranch, openActivityLog, thisMachine } = await import("@storytree/session-management");
    const machine = thisMachine();
    // Lines written from a terminal name its machine and its folder's branch, as a hook's do (ADR-0754 D4).
    return (this.#log ??= this.#server().then((storytree) => openActivityLog(storytree, { branchOf: currentBranch, ...(machine === undefined ? {} : { machine }) })));
  }

  /**
   * The project, with the roles, checks and notes this computer's settings switch off left out of what it lists (ADR-1092
   * D2), and the kinds of record the factory plugins mounted here declare (ADR-1178 D3); a plugin whose kinds could not be
   * read is said, on a person's terminal, as its stand-in failing is.
   */
  async #open(): Promise<Library> {
    const where = this.#routed();
    const [{ readSystemSwitches }, { kinds, said }] = await Promise.all([import("@storytree/project-and-caller"), recordKindsMounted()]);
    for (const line of said) this.#say(line);
    return openNamedProject(await this.#server(), where.project, where.identity, { system: readSystemSwitches(), kinds });
  }

  /**
   * The connection, once this folder is approved as its project's checkout on this machine (ADR-0942
   * D1): a marker alone opens nothing, reads nothing and records nothing, as for hooks and tools.
   */
  #server(): Promise<Storytree> {
    return (this.#approved ??= this.#connection().then(async (storytree) => {
      const where = this.#routed();
      await requireApproval(storytree, where.project, where.folder).catch((error: unknown) => {
        throw error instanceof ProjectFolderError
          ? new Refusal(error.message, { next: [{ command: `storytree doctor --join ${where.project}`, why: `approve this folder as "${where.project}"'s checkout, if it is yours` }] })
          : error;
      });
      return storytree;
    }));
  }

  /** The connection to the library where routing says it is: the app's local database, or the Cloud SQL instance the user set. */
  #connection(): Promise<Storytree> {
    return (this.#storytree ??= (async () => {
      const { connect } = await import("@storytree/library");
      return connect({ ...this.#routed().library, onWait: this.#say });
    })());
  }

  /** The project and where its library is, or the refusal saying why there are none. */
  #routed(): { project: string; folder: string; identity?: string; library: ConnectOptions } {
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
