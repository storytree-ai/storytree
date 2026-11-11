/**
 * Capability 4 · Drill-down (the forest story): what the panel a click opens says about a story,
 * and which of its capabilities it shows below the diagram (ADR-0659).
 * The library's tree and history are written out here as the app hands
 * them to the page, so no database is needed.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import type { AnnotatedCapability, AnnotatedContract, AnnotatedStory, AnnotatedTree, Change, HealthColumn, HealthState } from "@storytree/library";
import { workStates } from "@storytree/arc-surface";

import { drillDown, NO_DESCRIPTION } from "./drill-down.js";

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

test("4.1 a story whose third capability builds on the first two opens in build order, with the agent's health", () => {
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

test("4.45 a contract marked for agentic user acceptance testing carries its state, not run until a run writes one; an unmarked contract carries none", () => {
  const marked: AnnotatedContract = { ...contract("marked", "passing"), proof: { by: "agentic-user-acceptance-testing", reason: "a user sees it on screen" } };
  const tested: AnnotatedContract = { ...contract("tested", "passing"), proof: { by: "test-criterion", reason: "a test reads it" } };
  const tree: AnnotatedTree = { stories: [story("s", capability("c", [], [marked, tested, contract("bare", "passing")]))], arcs: [] };
  const lines = drillDown(tree, "s", workStates([]), [])?.capabilities[0]?.contracts ?? [];
  assert.deepEqual(lines.map(({ id, acceptance }) => [id, acceptance]), [
    ["marked", "not-run"],
    ["tested", undefined],
    ["bare", undefined],
  ]);
});

test("4.1 each capability carries the library's word for it", () => {
  const tree: AnnotatedTree = { stories: [story("a", capability("login", [], [], "Logs in.", "unhealthy"), capability("logout", [], [], "Logs out.", "healthy"))], arcs: [] };
  assert.deepEqual(drillDown(tree, "a", workStates([]), [])?.capabilities.map(({ id, status }) => [id, status]), [["login", "unhealthy"], ["logout", "healthy"]]);
});

function numbered(id: string, title: string, verified: HealthColumn): AnnotatedContract {
  return { id, title, health: { reported: { state: "not-checked" }, verified } };
}

test("4.12 a capability that is not healthy carries its reason, who moves it, and its contracts by number; a healthy one carries nothing", () => {
  const stuck = capability("stuck", [], [numbered("c1", "8.1 · The live proof", { state: "not-checked", skip: "owner", at: "2026-09-27T10:00:00.000Z" }), numbered("c2", "Untitled promise", { state: "not-checked" })], null, "untested");
  const owners = { ...stuck, why: { reason: "needs owner" as const, mover: "owner" as const, contracts: ["c1"], since: "2026-09-27T10:00:00.000Z" } };
  const naming = { ...capability("naming", [], [numbered("c3", "Plain title", { state: "not-checked" }), numbered("c4", "1.2 · Numbered", { state: "not-checked" })], null, "untested"), why: { reason: "no test names it" as const, mover: "agent" as const, contracts: ["c3", "c4"] } };
  const built = { ...capability("built", [], [numbered("c5", "2.1 · Green", { state: "passing", at: "2026-09-27T10:00:00.000Z" })], null, "healthy") };
  const tree: AnnotatedTree = { stories: [story("s", owners, naming, built)], arcs: [] };
  const [a, b, c] = drillDown(tree, "s", workStates([]), [])?.capabilities ?? [];
  assert.deepEqual(a?.why, { reason: "needs owner", mover: "owner", contracts: ["8.1"], since: "2026-09-27T10:00:00.000Z" });
  assert.deepEqual(b?.why, { reason: "no test names it", mover: "agent", contracts: ["Plain title", "1.2"] }, "the number its title starts with, else the title");
  assert.equal(c?.why, undefined, "a healthy capability says nothing more");
});

test("4.14 a parked capability carries its word, its reason and the arcs that park it; one not parked carries none", () => {
  const why = { reason: "not built" as const, mover: "agent" as const, contracts: [] };
  const parked = { ...capability("parked", []), why, parkedOn: [{ arc: "arc-1", title: "Identity" }] };
  const tree: AnnotatedTree = { stories: [story("s", parked, { ...capability("free", []), why })], arcs: [] };
  const [a, b] = drillDown(tree, "s", workStates([]), [])?.capabilities ?? [];
  assert.equal(a?.status, "proposed");
  assert.deepEqual(a?.why, { reason: "not built", mover: "agent", contracts: [] });
  assert.deepEqual(a?.parkedOn, [{ arc: "arc-1", title: "Identity" }]);
  assert.equal("parkedOn" in (b ?? {}), false);
});

test("4.38 a capability carries the open increments naming it in the library's order; one with no open work carries none", () => {
  const open = [{ increment: "inc-2", title: "Started", active: true as const }, { increment: "inc-1", title: "Parked first" }];
  const tree: AnnotatedTree = { stories: [story("s", { ...capability("busy", []), openWork: open }, capability("idle", []))], arcs: [] };
  const [a, b] = drillDown(tree, "s", workStates([]), [])?.capabilities ?? [];
  assert.deepEqual(a?.openWork, open);
  assert.equal("openWork" in (b ?? {}), false);
});

test("4.40 a story's edges carry their own contracts as a capability's contract lines, by which capability depends on which, apart from either capability's", () => {
  const was = { state: "passing" as const, at: "2026-09-27T10:00:00.000Z" };
  const edge = { id: "edge-1", from: "login", to: "accounts", contracts: [{ ...contract("e-k", "passing", "failing"), title: "login asks accounts by id" }, { ...contract("e-l", "passing"), title: "login never writes accounts", health: { reported: column("passing", true), verified: { state: "not-checked" as const, was } } }] };
  const tree: AnnotatedTree = { stories: [{ ...story("s", capability("login", ["accounts"], [contract("k1", "passing")]), capability("accounts", [])), edges: [edge] }], arcs: [] };
  const panel = drillDown(tree, "s", workStates([]), reports("e-k", "failing", "passing"));
  assert.deepEqual(panel?.edges, [{ from: "login", fromTitle: "The login", to: "accounts", toTitle: "The accounts", contracts: [
    { id: "e-k", title: "login asks accounts by id", reported: "passing", trail: "red, then green", verified: "failing", ran: { at: new Date(0).toISOString() } },
    { id: "e-l", title: "login never writes accounts", reported: "passing", trail: "not reported yet", lastSeen: was },
  ] }], "the same readings, trail and last-seen a capability's contract carries; the agent's report is not storytree's verdict");
  assert.deepEqual(panel?.capabilities.find(({ id }) => id === "login")?.contracts.map(({ id }) => id), ["k1"], "its own contracts stay its own");
  assert.equal("edges" in (drillDown({ stories: [story("t", capability("alone", []))], arcs: [] }, "t", workStates([]), []) ?? {}), false, "a story with no edges carries none");
});

test("4.13 in a project nothing verifies, each capability is marked as shown by the agent's report", () => {
  const reportOnly = (built: AnnotatedCapability): AnnotatedCapability => ({ ...built, reportOnly: true });
  const tree: AnnotatedTree = {
    stories: [story("a", reportOnly(capability("login", ["accounts"], [contract("k1", "passing")], undefined, "untested"))), story("b", reportOnly(capability("accounts", [], [contract("k2", "failing")], undefined, "untested")))],
    arcs: [],
    unverified: true,
  };
  const panel = drillDown(tree, "a", workStates([]), []);
  assert.equal(panel?.capabilities[0]?.reportOnly, true);
  assert.equal(panel?.capabilities[0]?.reported, "passing");
  const checked = drillDown({ stories: [story("a", capability("login", [], [], undefined, "untested"))], arcs: [] }, "a", workStates([]), []);
  assert.equal("reportOnly" in (checked?.capabilities[0] ?? {}), false);
});

test("4.12 a contract whose last verdict was not re-run carries what it last saw and when", () => {
  const was = { state: "failing" as const, at: "2026-09-27T10:00:00.000Z" };
  const tree: AnnotatedTree = {
    stories: [story("s", capability("cap", [], [numbered("c1", "8.1 · Proof", { state: "not-checked", skip: "other", at: "2026-10-01T00:00:00.000Z", was }), numbered("c2", "8.2 · Seen", { state: "passing", at: "2026-10-01T00:00:00.000Z" })], null, "untested"))],
    arcs: [],
  };
  const [first, second] = drillDown(tree, "s", workStates([]), [])?.capabilities[0]?.contracts ?? [];
  assert.deepEqual(first?.lastSeen, was);
  assert.equal(second?.lastSeen, undefined);
});

test("4.15 a mapped story's panel says it is mapped, with its files and lines from the survey; a built story's says nothing of it", () => {
  const mapped: AnnotatedStory = { ...story("old"), mapped: { from: "/code/shop", package: "packages/cart", folders: ["packages/cart"] } };
  const tree: AnnotatedTree = { stories: [mapped, story("new", capability("a", []))], arcs: [] };
  const survey = { old: { files: [{ path: "packages/cart/src/a.ts", lines: 120 }, { path: "packages/cart/src/b.ts", lines: 80 }], imports: [], mapped: { folder: "/code/shop" } } };
  assert.deepEqual(drillDown(tree, "old", workStates([]), [], survey)?.mapped, { files: 2, lines: 200 });
  assert.deepEqual(drillDown(tree, "old", workStates([]), [])?.mapped, {}, "before its survey it is still mapped, with no counts invented");
  assert.equal("mapped" in (drillDown(tree, "new", workStates([]), [], survey) ?? {}), false);
});

test("4.36 a story's panel carries its own and its capabilities' extra checks and no risk rating, even when the story has a reading; a story with no extra checks carries none", () => {
  const read = "2026-10-24";
  const risk = { depth: { value: 3 as const, read, reason: "flags: screen" }, radius: { value: 2 as const, downstream: 1, audience: "invited" as const, read, reason: "serves invited users itself" } };
  const install = { ...capability("install", []), guardrails: [{ check: "a fresh-install sweep", trigger: "release" as const }] };
  const rated: AnnotatedStory = { ...story("desktop", install, capability("window", [])), risk, guardrails: [{ check: "a real-app run", trigger: "change" }] };
  const tree: AnnotatedTree = { stories: [rated, { ...story("site"), risk }, story("plain", capability("a", []))], arcs: [] };
  const desktop = drillDown(tree, "desktop", workStates([]), []);
  assert.deepEqual(desktop?.checks, [
    { check: "a real-app run", trigger: "change" },
    { check: "a fresh-install sweep", trigger: "release", capability: "The install" },
  ]);
  assert.equal("risk" in (desktop ?? {}), false, "the rating is switched off (question_0de2b8280384)");
  assert.equal("checks" in (drillDown(tree, "site", workStates([]), []) ?? {}), false, "a reading alone carries nothing");
  assert.equal("checks" in (drillDown(tree, "plain", workStates([]), []) ?? {}), false);
});

test("4.37 each contract storytree saw carries the source of its verdict, its capability the sources of its contracts', and its reason the sources of the contracts carrying it", () => {
  const at = "2026-10-30T10:00:00.000Z";
  const mixed = capability("mixed", [], [
    numbered("c1", "1.1 · Local", { state: "passing", at, source: "local" }),
    numbered("c2", "1.2 · On CI", { state: "failing", at, source: "ci" }),
    numbered("c3", "1.3 · Before sources", { state: "passing", at }),
  ], null, "unhealthy");
  const local = capability("local", [], [numbered("c4", "2.1 · Local", { state: "passing", at, source: "local" })], null, "healthy");
  const older = capability("older", [], [numbered("c5", "3.1 · Before sources", { state: "failing", at })], null, "unhealthy");
  const tree: AnnotatedTree = {
    stories: [story("s", { ...mixed, why: { reason: "failing", mover: "agent", contracts: ["c2"] } }, local, { ...older, why: { reason: "failing", mover: "agent", contracts: ["c5"] } })],
    arcs: [],
  };
  const [first, second, third] = drillDown(tree, "s", workStates([]), [])?.capabilities ?? [];
  assert.deepEqual(first?.contracts.map(({ id, source }) => [id, source]), [["c1", "local"], ["c2", "ci"], ["c3", undefined]], "an entry written before sources says none");
  assert.deepEqual(first?.sources, ["local", "ci"]);
  assert.deepEqual(first?.why?.sources, ["ci"], "the source of the contract carrying its reason");
  assert.deepEqual(second?.sources, ["local"]);
  assert.equal(third?.sources, undefined, "no contract with a source recorded: none");
  assert.equal(third?.why?.sources, undefined);
});

test("4.46 a story's edge carries its description to the panel, and one with none carries no description at all", () => {
  const said = { id: "edge-1", from: "login", to: "accounts", description: "Login passes accounts the resolved user, never the request's tenant.", contracts: [] };
  const bare = { id: "edge-2", from: "accounts", to: "audit", contracts: [] };
  const tree: AnnotatedTree = { stories: [{ ...story("s", capability("login", ["accounts"]), capability("accounts", ["audit"]), capability("audit", [])), edges: [said, bare] }], arcs: [] };
  const edges = drillDown(tree, "s", workStates([]), [])?.edges;
  assert.equal(edges?.[0]?.description, "Login passes accounts the resolved user, never the request's tenant.");
  assert.equal("description" in (edges?.[1] ?? {}), false, "no description, no field");
});

test("4.47 a contract a run judged carries when that run was and the tests it named; one judged before names were kept carries only when; one no run judged carries neither", () => {
  const at = "2026-11-12T09:00:00.000Z";
  const tests = ["8.1 · the fold names its tests"];
  const tree: AnnotatedTree = {
    stories: [story("s", capability("cap", [], [numbered("c1", "8.1 · Named", { state: "failing", at, tests }), numbered("c2", "8.2 · Unnamed", { state: "passing", at }), numbered("c3", "8.3 · Never", { state: "not-checked" }), numbered("c4", "8.4 · Skipped", { state: "not-checked", skip: "other", at })], null, "untested"))],
    arcs: [],
  };
  const [named, unnamed, never, skipped] = drillDown(tree, "s", workStates([]), [])?.capabilities[0]?.contracts ?? [];
  assert.deepEqual(named?.ran, { at, tests });
  assert.deepEqual(unnamed?.ran, { at });
  assert.equal(never?.ran, undefined);
  assert.equal(skipped?.ran, undefined, "a skip is no run of its tests");
});
