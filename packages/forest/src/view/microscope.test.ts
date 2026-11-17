/**
 * Capability 4 · Drill-down: the panel's microscope (ADR-1350 D2), as the page draws it and the user drills it. Read in
 * happy-dom: the panel's HTML, then its folds, which work the microscope beside them.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { Window } from "happy-dom";
import { waitUntil } from "@storytree/test-waits";

import type { CapabilityLine, StoryPanel } from "@storytree/forest";

import { microscope } from "../drill-down/microscope.js";
import { namesShown, scopeDrawing, scopeSection } from "./microscope.js";
import { panelFolds } from "./panel-folds.js";
import { renderStoryPanel } from "./story-panel.js";
import { PARKED_FILL } from "./territory-land.js";

const capability = (id: string): CapabilityLine => ({ id, title: `The ${id}`, description: `What ${id} does.`, reported: "passing", status: "healthy", contracts: [] });

// Capability a's code nests three deep: x holds deep and wide, and deep holds inner. Its own file outside x imports x;
// inside x, x's entry imports deep, deep's inner imports wide and b's file; story t's c imports wide. b is parked, and its
// name runs long enough to be cut where a gate names it.
const B = "The b, whose name runs long enough to be cut";
const files = ["src/a/own.ts", "src/a/x/index.ts", "src/a/x/deep/index.ts", "src/a/x/deep/two.ts", "src/a/x/deep/inner/index.ts", "src/a/x/wide/index.ts"];
const survey = {
  s: {
    files: [...files.map((path) => ({ path, lines: 40, capability: "a" })), { path: "src/b/b.ts", lines: 60, capability: "b" }],
    imports: [
      { from: "src/a/own.ts", to: "src/a/x/index.ts" },
      { from: "src/a/x/index.ts", to: "src/a/x/deep/index.ts" },
      { from: "src/a/x/deep/inner/index.ts", to: "src/a/x/wide/index.ts" },
    ],
    edges: [{ story: "s", from: "a", to: "b", typeOnly: false, files: [{ from: "src/a/x/deep/inner/index.ts", to: "src/b/b.ts", typeOnly: false }] }],
    parts: {
      capabilities: {
        a: [{
          folder: "src/a/x", files: ["src/a/x/index.ts"], parts: [
            { folder: "src/a/x/deep", files: ["src/a/x/deep/index.ts", "src/a/x/deep/two.ts"], parts: [{ folder: "src/a/x/deep/inner", files: ["src/a/x/deep/inner/index.ts"], parts: [] }] },
            { folder: "src/a/x/wide", files: ["src/a/x/wide/index.ts"], parts: [] },
          ],
        }],
      },
    },
  },
};
const surveys = {
  ...survey,
  t: { files: [{ path: "src/c.ts", lines: 10, capability: "c" }], edges: [{ story: "s", from: "c", to: "a", typeOnly: false, files: [{ from: "src/c.ts", to: "src/a/x/wide/index.ts", typeOnly: false }] }] },
};
const plan = {
  story: "s", title: "Story s",
  capabilities: [{ id: "a", title: "The a", status: "healthy" as const }, { id: "b", title: B, status: "untested" as const, parked: true }],
  edges: [{ from: "a", to: "b" }],
  names: new Map([["s", "Story s"], ["a", "The a"], ["b", B], ["t", "Story t"], ["c", "The c"]]),
};
const story: StoryPanel = { story: "s", title: "Story s", description: "What s is.", capabilities: [capability("a"), capability("b")], microscope: microscope(plan, surveys) };

function page(drawn: StoryPanel = story) {
  const window = new Window();
  const host = window.document.createElement("aside") as unknown as HTMLElement;
  window.document.body.appendChild(host as never);
  const folds = panelFolds();
  /** Draw the panel for `selected` as the page does, then let its microscope's layout finish. */
  const draw = async (selected: string | undefined): Promise<void> => {
    host.innerHTML = renderStoryPanel(drawn, selected);
    folds.draw(host);
    await settled();
  };
  const settled = () => waitUntil(() => host.querySelector("[data-scope-pending]") === null, 10_000, "the microscope's level laid out");
  const section = () => host.querySelector<HTMLElement>(".panel-microscope")!;
  const shown = () => [...section().querySelectorAll<SVGElement>("[data-scope-child]")].map((child) => child.getAttribute("data-scope-child"));
  const trail = () => [...section().querySelectorAll(".scope-trail > *:not(.scope-step)")].map((crumb) => crumb.textContent);
  const gates = () => [...section().querySelectorAll(".scope-gate")].map((gate) => gate.getAttribute("data-scope-gate"));
  const click = async (selector: string) => {
    const target = section().querySelector(selector);
    assert.ok(target, `the microscope offers ${selector}`);
    target.dispatchEvent(new window.MouseEvent("click", { bubbles: true }) as never);
    await settled();
  };
  const press = async (selector: string, key: string) => {
    section().querySelector(selector)!.dispatchEvent(new window.KeyboardEvent("keydown", { key, bubbles: true }) as never);
    await settled();
  };
  /** Whether the level's roads hold a road from `from` to `to`, each a gate (by its name) or a part's junction (by its id). */
  const road = (from: string, to: string) => {
    const end = (what: string) => {
      const gate = [...section().querySelectorAll(".scope-gate")].find((each) => each.getAttribute("data-scope-gate") === what);
      if (gate !== undefined) return gate.getAttribute("data-scope-post")!;
      const junction = [...section().querySelectorAll(".scope-junction")].find((each) => each.getAttribute("data-scope-junction") === what);
      return junction === undefined ? "none" : `${junction.getAttribute("cx")} ${junction.getAttribute("cy")}`;
    };
    return section().querySelector(".scope-roads")!.getAttribute("d")!.includes(`M${end(from)}L${end(to)}`);
  };
  return { draw, section, shown, trail, gates, click, press, road, host, folds };
}

test("4.55 · the panel's microscope shows the one thing it is rooted on, drills into a capability's parts as deep as the code goes with a breadcrumb back up, and names the neighbour at each gate", async () => {
  const { draw, section, shown, trail, gates, click, press, road, host, folds } = page();

  // A story alone: its capabilities, each choosing that capability through the globe's selection.
  await draw(undefined);
  assert.deepEqual(shown(), ["a", "b"]);
  assert.equal(section().querySelector('[data-scope-child="a"]')?.getAttribute("data-pick-capability"), "a");
  assert.deepEqual(gates(), ["Story t"], "another island its code reaches is a gate named by its story");
  assert.ok(road("Story t", "a"), "its road leads to the capability it reaches");
  assert.equal(section().querySelector('[data-scope-child="b"]')?.getAttribute("fill"), PARKED_FILL.colour, "a parked capability is grey, as on the map");

  // The capability chosen: its parts, x opening further and its own files named by itself; b's road ends at a gate.
  await draw("a");
  assert.deepEqual(shown(), ["src/a/x", "a"]);
  assert.deepEqual(trail(), ["Story s", "The a"]);
  assert.deepEqual(gates(), ["Story t", B]);
  const named = [...section().querySelectorAll(".scope-gate")].find((gate) => gate.getAttribute("data-scope-gate") === B)!.querySelector("text")!;
  assert.equal(named.firstChild?.textContent, "The b, whose name runs…", "a long name is cut on the drawing");
  assert.equal(named.querySelector("title")?.textContent, B, "and whole on hover");
  // The panel's behaviours drawn again over the same panel keep the microscope as it is.
  const kept = section();
  folds.draw(host);
  assert.ok(section() === kept, "drawing the panel's behaviours again replaces nothing");

  // Into x by the keyboard, then on into deep: each drill re-rooted, only its own parts drawn, with a breadcrumb back up.
  await press('[data-scope-child="src/a/x"]', "Enter");
  assert.deepEqual(shown(), ["src/a/x/deep", "src/a/x/wide", "src/a/x"]);
  assert.deepEqual(trail(), ["Story s", "The a", "x"]);
  assert.deepEqual(gates(), ["Story t", "The a", B], "x's gates name the capability's own files beside it and the capabilities its code reaches");
  assert.ok(road("src/a/x", "src/a/x/deep"), "a road joins two parts where one's file imports the other's");
  await click('[data-scope-child="src/a/x/deep"]');
  assert.deepEqual(shown(), ["src/a/x/deep/inner", "src/a/x/deep"]);
  assert.deepEqual(trail(), ["Story s", "The a", "x", "deep"]);
  assert.deepEqual(gates(), [B, "wide", "x"], "deep's gates name the parts beside it inside x and the other capability");
  assert.ok(road(B, "src/a/x/deep/inner") && road("wide", "src/a/x/deep/inner"), "each gate's road leads to the part its files are in");

  // A redraw of the panel keeps the drill; the breadcrumb climbs back.
  await draw("a");
  assert.deepEqual(trail(), ["Story s", "The a", "x", "deep"]);
  await click('.scope-trail [data-scope-to="a:src/a/x"]');
  assert.deepEqual(shown(), ["src/a/x/deep", "src/a/x/wide", "src/a/x"]);
  await click('.scope-trail [data-scope-to="a"]');
  assert.deepEqual(shown(), ["src/a/x", "a"]);
  assert.ok(section().querySelector(".scope-trail [data-pick-story]"), "the story's crumb opens the story alone, as the panel's head does");

  // Another capability chosen starts at its own level.
  await click('[data-scope-child="src/a/x"]');
  await draw("b");
  assert.deepEqual(trail(), ["Story s", B]);
});

test("4.55 · where two of the microscope's names would be written over each other, the larger part's is written and the other's left to its hover", () => {
  // "below" sits a line under "large", nearer than a 7-unit name's own height with its stroke, so it gives way too.
  const children = [{ id: "small", title: "2 · Small", lines: 10 }, { id: "large", title: "1 · Large", lines: 90 }, { id: "apart", title: "3 · Apart", lines: 5 }, { id: "below", title: "4 · Below", lines: 8 }];
  const places = new Map([["small", { x: 3, z: 2 }], ["large", { x: 0, z: 0 }], ["apart", { x: 0, z: 40 }], ["below", { x: 6, z: 9 }]]);
  assert.deepEqual(namesShown(children, places).map(({ child }) => child.id), ["large", "apart"]);
});

test("4.55 · news that leaves the story unchanged draws the panel the same once its microscope is laid out, so the page touches nothing (2.51)", async () => {
  // Its own sizes, so no other test has laid its level out already.
  const resized = { ...surveys, s: { ...survey.s, files: survey.s.files.map((file) => ({ ...file, lines: file.lines + 1 })) } };
  const unchanged: StoryPanel = { ...story, microscope: microscope(plan, resized) };
  const { draw, host } = page(unchanged);
  const before = renderStoryPanel(unchanged, undefined);
  await draw(undefined);
  assert.ok(host.querySelector(".scope-territory"), "the microscope's level laid out on the panel");
  assert.equal(renderStoryPanel(unchanged, undefined), before, "the panel's HTML is the same after its microscope was laid out");
});

test("4.55 · a capability whose code is one part opens on that part's parts, the capability named on the way; a dependency only the plan records ends at its gate; a level of many roads draws them fine", () => {
  const window = new Window();
  // r's code is one part, lib, holding two parts of its own; the plan alone says r depends on q.
  const one = microscope({
    story: "s", title: "Story s",
    capabilities: [{ id: "r", title: "The r", status: "healthy" }, { id: "q", title: "The q", status: "healthy" }],
    edges: [{ from: "r", to: "q" }],
    names: new Map([["s", "Story s"], ["r", "The r"], ["q", "The q"]]),
  }, { s: {
    files: ["src/r/lib/index.ts", "src/r/lib/one/index.ts", "src/r/lib/two/index.ts", "src/q/q.ts"].map((path) => ({ path, lines: 20, capability: path.startsWith("src/q") ? "q" : "r" })),
    parts: { capabilities: { r: [{ folder: "src/r/lib", files: ["src/r/lib/index.ts"], parts: [
      { folder: "src/r/lib/one", files: ["src/r/lib/one/index.ts"], parts: [] }, { folder: "src/r/lib/two", files: ["src/r/lib/two/index.ts"], parts: [] }] }] } },
  } });
  const host = window.document.createElement("div");
  host.innerHTML = scopeSection(one, "r");
  assert.equal(host.querySelector(".panel-microscope")?.getAttribute("data-scope-root"), "r:src/r/lib", "the one part's level is shown");
  assert.deepEqual([...host.querySelectorAll("[data-scope-child]")].map((child) => child.getAttribute("data-scope-child")), ["src/r/lib/one", "src/r/lib/two", "src/r/lib"]);
  const through = host.querySelector(".scope-through");
  assert.equal(through?.textContent, "The r", "the capability is named on the way down, not offered, since it would show this level again");
  assert.deepEqual(one.levels["r"]!.gates, [{ name: "The q", reaches: [] }], "a dependency the code does not show still has its gate");

  const many = Array.from({ length: 12 }, (_, k) => ({ id: `p${k}`, title: `p${k}`, lines: 10 }));
  const roads = many.flatMap((a, i) => many.slice(i + 1).map((b) => ({ from: a.id, to: b.id })));
  const busy = (level: typeof roads) => scopeDrawing({ id: "m", path: ["s", "m"], titles: ["S", "M"], children: many, roads: level, gates: [] }).includes('class="scope-roads busy"');
  assert.equal(busy(roads), true, "sixty-six roads drawn fine");
  assert.equal(busy(roads.slice(0, 3)), false, "three drawn full");
});
