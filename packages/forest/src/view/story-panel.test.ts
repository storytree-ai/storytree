/**
 * Capability 4 · Drill-down (the forest story), as the page draws it (ADR-1297): exactly what is selected, a story alone with
 * its capabilities by name or a capability with its contracts; no tree, card or pop-out of its own, and no front cover
 * anywhere. The panel is HTML text, so it is read here without a browser.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import type { CapabilityLine, StoryPanel } from "@storytree/forest";

import { renderStoryPanel } from "./story-panel.js";

function line(id: string, reported: CapabilityLine["reported"], status: CapabilityLine["status"] = "proposed"): CapabilityLine {
  return {
    id,
    title: `The ${id}`,
    description: `What ${id} does.`,
    reported,
    status,
    contracts: [{ id: `${id}-k`, title: `${id} keeps its promise`, reported, trail: "green only" }],
  };
}

const panel: StoryPanel = {
  story: "s",
  title: "Story s",
  description: "What s is. Why.",
  capabilities: [line("base", "passing", "healthy"), line("next", "failing")],
};

/** The fold of `kind` in a rendered panel: its handle's words, whether it is open, and what it holds. */
function fold(html: string, kind: string): { handle: string; expanded: string; hidden: boolean; body: string } | undefined {
  const found = new RegExp(`<div class="panel-fold" data-fold="${kind}">\\s*<button type="button" class="panel-handle" aria-expanded="(true|false)">([\\s\\S]*?)</button>\\s*<div class="panel-fold-body"( hidden)?>`).exec(html);
  if (found === null) return undefined;
  return { expanded: found[1]!, handle: plainText(found[2]!), hidden: found[3] !== undefined, body: html.slice(found.index + found[0].length) };
}

/** The panel's head: the title it leads with, and the story named small above a capability's. */
function head(html: string): { title: string; story: string | undefined } {
  const header = /<header class="panel-head"[\s\S]*?<\/header>/.exec(html)?.[0] ?? "";
  const story = /<p class="panel-story-name">([\s\S]*?)<\/p>/.exec(header)?.[1];
  return { title: plainText(/<h2>([\s\S]*?)<\/h2>/.exec(header)?.[1] ?? ""), story: story === undefined ? undefined : plainText(story) };
}

/** The capability names a story's panel lists, each with the capability it opens. */
function names(html: string): string[][] {
  return [...html.matchAll(/<button type="button" class="panel-pick" data-pick-capability="([^"]+)">([\s\S]*?)<\/button>/g)].map(([, id, title]) => [id!, plainText(title!)]);
}

test("4.6 a story picked alone shows its title, its whole description and its capabilities by name, each opening that capability, with none picked for it", () => {
  const html = renderStoryPanel({ ...panel, description: "What s does for you.\n\nHow it works, <here>.\n\nWhat it is not." }, undefined);
  assert.deepEqual(head(html), { title: "Story s", story: undefined });
  assert.equal(plainText(/<div class="panel-sentences">([\s\S]*?)<\/div>/.exec(html)?.[1] ?? ""), "What s does for you.How it works, &lt;here&gt;.What it is not.", "every paragraph, as text");
  assert.equal(html.includes("panel-fold"), false, "no fold: no How it works");
  assert.deepEqual(names(html), [["base", "The base"], ["next", "The next"]], "its capabilities by name, in build order");
  assert.equal(html.includes("panel-detail"), false, "no capability is picked for the user");
  assert.doesNotMatch(html, /What base does|keeps its promise|panel-badge/, "nor any capability's description, contracts or health");
  assert.doesNotMatch(html, /Front covers|panel-shelf|data-book-id/, "no front covers (ADR-0659 D4)");
  assert.equal(names(renderStoryPanel({ ...panel, capabilities: [] }, undefined)).length, 0, "a story with no capabilities lists none");
});

test("4.6 a capability picked heads the panel, its story named small above it, then its whole description and its contracts, each with its own state on show", () => {
  const capability: CapabilityLine = { ...line("next", "failing"), description: "Its lead.\n\nIts rest <here>.", verified: "failing", sources: ["ci"],
    contracts: [{ id: "k1", title: "next keeps its promise", reported: "passing", trail: "red, then green", verified: "failing", source: "ci" }, { id: "k2", title: "next says so", reported: "passing", trail: "green only" }] };
  const html = renderStoryPanel({ ...panel, capabilities: [line("base", "passing", "healthy"), capability] }, "next");
  assert.deepEqual(head(html), { title: "The next", story: "Story s" });
  assert.equal(html.includes("What s is. Why."), false, "the story's description is not repeated");
  assert.equal(names(html).length, 0, "nor its list of capabilities");
  assert.equal(plainText(/<div class="panel-lead">([\s\S]*?)<\/div>/.exec(html)?.[1] ?? ""), "Its lead.Its rest &lt;here&gt;.", "its whole description, with no fold");
  const items = [...html.matchAll(/<li data-contract-id="([^"]+)">[\s\S]*?<\/li>/g)].map(([item]) => fold(item, "contract")?.handle);
  assert.deepEqual(items, ["next keeps its promise storytree saw: failing, from CI", "next says so the agent reports: passing"], "each contract by title with its own state");
  const opened = fold(/<li data-contract-id="k1">[\s\S]*?<\/li>/.exec(html)![0], "contract");
  assert.ok(opened?.hidden);
  assert.match(plainText(opened!.body), /the agent reports: passing red, then green/, "a contract opens to the agent's report and its trail");
  const kinds = [...html.matchAll(/data-fold="([^"]+)"/g)].map(([, kind]) => kind);
  assert.deepEqual(kinds, ["contract", "contract"], "no How it works, no Health and no Contracts fold");
  assert.doesNotMatch(html, /panel-state|What base does|base keeps its promise/, "no word of its own, and nothing of another capability");
  assert.match(renderStoryPanel({ ...panel, capabilities: [{ ...capability, contracts: [] }] }, "next"), /No contracts yet\./);
});

test("4.6 a capability's open work waits behind its counted handle above its contracts", () => {
  const capability: CapabilityLine = { ...line("next", "failing"), openWork: [{ increment: "i", title: "Do it" }] };
  const html = renderStoryPanel({ ...panel, capabilities: [capability] }, "next");
  assert.deepEqual([...html.matchAll(/data-fold="([^"]+)"/g)].map(([, kind]) => kind), ["open-work", "contract"]);
  assert.equal(fold(html, "open-work")?.handle, "Open work · 1");
});

test("4.7 no capability is picked for the user: a story alone, or a pick no longer in the story, shows the story", () => {
  for (const selected of [undefined, "gone"]) {
    const html = renderStoryPanel(panel, selected);
    assert.equal(head(html).title, "Story s");
    assert.equal(html.includes("data-capability-id"), false, `${String(selected)}: no capability shown`);
  }
  assert.equal(head(renderStoryPanel(panel, "base")).title, "The base", "a capability of the story shows when picked");
});

/** The selected capability's surface: its section's words with every fold's body dropped. */
function surface(html: string): string {
  const detail = /<section class="panel-detail[\s\S]*<\/section>/.exec(html)?.[0] ?? "";
  return plainText(detail.split(/<div class="panel-fold-body" hidden>[\s\S]*?<\/div><\/div>/).join(""));
}

test("4.12 the why line shows only for an unhealthy or untested capability or one the owner moves; a proposed one says nothing of it", () => {
  const proposed = (why: NonNullable<CapabilityLine["why"]>): string => renderStoryPanel({ ...panel, capabilities: [{ ...line("cap", "not-checked", "proposed"), why }] }, "cap");
  assert.equal(surface(proposed({ reason: "not built", mover: "agent", contracts: [] })), "What cap does. Contracts cap keeps its promise the agent reports: not checked", "not built yet is no news");
  assert.equal(whyLine(proposed({ reason: "needs owner", mover: "owner", contracts: ["8.1"] })), "Why not green: 8.1 needs something only you can give. You move this one.", "the owner's always shows");
  assert.equal(whyLine(renderStoryPanel(notGreen({ reason: "not built", mover: "agent", contracts: [] }), "cap")), "Why not green: it is not built yet. The agent moves this one.", "an untested one keeps it");
});

test("4.6 a story's surface says how many of its capabilities need the owner, only when he moves one", () => {
  const owner = (id: string): CapabilityLine => ({ ...line(id, "not-checked", "untested"), why: { reason: "needs owner", mover: "owner", contracts: ["8.1"] } });
  const agent: CapabilityLine = { ...line("a", "failing", "unhealthy"), why: { reason: "failing", mover: "agent", contracts: ["1.1"] } };
  const needs = (capabilities: CapabilityLine[]): string | undefined => /<p class="panel-needs-you">([\s\S]*?)<\/p>/.exec(renderStoryPanel({ ...panel, capabilities }, undefined))?.[1];
  assert.equal(needs([owner("x"), agent]), "1 capability needs you");
  assert.equal(needs([owner("x"), owner("y")]), "2 capabilities need you");
  assert.equal(needs([agent, line("h", "passing", "healthy")]), undefined, "none the owner moves, no line");
  const html = renderStoryPanel({ ...panel, capabilities: [owner("x")] }, undefined);
  assert.ok(html.indexOf("panel-needs-you") > html.indexOf("What s is. Why."), "under the story's lead");
});

test("4.8 the panel draws no tree, card or pop-out: its one pick is a story's capability names, each a button naming the capability it opens", () => {
  const html = renderStoryPanel(panel, undefined);
  assert.doesNotMatch(html, /<svg|panel-tree|data-open-tree|role="button"|tabindex/, "no tree and no card to click");
  assert.deepEqual(names(html).map(([id]) => id), ["base", "next"]);
  assert.equal(names(renderStoryPanel(panel, "next")).length, 0, "a capability's own panel names no other");
});

test("4.6 with the capability details switched off, the panel is the story's sentences alone, with no capability names and no capability shown (ADR-0750)", () => {
  const html = renderStoryPanel(panel, "next", { details: false });
  assert.match(html, /What s is\. Why\./);
  assert.doesNotMatch(html, /data-capability-id|data-pick-capability/, "no capability shown or named");
});

function notGreen(why: CapabilityLine["why"], lastSeen?: { state: "passing" | "failing"; at: string }): StoryPanel {
  const base = line("cap", "not-checked", "untested");
  const contract = { ...base.contracts[0]!, ...(lastSeen === undefined ? {} : { lastSeen }) };
  return { ...panel, capabilities: [{ ...base, contracts: [contract], ...(why === undefined ? {} : { why }) }] };
}

/** A rendered fragment's words, its tags dropped and its spaces squeezed (split, not replace: the text stays escaped as rendered). */
function plainText(fragment: string): string {
  return fragment.split(/<[^>]*>/).join("").replace(/\s+/g, " ").trim();
}

/** The sentence under the selected capability's word. */
function whyLine(html: string): string {
  const found = /<p class="panel-why[^"]*"[^>]*>([\s\S]*?)<\/p>/.exec(html);
  assert.ok(found !== null, "a line saying why");
  return plainText(found[1]!);
}

test("4.14 a parked capability's detail keeps its reason and says it is parked, naming its arcs", () => {
  const base = notGreen({ reason: "not built", mover: "agent", contracts: [] });
  const parked = (titles: string[]): string => renderStoryPanel({ ...base, capabilities: [{ ...base.capabilities[0]!, parkedOn: titles.map((title, at) => ({ arc: `arc-${at}`, title })) }] }, "cap");
  const one = parked(["Identity <beta>"]);
  const said = /<p class="panel-parked"[^>]*>([\s\S]*?)<\/p>/.exec(one)?.[1];
  assert.ok(said !== undefined, "a line saying it is parked");
  assert.equal(plainText(said), "Parked on Identity &lt;beta&gt;: shelved on purpose.");
  assert.equal(whyLine(one), "Why not green: it is not built yet. The agent moves this one.", "and its reason");
  assert.ok(one.indexOf("panel-parked") > one.indexOf("panel-why") && one.indexOf("panel-parked") < one.indexOf("panel-contracts"));
  assert.match(parked(["Identity", "Journey events"]), /Parked on Identity and Journey events:/);
  assert.equal(renderStoryPanel(base, "cap").includes("panel-parked"), false, "one not parked says nothing of it");
});

test("4.38 a capability's detail lists its open work in the order given, each by title, the active one marked", () => {
  const base = notGreen(undefined);
  const html = renderStoryPanel({ ...base, capabilities: [{ ...base.capabilities[0]!, openWork: [
    { increment: "inc-2", title: "Started <first>", active: true },
    { increment: "inc-1", title: "Parked first" },
    { increment: "inc-3", title: "Parked second" },
  ] }] }, "cap");
  const items = [...html.matchAll(/<li data-increment-id="([^"]+)"[^>]*>([\s\S]*?)<\/li>/g)].map(([, id, said]) => [id, plainText(said!)]);
  assert.deepEqual(items, [["inc-2", "Started &lt;first&gt; (in progress)"], ["inc-1", "Parked first"], ["inc-3", "Parked second"]]);
  assert.equal(fold(html, "open-work")?.handle, "Open work · 3", "behind a handle counting them");
  assert.ok(html.indexOf('data-fold="open-work"') < html.indexOf("panel-contracts"), "above its contracts");
  assert.equal(renderStoryPanel(base, "cap").includes('data-fold="open-work"'), false, "one with no open work lists none");
});

test("4.40 a picked gate's panel gives each edge joining its pair, either way, its sentence and one state line, its contracts behind a counted handle, each opening as a capability's does, and how many are failing", () => {
  const edged: StoryPanel = { ...panel, edges: [
    { from: "next", fromTitle: "The next", to: "base", toTitle: "The base", contracts: [{ id: "e-1", title: "next reads <base> by id", reported: "passing", trail: "green only", verified: "passing" }, { id: "e-2", title: "next never writes base", reported: "passing", trail: "green only" }] },
    { from: "next", fromTitle: "The next", to: "other", toTitle: "The other", contracts: [{ id: "e-3", title: "not this gate's", reported: "passing", trail: "green only" }] },
  ] };
  const section = (html: string): string => /<section class="panel-gate"[\s\S]*?<\/section>/.exec(html)?.[0] ?? "";
  const html = renderStoryPanel(edged, "next", { gate: ["base", "next"] });
  const gate = section(html);
  assert.match(plainText(gate), /^The next depends on The base\./);
  const contracts = fold(gate, "contracts");
  assert.equal(contracts?.handle, "Contracts · 2", "its state: the contracts counted on a handle");
  assert.equal(contracts?.hidden, true, "drawn closed, one click away");
  assert.deepEqual([...gate.matchAll(/<li data-contract-id="([^"]+)"[^>]*>([\s\S]*?)<\/li>/g)].map(([, id, said]) => [id, fold(said!, "contract")?.handle]), [["e-1", "next reads &lt;base&gt; by id storytree saw: passing"], ["e-2", "next never writes base the agent reports: passing"]]);
  assert.equal(plainText(gate).includes("failing"), false, "none failing, none said");
  const shared = { id: "k-1", title: "next reads base by id", reported: "failing" as const, trail: "green, then red", verified: "failing" as const, source: "ci" as const, lastSeen: { state: "passing" as const, at: "2026-09-27T10:00:00.000Z" } };
  const item = (html: string): string => /<li data-contract-id="k-1">[\s\S]*?<\/li>/.exec(html)?.[0] ?? "";
  const asGate = item(section(renderStoryPanel({ ...edged, edges: [{ ...edged.edges![0]!, contracts: [shared] }] }, "next", { gate: ["base", "next"] })));
  const asCapability = item(renderStoryPanel({ ...panel, capabilities: [{ ...panel.capabilities[1]!, contracts: [shared] }] }, "next"));
  assert.equal(fold(asGate, "contract")?.handle, "next reads base by id storytree saw: failing, from CI", "each contract opens one level deeper, behind its title and state");
  assert.equal(asGate, asCapability, "to exactly what a capability's contract shows, no more");
  const failing = section(renderStoryPanel({ ...edged, edges: edged.edges!.map((edge) => ({ ...edge, contracts: edge.contracts.map((contract) => ({ ...contract, verified: "failing" as const })) })) }, "next", { gate: ["base", "next"], open: ["e-2"] }));
  const says = failing.indexOf('class="panel-link-failing"');
  assert.ok(failing.indexOf('data-fold="contracts"') < says && says < failing.indexOf("open work on this link"), "how many are failing is said in its state line, after the handle");
  assert.match(plainText(failing), /2 failing/);
  assert.equal(plainText(gate).includes("open work on this link"), false, "no open work named, none said");
  assert.equal(html.includes("panel-detail"), false, "neither capability's own contracts are listed");
  assert.equal(renderStoryPanel(edged, "next", { gate: ["next", "base"] }).includes('data-contract-id="e-1"'), true, "the pair either way round");
  const ringed = section(renderStoryPanel(edged, "next", { gate: ["base", "next"], open: ["e-2", "e-3"] }));
  const state = ringed.indexOf('class="panel-link-state"');
  assert.ok(state > 0 && state < ringed.indexOf('data-fold="contracts"') && ringed.indexOf('data-fold="contracts"') < ringed.indexOf("open work on this link"), "open work on its contracts, the gate's ring, is said in its state line");
  const bare = renderStoryPanel({ ...panel, edges: [{ from: "next", fromTitle: "The next", to: "base", toTitle: "The base", contracts: [] }] }, "next", { gate: ["base", "next"] });
  assert.match(plainText(section(bare)), /The next depends on The base\. No contracts on this link yet\./);
  assert.equal(section(bare).includes("panel-handle"), false, "with none, no handle");
  assert.match(renderStoryPanel(edged, "next", { gate: ["base", "other"] }), /No link joins these two capabilities directly\./, "a gate a road only passes through joins no edge");
  assert.equal(renderStoryPanel(edged, "next").includes("panel-gate"), false, "no gate picked, no gate section");
});

test("4.12 a capability that is not healthy says why above its description, who moves it, and its contracts by number", () => {
  const agent = renderStoryPanel(notGreen({ reason: "no test names it", mover: "agent", contracts: ["1.2", "1.3"] }), "cap");
  assert.equal(whyLine(agent), "Why not green: no test names 1.2 and 1.3. The agent moves this one.");
  assert.ok(agent.indexOf("panel-why") > agent.indexOf("panel-detail") && agent.indexOf("panel-why") < agent.indexOf("panel-lead"), "at the top of its detail, above its description");
  const owner = renderStoryPanel(notGreen({ reason: "needs owner", mover: "owner", contracts: ["8.1"], since: "2026-09-27T10:00:00.000Z" }), "cap");
  assert.equal(whyLine(owner), "Why not green: 8.1 needs something only you can give, since 27 Sep. You move this one.");
  assert.match(owner, /class="panel-why mover-owner"/);
  assert.equal(whyLine(renderStoryPanel(notGreen({ reason: "not built", mover: "agent", contracts: [] }), "cap")), "Why not green: it is not built yet. The agent moves this one.");
  assert.equal(whyLine(renderStoryPanel(notGreen({ reason: "failing", mover: "agent", contracts: ["2.1"] }), "cap")), "Why not green: 2.1 is failing. The agent moves this one.");
  assert.equal(whyLine(renderStoryPanel(notGreen({ reason: "not re-run", mover: "agent", contracts: ["2.1"] }), "cap")), "Why not green: 2.1 was not re-run. The agent moves this one.");
  assert.equal(whyLine(renderStoryPanel(notGreen({ reason: "not re-run", mover: "agent", contracts: ["2.1"], since: "2026-10-01T06:00:00.000Z" }), "cap")), "Why not green: 2.1 was not re-run. The agent moves this one.", "its date is on the contract row: the day it was last seen, not the day the skip was written");
  assert.equal(whyLine(renderStoryPanel(notGreen({ reason: "out of CI's reach", mover: "agent", contracts: ["3.4"] }), "cap")), "Why not green: 3.4 can only run on another platform. The agent moves this one.");
});

test("4.13 in a project nothing verifies, a built capability's detail says storytree does not check this project's tests yet, and its contracts show the agent's report, labelled as the agent's", () => {
  const cap: CapabilityLine = { ...line("cap", "passing", "untested"), reportOnly: true };
  const html = renderStoryPanel({ ...panel, capabilities: [cap] }, "cap");
  const shown = (part: string): string => part.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  const detail = /<section class="panel-detail[\s\S]*?<\/section>/.exec(html)?.[0] ?? "";
  assert.match(shown(detail), /^storytree does not check this project's tests yet\./);
  assert.match(shown(detail), /cap keeps its promise the agent reports: passing/);
  assert.doesNotMatch(shown(html), /untested|no test names|moves this one|Why not green/);
});

test("4.12 a healthy capability says nothing more, and a contract not re-run says what it last saw", () => {
  assert.doesNotMatch(renderStoryPanel(notGreen(undefined), "cap"), /panel-why|Why not green/);
  const html = renderStoryPanel(notGreen({ reason: "not re-run", mover: "agent", contracts: ["2.1"] }, { state: "failing", at: "2026-09-27T10:00:00.000Z" }), "cap");
  assert.match(html, /<li data-contract-id="cap-k">[\s\S]*last seen failing 27 Sep, not re-run since/);
  assert.match(renderStoryPanel(notGreen(undefined, { state: "passing", at: "2026-10-01T23:59:00.000Z" }), "cap"), /last seen passing 1 Oct, not re-run since/);
  assert.doesNotMatch(renderStoryPanel(notGreen(undefined), "cap"), /not re-run since/);
});

test("4.15 a mapped story's panel says it was here before storytree and is assumed to be working, with its files and lines, and shows no health", () => {
  const mapped: StoryPanel = { story: "m", title: "Cart", description: "no description yet", capabilities: [], mapped: { files: 2, lines: 1200 } };
  const html = renderStoryPanel(mapped, undefined);
  assert.match(html, /class="panel-mapped"/);
  assert.match(html, /here before storytree/i);
  assert.match(html, /assumed to be working/);
  assert.match(html, /2 files, 1,200 lines/);
  assert.doesNotMatch(html, /panel-badge|panel-health|passing|failing|not checked/, "no health is shown");
  const uncounted = renderStoryPanel({ ...mapped, mapped: {} }, undefined);
  assert.match(uncounted, /assumed to be working/);
  assert.doesNotMatch(uncounted, /files|lines/, "no counts before the survey reads it");
  assert.doesNotMatch(renderStoryPanel(panel, "base"), /panel-mapped/, "a built story's panel says nothing of it");
});

test("4.36 a story's panel lists its extra checks with what sets each off, and shows no risk rating and no graph; a story without extra checks shows none", () => {
  const checks: NonNullable<StoryPanel["checks"]> = [
    { check: "a real-app run", trigger: "change" },
    { check: "a fresh-install sweep", trigger: "release", capability: "Install & update" },
  ];
  const html = renderStoryPanel({ ...panel, checks }, undefined);
  const listed = fold(html, "extra-checks");
  assert.equal(listed?.handle, "Extra checks · 2", "behind a handle counting them");
  assert.match(listed!.body, /a real-app run[\s\S]*on every change/);
  assert.match(listed!.body, /a fresh-install sweep[\s\S]*Install &amp; update[\s\S]*before each formal release/, "a capability's check is named with it, as text");
  assert.doesNotMatch(listed!.body, /<svg|<canvas/, "no graph");
  assert.doesNotMatch(html, /Risk rating|of 10|Users potentially impacted/, "the rating is switched off (question_0de2b8280384)");
  assert.doesNotMatch(renderStoryPanel(panel, undefined), /extra-checks/);
});

test("4.37 storytree's mark names its source on each contract: verified locally, from CI, or both; the reason says the source of what carries it; no source recorded, it says none", () => {
  const shown = (part: string): string => part.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  const base = line("base", "passing", "unhealthy");
  const local: CapabilityLine = { ...base, verified: "passing", sources: ["local"], contracts: [{ ...base.contracts[0]!, verified: "passing", source: "local" }] };
  const both: CapabilityLine = {
    ...line("both", "passing", "unhealthy"),
    verified: "failing",
    sources: ["local", "ci"],
    why: { reason: "failing", mover: "agent", contracts: ["2.1"], sources: ["ci"] },
    contracts: [{ id: "k1", title: "2.1 · On CI", reported: "passing", trail: "green only", verified: "failing", source: "ci" }, { id: "k2", title: "2.2 · Local", reported: "passing", trail: "green only", verified: "passing", source: "local" }],
  };
  const older: CapabilityLine = { ...line("older", "passing", "unhealthy"), verified: "failing", why: { reason: "failing", mover: "agent", contracts: ["3.1"] } };
  const html = (selected: string) => renderStoryPanel({ ...panel, capabilities: [local, both, older] }, selected);

  const detail = (selected: string) => shown(/<section class="panel-detail[\s\S]*?<\/section>/.exec(html(selected))?.[0] ?? "");
  assert.match(detail("base"), /base keeps its promise storytree saw: passing, verified locally/);
  assert.match(detail("both"), /2\.1 · On CI .*storytree saw: failing, from CI/);
  assert.match(detail("both"), /2\.2 · Local .*storytree saw: passing, verified locally/);
  assert.equal(whyLine(html("both")), "Why not green: 2.1 is failing, from CI. The agent moves this one.");
  assert.equal(whyLine(html("older")), "Why not green: 3.1 is failing. The agent moves this one.");
  assert.doesNotMatch(detail("older"), /locally|from CI/);
});

