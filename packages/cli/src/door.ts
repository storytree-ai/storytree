// Capability 1 · Front door
import type { ActivityLog } from "@storytree/session-management";
import { openNamedProject, ProjectFolderError, requireApproval, route } from "@storytree/project-and-caller/routing";
import { sourceVersion } from "@storytree/app/version";
import type { ConnectOptions, Library, Storytree, WriteOptions } from "@storytree/library";
import type { Consumer } from "@storytree/library/verbs";
import { printable } from "@storytree/library/printable";

import { Refusal, render, UnknownCommand, type Answer, type Next } from "./answer.js";
import { parseArgs, type Args } from "./args.js";
import { FAMILIES, familiesOff, fromFactoryPlugin, GUESSES, NO_SUCH_JOB, POINTERS } from "./families/index.js";
import { recordKindsMounted } from "./mount.js";
import { commandSession, commandWriter, person } from "./writer.js";

export type ClaimContext = {
  readonly log: ActivityLog;
  readonly library: Library;
  readonly project: string;
  readonly session: string;
  readonly harness?: string;
  readonly folder: string;
  readonly branch?: string;
};

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

export interface Io {
  readonly cwd: string;
  readonly script?: string;
  readonly terminal?: boolean;
  out(text: string): void;
  err(text: string): void;
}

export interface Context {
  readonly cwd: string;
  readonly script?: string;
  out(text: string): void;
  library(): Promise<Library>;
  server(): Promise<Storytree>;
  writer(): WriteOptions;
  claims(): Promise<Claim[]>;
  activityContext(): Promise<ClaimContext & { readonly server?: Storytree }>;
  claimContext(): Promise<ClaimContext>;
  journey(): Promise<JourneyRuntime>;
}

export interface Verb {
  readonly name: string;
  readonly usage: string;
  readonly summary: string;
  readonly switches?: readonly string[];
  readonly consumers?: readonly Consumer[];
  act(args: Args, context: Context): Promise<Answer>;
}

export interface Family {
  readonly name: string;
  readonly aliases?: readonly string[];
  readonly guesses?: Readonly<Record<string, string>>;
  readonly retired?: Readonly<Record<string, { readonly why: string; readonly instead: string }>>;
  readonly summary: string;
  readonly verbs: readonly Verb[];
  readonly families?: readonly Family[];
  readonly bare?: Verb;
  readonly waitsOn?: string;
}

export async function run(argv: readonly string[], given: Io): Promise<number> {
  const io: Io = { ...given, out: (text) => given.out(printable(text)), err: (text) => given.err(printable(text)) };
  const opened = new Opened(io.cwd, io.terminal === true ? (what) => io.err(`storytree: ${what}\n`) : () => {});
  let writer: WriteOptions | undefined;
  let journey: Promise<JourneyRuntime> | undefined;
  const heard: Heard = { verb: "storytree" };
  let outcome: DoorOutcome | undefined;
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
      writer: () => (writer ??= { ...commandWriter(), ...opened.outsideRead() }),
      journey: () => (journey ??= import("@storytree/app-setup/journey-events/runtime").then(({ createJourneyRuntime }) =>
        createJourneyRuntime({ appVersion: sourceVersion()?.version ?? "0.3.0" }))),
    };
    await warnStaleFactory(argv[0], io);
    const answer = await dispatch(argv, heard, context).catch(async (thrown: unknown) => {
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
    const error = thrown instanceof Unheard && pointed === undefined ? await repointed(thrown, opened, io.cwd) : thrown;
    outcome = { ...outcomeOf(error), ...pointed };
    if (error instanceof Refusal) {
      io.err(render({ text: error.message, next: error.next }));
      return error.code;
    }
    io.err(`${error instanceof Error ? error.message : String(error)}\n`);
    return 1;
  } finally {
    if (outcome !== undefined) await opened.answered({ verb: heard.verb, ...outcome }).catch(() => {});
    await opened.close();
    await journey?.then((runtime) => runtime.finish()).catch(() => {});
  }
}

interface Heard {
  verb: string;
}

async function warnStaleFactory(word: string | undefined, io: Io): Promise<void> {
  const family = word === undefined ? undefined : FAMILIES.find((candidate) => candidate.name === word || candidate.aliases?.includes(word));
  if (family === undefined || !fromFactoryPlugin(family.name)) return;
  try {
    const [{ factoryFolder }, { factoryStale }] = await Promise.all([import("@storytree/project-and-caller"), import("@storytree/plugin-loader/factory")]);
    const line = await factoryStale(factoryFolder().folder);
    if (line !== undefined) io.err(`${line}\n`);
  } catch {
  }
}

class DeniedByArm extends Refusal {}

interface DoorOutcome {
  readonly outcome: "answered" | "unknown" | "refused" | "failed" | "denied-by-arm";
  readonly word?: string;
  readonly pointedFrom?: string;
  readonly named?: string;
  readonly class?: string;
  readonly next: string[];
}

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

function stepVerbs(next: readonly Next[] | undefined): string[] {
  return (next ?? []).flatMap((step) => {
    const verb = verbOf(step.command);
    return verb === undefined ? [] : [verb];
  });
}

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
    throw new Refusal(`storytree ${family!.name} is not mounted: ${offSaid(off)}`, { next: [{ command: `storytree settings set module ${off.because} on`, why: "switch it on" }] });
  }
  if (family === undefined) {
    const pointed = [`${first} ${rest[0]}`, first].find((words) => Object.hasOwn(POINTERS, words));
    if (pointed !== undefined) return pointedBy(pointed, pointed === first ? rest : rest.slice(1), heard, context);
    const held = await unnamedHolderOf(first);
    if (held !== undefined) {
      const naming = `storytree settings set module ${held.part} plugin ${held.plugin}`;
      throw new Refusal(`storytree has no "${first}": it is a family of the factory plugin ${held.plugin}, which this computer does not name. Name it with: ${naming}`, { code: 2, next: [{ command: naming, why: `mount ${held.plugin}'s families here` }] });
    }
    const named = FAMILIES.filter((candidate) => candidate.waitsOn === undefined).map((candidate) => ({ name: candidate.name, command: candidate.name }));
    const guessed = [`${first} ${rest[0]}`, first].find((words) => Object.hasOwn(GUESSES, words));
    throw unknown("storytree", first, guessed === undefined ? undefined : GUESSES[guessed], "Its families", named, rest);
  }
  return dispatchIn(family, family.name, rest, heard, context);
}

async function unnamedHolderOf(word: string) {
  const [{ readStandIns }, { unnamedOwnerOf }] = await Promise.all([import("@storytree/project-and-caller"), import("@storytree/plugin-loader/factory")]);
  try {
    return unnamedOwnerOf(readStandIns(), "verbs", word);
  } catch {
    return undefined;
  }
}

async function pointedBy(words: string, rest: readonly string[], heard: Heard, context: Context): Promise<Answer> {
  const to = POINTERS[words]!;
  const ran = await dispatch([...to.split(" "), ...rest], heard, context);
  return ran.raw === true ? ran : { ...ran, text: `storytree ${words} is storytree ${to}\n${ran.text}` };
}

function version(): Answer {
  const build = sourceVersion();
  if (build === undefined) throw new Refusal("storytree cannot tell its version: this build is not in a storytree checkout and carries no release version.");
  return { text: `storytree ${build.version} (${build.commit})` };
}

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
  if (second !== undefined && Object.hasOwn(NO_SUCH_JOB, pointer)) {
    const { why, instead } = NO_SUCH_JOB[pointer]!;
    const usage = usageOf(`storytree ${instead}`);
    throw new Refusal(`storytree ${path} has no "${second}": ${why}\nRun ${usage}`, { code: 2, next: [{ command: usage, why: "the command for this job" }] });
  }
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

async function act(verb: Verb, args: Args, context: Context, heard: Heard): Promise<Answer> {
  const [{ armChecks }, { nameReader }] = await Promise.all([import("./mount.js"), import("@storytree/library/reads")]);
  nameReader(heard.verb.replace(/^storytree /, ""));
  const verdict = (await armChecks()).map((check) => check.verdict("command", heard.verb)).find((one) => !one.allowed);
  if (verdict !== undefined && !verdict.allowed) throw new DeniedByArm(verdict.message);
  const answer = await verb.act(args, context);
  try { (await context.journey()).record("app_version"); } catch { }
  return answer;
}

class Unheard extends UnknownCommand {
  readonly where: string;
  readonly handPicked: string | undefined;
  readonly spelled: readonly string[];
  readonly choices: string;
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

async function repointed(unheard: Unheard, opened: Opened, folder: string): Promise<UnknownCommand> {
  const { repointHints } = await import("./usage/repoint.js");
  const learned = await opened.learned(unheard.where, unheard.word);
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

function nearby(word: string, named: readonly { name: string; command: string }[]): string[] {
  const most = Math.max(1, Math.floor(word.length / 3));
  return named
    .map((one) => ({ distance: editDistance(word.toLowerCase(), one.name), command: one.command }))
    .filter((one) => one.distance <= most)
    .sort((a, b) => a.distance - b.distance)
    .map((one) => one.command);
}

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

function asksHelp(words: readonly string[]): boolean {
  const end = words.indexOf("--");
  return (end === -1 ? words : words.slice(0, end)).some((word) => word === "--help" || word === "-h");
}

function helpOf(verb: Verb): Answer {
  return { text: `storytree ${verb.usage}\n    ${verb.summary}` };
}

async function switchedOffNow(): Promise<ReturnType<typeof familiesOff>> {
  const { readPartsOff } = await import("@storytree/project-and-caller");
  return familiesOff(readPartsOff());
}

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

function verbsOf(family: Family, path: string): Answer {
  const verbs = [...(family.bare === undefined ? [] : [family.bare]), ...family.verbs, ...(family.families ?? []).flatMap((inner) => inner.verbs)];
  const lines = verbs.flatMap((verb) => [`  storytree ${verb.usage}`, `      ${verb.summary}`]);
  return { text: [`storytree ${path}: ${family.summary}.`, "", ...lines].join("\n") };
}

class Opened {
  readonly #cwd: string;
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

  async answered(answer: { verb: string } & DoorOutcome): Promise<void> {
    const caller = commandSession();
    if (caller === undefined || route(this.#cwd).status !== "routed") return;
    await (await this.#activityLog()).append(this.#routed().project, { ...caller, source: "tool", folder: this.#cwd, kind: "door-answered", door: "command", ...answer });
  }

  async learned(where: string, word: string): Promise<{ verb: string; count: number }[]> {
    if (route(this.#cwd).status !== "routed") return [];
    try {
      const { readLearned } = await import("./usage/read.js");
      return await readLearned(await this.#activityLog(), this.#routed().project, where, word, new Date());
    } catch {
      return [];
    }
  }

  async pointer(where: string, word: string): Promise<string | undefined> {
    if (route(this.#cwd).status !== "routed") return undefined;
    try {
      const { readPointer } = await import("./usage/read.js");
      return await readPointer(await this.#activityLog(), this.#routed().project, where, word);
    } catch {
      return undefined;
    }
  }

  outsideRead(): Pick<WriteOptions, "outsideRead"> {
    const caller = commandSession();
    if (caller === undefined) return {};
    return {
      outsideRead: async () => {
        const { outsideTextReads } = await import("@storytree/session-management");
        return outsideTextReads(await this.#activityLog(), this.#routed().project, caller.session);
      },
    };
  }

  async activityContext(): Promise<ClaimContext & { readonly server: Storytree }> {
    const caller = commandSession() ?? { session: `person:${person()}` };
    const where = this.#routed();
    const library = await this.library();
    const { currentBranch } = await import("@storytree/session-management");
    const branch = currentBranch(this.#cwd);
    return { log: await this.#activityLog(), library, server: await this.#server(), project: where.project, folder: this.#cwd, ...caller, ...(branch === undefined ? {} : { branch }) };
  }

  async #activityLog(): Promise<ActivityLog> {
    const { currentBranch, openActivityLog, thisMachine } = await import("@storytree/session-management");
    const machine = thisMachine();
    return (this.#log ??= this.#server().then((storytree) => openActivityLog(storytree, { branchOf: currentBranch, ...(machine === undefined ? {} : { machine }) })));
  }

  async #open(): Promise<Library> {
    const where = this.#routed();
    const [{ readSystemSwitches }, { kinds, said }] = await Promise.all([import("@storytree/project-and-caller"), recordKindsMounted()]);
    for (const line of said) this.#say(line);
    return openNamedProject(await this.#server(), where.project, where.identity, { system: readSystemSwitches(), kinds });
  }

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

  #connection(): Promise<Storytree> {
    return (this.#storytree ??= (async () => {
      const { connect } = await import("@storytree/library");
      return connect({ ...this.#routed().library, onWait: this.#say });
    })());
  }

  #routed(): { project: string; folder: string; identity?: string; library: ConnectOptions } {
    const where = route(this.#cwd);
    if (where.status === "not-a-project") {
      throw new Refusal(`${where.message}: no .storytree/project.json (or older .storytree.json) in ${this.#cwd} or any folder above it`, {
        next: [{ command: "cd <your project's folder>", why: "run it where your project is" }],
      });
    }
    if (where.status === "not-running") {
      throw new Refusal(`${where.message}: open the storytree app, then run this again`);
    }
    return where;
  }

  async close(): Promise<void> {
    if (this.#approved !== undefined) await this.#approved.then(() => this.#activityLog()).catch(() => undefined);
    await Promise.allSettled([this.#log?.then((log) => log.close())]);
    await Promise.allSettled([this.#library?.then((library) => library.close())]);
    await Promise.allSettled([this.#storytree?.then((storytree) => storytree.close())]);
  }
}
