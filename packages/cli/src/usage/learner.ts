/**
 * Capability 14 · Reading the doors' use. The learner, one step of the friction drain every landing runs (ADR-1045 D7):
 * no timer and no model. It reads the 28 days of door-answered lines to the drain, learns from them (./learn.ts) and acts
 * on the lesson, so a second drain duplicates nothing.
 *
 * - A pointer is written as a `door-pointer` line in the activity log, the data the command line reads (ADR-1045 D4), with
 *   the evidence that made it; a pointer that fell back is a line with no target. The latest line for a word in a place is
 *   its state, so a word already pointed, or already fallen back, is not written again.
 * - A want is filed under the learner's own branch name, so it never spends the landing session's three a day (ADR-0716),
 *   and a want past the learner's own three waits for a later drain while the rest of the step still runs.
 * - A want is filed as friction naming the arc that measures the doors (friction links only to other notes), with the reading as evidence, under one
 *   title per word and place. While that friction is open nothing more is written; once it is routed, 10 more refusals
 *   since its last filing or recurrence reinforce it, which reopens it.
 * - Each group of cut candidates is raised as an open question on "Prune the front doors" and then parked there as an
 *   increment held on it, question first, so the pool cannot take it. A group with an open question is not raised again;
 *   one whose question is answered is raised again only for verbs that question did not name.
 * - Door gaps are reported in the drain's answer, never cut.
 * - Last, the weekly doors check (./doors-check.ts, ADR-1090 D2) runs when a week has passed since the last one.
 */
import type { Library, NewLine, SchemaRecord, WriteOptions } from "@storytree/library";
import { CaptureError, recordFriction, reinforceFriction } from "@storytree/session-management/friction";

import { checkDoors } from "./doors-check.js";
import { BARS, evidenceOf, learnDoors, type Candidate, type CutGroup, type Fallback, type NewPointer, type Pointer, type Surfaces, type Want } from "./learn.js";
import { doorLineOf, type DoorsLog } from "./read.js";
import type { DoorLine } from "./reading.js";

/** storytree's own arcs: the one that measures the front doors, where a want is filed, and "Prune the front doors", where each cut group waits for the owner (ADR-1045 D6). */
export const ARCS = { wants: "arc_32e1fe58d6a6", cuts: "arc_4a62104e4de4" } as const;

/** The branch a want is filed on: the learner's own, not the landing session's. */
export const LEARNER_BRANCH = "(doors learner)";

const DAY_MS = 24 * 60 * 60 * 1000;
/** The most door gaps the drain's answer names. */
const GAPS_SHOWN = 5;

/** What the learner reads and writes through: the project's log and library, the drain's writer and session, the doors' surfaces, and the arcs it writes on. */
export interface LearnerWorld {
  readonly log: DoorsLog & { append(project: string, line: NewLine, options?: { readonly at?: string }): Promise<unknown> };
  /** The session running the drain, which a pointer's line is written on. */
  readonly caller: { readonly session: string; readonly harness?: string };
  readonly project: string;
  readonly library: Library;
  readonly writer?: WriteOptions;
  readonly surfaces: Surfaces;
  readonly arcs: { readonly wants: string; readonly cuts: string };
  readonly now: Date;
}

/**
 * Learn from the 28 days to `now` and act on it; the lines say what was written, and what was not and why. A project
 * without both arcs (any project but storytree's own) learns nothing and is told nothing.
 */
export async function learnInDrain(world: LearnerWorld): Promise<string[]> {
  for (const arc of [world.arcs.wants, world.arcs.cuts]) if ((await world.library.get(arc))?.type !== "arc") return [];
  const since = new Date(world.now.getTime() - BARS.days * DAY_MS).toISOString();
  const lines = (await world.log.lines(world.project, { kinds: ["door-answered"], since })).flatMap((line) => doorLineOf(line) ?? []);
  const pointers = (await world.log.lines(world.project, { kinds: ["door-pointer"], latestBy: ["where", "word"] })).flatMap((line) =>
    line.kind === "door-pointer" ? [{ where: line.where, word: line.word, ...(line.to === undefined ? {} : { to: line.to }), others: line.others, at: new Date(line.at).toISOString() } satisfies Pointer] : []);
  const lesson = learnDoors(lines, world.surfaces, since, pointers);
  const said = [`The doors learner read ${lines.length} door-answered lines from ${lesson.sessions} sessions over ${BARS.days} days (ADR-1045 D4 to D6).`];
  said.push(...await writePointers(world, lesson.pointers, lesson.fallbacks));
  said.push(...await fileWants(world, lesson.wants, lines));
  said.push(...lesson.cuts === undefined
    ? [`  No cut candidates judged: disuse needs ${BARS.days} days of lines and ${BARS.cutSessions} sessions.`]
    : await raiseCuts(world, lesson.cuts, lesson.sessions));
  for (const gap of lesson.gaps.slice(0, GAPS_SHOWN)) said.push(`  Door gap, not cut: ${gap.unused} has no call while ${gap.carriedBy} carries it (${gap.calls}).`);
  if (lesson.gaps.length > GAPS_SHOWN) said.push(`  ${lesson.gaps.length - GAPS_SHOWN} more door gaps: storytree doors --days ${BARS.days}.`);
  said.push(...await checkDoors(world, lesson, pointers, { want: (where, word) => wantTitle({ where, word }), cut: cutTitle }));
  return said;
}

/** The title a want is filed under: one per word and place. */
function wantTitle(want: Pick<Want, "where" | "word">): string {
  return `Agents type "${want.where} ${want.word}", which no command answers`;
}

async function fileWants(world: LearnerWorld, wants: readonly Want[], lines: readonly DoorLine[]): Promise<string[]> {
  if (wants.length === 0) return [];
  const filed = new Map((await world.library.list("friction")).map((friction) => [friction.fields.title, friction] as const));
  const said: string[] = [];
  for (const want of wants) {
    const title = wantTitle(want);
    const evidence = `${readingTo(world.now)}: ${evidenceOf(want)}`;
    const earlier = filed.get(title);
    if (earlier === undefined) {
      const friction = await recordFriction(world.library, {
        title,
        description: `A word agents type where storytree has no command, refused ${want.refusals} times in ${BARS.days} days.`,
        statement: `Agents typed "${want.where} ${want.word}" ${want.refusals} times in ${want.sessions} sessions, and the door refused it as unknown each time; no command its refusal offered was taken often enough to stand for it (ADR-1045 D4, D5). The nearest surface is ${want.where}, measured on ${world.arcs.wants}. Find what they want before building it: a command, a pointer, or a refusal that names the right one.`,
        evidence,
        impact: "Each refusal costs the session a call and another guess at the command it wanted.",
        branch: LEARNER_BRANCH,
      }, world.writer).catch((error: unknown) => {
        if (error instanceof CaptureError) return undefined;
        throw error;
      });
      if (friction === undefined) {
        const left = wants.length - wants.indexOf(want);
        said.push(`  ${left} more ${left === 1 ? "want waits" : "wants wait"} for a later drain: the learner has filed its three for today.`);
        break;
      }
      said.push(`  Want filed as ${friction.id}: "${want.where} ${want.word}", refused ${want.refusals} times.`);
      continue;
    }
    if (earlier.fields.state === "open") continue;
    const last = [earlier.createdAt.slice(0, 10), ...(earlier.fields.reinforcedBy ?? []).map(({ date }) => date)].sort().at(-1)!;
    const since = lines.filter((line) => line.at.slice(0, 10) > last && line.door === "command" && line.outcome === "unknown" && line.verb === want.where && line.word === want.word).length;
    if (since < BARS.wantRefusals) continue;
    await reinforceFriction(world.library, earlier.id, { branch: LEARNER_BRANCH, evidence }, world.writer);
    said.push(`  Want ${earlier.id} reinforced: "${want.where} ${want.word}", refused ${since} more times since ${last}.`);
  }
  return said;
}

/** Where the evidence was read: the reading of the 28 days to `now`. */
function readingTo(now: Date): string {
  return `\`storytree doors --days ${BARS.days}\` to ${now.toISOString().slice(0, 10)}`;
}

async function writePointers(world: LearnerWorld, pointers: readonly NewPointer[], fallbacks: readonly Fallback[]): Promise<string[]> {
  const said: string[] = [];
  const write = (line: { where: string; word: string; to?: string; others: readonly string[]; evidence: string }) => world.log.append(world.project, {
    session: world.caller.session, ...(world.caller.harness === undefined ? {} : { harness: world.caller.harness }), source: "tool", kind: "door-pointer",
    where: line.where, word: line.word, ...(line.to === undefined ? {} : { to: line.to }), others: [...line.others], evidence: `${readingTo(world.now)}: ${line.evidence}`,
  }, { at: world.now.toISOString() });
  for (const pointer of pointers) {
    await write(pointer);
    said.push(`  Pointer written: "${pointer.where} ${pointer.word}" now runs ${pointer.to} (${pointer.follows} follows from ${pointer.sessions} sessions).`);
  }
  for (const fallback of fallbacks) {
    await write({ where: fallback.where, word: fallback.word, others: [], evidence: fallback.evidence });
    said.push(`  Pointer fallen back: "${fallback.where} ${fallback.word}" is refused with hints again, ${fallback.left} of ${fallback.calls} pointed calls having left ${fallback.to}.`);
  }
  return said;
}

/** A candidate as its doors name it. */
function labelOf({ command, tool }: Candidate): string {
  return [command, tool].filter((name) => name !== undefined).join(" / ");
}

/** The title a cut group's question is raised under: one per group. */
function cutTitle(group: string): string {
  return `Cut, keep or merge the unused verbs in ${group}?`;
}

async function raiseCuts(world: LearnerWorld, cuts: readonly CutGroup[], sessions: number): Promise<string[]> {
  if (cuts.length === 0) return [];
  const asked = await world.library.questions(world.arcs.cuts);
  const said: string[] = [];
  for (const { group, verbs } of cuts) {
    const earlier = asked.filter((question) => question.fields.title === cutTitle(group));
    if (earlier.some((question) => question.fields.lifecycle === "open")) continue;
    const fresh = verbs.filter((verb) => !earlier.some((question) => question.fields.statement.includes(labelOf(verb))));
    if (fresh.length === 0) continue;
    const question = await raise(world, group, fresh, sessions);
    const increment = await world.library.addIncrement({
        arc: world.arcs.cuts,
      title: `Build the owner's answer on the unused verbs in ${group}`,
      objective: `The answer to ${question.id} is built: each verb it names is cut, kept with its reason, or merged into the sibling he names.`,
      body: `Parked by the doors learner (ADR-1045 D6), held on ${question.id} until the owner answers it in grill me. Its verbs: ${fresh.map(labelOf).join("; ")}. Build what he answers; a verb he keeps carries his reason, so it is not proposed again without new evidence.`,
      heldOn: [question.id],
    }, world.writer);
    said.push(`  Cut candidates in ${group} (${fresh.length}): question ${question.id} raised, ${increment.id} parked held on it.`);
  }
  return said;
}

function raise(world: LearnerWorld, group: string, verbs: readonly Candidate[], sessions: number): Promise<SchemaRecord<"question">> {
  const day = world.now.toISOString().slice(0, 10);
  return world.library.raiseQuestion({
    arc: world.arcs.cuts,
    title: cutTitle(group),
    stakes: `No agent called these verbs in ${BARS.days} days across ${sessions} sessions. Each one kept is another name in the help and the tool list every agent reads; each one cut is gone for a person or agent who might have needed it.`,
    statement: `Should these verbs in ${group} be cut, kept, or merged into a sibling? ${verbs.map(labelOf).join("; ")}.`,
    context: `The doors learner (ADR-1045 D6) found them in the friction drain on ${day}: verbs whose consumers are only agents, with no call through either door in the ${BARS.days} days to ${day} (\`storytree doors --days ${BARS.days}\`). A verb a person may call is never proposed, since a person's own terminal writes no line, and a verb one door leaves unused while the other carries its job is a door gap, never a candidate. Every MCP tool stays unless you decide otherwise here (ADR-1090 D1). A verb both doors mount is named as its command / its tool.`,
    options: "Cut: they are removed from both doors, by the increment this question holds. Keep: they stay, with your reason, and are not proposed again without new evidence. Merge: they fold into a sibling verb you name.",
  }, world.writer);
}
