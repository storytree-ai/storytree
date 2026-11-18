// Capability 20 · Lane measures
import type { FieldsOf, Library } from "@storytree/library";

import type { LaneWindow } from "./lanes.js";

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

const REVIEWERS: readonly CatchLayer[] = ["test reviewer", "code reviewer"];

type DrillCaught = FieldsOf<"drill">["caughtBy"];

const OF_DRILL: Readonly<Record<DrillCaught, CatchLayer>> = {
  "test-writer": "test writer", builder: "builder", lint: "lint", tests: "build-loop check", mutation: "mutation report",
  "test-reviewer": "test reviewer", "code-reviewer": "code reviewer", "ci-linux": "CI", "ci-windows": "CI", none: "escaped",
};

export function layerOfDrill(layer: DrillCaught): CatchLayer {
  return OF_DRILL[layer];
}

export function layerOfField(caughtAt: FieldsOf<"escape">["caughtAt"]): CatchLayer {
  return caughtAt === "ci" ? "CI" : "escaped";
}

export function layerOfFinding(foundBy: "graduated" | "mutation" | "weakening" | "reviewer", slice: "code" | "test" | "whole"): CatchLayer | undefined {
  if (foundBy === "graduated") return "lint";
  if (foundBy === "mutation") return "mutation report";
  if (foundBy === "weakening") return "test reviewer";
  return slice === "code" ? "code reviewer" : slice === "test" ? "test reviewer" : undefined;
}

export interface FieldCount {
  readonly caughtByCi: number;
  readonly escaped: number;
}

export interface LayerCount {
  readonly layer: CatchLayer;
  readonly caughtFirst: number;
  readonly notRun: number;
  readonly sameModel?: number;
}

export interface DrillReading {
  readonly drills: number;
  readonly layers: readonly LayerCount[];
}

export interface PatternCatch extends DrillReading {
  readonly pattern: string;
  readonly title?: string;
}

export interface StoryCatch {
  readonly story: string;
  readonly title?: string;
  readonly field: FieldCount;
  readonly drills: DrillReading;
}

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

function layerLines(reading: DrillReading, indent: string): string[] {
  return reading.layers.map((count) => `${indent}${count.layer}: ${count.caughtFirst} caught first, ${count.notRun} not run${count.sameModel === undefined ? "" : `, ${count.sameModel} same-model`}`);
}

const drillsText = (count: number): string => `${count} drill${count === 1 ? "" : "s"}`;

export function catchRateLines(stories: readonly StoryCatch[]): string[] {
  const lines = ["Catch rate per story (escape patterns harvested and drills dated in the window, by the layer that caught each first; report only):"];
  if (stories.length === 0) return [...lines, "  No escape pattern or drill in that window."];
  for (const story of stories) {
    lines.push(`  ${named(story.story, story.title)}:`, `    field: ${fieldText(story.field)}`, `    ${drillsText(story.drills.drills)}:`, ...layerLines(story.drills, "      "));
  }
  return lines;
}

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
