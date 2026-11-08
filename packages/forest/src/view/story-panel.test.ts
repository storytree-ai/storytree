/**
 * Capability 4 · Drill-down (the forest story), as the page draws it (ADR-0659): the story's
 * sentences and below them the one capability selected, picked on the island; no tree, card or
 * pop-out of its own, and no front cover anywhere. The panel is HTML text, so it is read here without a browser.
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

test("4.6 the panel is the story's lead and below it only the capability selected, its lead on the surface and its contracts behind a closed handle", () => {
  const html = renderStoryPanel(panel, "next");
  const detail = html.indexOf("panel-detail");
  assert.ok(html.indexOf("What s is. Why.") > 0 && detail > html.indexOf("What s is. Why."), "the selected capability shows below the story's lead");
  const below = html.slice(detail);
  assert.match(below, /The next/);
  assert.match(below, /What next does\./);
  assert.match(below, /<span class="panel-state status-proposed">proposed<\/span>/, "its word, not its work state");
  assert.doesNotMatch(below, /in progress/);
  assert.match(fold(below, "health")?.body ?? "", /the agent reports: failing/, "its health behind its Health handle");
  const contracts = fold(below, "contracts");
  assert.ok(contracts !== undefined, "its contracts sit behind a handle");
  assert.equal(contracts.handle, "Contracts · 1", "which says what is inside and how much");
  assert.equal(contracts.expanded, "false");
  assert.ok(contracts.hidden, "closed until asked for");
  assert.match(contracts.body, /next keeps its promise/);
  assert.doesNotMatch(html, /<details|<summary/, "no single-click fold");
  assert.doesNotMatch(html, /What base does\./, "no other capability's sentences");
  assert.doesNotMatch(html, /base keeps its promise/, "nor its contracts");
  assert.doesNotMatch(html, /panel-capabilities/, "no list of every capability");
  assert.doesNotMatch(html, /Front covers|panel-shelf|data-book-id/, "no front covers (ADR-0659 D4)");
});

test("4.6 a description shows its lead, its first paragraph, and the rest behind a bare \"How it works\", no count; one paragraph has no handle", () => {
  const story = "What s does for you.\n\nHow it works, in   five words.\n\nWhat it is not.";
  const capability = { ...line("next", "failing"), description: "Its lead.\n\nIts rest <here>." };
  const html = renderStoryPanel({ ...panel, description: story, capabilities: [capability] }, "next");
  assert.equal(plainText(/<p class="panel-sentences">([\s\S]*?)<\/p>/.exec(html)?.[1] ?? ""), "What s does for you.", "the story's lead alone on the surface");
  const more = fold(html, "more");
  assert.equal(more?.handle, "How it works", "a bare label, no word count (ADR-1291)");
  assert.ok(more?.hidden);
  assert.match(more!.body, /How it works, in\s+five words\.[\s\S]*What it is not\./);
  const detail = html.slice(html.indexOf("panel-detail"));
  assert.match(detail, /<p class="panel-lead">Its lead\.<\/p>/, "the capability's lead on its surface");
  assert.equal(fold(detail, "more")?.handle, "How it works");
  assert.match(fold(detail, "more")!.body, /Its rest &lt;here&gt;\./, "as text");
  assert.equal(renderStoryPanel(panel, "next").includes('data-fold="more"'), false, "a one-paragraph description has no How it works");
});

test("4.6 a capability's handles come in one order, More, Health, Open work, Contracts, each contract opens to its own detail, and Open all · n counts every handle", () => {
  const capability: CapabilityLine = { ...line("next", "failing"), description: "Lead.\n\nRest.", openWork: [{ increment: "i", title: "Do it" }] };
  const html = renderStoryPanel({ ...panel, capabilities: [capability] }, "next");
  const kinds = [...html.matchAll(/data-fold="([^"]+)"/g)].map(([, kind]) => kind);
  assert.deepEqual(kinds, ["more", "health", "open-work", "contracts", "contract"]);
  assert.equal(fold(html, "open-work")?.handle, "Open work · 1");
  const contract = fold(html, "contract");
  assert.equal(contract?.handle, "next keeps its promise", "a contract's handle is its title");
  assert.match(contract!.body, /the agent reports: failing[\s\S]*green only/, "it opens to its health and trail");
  const foot = /<footer class="panel-foot">([\s\S]*?)<\/footer>/.exec(html)?.[1] ?? "";
  assert.match(foot, /<button type="button" class="panel-handle panel-open-all" data-open-all>Open all · 5<\/button>/, "both levels counted");
  assert.equal(renderStoryPanel({ ...panel, capabilities: [] }, undefined).includes("panel-open-all"), false, "no handles, no Open all");
});

/** The selected capability's surface: its section's words with every fold's body dropped. */
function surface(html: string): string {
  const detail = /<section class="panel-detail[\s\S]*<\/section>/.exec(html)?.[0] ?? "";
  return plainText(detail.split(/<div class="panel-fold-body" hidden>[\s\S]*?<\/div><\/div>/).join(""));
}

test("4.6 a capability's word says where it came from, and its two health readings wait behind Health, each with its source", () => {
  const base = line("base", "passing", "healthy");
  const healthy: CapabilityLine = { ...base, verified: "passing", sources: ["ci"] };
  const html = renderStoryPanel({ ...panel, capabilities: [healthy] }, "base");
  assert.equal(surface(html), "The base healthy, from CI What base does. Health · 2 Contracts · 1", "title, word with source and lead; then its handles");
  const health = fold(html, "health");
  assert.equal(health?.handle, "Health · 2");
  assert.ok(health?.hidden, "closed until asked for");
  assert.match(plainText(health!.body), /^the agent reports: passing storytree saw: passing, from CI/, "both readings, each with its source");
  const local = renderStoryPanel({ ...panel, capabilities: [{ ...line("cap", "failing", "unhealthy"), verified: "failing", sources: ["local"] }] }, "cap");
  assert.match(local, /<span class="panel-state status-unhealthy">unhealthy, verified locally<\/span>/);
  const unseen = renderStoryPanel(panel, "base");
  assert.match(unseen, /<span class="panel-state status-healthy">healthy<\/span>/, "no source recorded, the word alone");
  assert.equal(fold(unseen, "health")?.handle, "Health · 1", "only the readings there are");
});

test("4.12 the why line shows only for an unhealthy or untested capability or one the owner moves; a proposed one shows its word alone", () => {
  const proposed = (why: NonNullable<CapabilityLine["why"]>): string => renderStoryPanel({ ...panel, capabilities: [{ ...line("cap", "not-checked", "proposed"), why }] }, "cap");
  assert.equal(surface(proposed({ reason: "not built", mover: "agent", contracts: [] })), "The cap proposed What cap does. Health · 1 Contracts · 1", "not built yet is no news");
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

test("4.8 the panel offers no pick of its own: no tree, no card to click and no pop-out, only the capability the island picked", () => {
  const html = renderStoryPanel(panel, "next");
  assert.doesNotMatch(html, /<svg|panel-tree|data-open-tree|role="button"|tabindex/, "nothing in it picks a capability");
  assert.deepEqual([...html.matchAll(/data-capability-id="([^"]+)"/g)].map(([, id]) => id), ["next"], "only the one picked shows");
  assert.match(renderStoryPanel(panel, "base"), /data-capability-id="base"/, "another pick shows that one instead");
});

test("4.8 a story with no capabilities shows its sentences and nothing below", () => {
  const html = renderStoryPanel({ ...panel, capabilities: [] }, undefined);
  assert.match(html, /What s is\. Why\./);
  assert.doesNotMatch(html, /panel-detail/);
});

test("4.6 with the capability details switched off, the panel is the story's sentences alone (ADR-0750)", () => {
  const html = renderStoryPanel(panel, "next", { details: false });
  assert.match(html, /What s is\. Why\./);
  assert.doesNotMatch(html, /data-capability-id/, "no capability shown");
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

test("4.14 a parked capability's detail keeps its word and reason and says it is parked, naming its arcs", () => {
  const base = notGreen({ reason: "not built", mover: "agent", contracts: [] });
  const parked = (titles: string[]): string => renderStoryPanel({ ...base, capabilities: [{ ...base.capabilities[0]!, parkedOn: titles.map((title, at) => ({ arc: `arc-${at}`, title })) }] }, "cap");
  const one = parked(["Identity <beta>"]);
  const said = /<p class="panel-parked"[^>]*>([\s\S]*?)<\/p>/.exec(one)?.[1];
  assert.ok(said !== undefined, "a line saying it is parked");
  assert.equal(plainText(said), "Parked on Identity &lt;beta&gt;: shelved on purpose.");
  assert.match(one, /panel-state status-untested">untested</, "its word is kept");
  assert.equal(whyLine(one), "Why not green: it is not built yet. The agent moves this one.", "and its reason");
  assert.ok(one.indexOf("panel-parked") > one.indexOf("panel-why") && one.indexOf("panel-parked") < one.indexOf('data-fold="contracts"'));
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
  assert.ok(html.indexOf('data-fold="open-work"') < html.indexOf('data-fold="contracts"'), "above its contracts");
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
  assert.deepEqual([...gate.matchAll(/<li data-contract-id="([^"]+)"[^>]*>([\s\S]*?)<\/li>/g)].map(([, id, said]) => [id, fold(said!, "contract")?.handle]), [["e-1", "next reads &lt;base&gt; by id"], ["e-2", "next never writes base"]]);
  assert.equal(plainText(gate).includes("failing"), false, "none failing, none said");
  const shared = { id: "k-1", title: "next reads base by id", reported: "failing" as const, trail: "green, then red", verified: "failing" as const, source: "ci" as const, lastSeen: { state: "passing" as const, at: "2026-09-27T10:00:00.000Z" } };
  const item = (html: string): string => /<li data-contract-id="k-1">[\s\S]*?<\/li>/.exec(html)?.[0] ?? "";
  const asGate = item(section(renderStoryPanel({ ...edged, edges: [{ ...edged.edges![0]!, contracts: [shared] }] }, "next", { gate: ["base", "next"] })));
  const asCapability = item(renderStoryPanel({ ...panel, capabilities: [{ ...panel.capabilities[1]!, contracts: [shared] }] }, "next"));
  assert.equal(fold(asGate, "contract")?.handle, "next reads base by id", "each contract opens one level deeper, behind its title");
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

test("4.12 a capability that is not healthy says why under its word, who moves it, and its contracts by number", () => {
  const agent = renderStoryPanel(notGreen({ reason: "no test names it", mover: "agent", contracts: ["1.2", "1.3"] }), "cap");
  assert.equal(whyLine(agent), "Why not green: no test names 1.2 and 1.3. The agent moves this one.");
  assert.ok(agent.indexOf("panel-why") > agent.indexOf("panel-state") && agent.indexOf("panel-why") < agent.indexOf('data-fold="contracts"'), "under its word, above its contracts");
  const owner = renderStoryPanel(notGreen({ reason: "needs owner", mover: "owner", contracts: ["8.1"], since: "2026-09-27T10:00:00.000Z" }), "cap");
  assert.equal(whyLine(owner), "Why not green: 8.1 needs something only you can give, since 27 Sep. You move this one.");
  assert.match(owner, /class="panel-why mover-owner"/);
  assert.equal(whyLine(renderStoryPanel(notGreen({ reason: "not built", mover: "agent", contracts: [] }), "cap")), "Why not green: it is not built yet. The agent moves this one.");
  assert.equal(whyLine(renderStoryPanel(notGreen({ reason: "failing", mover: "agent", contracts: ["2.1"] }), "cap")), "Why not green: 2.1 is failing. The agent moves this one.");
  assert.equal(whyLine(renderStoryPanel(notGreen({ reason: "not re-run", mover: "agent", contracts: ["2.1"] }), "cap")), "Why not green: 2.1 was not re-run. The agent moves this one.");
  assert.equal(whyLine(renderStoryPanel(notGreen({ reason: "not re-run", mover: "agent", contracts: ["2.1"], since: "2026-10-01T06:00:00.000Z" }), "cap")), "Why not green: 2.1 was not re-run. The agent moves this one.", "its date is on the contract row: the day it was last seen, not the day the skip was written");
  assert.equal(whyLine(renderStoryPanel(notGreen({ reason: "out of CI's reach", mover: "agent", contracts: ["3.4"] }), "cap")), "Why not green: 3.4 can only run on another platform. The agent moves this one.");
});

test("4.13 in a project nothing verifies, a built capability's detail leads with the agent's report and says storytree does not check this project's tests yet", () => {
  const cap: CapabilityLine = { ...line("cap", "passing", "untested"), reportOnly: true };
  const html = renderStoryPanel({ ...panel, capabilities: [cap] }, "cap");
  const shown = (part: string): string => part.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  const detail = /<section class="panel-detail[\s\S]*?<\/section>/.exec(html)?.[0] ?? "";
  assert.match(shown(detail), /^The cap the agent reports passing storytree does not check this project's tests yet\./);
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

test("4.37 storytree's mark names its source in the detail and on each contract: verified locally, from CI, or both; the reason says the source of what carries it; no source recorded, it says none", () => {
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
  assert.match(detail("base"), /storytree saw: passing, verified locally/);
  assert.match(detail("both"), /storytree saw: failing, verified locally and from CI/);
  assert.match(detail("both"), /2\.1 · On CI .*storytree saw: failing, from CI/);
  assert.match(detail("both"), /2\.2 · Local .*storytree saw: passing, verified locally/);
  assert.equal(whyLine(html("both")), "Why not green: 2.1 is failing, from CI. The agent moves this one.");
  assert.equal(whyLine(html("older")), "Why not green: 3.1 is failing. The agent moves this one.");
  assert.doesNotMatch(detail("older"), /locally|from CI/);
});

