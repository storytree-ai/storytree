/**
 * Capability 4 · Drill-down (the forest story): what the panel a click opens says about a story,
 * and which of its capabilities it shows below the diagram (ADR-0659).
 * The library's tree and history, and the agent log's lines, are written out here as the app hands
 * them to the page, so no database is needed.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import type { Line, NewLine } from "@storytree/agent-link";
import { workStates } from "@storytree/arc-surface";
import type { AnnotatedCapability, AnnotatedContract, AnnotatedStory, AnnotatedTree, Change, HealthColumn, HealthState } from "@storytree/library";

import { drillDown, NO_DESCRIPTION, selectedCapability } from "./drill-down.js";

const column = (state: HealthState, written = false): HealthColumn => (written ? { state, by: "someone", at: new Date(0).toISOString() } : { state });

function contract(id: string, reported: HealthState, verified?: HealthState): AnnotatedContract {
  return { id, title: `${id} works`, health: { reported: column(reported, reported !== "not-checked"), verified: column(verified ?? "not-checked", verified !== undefined) } };
}

/** A capability as the library hands it over: its health rolled up from its contracts (all passing is passing, any failing is failing). `null` for no description. */
function capability(id: string, dependsOn: string[], contracts: AnnotatedContract[] = [], description: string | null = `What ${id} does. Why it matters.`, status: AnnotatedCapability["status"] = "proposed"): AnnotatedCapability {
  const rollUp = (states: HealthState[]): HealthColumn => ({
    state: states.includes("failing") ? "failing" : states.length > 0 && states.every((state) => state === "passing") ? "passing" : "not-checked",
  });
  const health = {
    reported: rollUp(contracts.map((each) => each.health.reported.state)),
    verified: rollUp(contracts.map((each) => each.health.verified.state)),
  };
  return { id, title: `The ${id}`, ...(description === null ? {} : { description }), dependsOn, proposed: status === "proposed", contracts, health, status };
}

function story(id: string, ...capabilities: AnnotatedCapability[]): AnnotatedStory {
  return { id, title: `Story ${id}`, description: `What ${id} is. Why.`, capabilities, health: { reported: { state: "not-checked" }, verified: { state: "not-checked" } } };
}

/** The history's health saves for `contract`'s reported column, oldest first. */
function reports(contractId: string, ...states: HealthState[]): Change[] {
  return states.map((state, index) => {
    const at = new Date(Date.UTC(2026, 8, 27, 12, 0, index)).toISOString();
    const id = `health_${contractId}_reported`;
    return { seq: index + 1, recordId: id, type: "health", action: index === 0 ? "created" : "updated", record: { id, type: "health", version: index + 1, fields: { node: contractId, column: "reported", state }, createdAt: at, updatedAt: at } };
  });
}

function log(...written: NewLine[]): Line[] {
  return written.map((line, index) => ({ ...line, seq: index + 1, project: "shop", at: new Date(0).toISOString() }));
}
const claimed = (capability: string): NewLine => ({ kind: "claimed", session: "s1", source: "tool", capability, reason: "building it" });
const landed = (capability: string): NewLine => ({ kind: "landed", session: "s1", source: "tool", capability });

test("4.1 a story whose third capability builds on the first two opens in build order, with the agent's health, and a diagram of exactly two arrows", () => {
  const tree: AnnotatedTree = {
    stories: [story("s", capability("third", ["first", "second"]), capability("first", [], [contract("k1", "passing")]), capability("second", []))],
    arcs: [],
  };
  const panel = drillDown(tree, "s", workStates([]), []);
  assert.equal(panel?.description, "What s is. Why.");
  assert.deepEqual(panel?.capabilities.map(({ id, description }) => [id, description]), [
    ["first", "What first does. Why it matters."],
    ["second", "What second does. Why it matters."],
    ["third", "What third does. Why it matters."],
  ]);
  assert.equal(panel?.capabilities[0]?.contracts[0]?.reported, "passing");
  assert.deepEqual(panel?.arrows.map(({ from, to }) => `${from} -> ${to}`), ["third -> first", "third -> second"]);
});

test("4.2 a capability that builds on one in another story points at it, named with that story, with its word and whether it landed", () => {
  const tree: AnnotatedTree = { stories: [story("a", capability("login", ["accounts"])), story("b", capability("accounts", []))], arcs: [] };
  const [before] = drillDown(tree, "a", workStates([]), [])?.arrows ?? [];
  assert.deepEqual(before, { from: "login", to: "accounts", toTitle: "The accounts", toStory: "Story b", landed: false, toStatus: "proposed" });
  const [after] = drillDown(tree, "a", workStates(log(claimed("accounts"), landed("accounts"))), [])?.arrows ?? [];
  assert.equal(after?.landed, true);
});

test("4.3 a capability with no description says so instead of leaving a blank", () => {
  const tree: AnnotatedTree = { stories: [story("s", capability("bare", [], [], null))], arcs: [] };
  assert.equal(drillDown(tree, "s", workStates([]), [])?.capabilities[0]?.description, NO_DESCRIPTION);
});

test("4.4 a contract reported red, then green, says so; one reported only green says that", () => {
  const tree: AnnotatedTree = { stories: [story("s", capability("c", [], [contract("fixed", "passing"), contract("clean", "passing")]))], arcs: [] };
  const history = [...reports("fixed", "failing", "passing"), ...reports("clean", "passing")];
  const contracts = drillDown(tree, "s", workStates([]), history)?.capabilities[0]?.contracts ?? [];
  assert.deepEqual(contracts.map(({ id, trail }) => [id, trail]), [
    ["fixed", "red, then green"],
    ["clean", "green only"],
  ]);
});

test("4.5 storytree's own column shows beside the agent's only where something wrote it", () => {
  const tree: AnnotatedTree = { stories: [story("s", capability("c", [], [contract("seen", "passing", "passing"), contract("unseen", "passing")]))], arcs: [] };
  const [line] = drillDown(tree, "s", workStates([]), [])?.capabilities ?? [];
  assert.deepEqual(line?.contracts.map(({ id, verified }) => [id, verified]), [
    ["seen", "passing"],
    ["unseen", undefined],
  ]);
  assert.equal(line?.verified, "not-checked", "the capability shows storytree's column too, rolled up, since one of its contracts has an entry");
  const bare = drillDown({ stories: [story("t", capability("d", [], [contract("x", "failing")]))], arcs: [] }, "t", workStates([]), []);
  assert.equal(bare?.capabilities[0]?.verified, undefined);
});

test("4.7 the panel shows one capability below its diagram: the one chosen, else the first in build order not yet landed", () => {
  const tree: AnnotatedTree = { stories: [story("s", capability("base", []), capability("next", ["base"]), capability("last", ["next"])), story("t", capability("away", []))], arcs: [] };
  const opened = (lines: Line[]) => drillDown(tree, "s", workStates(lines), []);
  const fresh = opened([]);
  assert.ok(fresh !== undefined);
  assert.equal(selectedCapability(fresh), "base", "nothing landed: the first in build order");
  const part = opened(log(claimed("base"), landed("base")));
  assert.ok(part !== undefined);
  assert.equal(selectedCapability(part), "next", "the first not yet landed");
  assert.equal(selectedCapability(part, "last"), "last", "a chosen capability of the story stays chosen");
  assert.equal(selectedCapability(part, "away"), "next", "another story's capability is never chosen here");
  assert.equal(selectedCapability(part, "gone"), "next", "a choice that has left the story falls back");
  const done = opened(log(...["base", "next", "last"].flatMap((id) => [claimed(id), landed(id)])));
  assert.ok(done !== undefined);
  assert.equal(selectedCapability(done), "base", "everything landed: the first");
  const empty = drillDown({ stories: [story("e")], arcs: [] }, "e", workStates([]), []);
  assert.ok(empty !== undefined);
  assert.equal(selectedCapability(empty), undefined, "a story with no capabilities selects none");
});

test("4.10 each capability, and each other story's capability it points at, carries the library's word for it", () => {
  const tree: AnnotatedTree = {
    stories: [story("a", capability("login", ["accounts"], [], "Logs in.", "unhealthy")), story("b", capability("accounts", [], [], "Holds accounts.", "healthy"))],
    arcs: [],
  };
  const panel = drillDown(tree, "a", workStates([]), []);
  assert.equal(panel?.capabilities[0]?.status, "unhealthy");
  assert.equal(panel?.arrows[0]?.toStatus, "healthy");
});
