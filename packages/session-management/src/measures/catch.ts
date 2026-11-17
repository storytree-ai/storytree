/**
 * Capability 20 · Lane measures: the catch rate by layer (contracts 20.4, 20.5, 20.6). One vocabulary for the layer a fault
 * was first caught at, earliest to latest, each defined once, and what maps onto it: a red-team drill's layers, an escape
 * pattern's caughtAt and the QA ledger's found_by by its slice (ADR-1356 D7). Over a window it reads the field reading, from
 * the escape patterns harvested in it (the day each record was made), and the drill reading, from the drills dated in it,
 * overall, per pattern and per story; `storytree measures catch` prints it all and `storytree measures` its per-story part.
 * Report only (ADR-1238): it states no verdict, and nothing reads it to decide.
 */
import type { FieldsOf, Library } from "@storytree/library";

import type { LaneWindow } from "./lanes.js";

/** The catch layers, earliest to latest, each as the help defines it. */
export const CATCH_LAYERS = [
  { name: "test writer", means: "the test writer's failing tests, written before the code, went red on it" },
  { name: "builder", means: "the builder, writing the code to those tests, found it" },
  { name: "lint", means: "a lint or static check on the change, a graduated check included, flagged it" },
  { name: "build-loop check", means: "the change's own test run in the build loop failed on it" },
  { name: "mutation report", means: "a mutant the change's tests let live pointed at it" },
  { name: "test reviewer", means: "the test reviewer, reviewing the change's tests, found it" },
  { name: "code reviewer", means: "the code reviewer, reviewing the change's code, found it" },
  { name: "CI", means: "CI's checks on the pull request, on Linux or Windows, failed on it before merge" },
  { name: "escaped", means: "nothing caught it before it reached main" },
] as const satisfies readonly { readonly name: string; readonly means: string }[];

export type CatchLayer = (typeof CATCH_LAYERS)[number]["name"];

/** The layers whose catches say whether the reviewer was the planter's model. */
const REVIEWERS: readonly CatchLayer[] = ["test reviewer", "code reviewer"];

type DrillCaught = FieldsOf<"drill">["caughtBy"];

const OF_DRILL: Readonly<Record<DrillCaught, CatchLayer>> = {
  "test-writer": "test writer", builder: "builder", lint: "lint", tests: "build-loop check", mutation: "mutation report",
  "test-reviewer": "test reviewer", "code-reviewer": "code reviewer", "ci-linux": "CI", "ci-windows": "CI", none: "escaped",
};

/** The catch layer of a drill's layer, or of its caughtBy none. */
export function layerOfDrill(layer: DrillCaught): CatchLayer {
  return OF_DRILL[layer];
}

/** The catch layer of an escape pattern's caughtAt. */
export function layerOfField(caughtAt: FieldsOf<"escape">["caughtAt"]): CatchLayer {
  return caughtAt === "ci" ? "CI" : "escaped";
}

/** The catch layer of a QA ledger finding, by what found it and the slice of its review; a reviewer's hit on a whole review has none. */
export function layerOfFinding(foundBy: "graduated" | "mutation" | "weakening" | "reviewer", slice: "code" | "test" | "whole"): CatchLayer | undefined {
  if (foundBy === "graduated") return "lint";
  if (foundBy === "mutation") return "mutation report";
  if (foundBy === "weakening") return "test reviewer";
  return slice === "code" ? "code reviewer" : slice === "test" ? "test reviewer" : undefined;
}

/** Escape patterns harvested in a window, by where they were caught. */
export interface FieldCount {
  readonly caughtByCi: number;
  readonly escaped: number;
}

/** One layer's drills: the plants it caught first, those it was not run on, and of a reviewer's catches, those by the planter's model. */
export interface LayerCount {
  readonly layer: CatchLayer;
  readonly caughtFirst: number;
  readonly notRun: number;
  readonly sameModel?: number;
}

/** A set of drills, read per layer, every layer in the fixed order. */
export interface DrillReading {
  readonly drills: number;
  readonly layers: readonly LayerCount[];
}

/** The drills replanting one escape pattern. */
export interface PatternCatch extends DrillReading {
  readonly pattern: string;
  readonly title?: string;
}

/** One story's escape patterns (by their instance) and drills (by their plant); its title when the record names it by id. */
export interface StoryCatch {
  readonly story: string;
  readonly title?: string;
  readonly field: FieldCount;
  readonly drills: DrillReading;
}

/** The catch reading over a window. */
export interface CatchReading {
  readonly field: { readonly overall: FieldCount; readonly storyNotRecorded: FieldCount };
  readonly drills: DrillReading;
  readonly patterns: readonly PatternCatch[];
  readonly stories: readonly StoryCatch[];
}

type Drill = FieldsOf<"drill">;

function fieldCount(caughtAt: readonly FieldsOf<"escape">["caughtAt"][]): FieldCount {
  return { caughtByCi: caughtAt.filter((at) => layerOfField(at) === "CI").length, escaped: caughtAt.filter((at) => layerOfField(at) === "escaped").length };
}

/** A layer is not run on a drill when every drill layer mapping onto it was not run. */
function drillReading(drills: readonly Drill[]): DrillReading {
  return {
    drills: drills.length,
    layers: CATCH_LAYERS.map(({ name }) => {
      const first = drills.filter((drill) => layerOfDrill(drill.caughtBy) === name);
      const notRun = drills.filter((drill) => {
        const rows = drill.layers.filter((row) => layerOfDrill(row.layer) === name);
        return rows.length > 0 && rows.every((row) => row.result === "not-run");
      }).length;
      return { layer: name, caughtFirst: first.length, notRun, ...(REVIEWERS.includes(name) ? { sameModel: first.filter((drill) => drill.sameModel === true).length } : {}) };
    }),
  };
}

/** The field and drill readings over `window`: escape patterns by the day harvested, drills by their date. */
export async function catchReading(library: Library, window: LaneWindow): Promise<CatchReading> {
  const inWindow = (day: string): boolean => day >= window.from && day <= window.to;
  const [escapes, allDrills, tree] = await Promise.all([library.list("escape"), library.list("drill"), library.projectTree()]);
  const harvested = escapes.filter((one) => inWindow(one.createdAt.slice(0, 10))).map((one) => one.fields);
  const drills = allDrills.map((one) => one.fields).filter((drill) => inWindow(drill.date));
  const storyTitle = new Map(tree.stories.map((story) => [story.id, story.title] as const));
  const patternTitle = new Map(escapes.map((one) => [one.id, one.fields.title] as const));

  const patterns = [...new Set(drills.map((drill) => drill.pattern))].map((pattern): PatternCatch => ({
    pattern, ...(patternTitle.has(pattern) ? { title: patternTitle.get(pattern)! } : {}), ...drillReading(drills.filter((drill) => drill.pattern === pattern)),
  }));
  const named = [...new Set([...harvested.flatMap((one) => one.instance.story ?? []), ...drills.map((drill) => drill.plant.story)])];
  const stories = named.map((story): StoryCatch => ({
    story, ...(storyTitle.has(story) ? { title: storyTitle.get(story)! } : {}),
    field: fieldCount(harvested.filter((one) => one.instance.story === story).map((one) => one.caughtAt)),
    drills: drillReading(drills.filter((drill) => drill.plant.story === story)),
  }));
  return {
    field: { overall: fieldCount(harvested.map((one) => one.caughtAt)), storyNotRecorded: fieldCount(harvested.filter((one) => one.instance.story === undefined).map((one) => one.caughtAt)) },
    drills: drillReading(drills),
    patterns: patterns.sort((a, b) => b.drills - a.drills || a.pattern.localeCompare(b.pattern)),
    stories: stories.sort((a, b) => (a.title ?? a.story).localeCompare(b.title ?? b.story)),
  };
}

const fieldText = (count: FieldCount): string => `${count.caughtByCi} caught by CI, ${count.escaped} escaped`;

const named = (id: string, title: string | undefined): string => (title === undefined ? id : `${title} [${id}]`);

/** A drill reading's nine layer lines, each indented by `indent`. */
function layerLines(reading: DrillReading, indent: string): string[] {
  return reading.layers.map((count) => `${indent}${count.layer}: ${count.caughtFirst} caught first, ${count.notRun} not run${count.sameModel === undefined ? "" : `, ${count.sameModel} same-model`}`);
}

const drillsText = (count: number): string => `${count} drill${count === 1 ? "" : "s"}`;

/** `storytree measures`' catch rate section: each story with escape patterns or drills in the window, read as `measures catch` reads it. */
export function catchRateLines(stories: readonly StoryCatch[]): string[] {
  const lines = ["Catch rate per story (escape patterns harvested and drills dated in the window, by the layer that caught each first; report only):"];
  if (stories.length === 0) return [...lines, "  No escape pattern or drill in that window."];
  for (const story of stories) {
    lines.push(`  ${named(story.story, story.title)}:`, `    field: ${fieldText(story.field)}`, `    ${drillsText(story.drills.drills)}:`, ...layerLines(story.drills, "      "));
  }
  return lines;
}

/** `storytree measures catch`'s text: the layers' definitions, the field reading and the drill reading. */
export function catchText(reading: CatchReading, window: LaneWindow): string {
  return [
    `Catch by layer for escape patterns harvested and drills dated ${window.from} to ${window.to} (report only: nothing gates on these, and none is a verdict).`,
    "The layers, earliest to latest:",
    ...CATCH_LAYERS.map((layer) => `  ${layer.name}: ${layer.means}.`),
    "",
    "Field reading (escape patterns harvested in the window, by whether CI caught each before merge or it escaped):",
    `  overall: ${fieldText(reading.field.overall)}`,
    ...reading.stories.map((story) => `  ${named(story.story, story.title)}: ${fieldText(story.field)}`),
    `  story not recorded: ${fieldText(reading.field.storyNotRecorded)}`,
    "",
    "Drill reading (drills dated in the window: per layer, the plants it caught first and those it was not run on; a reviewer's catches by the planter's own model counted same-model):",
    `  overall, ${drillsText(reading.drills.drills)}:`,
    ...layerLines(reading.drills, "    "),
    "  Per pattern:",
    ...reading.patterns.flatMap((pattern) => [`  ${named(pattern.pattern, pattern.title)}, ${drillsText(pattern.drills)}:`, ...layerLines(pattern, "    ")]),
    "  Per story (where each was planted):",
    ...reading.stories.filter((story) => story.drills.drills > 0).flatMap((story) => [`  ${named(story.story, story.title)}, ${drillsText(story.drills.drills)}:`, ...layerLines(story.drills, "    ")]),
  ].join("\n");
}
