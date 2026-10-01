// The drill-down panel of a first user's project, which nothing verifies (forest 4.13, ADR-0630):
// a fixed annotated tree, through the real view model (drillDown) and the real renderer
// (renderStoryPanel); no randomness, no clock. Bundled and captured by ./capture.mjs.
import { workStates } from "@storytree/arc-surface";
import { drillDown } from "@storytree/forest";
import type { AnnotatedCapability, AnnotatedContract, AnnotatedTree, HealthState } from "@storytree/library";

import { renderStoryPanel } from "../../src/view/story-panel.js";

const contract = (id: string, title: string, reported: HealthState): AnnotatedContract => ({
  id,
  title,
  health: { reported: reported === "not-checked" ? { state: reported } : { state: reported, by: "agent", at: "2026-10-01T09:00:00.000Z" }, verified: { state: "not-checked" } },
});
const cap = (id: string, title: string, description: string, dependsOn: string[], reported: HealthState, contracts: AnnotatedContract[], proposed = false): AnnotatedCapability => ({
  id,
  title,
  description,
  dependsOn,
  proposed,
  contracts,
  status: proposed ? "proposed" : "untested",
  ...(proposed ? { why: { reason: "not built", mover: "agent", contracts: [] } } : { reportOnly: true }),
  health: { reported: { state: reported }, verified: { state: "not-checked" } },
});

const tree: AnnotatedTree = {
  arcs: [],
  unverified: true,
  stories: [
    {
      id: "todos",
      title: "Keep a todo list",
      description: "A visitor adds, completes and clears todos, and the list survives a reload.",
      health: { reported: { state: "passing" }, verified: { state: "not-checked" } },
      capabilities: [
        cap("add", "Add a todo", "Typing a todo and pressing Enter adds it to the list.", [], "passing", [contract("a1", "1.1 · Enter adds the trimmed todo", "passing"), contract("a2", "1.2 · An empty todo is not added", "passing")]),
        cap("complete", "Complete a todo", "Ticking a todo marks it done and updates the count.", ["add"], "failing", [contract("c1", "2.1 · Ticking marks it done", "passing"), contract("c2", "2.2 · The count says how many are left", "failing")]),
        cap("footer", "Main and footer", "The list and its footer are hidden when there are no todos.", ["add"], "passing", [contract("f1", "3.1 · Hidden with no todos", "passing")]),
        cap("persist", "Survives a reload", "The list is kept in the browser's storage.", ["add"], "not-checked", [contract("p1", "4.1 · A reload keeps the list", "not-checked")]),
        cap("routing", "Filter by address", "All, Active and Completed each have their own address.", ["complete"], "not-checked", [contract("r1", "5.1 · #/active shows only active todos", "not-checked")], true),
      ],
    },
  ],
};

const panel = drillDown(tree, "todos", workStates([]), []);
if (panel === undefined) throw new Error("the fixture story is missing");
(globalThis as { show?: (selected: string) => void }).show = (selected) => {
  const root = document.querySelector(".story-panel");
  if (root === null) throw new Error("no panel");
  root.innerHTML = renderStoryPanel(panel, selected);
};
