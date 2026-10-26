/**
 * Capability 14 · Reading the doors' use. What the doors learn from their own lines (ADR-1045 D4 to D7), a pure count over
 * 28 days of both doors' door-answered lines with the declared surfaces and the pointers already written handed in; the
 * friction drain acts on it (./learner.ts).
 *
 * - A pointer (D4): a guessed word, judged as a want is, whose followed hints clear the bar points to its leading target.
 *   A word already pointed is not pointed again, and after a pointer fell back only follows since count.
 * - A fallback (D4): a pointer whose pointed calls mostly leave it, read as more than half of at least 5 pointed calls since
 *   it was written. A pointed call is left when it did not answer, or when its session's next command was another of the
 *   word's followed targets: the session went where the pointer did not send it.
 * - A want (D5): a guessed word refused at least 10 times in one place, whose followed hints stay below D4's bar for a
 *   pointer (at least 5 follows across at least 3 sessions, at least 70% to one command). A word is judged where it was
 *   refused, as D5's own `friction list` is, though `list` is a verb in other families; a tool's name typed as a command is
 *   the mistake D2 names, which keeps its refusal naming the command, and is never a want. Nor is a word holding
 *   whitespace: that is text that strayed into a command's place, such as a quoted argument, never a command's name.
 * - A cut candidate (D6): a verb whose consumers are only agents, with no call in the 28 days across at least 100
 *   sessions, grouped by its command family, or with the tools that have no command. A verb both doors mount is one
 *   candidate only when neither door called it; one door's unused while the other's carries the job is a door gap,
 *   reported apart and never cut. Nothing is a candidate unless the lines cover the whole window: silence before the
 *   log began is not disuse.
 */
import type { DeclaredVerb, DoorLine } from "./reading.js";

/** ADR-1045's starting bars, tuned only by decision. */
export const BARS = {
  days: 28,
  /** D5: refusals of one guessed word that make a want. */
  wantRefusals: 10,
  /** D4: follows to one command, the sessions they came from and that command's share of all the word's follows. */
  pointerFollows: 5,
  pointerSessions: 3,
  pointerShare: 0.7,
  /** D6: the sessions a window needs before a verb with no call in it is a cut candidate. */
  cutSessions: 100,
  /** D4's fallback, "mostly leave": pointed calls since the pointer before it is judged, and the share of them left that falls it back. */
  fallbackCalls: 5,
  fallbackShare: 0.5,
} as const;

/** A guessed word agents keep typing where no command answers it, and what its refusal's hints led to. */
export interface Want {
  /** Where it was refused, as the door names it: `storytree adr`. */
  readonly where: string;
  readonly word: string;
  readonly refusals: number;
  readonly sessions: number;
  /** Each refusal's hint the session's next answered call took, by target, most first. */
  readonly followed: readonly { readonly target: string; readonly count: number }[];
}

/** A pointer as its latest line holds it: no `to` once it fell back. `at` is when that line was written. */
export interface Pointer {
  readonly where: string;
  readonly word: string;
  readonly to?: string;
  readonly others: readonly string[];
  readonly at: string;
}

/** A word whose followed hints clear the bar, to be pointed to `to`, with the word's other followed targets and the evidence. */
export interface NewPointer {
  readonly where: string;
  readonly word: string;
  readonly to: string;
  readonly others: readonly string[];
  /** Follows to `to`, and the sessions they came from. */
  readonly follows: number;
  readonly sessions: number;
  readonly evidence: string;
}

/** A pointer whose pointed calls mostly left it: `left` of its `calls` since it was written. */
export interface Fallback {
  readonly where: string;
  readonly word: string;
  readonly to: string;
  readonly calls: number;
  readonly left: number;
  readonly evidence: string;
}

/** A verb the doors could forget, as its doors name it: its command, its tool, or both. */
export interface Candidate {
  readonly command?: string;
  readonly tool?: string;
}

/** A command family's candidates, or the tools' that have no command (`group` names which). */
export interface CutGroup {
  readonly group: string;
  readonly verbs: readonly Candidate[];
}

/** A verb one door has no call for while the other door's twin carries the job. */
export interface Gap {
  readonly unused: string;
  readonly carriedBy: string;
  readonly calls: number;
}

/** What 28 days of lines teach. `cuts` is absent when the lines cannot judge disuse: the window is not covered or has too few sessions. */
export interface Lesson {
  readonly sessions: number;
  readonly wants: readonly Want[];
  readonly pointers: readonly NewPointer[];
  readonly fallbacks: readonly Fallback[];
  readonly cuts?: readonly CutGroup[];
  /** The agent-only verbs with no call in the 28 days, grouped as cuts are, whatever the sessions; absent when the lines do not cover the window. */
  readonly unused?: readonly CutGroup[];
  readonly gaps: readonly Gap[];
}

/** The surfaces the learner judges: each door's declared verbs, and each verb both doors mount as its command and its tool. */
export interface Surfaces {
  readonly commands: readonly DeclaredVerb[];
  readonly tools: readonly DeclaredVerb[];
  readonly twins: readonly { readonly command: string; readonly tool: string }[];
}

/** The group of the tools that have no command. */
export const TOOLS_ALONE = "the tools with no command";

const DAY_MS = 24 * 60 * 60 * 1000;

/** Learn from `lines`, both doors' door-answered lines of the 28 days from `since`, oldest first, and `pointers`, the latest line of each word's pointer. */
export function learnDoors(lines: readonly DoorLine[], surfaces: Surfaces, since: string, pointers: readonly Pointer[] = []): Lesson {
  const sessions = new Set(lines.map((line) => line.session)).size;
  const covered = lines.length > 0 && Date.parse(lines[0]!.at) <= Date.parse(since) + DAY_MS;
  const { cuts, gaps } = disuse(lines, surfaces);
  const tools = new Set(surfaces.tools.map(({ verb }) => verb));
  const latest = new Map(pointers.map((pointer) => [JSON.stringify([pointer.where, pointer.word]), pointer] as const));
  const words = guesses(lines, tools, latest);
  return {
    sessions,
    wants: words.filter(({ key, refusals, targets }) => refusals >= BARS.wantRefusals && !clearsPointerBar(targets) && latest.get(key)?.to === undefined)
      .map(({ where, word, refusals, sessions: by, targets }) => ({ where, word, refusals, sessions: by, followed: targets.map(({ target, count }) => ({ target, count })) })),
    pointers: words.filter(({ key, targets }) => clearsPointerBar(targets) && latest.get(key)?.to === undefined).map((guess) => {
      const [lead, ...others] = guess.targets;
      return { where: guess.where, word: guess.word, to: lead!.target, others: others.map(({ target }) => target), follows: lead!.count, sessions: lead!.sessions, evidence: evidenceOf({ ...guess, followed: guess.targets }) };
    }),
    fallbacks: fallbacks(lines, pointers),
    ...(covered && sessions >= BARS.cutSessions ? { cuts } : {}),
    ...(covered ? { unused: cuts } : {}),
    gaps,
  };
}

/** The evidence a want or a pointer is written with: the word's refusals and where its followed hints went. */
export function evidenceOf(guess: Pick<Want, "where" | "word" | "refusals" | "sessions" | "followed">): string {
  const hints = guess.followed.length === 0 ? "no hint was followed" : `hints followed: ${guess.followed.map(({ target, count }) => `${target} ${count}`).join(", ")}`;
  return `"${guess.where} ${guess.word}" refused as unknown ${guess.refusals} times in ${guess.sessions} sessions; ${hints}.`;
}

/** Whether `followed`, a word's follows by target, clears D4's bar for a pointer to its leading target. */
export function clearsPointerBar(followed: readonly { readonly target: string; readonly count: number; readonly sessions: number }[]): boolean {
  const [lead] = followed;
  const total = followed.reduce((sum, { count }) => sum + count, 0);
  return lead !== undefined && lead.count >= BARS.pointerFollows && lead.sessions >= BARS.pointerSessions && lead.count / total >= BARS.pointerShare;
}

interface Guess {
  readonly key: string;
  readonly where: string;
  readonly word: string;
  readonly refusals: number;
  readonly sessions: number;
  /** Its followed hints by target, most first, counting only refusals after its pointer's latest line. */
  readonly targets: readonly { readonly target: string; readonly count: number; readonly sessions: number }[];
}

/** Each guessed word refused in a place, with its refusals and its follows. */
function guesses(lines: readonly DoorLine[], tools: ReadonlySet<string>, latest: ReadonlyMap<string, Pointer>): Guess[] {
  const words = new Map<string, { where: string; word: string; refusals: number; sessions: Set<string>; followed: Map<string, { count: number; sessions: Set<string> }> }>();
  const pending = new Map<string, { key: string; next: readonly string[] }>();
  for (const line of lines) {
    const before = pending.get(line.session);
    pending.delete(line.session);
    if (before !== undefined && line.outcome === "answered" && before.next.includes(line.verb)) {
      const followed = words.get(before.key)!.followed;
      const target = followed.get(line.verb) ?? { count: 0, sessions: new Set<string>() };
      target.count += 1;
      target.sessions.add(line.session);
      followed.set(line.verb, target);
    }
    if (line.door !== "command" || line.outcome !== "unknown" || line.word === undefined || line.pointedFrom !== undefined || tools.has(line.word) || /\s/.test(line.word)) continue;
    const key = JSON.stringify([line.verb, line.word]);
    const counted = words.get(key) ?? { where: line.verb, word: line.word, refusals: 0, sessions: new Set<string>(), followed: new Map() };
    counted.refusals += 1;
    counted.sessions.add(line.session);
    words.set(key, counted);
    const since = latest.get(key)?.at;
    if (since === undefined || line.at > since) pending.set(line.session, { key, next: line.next });
  }
  return [...words].map(([key, { where, word, refusals, sessions, followed }]) => ({
    key, where, word, refusals, sessions: sessions.size,
    targets: [...followed].map(([target, by]) => ({ target, count: by.count, sessions: by.sessions.size }))
      .sort((a, b) => b.count - a.count || a.target.localeCompare(b.target)),
  })).sort((a, b) => b.refusals - a.refusals || a.where.localeCompare(b.where) || a.word.localeCompare(b.word));
}

/** Each live pointer whose pointed calls since it was written mostly left it. */
function fallbacks(lines: readonly DoorLine[], pointers: readonly Pointer[]): Fallback[] {
  return pointers.flatMap(({ where, word, to, others, at }) => {
    if (to === undefined) return [];
    let calls = 0;
    let left = 0;
    const pending = new Set<string>();
    for (const line of lines) {
      if (line.at <= at || line.door !== "command") continue;
      if (pending.delete(line.session) && others.includes(line.verb)) left += 1;
      if (line.pointedFrom !== where || line.word !== word) continue;
      calls += 1;
      if (line.outcome === "answered") pending.add(line.session);
      else left += 1;
    }
    if (calls < BARS.fallbackCalls || left / calls <= BARS.fallbackShare) return [];
    return [{ where, word, to, calls, left, evidence: `"${where} ${word}" pointed to ${to} ${calls} times; ${left} of those sessions left it: the call did not answer, or the next command was another the word's hints had led to (${others.join(", ") || "none"}).` }];
  });
}

function disuse(lines: readonly DoorLine[], { commands, tools, twins }: Surfaces): { cuts: CutGroup[]; gaps: Gap[] } {
  const calls = new Map<string, number>();
  for (const line of lines) calls.set(line.verb, (calls.get(line.verb) ?? 0) + 1);
  const agentOnly = new Set([...commands, ...tools].filter(({ consumers }) => consumers.length === 1 && consumers[0] === "agent").map(({ verb }) => verb));
  const unused = (verb: string) => agentOnly.has(verb) && (calls.get(verb) ?? 0) === 0;
  const groups = new Map<string, Candidate[]>();
  const add = (group: string, candidate: Candidate) => groups.set(group, [...(groups.get(group) ?? []), candidate]);
  const gaps: Gap[] = [];
  const twinned = new Set<string>();
  for (const { command, tool } of twins) {
    twinned.add(command);
    twinned.add(tool);
    if (unused(command) && unused(tool)) add(familyOf(command), { command, tool });
    else if (unused(command)) gaps.push({ unused: command, carriedBy: tool, calls: calls.get(tool) ?? 0 });
    else if (unused(tool)) gaps.push({ unused: tool, carriedBy: command, calls: calls.get(command) ?? 0 });
  }
  for (const { verb } of commands) if (!twinned.has(verb) && unused(verb)) add(familyOf(verb), { command: verb });
  for (const { verb } of tools) if (!twinned.has(verb) && unused(verb)) add(TOOLS_ALONE, { tool: verb });
  const cuts = [...groups].map(([group, verbs]) => ({ group, verbs })).sort((a, b) => a.group.localeCompare(b.group));
  return { cuts, gaps: gaps.sort((a, b) => b.calls - a.calls || a.unused.localeCompare(b.unused)) };
}

/** The family a command is in: its path without its last word. */
function familyOf(command: string): string {
  return command.split(" ").slice(0, -1).join(" ");
}
