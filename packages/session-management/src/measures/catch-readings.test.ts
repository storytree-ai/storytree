// Capability 20 · Lane measures
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

import { connect, type Library } from "@storytree/library";
import { removeTemp } from "@storytree/test-waits";
import { dropTestProjects, testServerUrl, uniqueProjectName } from "@storytree/project-and-caller/testing/pg";

import { openActivityLog, type ActivityLog } from "../activity/index.js";
import { MEASURES_FAMILIES } from "./verbs.js";

const NAMES = ["test writer", "builder", "lint", "build-loop check", "mutation report", "test reviewer", "code reviewer", "CI", "escaped"] as const;
type Name = (typeof NAMES)[number];
const REVIEWERS: readonly Name[] = ["test reviewer", "code reviewer"];

type Result = "caught" | "missed" | "not-run";
const nr = "not-run", m = "missed", c = "caught";
const DRILL_LAYERS = ["test-writer", "builder", "lint", "tests", "mutation", "test-reviewer", "code-reviewer", "ci-linux", "ci-windows"] as const;

function layers(results: readonly Result[]): { layer: string; result: Result; evidence: string }[] {
  assert.equal(results.length, DRILL_LAYERS.length);
  return DRILL_LAYERS.map((layer, at) => ({ layer, result: results[at]!, evidence: `${layer}: ${results[at]} at scratch head 3f9c2a1b` }));
}

interface World {
  log: ActivityLog;
  library: Library;
  project: string;
  signUp: string;
  mail: string;
  p1: string;
  p2: string;
}

async function withWorld(body: (world: World) => Promise<void>): Promise<void> {
  const project = uniqueProjectName();
  const storytree = await connect({ url: testServerUrl() });
  const log = await openActivityLog(testServerUrl());
  try {
    const library = await storytree.openProject(project);
    const signUp = (await library.addStory({ title: "Sign up" })).id;
    const mail = (await library.addStory({ title: "Mail" })).id;
    const emailForm = (await library.addCapability({ title: "Email form", story: signUp })).id;
    const sender = (await library.addCapability({ title: "Sender", story: mail })).id;
    const arc = await library.createArc({ title: "Sign-up", intent: "Ship sign-up", endState: "Visitors sign up" });
    const built = await library.addIncrement({ arc: arc.id, title: "Built", objective: "Built", body: "Built", capabilities: [emailForm] });
    await library.closeIncrement(built.id, { pr: "#5", disposition: "landed", date: "2026-11-10" });

    const escape = (title: string, instance: Record<string, unknown>, caughtAt: "ci" | "escaped") =>
      library.writeKnowledge("escape", { title, description: `${title}, harvested`, instance, caughtAt, reasoning: "It failed at the head and passed once the pull request changed the unit it is in" } as never);
    const p1 = (await escape("A path joined with / that breaks on Windows", { run: 19234567890, pr: 941, story: signUp }, "ci")).id;
    await escape("A clock read twice in one comparison", { run: 19234567891, story: signUp }, "ci");
    const p2 = (await escape("A retry that resends a sent mail", { pr: 900, escape: "increment_dddddddddddd", story: mail }, "escaped")).id;
    await escape("A port taken by a stale server", { pr: 902 }, "ci");

    const drill = (name: string, pattern: string, story: string, date: string, fields: Record<string, unknown>) =>
      library.writeKnowledge("drill", {
        title: `Drill ${name}`, description: `Drill ${name}, replanted`, pattern,
        plant: { story, capability: story === signUp ? emailForm : sender, file: "packages/x/src/x.ts", shape: "a template-string join" },
        mode: "defect", session: "red-team-lane-7f3a", date, ...fields,
      } as never);
    await drill("d1", p1, signUp, "2026-11-10", { layers: layers([nr, nr, m, m, c, c, m, m, nr]), caughtBy: "mutation", fixer: "test-writer" });
    await drill("d2", p1, signUp, "2026-11-12", { layers: layers([nr, nr, m, m, m, m, c, c, nr]), caughtBy: "code-reviewer", fixer: "builder", sameModel: true });
    await drill("d3", p2, mail, "2026-11-12", { layers: layers([nr, nr, m, m, nr, m, m, nr, nr]), caughtBy: "none", fixer: "escaped" });
    await drill("d4", p2, mail, "2026-11-10", { mode: "task", layers: layers([c, m, m, c, m, m, m, m, nr]), caughtBy: "test-writer", fixer: "builder" });
    await drill("d5", p1, mail, "2026-11-11", { layers: layers([nr, nr, m, m, m, c, m, m, nr]), caughtBy: "test-reviewer", fixer: "test-writer", sameModel: false });
    await drill("d6", p1, signUp, "2026-10-01", { layers: layers([nr, nr, c, c, m, m, m, m, nr]), caughtBy: "lint", fixer: "builder" });
    await body({ log, library, project, signUp, mail, p1, p2 });
  } finally {
    try {
      await log.close();
      await storytree.close();
    } finally {
      await dropTestProjects([project]);
    }
  }
}

const LAYER_LINE = new RegExp(`^\\s*(${NAMES.join("|")}): (\\d+) caught first, (\\d+) not run(?:, (\\d+) same-model)?`);

function layersAfter(lines: readonly string[], from: number): (readonly [string, number, number, number | undefined])[] {
  const found: (readonly [string, number, number, number | undefined])[] = [];
  for (const line of lines.slice(from + 1)) {
    const match = LAYER_LINE.exec(line);
    if (match === null) continue;
    found.push([match[1]!, Number(match[2]), Number(match[3]), match[4] === undefined ? undefined : Number(match[4])]);
    if (found.length === NAMES.length) break;
  }
  return found;
}

function expected(counts: Partial<Record<Name, readonly number[]>>): (readonly [string, number, number, number | undefined])[] {
  return NAMES.map((name) => {
    const [first = 0, notRun = 0, same = 0] = counts[name] ?? [];
    return [name, first, notRun, REVIEWERS.includes(name) ? same : undefined] as const;
  });
}

interface JsonLayer { layer: string; caughtFirst: number; notRun: number; sameModel?: number }
interface JsonDrills { drills: number; layers: JsonLayer[] }
type JsonField = { caughtByCi: number; escaped: number };
interface JsonReading {
  field: { overall: JsonField; storyNotRecorded: JsonField };
  drills: JsonDrills;
  patterns: (JsonDrills & { pattern: string })[];
  stories: { story: string; field: JsonField; drills: JsonDrills }[];
}

function tuples(layers: readonly JsonLayer[]): (readonly [string, number, number, number | undefined])[] {
  return layers.map((one) => [one.layer, one.caughtFirst, one.notRun, one.sameModel] as const);
}

function lineAfter(lines: readonly string[], from: number, match: (line: string) => boolean, to = lines.length): number {
  for (let at = from + 1; at < to; at++) if (match(lines[at]!)) return at;
  return -1;
}

const today = (): string => new Date().toISOString().slice(0, 10);

function context(world: World, folder: string) {
  return { log: world.log, library: world.library, project: world.project, session: "me", folder, server: {} as never, placeFiles: async () => [] };
}

test("20.5 · `storytree measures catch` prints, over its window, the field reading (caught by CI, escaped) overall and per story, and the drill reading's first catches and not-run counts for every layer overall, per pattern and per story, reviewer catches counted same-model; --json gives the reading", async () => {
  await withWorld(async (world) => {
    const { signUp, mail, p1, p2 } = world;
    const family = MEASURES_FAMILIES.find((one) => one.name === "measures")!;
    const verb = family.verbs.find((one) => "name" in one.command && one.command.name === "catch");
    assert.ok(verb, "the measures family has a catch verb");
    const folder = mkdtempSync(path.join(tmpdir(), "catch-"));
    try {
      const run = async (input: Record<string, unknown>) => (await verb.act(input as never, context(world, folder) as never, {} as never)).text;
      const window = { from: "2026-11-01", to: today() };
      const text = await run({ ...window, json: false });
      assert.match(text, /report only/);
      const lines = text.split("\n");

      const field = lines.findIndex((line) => /field reading/i.test(line));
      const drills = lines.findIndex((line) => /drill reading/i.test(line));
      assert.ok(field >= 0 && drills > field, `a field reading, then a drill reading:\n${text}`);
      const fieldLine = (match: (line: string) => boolean) => lines[lineAfter(lines, field, match, drills)] ?? "";
      assert.match(fieldLine((line) => /caught by CI/.test(line)), /\b3 caught by CI\b.*\b1 escaped\b/, "overall: three CI caught, one escaped");
      assert.match(fieldLine((line) => line.includes(signUp)), /\b2 caught by CI\b.*\b0 escaped\b/, "Sign up: its two CI caught");
      assert.match(fieldLine((line) => line.includes(mail)), /\b0 caught by CI\b.*\b1 escaped\b/, "Mail: its escape");
      assert.match(fieldLine((line) => /story not recorded/.test(line)), /\b1 caught by CI\b.*\b0 escaped\b/, "the pattern naming no story");

      assert.deepEqual(layersAfter(lines, drills), expected({
        "test writer": [1, 4], builder: [0, 4], "mutation report": [1, 1], "test reviewer": [1, 0, 0], "code reviewer": [1, 0, 1], CI: [0, 1], escaped: [1, 0],
      }), "overall: five drills in the window (not d6, dated before it), every layer listed");
      assert.deepEqual(layersAfter(lines, lineAfter(lines, drills, (line) => line.includes(p1))), expected({
        "test writer": [0, 3], builder: [0, 3], "mutation report": [1], "test reviewer": [1, 0, 0], "code reviewer": [1, 0, 1],
      }), "per pattern: p1's drills d1, d2 and d5");
      assert.deepEqual(layersAfter(lines, lineAfter(lines, drills, (line) => line.includes(p2))), expected({
        "test writer": [1, 1], builder: [0, 1], "mutation report": [0, 1], CI: [0, 1], escaped: [1, 0],
      }), "per pattern: p2's drills d3 and d4");
      const perStory = lineAfter(lines, drills, (line) => /per story/i.test(line));
      assert.ok(perStory > drills, "the drill reading per story");
      assert.deepEqual(layersAfter(lines, lineAfter(lines, perStory, (line) => line.includes(signUp))), expected({
        "test writer": [0, 2], builder: [0, 2], "mutation report": [1], "code reviewer": [1, 0, 1],
      }), "per story: Sign up's plants d1 and d2");
      assert.deepEqual(layersAfter(lines, lineAfter(lines, perStory, (line) => line.includes(mail))), expected({
        "test writer": [1, 2], builder: [0, 2], "mutation report": [0, 1], "test reviewer": [1, 0, 0], CI: [0, 1], escaped: [1, 0],
      }), "per story: Mail's plants d3, d4 and d5");

      const earlier = (await run({ from: "2026-11-01", to: "2026-11-11", json: false })).split("\n");
      const earlierField = earlier.findIndex((line) => /field reading/i.test(line));
      const earlierDrills = earlier.findIndex((line) => /drill reading/i.test(line));
      assert.match(earlier[lineAfter(earlier, earlierField, (line) => /caught by CI/.test(line), earlierDrills)] ?? "", /\b0 caught by CI\b.*\b0 escaped\b/);
      assert.deepEqual(layersAfter(earlier, earlierDrills), expected({ "test writer": [1, 2], builder: [0, 2], "mutation report": [1], "test reviewer": [1, 0, 0] }), "d1, d4 and d5 alone");

      assert.match(lines[lineAfter(lines, drills, (line) => /overall/.test(line))] ?? "", /\b5 drills\b/);
      const p1At = lineAfter(lines, drills, (line) => line.includes(p1));
      const p2At = lineAfter(lines, drills, (line) => line.includes(p2));
      assert.match(lines[p1At] ?? "", /\b3 drills\b/);
      assert.match(lines[p2At] ?? "", /\b2 drills\b/);
      assert.ok(p1At < p2At, "p1, replanted three times, before p2, twice");

      const json = JSON.parse(await run({ ...window, json: true })) as JsonReading & { window: unknown };
      assert.deepEqual(json.window, window);
      assert.deepEqual(json.field, { overall: { caughtByCi: 3, escaped: 1 }, storyNotRecorded: { caughtByCi: 1, escaped: 0 } });
      assert.equal(json.drills.drills, 5);
      assert.deepEqual(tuples(json.drills.layers), expected({
        "test writer": [1, 4], builder: [0, 4], "mutation report": [1, 1], "test reviewer": [1, 0, 0], "code reviewer": [1, 0, 1], CI: [0, 1], escaped: [1, 0],
      }));
      assert.deepEqual(json.patterns.map((one) => [one.pattern, one.drills]), [[p1, 3], [p2, 2]], "the most drills first");
      assert.deepEqual(tuples(json.patterns[1]!.layers), expected({ "test writer": [1, 1], builder: [0, 1], "mutation report": [0, 1], CI: [0, 1], escaped: [1, 0] }));
      const story = (id: string) => json.stories.find((one) => one.story === id)!;
      assert.deepEqual(story(signUp).field, { caughtByCi: 2, escaped: 0 });
      assert.deepEqual(story(mail).field, { caughtByCi: 0, escaped: 1 });
      assert.deepEqual(tuples(story(mail).drills.layers), expected({
        "test writer": [1, 2], builder: [0, 2], "mutation report": [0, 1], "test reviewer": [1, 0, 0], CI: [0, 1], escaped: [1, 0],
      }));

      const week = JSON.parse(await run({ json: true })) as { window: unknown };
      assert.deepEqual(week.window, { from: new Date(Date.parse(`${today()}T00:00:00Z`) - 6 * 86_400_000).toISOString().slice(0, 10), to: today() });
      await assert.rejects(run({ from: "2026-11-31", json: false }), /not a day/);
      await assert.rejects(run({ from: "2026-11-12", to: "2026-11-10", json: false }), /after --to/);
    } finally {
      await removeTemp(folder);
    }
  });
});

test("20.6 · `storytree measures` prints, beside the lane measures, the catch rate per story with escapes or drills in its window (caught by CI, escaped, and first catches per layer, reviewer catches same-model), and its --json carries the catch reading per story", async () => {
  await withWorld(async (world) => {
    const { signUp, mail } = world;
    const family = MEASURES_FAMILIES.find((one) => one.name === "measures")!;
    const folder = mkdtempSync(path.join(tmpdir(), "measures-catch-"));
    try {
      const run = async (input: Record<string, unknown>) => (await family.bare!.act(input as never, context(world, folder) as never, {} as never)).text;
      const window = { from: "2026-11-01", to: today() };
      const text = await run({ ...window, json: false });
      const lines = text.split("\n");
      assert.match(text, /Per story[^]*Sign up \[[^\]]+\]: 1 lane/, "the lane measures are still printed");
      const heading = lines.findIndex((line) => /catch rate/i.test(line));
      assert.ok(heading >= 0, `a catch rate section:\n${text}`);

      const signUpAt = lineAfter(lines, heading, (line) => line.includes(signUp));
      assert.match(lines[lineAfter(lines, signUpAt, (line) => /caught by CI/.test(line))] ?? "", /\b2 caught by CI\b.*\b0 escaped\b/);
      assert.deepEqual(layersAfter(lines, signUpAt), expected({ "test writer": [0, 2], builder: [0, 2], "mutation report": [1], "code reviewer": [1, 0, 1] }), "Sign up: d1 and d2");
      const mailAt = lineAfter(lines, heading, (line) => line.includes(mail));
      assert.ok(mailAt > heading, "Mail, which no lane touched, has its catch printed");
      assert.match(lines[lineAfter(lines, mailAt, (line) => /caught by CI/.test(line))] ?? "", /\b0 caught by CI\b.*\b1 escaped\b/);
      assert.deepEqual(layersAfter(lines, mailAt), expected({
        "test writer": [1, 2], builder: [0, 2], "mutation report": [0, 1], "test reviewer": [1, 0, 0], CI: [0, 1], escaped: [1, 0],
      }), "Mail: d3, d4 and d5");

      const october = (await run({ from: "2026-10-01", to: "2026-10-01", json: false })).split("\n");
      const octoberHeading = october.findIndex((line) => /catch rate/i.test(line));
      assert.ok(octoberHeading >= 0, "the catch is printed when no increment closed in the window");
      const octoberSignUp = lineAfter(october, octoberHeading, (line) => line.includes(signUp));
      assert.deepEqual(layersAfter(october, octoberSignUp), expected({ "test writer": [0, 1], builder: [0, 1], lint: [1] }));
      assert.match(october[lineAfter(october, octoberSignUp, (line) => /\bdrills?\b/.test(line))] ?? "", /\b1 drill\b/, "one drill, singular");
      assert.equal(lineAfter(october, octoberHeading, (line) => line.includes(mail)), -1, "a story with nothing in the window is left out");

      const report = JSON.parse(await run({ ...window, json: true })) as { catch: JsonReading["stories"] };
      assert.deepEqual(report.catch.map((one) => one.story).sort(), [signUp, mail].sort(), "--json carries each story with escapes or drills in the window");
      const story = (id: string) => report.catch.find((one) => one.story === id)!;
      assert.deepEqual(story(signUp).field, { caughtByCi: 2, escaped: 0 });
      assert.equal(story(signUp).drills.drills, 2);
      assert.deepEqual(tuples(story(signUp).drills.layers), expected({ "test writer": [0, 2], builder: [0, 2], "mutation report": [1], "code reviewer": [1, 0, 1] }));
      assert.deepEqual(story(mail).field, { caughtByCi: 0, escaped: 1 });
      assert.equal(story(mail).drills.drills, 3);
      assert.deepEqual(tuples(story(mail).drills.layers), expected({
        "test writer": [1, 2], builder: [0, 2], "mutation report": [0, 1], "test reviewer": [1, 0, 0], CI: [0, 1], escaped: [1, 0],
      }));
    } finally {
      await removeTemp(folder);
    }
  });
});
