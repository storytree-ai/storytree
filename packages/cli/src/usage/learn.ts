/**
 * Capability 14 · Reading the doors' use. What the doors learn from their own lines (ADR-1045 D5 to D7), a pure count over
 * 28 days of both doors' door-answered lines with the declared surfaces handed in; the friction drain acts on it
 * (./learner.ts).
 *
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
  readonly cuts?: readonly CutGroup[];
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

/** Learn from `lines`, both doors' door-answered lines of the 28 days from `since`, oldest first. */
export function learnDoors(lines: readonly DoorLine[], surfaces: Surfaces, since: string): Lesson {
  const sessions = new Set(lines.map((line) => line.session)).size;
  const covered = lines.length > 0 && Date.parse(lines[0]!.at) <= Date.parse(since) + DAY_MS;
  const { cuts, gaps } = disuse(lines, surfaces);
  const tools = new Set(surfaces.tools.map(({ verb }) => verb));
  return { sessions, wants: wants(lines, tools), ...(covered && sessions >= BARS.cutSessions ? { cuts } : {}), gaps };
}

/** Whether `followed`, a word's follows by target, clears D4's bar for a pointer to its leading target. */
export function clearsPointerBar(followed: readonly { readonly target: string; readonly count: number; readonly sessions: number }[]): boolean {
  const [lead] = followed;
  const total = followed.reduce((sum, { count }) => sum + count, 0);
  return lead !== undefined && lead.count >= BARS.pointerFollows && lead.sessions >= BARS.pointerSessions && lead.count / total >= BARS.pointerShare;
}

function wants(lines: readonly DoorLine[], tools: ReadonlySet<string>): Want[] {
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
    if (line.door !== "command" || line.outcome !== "unknown" || line.word === undefined || tools.has(line.word) || /\s/.test(line.word)) continue;
    const key = JSON.stringify([line.verb, line.word]);
    const counted = words.get(key) ?? { where: line.verb, word: line.word, refusals: 0, sessions: new Set<string>(), followed: new Map() };
    counted.refusals += 1;
    counted.sessions.add(line.session);
    words.set(key, counted);
    pending.set(line.session, { key, next: line.next });
  }
  return [...words.values()].flatMap(({ where, word, refusals, sessions, followed }) => {
    const targets = [...followed].map(([target, by]) => ({ target, count: by.count, sessions: by.sessions.size }))
      .sort((a, b) => b.count - a.count || a.target.localeCompare(b.target));
    if (refusals < BARS.wantRefusals || clearsPointerBar(targets)) return [];
    return [{ where, word, refusals, sessions: sessions.size, followed: targets.map(({ target, count }) => ({ target, count })) }];
  }).sort((a, b) => b.refusals - a.refusals || a.where.localeCompare(b.where) || a.word.localeCompare(b.word));
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
