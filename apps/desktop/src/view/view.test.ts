/**
 * The desktop app's view: a project's tree, as the library's projectTree() returns it, rendered as
 * the page shows it. Pure functions, so they are tested here without Electron or a library.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import type { AnnotatedTree, HealthColumn, NodeHealth } from "@storytree/library";

import { inBuildOrder, projectView, renderNoProjects, renderProject, renderSwitcher } from "./view.js";

const NOT_CHECKED: HealthColumn = { state: "not-checked" };
const health = (reported: HealthColumn, verified: HealthColumn): NodeHealth => ({ reported, verified });
const RUN_AT = "2026-09-26T06:40:12.345Z";

/** A story whose capabilities were added in the order C, A, B, where C depends on B and B on A. */
const TREE: AnnotatedTree = {
  arcs: [],
  stories: [
    {
      id: "story_1",
      title: "The library",
      description: "Where one project's `records` live & grow",
      health: health(NOT_CHECKED, { state: "failing" }),
      capabilities: [
        {
          id: "cap_c",
          title: "3 · Third",
          dependsOn: ["cap_b"],
          health: health(NOT_CHECKED, { state: "failing" }),
          contracts: [
            {
              id: "k_c1",
              title: "3.1 · Fails <loudly>",
              health: health(NOT_CHECKED, { state: "failing", by: "storytree test run", at: RUN_AT, note: "1/2 tests passed" }),
            },
          ],
        },
        {
          id: "cap_a",
          title: "1 · First",
          description: "The first one",
          dependsOn: [],
          health: health({ state: "passing" }, { state: "passing" }),
          contracts: [
            {
              id: "k_a1",
              title: '1.1 · `openProject("site")` creates it',
              health: health(
                { state: "passing", by: "an agent", at: RUN_AT },
                { state: "passing", by: "storytree test run", at: RUN_AT, note: "2/2 tests passed" },
              ),
            },
          ],
        },
        { id: "cap_b", title: "2 · Second", dependsOn: ["cap_a"], health: health(NOT_CHECKED, NOT_CHECKED), contracts: [] },
      ],
    },
  ],
};

test("capabilities are shown in build order: each after every capability it depends on, and otherwise in the order they were added", () => {
  const [story] = projectView("storytree", TREE).stories;
  assert.deepEqual(story?.capabilities.map(({ id }) => id), ["cap_a", "cap_b", "cap_c"]);
  assert.deepEqual(attributeValues(renderProject("storytree", TREE), "data-capability-id"), ["cap_a", "cap_b", "cap_c"]);

  // The library story, added in its stated build order 1 → 2 → 3 → (4, 6) → 5 → 7, then 8, keeps it.
  const library = [
    ["1", []], ["2", ["1"]], ["3", ["2"]], ["4", ["3"]], ["6", ["3"]], ["5", ["4"]], ["7", ["1", "4", "5", "6"]], ["8", ["1"]],
  ].map(([id, dependsOn]) => ({ id: id as string, dependsOn: dependsOn as string[] }));
  assert.deepEqual(inBuildOrder(library).map(({ id }) => id), ["1", "2", "3", "4", "6", "5", "7", "8"]);

  // A dependency that is not in the story (a retired capability) is ignored, and a loop (which the
  // library refuses to store) cannot hang it: what is left keeps the order it was added in.
  const odd = [
    { id: "x", dependsOn: ["y"] },
    { id: "y", dependsOn: ["x"] },
    { id: "z", dependsOn: ["gone"] },
  ];
  assert.deepEqual(inBuildOrder(odd).map(({ id }) => id), ["z", "x", "y"]);
});

test("each capability shows its health in two columns side by side, Agent reported then Storytree verified, each state a badge", () => {
  const [story] = projectView("storytree", TREE).stories;
  const third = story?.capabilities.find(({ id }) => id === "cap_c");
  assert.deepEqual(third?.health, [
    { column: "reported", label: "Agent reported", state: "not-checked", badge: "not checked" },
    { column: "verified", label: "Storytree verified", state: "failing", badge: "failing" },
  ]);

  const html = renderProject("storytree", TREE);
  const heads = [...html.matchAll(/class="column-head"[^>]*>([^<]*)</g)].map(([, label]) => label);
  assert.deepEqual(heads, ["Agent reported", "Storytree verified"], "the two columns are headed once, in that order");
  for (const [id, reported, verified] of [
    ["cap_a", "passing", "passing"],
    ["cap_b", "not-checked", "not-checked"],
    ["cap_c", "not-checked", "failing"],
  ] as const) {
    const summary = summaryOf(html, id);
    const cells = [...summary.matchAll(/data-column="(\w+)"[\s\S]*?class="badge badge-([\w-]+)"[^>]*>[\s\S]*?([a-z][a-z ]+)<\/span>/g)].map(
      ([, column, state, text]) => [column, state, text],
    );
    assert.deepEqual(
      cells,
      [
        ["reported", reported, reported === "not-checked" ? "not checked" : reported],
        ["verified", verified, verified === "not-checked" ? "not checked" : verified],
      ],
      `${id}: reported then verified, side by side in its summary row`,
    );
  }
});

test("a capability expands to show its contracts, each with its own two columns and what its entries say: who, when and the note", () => {
  const [story] = projectView("storytree", TREE).stories;
  const first = story?.capabilities.find(({ id }) => id === "cap_a");
  assert.deepEqual(first?.contracts, [
    {
      id: "k_a1",
      title: '1.1 · `openProject("site")` creates it',
      health: [
        { column: "reported", label: "Agent reported", state: "passing", badge: "passing", detail: "an agent · 2026-09-26 06:40 UTC" },
        {
          column: "verified",
          label: "Storytree verified",
          state: "passing",
          badge: "passing",
          detail: "storytree test run · 2026-09-26 06:40 UTC · 2/2 tests passed",
        },
      ],
    },
  ]);
  assert.deepEqual(story?.capabilities.find(({ id }) => id === "cap_b")?.dependsOn, ["1 · First"], "dependencies by title");

  const html = renderProject("storytree", TREE);
  assert.equal((html.match(/<details class="capability"/g) ?? []).length, 3, "every capability is an expandable <details>");
  assert.match(html, /<details class="capability" data-capability-id="cap_c">\s*<summary[\s\S]*?<\/summary>[\s\S]*data-contract-id="k_c1"[\s\S]*?<\/details>/);
  assert.match(html, /storytree test run · 2026-09-26 06:40 UTC · 1\/2 tests passed/);
  assert.match(detailsOf(html, "cap_b"), /No contracts yet/);
  assert.match(detailsOf(html, "cap_b"), /Depends on 1 · First/);
  assert.match(detailsOf(html, "cap_a"), /The first one/);
});

test("the story heads the page with its title, description and rolled-up health, all text escaped, and `code` shown as code", () => {
  const [story] = projectView("storytree", TREE).stories;
  assert.equal(story?.contractCount, 2);
  assert.deepEqual(story?.tally, {
    reported: { passing: 1, failing: 0, notChecked: 1 },
    verified: { passing: 1, failing: 1, notChecked: 0 },
  });
  assert.deepEqual(story?.health.map(({ badge }) => badge), ["not checked", "failing"]);

  const html = renderProject("storytree", TREE);
  assert.match(html, /<section class="story" data-story-id="story_1">/);
  assert.match(html, /<h1[^>]*>The library<\/h1>/);
  assert.match(html, /Where one project&#39;s <code>records<\/code> live &amp; grow/);
  assert.match(html, /3\.1 · Fails &lt;loudly&gt;/);
  assert.doesNotMatch(html, /<loudly>/);
  assert.match(html, /1\.1 · <code>openProject\(&quot;site&quot;\)<\/code> creates it/);
});

test("a project with no stories says so, and with no projects at all the page says how to bring this repo's own stories back from a snapshot", () => {
  const empty = renderProject("site", { stories: [], arcs: [] });
  assert.match(empty, /site has no stories yet/);
  assert.doesNotMatch(empty, /data-story-id/);
  const none = renderNoProjects();
  assert.match(none, /<code>pnpm library:restore &lt;snapshot&gt;<\/code>/);
  assert.match(none, /~\/\.storytree\/0\.3\/backups/);
  assert.doesNotMatch(none, /seed:library/, "the seed is gone: the library is the one copy (ADR-0641)");
});

test("the project switcher lists every project, the one shown selected, names escaped", () => {
  const html = renderSwitcher(["app", "storytree", "<odd>"], "storytree");
  assert.deepEqual(attributeValues(html, "value"), ["app", "storytree", "&lt;odd&gt;"]);
  assert.match(html, /<option value="storytree" selected>storytree<\/option>/);
  assert.doesNotMatch(html, /<option value="app" selected>/);
});

// --- helpers ---------------------------------------------------------------------------------

/** Every value of `attribute` in `html`, in document order. */
function attributeValues(html: string, attribute: string): string[] {
  return [...html.matchAll(new RegExp(`\\s${attribute}="([^"]*)"`, "g"))].map(([, value]) => value ?? "");
}

/** The <details> element of capability `id`, as HTML. */
function detailsOf(html: string, id: string): string {
  const start = html.indexOf(`<details class="capability" data-capability-id="${id}">`);
  assert.ok(start >= 0, `capability ${id} is rendered`);
  return html.slice(start, html.indexOf("</details>", start) + "</details>".length);
}

/** The <summary> row of capability `id`, as HTML. */
function summaryOf(html: string, id: string): string {
  const details = detailsOf(html, id);
  return details.slice(details.indexOf("<summary"), details.indexOf("</summary>"));
}
