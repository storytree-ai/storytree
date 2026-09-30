// The drill-down panel for a fixed annotated tree, through the real view model (drillDown) and the real
// renderer (renderStoryPanel): no randomness, no clock. Bundled and captured by ./capture.mjs.
import { workStates } from "@storytree/arc-surface";
import { drillDown } from "@storytree/forest";
import type { AnnotatedCapability, AnnotatedContract, AnnotatedTree, HealthColumn } from "@storytree/library";

import { renderStoryPanel } from "../../src/view/story-panel.js";

const none: HealthColumn = { state: "not-checked" };
const contract = (id: string, title: string, verified: HealthColumn): AnnotatedContract => ({ id, title, health: { reported: { state: "passing", by: "agent", at: "2026-09-20T09:00:00.000Z" }, verified } });
const cap = (id: string, title: string, description: string, dependsOn: string[], status: AnnotatedCapability["status"], contracts: AnnotatedContract[], why?: AnnotatedCapability["why"]): AnnotatedCapability => ({
  id,
  title,
  description,
  dependsOn,
  proposed: status === "proposed",
  contracts,
  status,
  ...(why === undefined ? {} : { why }),
  health: { reported: { state: "passing" }, verified: { state: status === "healthy" ? "passing" : "not-checked" } },
});

const tree: AnnotatedTree = {
  arcs: [],
  stories: [
    {
      id: "library",
      title: "The library",
      description: "Where the project's plan and knowledge live, and how an agent reads and writes it.",
      health: { reported: none, verified: none },
      capabilities: [
        cap("notes", "Notes", "Notes are written, found and edited by id.", [], "healthy", [contract("n1", "1.1 · A note is found by its title", { state: "passing", at: "2026-10-01T08:00:00.000Z" })]),
        cap("search", "Search", "A note is found by the words in it.", ["notes"], "untested", [contract("s1", "1.2 · Search finds a note by a word in its body", none), contract("s2", "1.3 · Search ranks a title above a body", none)], { reason: "no test names it", mover: "agent", contracts: ["s1", "s2"] }),
        cap("cloud", "Cloud connection", "The library opens on the project's Cloud database and says so.", ["notes"], "untested", [
          contract("c1", "8.1 · The live proof reads and writes on Cloud SQL", { state: "not-checked", skip: "owner", at: "2026-10-01T06:00:00.000Z", was: { state: "failing", at: "2026-09-27T10:00:00.000Z" } }),
          contract("c2", "8.2 · A refused connection says which setting to fix", { state: "passing", at: "2026-10-01T06:00:00.000Z" }),
        ], { reason: "needs owner", mover: "owner", contracts: ["c1"], since: "2026-09-27T10:00:00.000Z" }),
        cap("sync", "Sync", "Two computers see the same library.", ["notes"], "unhealthy", [
          contract("y1", "9.1 · A change on one computer shows on the other", { state: "not-checked", skip: "other", at: "2026-10-01T06:00:00.000Z", was: { state: "failing", at: "2026-09-27T10:00:00.000Z" } }),
          contract("y2", "9.2 · A conflict keeps both versions", { state: "passing", at: "2026-10-01T06:00:00.000Z" }),
        ], { reason: "not re-run", mover: "agent", contracts: ["y1"], since: "2026-10-01T06:00:00.000Z" }),
      ],
    },
  ],
};

const panel = drillDown(tree, "library", workStates([]), []);
if (panel === undefined) throw new Error("the fixture story is missing");
(globalThis as { show?: (selected: string) => void }).show = (selected) => {
  const root = document.querySelector(".story-panel");
  if (root === null) throw new Error("no panel");
  root.innerHTML = renderStoryPanel(panel, selected);
};
