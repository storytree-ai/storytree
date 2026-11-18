// Capability 14 · Reading the doors' use
import type { SchemaRecord } from "@storytree/library";
import { CaptureError, recordFriction, reinforceFriction } from "@storytree/session-management/friction";

import type { CutGroup, Lesson, Pointer } from "./learn.js";
import type { LearnerWorld } from "./learner.js";
import { readDoors } from "./read.js";
import type { Reading } from "./reading.js";

export const CHECK = {
  days: 7,
  wordRefusals: 5,
  hintOffers: 20,
  hintRate: 0.05,
  items: 3,
} as const;

export const CHECK_BRANCH = "(doors check)";

const DAY_MS = 24 * 60 * 60 * 1000;

interface Item {
  readonly title: string;
  readonly description: string;
  readonly statement: string;
  readonly evidence: string;
  readonly impact: string;
}

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

function weekTo(now: Date): string {
  return `\`storytree doors --days ${CHECK.days}\` to ${day(now)}`;
}

function day(at: Date): string {
  return at.toISOString().slice(0, 10);
}

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
