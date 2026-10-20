/**
 * Capability 5 · The placement report (the Guardrails story): rule 5 of the journey principle (principle_c660f3c89819,
 * ADR-1078), counted at the package level only, as ADR-1085 D3 narrows it to what reads reliably. `storytree check`
 * prints it and never fails on it: it is a reading for the user to judge, not a rule.
 *
 * - A package's counted callers are the other packages whose production code imports it, type-only imports included,
 *   as the map's code survey reads them (storyEdges, in packages/map). Tests and testing helpers make no edges.
 * - Not counted, but listed: imports from the delivery mechanisms (the front-door frames, the driving adapters, and the
 *   frame storytree.check.json marks `"compositionRoot": true`), and plumbing calls: a forwarder the survey marks, and
 *   the build steps and cleanups the checkout declares under `placement.plumbing`, since no code shows them. A
 *   declared call that matches no import is named as stale.
 * - Each count implies a placement: at or above the threshold (`placement.threshold`, default two) its own story; one
 *   caller, inside that story; none, its own story; between one and the threshold, separate ways. Today every package
 *   is its own story, so the report names each placed otherwise, with the loop moving it inside its caller would make:
 *   the caller reaching it through a package whose import of it is not counted, or a cycle already there.
 *   `placement.off` leaves the report out.
 */
import { existsSync, readdirSync } from "node:fs";
import path from "node:path";

import { codeSurveyReader } from "@storytree/map/code-survey";

import { storiesOf, type Frame } from "../package-rule/package-rule.js";

/** A frame as the placement report reads it: a front door, or the composition root, is a delivery mechanism. */
export type PlacementFrame = Frame & { readonly compositionRoot?: boolean };

/** A plumbing call no code shows: the file making it, the story (its package's folder name) it reaches, who said so and when. */
export interface Plumbing {
  readonly from: string;
  readonly to: string;
  readonly kind: "build step" | "cleanup";
  readonly said: string;
  readonly on: string;
}

/** The placement report's settings, under storytree.check.json's `placement`. */
export interface PlacementSettings {
  readonly threshold?: number;
  readonly plumbing?: readonly Plumbing[];
  readonly off?: boolean;
}

/** What the placement report reads from a checkout's declarations. */
export interface PlacementDeclarations {
  readonly stories?: readonly string[];
  readonly frames?: readonly PlacementFrame[];
  readonly placement?: PlacementSettings;
}

/** Why an import of a package is not counted. */
export type Uncounted = "delivery mechanism" | "forwarder" | "build step" | "cleanup";

/** One package's reading: its counted callers, the callers not counted and why, and the placement the count implies. */
export interface Placement {
  readonly package: string;
  readonly callers: readonly string[];
  readonly uncounted: readonly { readonly caller: string; readonly kind: Uncounted; readonly file: string }[];
  /** A delivery mechanism is listed, never placed. */
  readonly placement: "own story" | "inside" | "separate ways" | "delivery mechanism";
  /** The one caller it would go inside. */
  readonly inside?: string;
  /** Whether that differs from today, where every package is its own story. */
  readonly differs: boolean;
  /** The loop moving it inside its caller would make: a path between the two through other packages, either way. */
  readonly loop?: readonly string[];
}

export interface PlacementReport {
  readonly threshold: number;
  readonly placements: readonly Placement[];
  /** Declared plumbing that matches no import. */
  readonly stale: readonly Plumbing[];
  readonly text: string;
}

/** The workspace packages directly under `parent` (packages or apps), as repo-relative paths. */
function packageDirs(root: string, parent: string): string[] {
  if (!existsSync(path.join(root, parent))) return [];
  return readdirSync(path.join(root, parent)).filter((name) => existsSync(path.join(root, parent, name, "package.json"))).sort().map((name) => `${parent}/${name}`);
}

/** Each package's counted callers and the placement the count implies, over the checkout at `root`. */
export async function placementReport(root: string, declared: PlacementDeclarations = {}): Promise<PlacementReport> {
  const threshold = declared.placement?.threshold ?? 2;
  const plumbing = declared.placement?.plumbing ?? [];
  const stories = (declared.stories ?? storiesOf(root)).filter((story): story is string => typeof story === "string");
  const dirs = [...packageDirs(root, "packages"), ...packageDirs(root, "apps")];
  const delivery = new Set((declared.frames ?? []).filter((frame) => frame.frontDoor === true || frame.compositionRoot === true).flatMap((frame) => frame.dirs));
  const dirOf = (file: string) => dirs.filter((dir) => file.startsWith(`${dir}/`)).sort((a, b) => b.length - a.length)[0];

  type Tree = Parameters<ReturnType<typeof codeSurveyReader>["read"]>[1];
  const tree = { stories: stories.map((id) => ({ id, title: id, capabilities: [] })) } as unknown as Tree;
  const survey = await codeSurveyReader({ checkout: "current" }).read(root, tree);

  const counted = new Map(dirs.map((dir) => [dir, new Set<string>()]));
  const uncounted = new Map<string, Map<string, { caller: string; kind: Uncounted; file: string }>>(dirs.map((dir) => [dir, new Map()]));
  const imports = new Map(dirs.map((dir) => [dir, new Set<string>()]));
  const matched = new Set<Plumbing>();
  for (const [story, { edges = [] }] of Object.entries(survey)) {
    for (const edge of edges) {
      const target = `packages/${edge.story}`;
      for (const file of edge.files) {
        const from = path.posix.normalize(path.posix.join("packages", story, file.from));
        const caller = dirOf(from);
        if (caller === undefined || caller === target || !counted.has(target)) continue;
        imports.get(caller)!.add(target);
        const call = plumbing.find((declaredCall) => declaredCall.from === from && declaredCall.to === edge.story);
        if (call !== undefined) matched.add(call);
        const kind: Uncounted | undefined = delivery.has(caller) ? "delivery mechanism" : file.forwarder === true ? "forwarder" : call?.kind;
        if (kind === undefined) counted.get(target)!.add(caller);
        else uncounted.get(target)!.set(`${caller} ${kind}`, { caller, kind, file: from });
      }
    }
  }

  /** A path from `start` through other packages back to `end`, by production imports; undefined when there is none. */
  const loopFrom = (start: string, end: string): string[] | undefined => {
    const queue = [...imports.get(start)!].filter((next) => next !== end).map((next) => [start, next]);
    const seen = new Set([start]);
    for (let trail = queue.shift(); trail !== undefined; trail = queue.shift()) {
      const at = trail.at(-1)!;
      if (at === end) return trail;
      if (seen.has(at)) continue;
      seen.add(at);
      for (const next of imports.get(at) ?? []) queue.push([...trail, next]);
    }
    return undefined;
  };

  const placements = dirs.map((dir): Placement => {
    const callers = [...counted.get(dir)!].sort();
    const listed = [...uncounted.get(dir)!.values()].sort((a, b) => (a.caller + a.kind < b.caller + b.kind ? -1 : 1));
    if (delivery.has(dir)) return { package: dir, callers, uncounted: listed, placement: "delivery mechanism", differs: false };
    if (callers.length === 1) {
      // Its caller reaching it through a package whose import of it is not counted, or a cycle there already.
      const loop = loopFrom(callers[0]!, dir) ?? loopFrom(dir, callers[0]!);
      return { package: dir, callers, uncounted: listed, placement: "inside", inside: callers[0]!, differs: true, ...(loop === undefined ? {} : { loop }) };
    }
    const placement = callers.length === 0 || callers.length >= threshold ? "own story" : "separate ways";
    return { package: dir, callers, uncounted: listed, placement, differs: placement !== "own story" };
  });

  const said = (placed: Placement): string => {
    const count = `${placed.callers.length} counted ${placed.callers.length === 1 ? "caller" : "callers"}${placed.callers.length === 0 ? "" : ` (${placed.callers.join(", ")})`}`;
    const where = placed.placement === "delivery mechanism" ? "a delivery mechanism, not placed"
      : placed.placement === "inside" ? `inside ${placed.inside}, unlike today${placed.loop === undefined ? "" : `, though moving it there would make a loop: ${placed.loop.join(" → ")}, with ${placed.package} inside ${placed.inside}`}`
      : placed.placement === "separate ways" ? "separate ways, unlike today" : "its own story";
    const not = placed.uncounted.length === 0 ? "" : `; not counted: ${placed.uncounted.map(({ caller, kind, file }) => `${caller} (${kind === "delivery mechanism" ? kind : `${kind}, ${file}`})`).join(", ")}`;
    return `  - ${placed.package}: ${count}: ${where}${not}.`;
  };
  const differing = placements.filter((placed) => placed.differs);
  const stale = plumbing.filter((call) => !matched.has(call));
  const text = [
    `The placement report (rule 5 of the journey principle, threshold ${threshold}; it never fails the check):`,
    ...placements.map(said),
    differing.length === 0 ? "  Every package is placed as today." : `  Placed differently from today: ${differing.map((placed) => placed.package).join(", ")}.`,
    ...stale.map((call) => `  Stale: the ${call.kind} ${call.from} → ${call.to} in storytree.check.json's placement.plumbing matches no import; take it off the list.`),
  ].join("\n");
  return { threshold, placements, stale, text };
}
