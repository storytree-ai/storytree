/**
 * Capability 14 · Reading the doors' use. The weekly doors check, the last step of the learner in the friction drain
 * (ADR-1090 D2): no timer. When the latest `door-checked` line is a week old or older, or there is none, the drain reads the
 * trailing week and files what stands out as friction, at most three items, so the next drains route it as friction is
 * routed. It writes a `door-checked` line even when nothing stood out: silence writes nothing else, and this is when it is
 * looked at.
 *
 * - A guessed word refused at least 5 times in the week where no command answers it (BARS.wantRefusals over 28 days is
 *   fewer a week), filed under the learner's want title, so a word the learner filed, or pointed, is never filed again.
 * - A hint offered at least 20 times in the week whose next call took it under 5% of the time (ADR-1090 D1's dead hints
 *   were 0 to 2%).
 * - A group of agent-only verbs with no call in the 28 days, once the lines cover them, skipped when its cut question is
 *   open or already names every verb in it.
 *
 * An item already filed under its title is not filed again unless it was resolved, which it reinforces: it came back.
 */
import type { SchemaRecord } from "@storytree/library";
import { CaptureError, recordFriction, reinforceFriction } from "@storytree/session-management/friction";

import type { CutGroup, Lesson, Pointer } from "./learn.js";
import type { LearnerWorld } from "./learner.js";
import { readDoors } from "./read.js";
import type { Reading } from "./reading.js";

/** The weekly check's bars, the building session's call (ADR-1090 D2), recorded on its increment's close. */
export const CHECK = {
  /** How old the latest check must be before the drain checks again, and the window it reads. */
  days: 7,
  /** Refusals of one guessed word in one place in the week. */
  wordRefusals: 5,
  /** A hint's offers in the week before its follow rate is judged, and the rate below which it stands out. */
  hintOffers: 20,
  hintRate: 0.05,
  /** The most items one check files. */
  items: 3,
} as const;

/** The branch the check files on: its own, so it spends neither the landing session's three nor the learner's. */
export const CHECK_BRANCH = "(doors check)";

const DAY_MS = 24 * 60 * 60 * 1000;

/** One item that stood out, as it is filed. */
interface Item {
  readonly title: string;
  readonly description: string;
  readonly statement: string;
  readonly evidence: string;
  readonly impact: string;
}

/**
 * Check the doors when a week has passed since the last check, and say what it did. `lesson` and `pointers` are the
 * learner's, read in the same drain; `titles` the ones it files wants and raises cuts under.
 */
export async function checkDoors(world: LearnerWorld, lesson: Lesson, pointers: readonly Pointer[], titles: { want(where: string, word: string): string; cut(group: string): string }): Promise<string[]> {
  const [last] = await world.log.lines(world.project, { kinds: ["door-checked"], newest: 1 });
  if (last !== undefined) {
    const due = new Date(Date.parse(last.at) + CHECK.days * DAY_MS);
    if (due > world.now) return [`  Doors last checked ${day(new Date(last.at))}; the next weekly check is due from ${day(due)}.`];
  }
  const since = new Date(world.now.getTime() - CHECK.days * DAY_MS);
  const [reading] = await readDoors(world.log, world.project, world.surfaces, world.now, [CHECK.days]);
  const filed = new Map((await world.library.list("friction")).map((friction) => [friction.fields.title, friction] as const));
  const asked = await world.library.questions(world.arcs.cuts);
  const items = [
    ...words(reading!, pointers, titles.want, world.now),
    ...hints(reading!, world.now),
    ...unused(lesson.unused ?? [], asked, titles.cut, world.now),
  ];
  const said = [`The weekly doors check read ${reading!.sessions} sessions over ${CHECK.days} days (ADR-1090 D2).`];
  const ids: string[] = [];
  for (const item of items) {
    if (ids.length === CHECK.items) {
      said.push(`  More stood out than the ${CHECK.items} a check files; the rest wait for next week's.`);
      break;
    }
    const earlier = filed.get(item.title);
    if (earlier !== undefined && earlier.fields.state !== "resolved") continue;
    if (earlier !== undefined) {
      await reinforceFriction(world.library, earlier.id, { branch: CHECK_BRANCH, evidence: item.evidence }, world.writer);
      ids.push(earlier.id);
      said.push(`  ${earlier.id} came back after it was resolved, reinforced: ${item.title}.`);
      continue;
    }
    const friction = await recordFriction(world.library, { ...item, branch: CHECK_BRANCH }, world.writer).catch((error: unknown) => {
      if (error instanceof CaptureError) return undefined;
      throw error;
    });
    if (friction === undefined) {
      said.push("  The rest wait for next week's check: the check has filed its three for today.");
      break;
    }
    ids.push(friction.id);
    said.push(`  Filed ${friction.id}: ${item.title}.`);
  }
  if (said.length === 1) said.push("  Nothing new stood out.");
  await world.log.append(world.project, {
    session: world.caller.session, ...(world.caller.harness === undefined ? {} : { harness: world.caller.harness }), source: "tool", kind: "door-checked",
    since: since.toISOString(), until: world.now.toISOString(), filed: ids,
  }, { at: world.now.toISOString() });
  return said;
}

/** Where a week's evidence was read. */
function weekTo(now: Date): string {
  return `\`storytree doors --days ${CHECK.days}\` to ${day(now)}`;
}

function day(at: Date): string {
  return at.toISOString().slice(0, 10);
}

/** Each guessed word refused often enough in the week, with no live pointer, most refused first. */
function words(reading: Reading, pointers: readonly Pointer[], title: (where: string, word: string) => string, now: Date): Item[] {
  const pointed = new Set(pointers.filter(({ to }) => to !== undefined).map(({ where, word }) => JSON.stringify([where, word])));
  const tools = new Set(reading.surfaces.filter(({ door }) => door === "tool").map(({ verb }) => verb));
  const counted = new Map<string, { where: string; word: string; count: number }>();
  for (const { door, where, word, count } of reading.misses) {
    const key = JSON.stringify([where, word]);
    if (door !== "command" || word === "" || /\s/.test(word) || tools.has(word) || pointed.has(key)) continue;
    counted.set(key, { where, word, count: (counted.get(key)?.count ?? 0) + count });
  }
  return [...counted.values()].filter(({ count }) => count >= CHECK.wordRefusals)
    .sort((a, b) => b.count - a.count || a.where.localeCompare(b.where) || a.word.localeCompare(b.word))
    .map(({ where, word, count }) => ({
      title: title(where, word),
      description: `A word agents type where storytree has no command, refused ${count} times in ${CHECK.days} days.`,
      statement: `Agents typed "${where} ${word}" ${count} times in the week to ${day(now)}, and the door refused it as unknown each time (ADR-1090 D2). Find what they want: a command, a pointer, or a refusal that names the right one.`,
      evidence: `${weekTo(now)}: "${where} ${word}" refused as unknown ${count} times.`,
      impact: "Each refusal costs the session a call and another guess at the command it wanted.",
    }));
}

/** Each hint offered often in the week and almost never taken, the least taken first. */
function hints(reading: Reading, now: Date): Item[] {
  return reading.follows.filter(({ offered, followed }) => offered >= CHECK.hintOffers && followed / offered < CHECK.hintRate)
    .sort((a, b) => a.followed / a.offered - b.followed / b.offered || b.offered - a.offered)
    .map(({ step, offered, followed, baseline }) => ({
      title: `Agents rarely take the hint "${step}"`,
      description: `A next step the doors offer that the next call took ${followed} of ${offered} times in ${CHECK.days} days.`,
      statement: `The doors offered "${step}" as a next step ${offered} times in the week to ${day(now)}, and the session's next call took it ${followed} times (ADR-1090 D1, D2). Drop it, or rewrite it so it earns its place.`,
      evidence: `${weekTo(now)}: "${step}" offered ${offered}, followed ${followed}; after the same verbs unoffered, taken ${baseline.took} of ${baseline.calls}.`,
      impact: "A hint nobody takes is a line every agent reads and pays for.",
    }));
}

/** Each group of verbs unused for 28 days whose cut question is not open and does not already name them all. */
function unused(groups: readonly CutGroup[], asked: readonly SchemaRecord<"question">[], title: (group: string) => string, now: Date): Item[] {
  return groups.flatMap(({ group, verbs }) => {
    const earlier = asked.filter((question) => question.fields.title === title(group));
    if (earlier.some((question) => question.fields.lifecycle === "open")) return [];
    const labels = verbs.map(({ command, tool }) => [command, tool].filter((name) => name !== undefined).join(" / "));
    const fresh = labels.filter((label) => !earlier.some((question) => question.fields.statement.includes(label)));
    if (fresh.length === 0) return [];
    return [{
      title: `No agent called these verbs in ${group} for 28 days`,
      description: `${fresh.length} agent-only ${fresh.length === 1 ? "verb" : "verbs"} in ${group} with no call through either door in 28 days.`,
      statement: `No call reached ${fresh.join("; ")} in the 28 days to ${day(now)} (ADR-1090 D2). Each is a name every agent reads; the doors learner raises the cut on "Prune the front doors" once its window has the sessions to judge it.`,
      evidence: `\`storytree doors --days 28\` to ${day(now)}: ${fresh.join("; ")} called 0 times.`,
      impact: "An unused verb is another name in the help and the tool list every agent reads.",
    }];
  });
}
