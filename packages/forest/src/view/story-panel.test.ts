/**
 * Capability 4 · Drill-down (the forest story), as the page draws it (ADR-0659): the story's
 * sentences and its capability diagram, and below the diagram the one capability selected. Another
 * story's capability is in the diagram but cannot be clicked, and no front cover shows anywhere.
 * The panel is HTML text, so it is read here without a browser.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import type { CapabilityLine, StoryPanel } from "@storytree/forest";

import { renderStoryPanel } from "./story-panel.js";

function line(id: string, state: CapabilityLine["state"], reported: CapabilityLine["reported"], status: CapabilityLine["status"] = "proposed"): CapabilityLine {
  return {
    id,
    title: `The ${id}`,
    description: `What ${id} does.`,
    reported,
    state,
    status,
    contracts: [{ id: `${id}-k`, title: `${id} keeps its promise`, reported, trail: "green only" }],
  };
}

const panel: StoryPanel = {
  story: "s",
  title: "Story s",
  description: "What s is. Why.",
  capabilities: [line("base", "landed", "passing", "healthy"), line("next", "in-progress", "failing")],
  arrows: [
    { from: "next", to: "base", toTitle: "The base", landed: true, toStatus: "healthy" },
    { from: "base", to: "away", toTitle: "The away", toStory: "Story t", landed: false, toStatus: "untested" },
  ],
};

/** The `<g>` of the diagram box whose title is `title`. */
function box(html: string, title: string): string {
  const found = [...html.matchAll(/<g class="box[^"]*"[^>]*>[\s\S]*?<\/g>/g)].map(([each]) => each).find((each) => each.includes(`<title>${title}`));
  assert.ok(found !== undefined, `a box titled ${title}`);
  return found;
}

test("4.6 the panel is the story's sentences, its diagram, and below it only the capability selected", () => {
  const html = renderStoryPanel(panel, "next");
  assert.match(html, /What s is\. Why\./);
  const diagram = html.indexOf("panel-diagram");
  const detail = html.indexOf("panel-detail");
  assert.ok(diagram > 0 && detail > diagram, "the selected capability shows below the diagram");
  const below = html.slice(detail);
  assert.match(below, /The next/);
  assert.match(below, /What next does\./);
  assert.match(below, /<span class="panel-state status-proposed">proposed<\/span>/, "its word, not its work state");
  assert.doesNotMatch(below, /in progress/);
  assert.match(below, /the agent reports: failing/);
  assert.match(below, /<details><summary>1 contract<\/summary>[\s\S]*next keeps its promise/, "its contracts, folded until asked for");
  assert.doesNotMatch(html, /What base does\./, "no other capability's sentences");
  assert.doesNotMatch(html, /base keeps its promise/, "nor its contracts");
  assert.doesNotMatch(html, /panel-capabilities/, "no list of every capability");
  assert.doesNotMatch(html, /Front covers|panel-shelf|data-book-id/, "no front covers (ADR-0659 D4)");
});

test("4.8 each of the story's capabilities is a box you can click, marked when selected and tinted by its word; another story's is not", () => {
  const html = renderStoryPanel(panel, "next");
  const next = box(html, "The next");
  assert.match(next, /data-capability-id="next"/);
  assert.match(next, /role="button"/);
  assert.match(next, /tabindex="0"/);
  assert.match(next, /aria-pressed="true"/);
  assert.match(next, /\bselected\b/);
  assert.match(next, /\bstatus-proposed\b/);
  assert.doesNotMatch(next, /\bhealth-/, "the agent's report never tints a card");
  const base = box(html, "The base");
  assert.match(base, /aria-pressed="false"/);
  assert.match(base, /\bstatus-healthy\b/);
  assert.doesNotMatch(base, /\bselected\b/);
  const away = box(html, "Story t · The away");
  assert.match(away, /\belsewhere\b/);
  assert.doesNotMatch(away, /data-capability-id|role=|tabindex|aria-pressed/, "another story's capability is context, not a surface (ADR-0659 D3)");
});

test("4.10 each card has a strip saying proposed, healthy, unhealthy or untested, coloured by it, and the agent's report and storytree's as labelled marks", () => {
  const capabilities = [
    { ...line("base", "landed", "passing", "unhealthy"), verified: "failing" as const },
    line("next", "in-progress", "failing", "proposed"),
    line("done", "landed", "failing", "healthy"),
    line("bare", "planned", "passing", "untested"),
  ];
  const html = renderStoryPanel({ ...panel, capabilities }, "next");
  const base = box(html, "The base");
  assert.match(base, /class="card-strip"/);
  assert.match(base, /<text class="card-status"[^>]*>unhealthy<\/text>/);
  assert.match(base, /\bstatus-unhealthy\b/, "the strip is coloured by the word");
  assert.match(base, /the agent reports: passing/);
  assert.match(base, /storytree saw: failing/);
  const next = box(html, "The next");
  assert.match(next, /<text class="card-status"[^>]*>proposed<\/text>/);
  assert.match(next, /\bstatus-proposed\b/);
  assert.match(next, /the agent reports: failing/);
  assert.doesNotMatch(next, /storytree saw/, "storytree's mark only where something wrote it");
  assert.match(box(html, "The done"), /<text class="card-status"[^>]*>healthy<\/text>/);
  assert.match(box(html, "The bare"), /<text class="card-status"[^>]*>untested<\/text>/);
  const away = box(html, "Story t · The away");
  assert.match(away, /<text class="card-status"[^>]*>untested<\/text>/, "another story's card says its word too");
  assert.doesNotMatch(html, /card-status"[^>]*>(planned|in progress|landed|not landed yet)</, "the work state has left the card");
});

test("4.11 the tree has its own space in the panel, at full size, with a pop-out icon beside it and no text button", () => {
  const html = renderStoryPanel(panel, "next");
  const frame = html.match(/<div class="panel-tree-frame"[\s\S]*?<\/svg>\s*<\/div>\s*<\/div>/)?.[0];
  assert.ok(frame !== undefined, "a framed space holding the tree");
  assert.match(frame, /<div class="panel-tree-surface">\s*<svg class="panel-diagram"/, "the tree is drawn on a surface that is moved, not shrunk");
  assert.doesNotMatch(frame, /<button/, "no button inside the frame, where a press starts a drag");
  const popOut = html.match(/<button[^>]*data-open-tree[^>]*>/)?.[0];
  assert.ok(popOut !== undefined, "a pop-out control");
  assert.match(popOut, /aria-label="Open in a larger window"/);
  assert.match(popOut, /title="Open in a larger window"/);
  assert.doesNotMatch(html, /Open the capability tree/, "the icon replaces the text button");
});

test("4.8 a story with no capabilities shows its sentences and nothing below", () => {
  const html = renderStoryPanel({ ...panel, capabilities: [], arrows: [] }, undefined);
  assert.match(html, /What s is\. Why\./);
  assert.doesNotMatch(html, /panel-diagram|panel-detail/);
});

test("with the capability tree switched off, the panel is the story's sentences alone: no tree and no capability details (ADR-0750)", () => {
  const html = renderStoryPanel(panel, "next", { tree: false });
  assert.match(html, /What s is\. Why\./);
  assert.doesNotMatch(html, /panel-tree/, "no tree space and no pop-out");
  assert.doesNotMatch(html, /data-capability-id/, "no capability to pick or show");
});

function notGreen(why: CapabilityLine["why"], lastSeen?: { state: "passing" | "failing"; at: string }): StoryPanel {
  const base = line("cap", "in-progress", "not-checked", "untested");
  const contract = { ...base.contracts[0]!, ...(lastSeen === undefined ? {} : { lastSeen }) };
  return { ...panel, capabilities: [{ ...base, contracts: [contract], ...(why === undefined ? {} : { why }) }] };
}

/** The sentence under the selected capability's word. */
function whyLine(html: string): string {
  const found = /<p class="panel-why[^"]*"[^>]*>([\s\S]*?)<\/p>/.exec(html);
  assert.ok(found !== null, "a line saying why");
  return found[1]!.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
}

test("4.14 a parked capability's detail keeps its word and reason and says it is parked, naming its arcs", () => {
  const base = notGreen({ reason: "not built", mover: "agent", contracts: [] });
  const parked = (titles: string[]): string => renderStoryPanel({ ...base, capabilities: [{ ...base.capabilities[0]!, parkedOn: titles.map((title, at) => ({ arc: `arc-${at}`, title })) }] }, "cap");
  const one = parked(["Identity <beta>"]);
  const said = /<p class="panel-parked"[^>]*>([\s\S]*?)<\/p>/.exec(one)?.[1]?.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
  assert.equal(said, "Parked on Identity &lt;beta&gt;: shelved on purpose.");
  assert.match(one, /panel-state status-untested">untested</, "its word is kept");
  assert.equal(whyLine(one), "Why not green: it is not built yet. The agent moves this one.", "and its reason");
  assert.ok(one.indexOf("panel-parked") > one.indexOf("panel-why") && one.indexOf("panel-parked") < one.indexOf("<details>"));
  assert.match(parked(["Identity", "Journey events"]), /Parked on Identity and Journey events:/);
  assert.equal(renderStoryPanel(base, "cap").includes("panel-parked"), false, "one not parked says nothing of it");
});

test("4.12 a capability that is not healthy says why under its word, who moves it, and its contracts by number", () => {
  const agent = renderStoryPanel(notGreen({ reason: "no test names it", mover: "agent", contracts: ["1.2", "1.3"] }), "cap");
  assert.equal(whyLine(agent), "Why not green: no test names 1.2 and 1.3. The agent moves this one.");
  assert.ok(agent.indexOf("panel-why") > agent.indexOf("panel-state") && agent.indexOf("panel-why") < agent.indexOf("<details>"), "under its word, above its contracts");
  const owner = renderStoryPanel(notGreen({ reason: "needs owner", mover: "owner", contracts: ["8.1"], since: "2026-09-27T10:00:00.000Z" }), "cap");
  assert.equal(whyLine(owner), "Why not green: 8.1 needs something only you can give, since 27 Sep. You move this one.");
  assert.match(owner, /class="panel-why mover-owner"/);
  assert.equal(whyLine(renderStoryPanel(notGreen({ reason: "not built", mover: "agent", contracts: [] }), "cap")), "Why not green: it is not built yet. The agent moves this one.");
  assert.equal(whyLine(renderStoryPanel(notGreen({ reason: "failing", mover: "agent", contracts: ["2.1"] }), "cap")), "Why not green: 2.1 is failing. The agent moves this one.");
  assert.equal(whyLine(renderStoryPanel(notGreen({ reason: "not re-run", mover: "agent", contracts: ["2.1"] }), "cap")), "Why not green: 2.1 was not re-run. The agent moves this one.");
  assert.equal(whyLine(renderStoryPanel(notGreen({ reason: "not re-run", mover: "agent", contracts: ["2.1"], since: "2026-10-01T06:00:00.000Z" }), "cap")), "Why not green: 2.1 was not re-run. The agent moves this one.", "its date is on the contract row: the day it was last seen, not the day the skip was written");
  assert.equal(whyLine(renderStoryPanel(notGreen({ reason: "out of CI's reach", mover: "agent", contracts: ["3.4"] }), "cap")), "Why not green: 3.4 can only run on another platform. The agent moves this one.");
});

test("4.13 in a project nothing verifies, a built capability's card and detail lead with the agent's report and say storytree does not check this project's tests yet", () => {
  const cap: CapabilityLine = { ...line("cap", "landed", "passing", "untested"), reportOnly: true };
  const html = renderStoryPanel({ ...panel, capabilities: [cap], arrows: [{ from: "cap", to: "away", toTitle: "The away", toStory: "Story t", landed: true, toStatus: "untested", toReported: "failing" }] }, "cap");
  const shown = (part: string): string => part.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  assert.match(shown(box(html, "The cap")), /^The cap agent: passing/, "its strip says the agent's report");
  assert.match(shown(box(html, "Story t · The away")), /agent: failing/);
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
  const mapped: StoryPanel = { story: "m", title: "Cart", description: "no description yet", capabilities: [], arrows: [], mapped: { files: 2, lines: 1200 } };
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

test("4.36 a story's risk bar shows its rating out of ten, the users it could reach and its extra checks with what sets each off, and no graph; a story without one shows none", () => {
  const checks: NonNullable<StoryPanel["risk"]>["checks"] = [
    { check: "a real-app run", trigger: "change" },
    { check: "a fresh-install sweep", trigger: "release", capability: "Install & update" },
  ];
  const html = renderStoryPanel({ ...panel, risk: { rating: 8, audience: "invited", checks } }, undefined);
  const bar = /<section class="panel-risk"[\s\S]*?<\/section>/.exec(html)?.[0] ?? "";
  assert.match(bar, /Risk rating[\s\S]*8<\/strong> of 10/);
  assert.match(bar, /Users potentially impacted[\s\S]*the invited users \(not counted yet\)/);
  assert.match(bar, /a real-app run[\s\S]*on every change/);
  assert.match(bar, /a fresh-install sweep[\s\S]*Install &amp; update[\s\S]*before each formal release/, "a capability's check is named with it, as text");
  assert.doesNotMatch(bar, /<svg|<canvas/, "no graph");
  const counted = renderStoryPanel({ ...panel, risk: { rating: 9, audience: "public", users: 40, checks: [] } }, undefined);
  assert.match(counted, /Users potentially impacted[\s\S]*40/);
  assert.match(counted, /Extra checks[\s\S]*none beyond the standard tests/);
  assert.match(renderStoryPanel({ ...panel, risk: { checks } }, undefined), /Risk rating[\s\S]*not read yet/, "checks without a reading");
  assert.doesNotMatch(renderStoryPanel(panel, undefined), /panel-risk/);
});

test("4.37 storytree's mark names its source on the card, in the detail and on each contract: verified locally, from CI, or both (short on the card); the reason says the source of what carries it; no source recorded, it says none", () => {
  const shown = (part: string): string => part.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  const base = line("base", "landed", "passing", "unhealthy");
  const local: CapabilityLine = { ...base, verified: "passing", sources: ["local"], contracts: [{ ...base.contracts[0]!, verified: "passing", source: "local" }] };
  const both: CapabilityLine = {
    ...line("both", "landed", "passing", "unhealthy"),
    verified: "failing",
    sources: ["local", "ci"],
    why: { reason: "failing", mover: "agent", contracts: ["2.1"], sources: ["ci"] },
    contracts: [{ id: "k1", title: "2.1 · On CI", reported: "passing", trail: "green only", verified: "failing", source: "ci" }, { id: "k2", title: "2.2 · Local", reported: "passing", trail: "green only", verified: "passing", source: "local" }],
  };
  const older: CapabilityLine = { ...line("older", "landed", "passing", "unhealthy"), verified: "failing", why: { reason: "failing", mover: "agent", contracts: ["3.1"] } };
  const html = (selected: string) => renderStoryPanel({ ...panel, capabilities: [local, both, older], arrows: [] }, selected);

  assert.match(shown(box(html("base"), "The base")), /storytree saw: passing · local\b/, "the card, short of room, says it short");
  assert.match(shown(box(html("base"), "The both")), /storytree saw: failing · local \+ CI/);
  assert.doesNotMatch(shown(box(html("base"), "The older")), /· (local|CI)/, "no source recorded: none said");

  const detail = (selected: string) => shown(/<section class="panel-detail[\s\S]*?<\/section>/.exec(html(selected))?.[0] ?? "");
  assert.match(detail("base"), /storytree saw: passing, verified locally/);
  assert.match(detail("both"), /storytree saw: failing, verified locally and from CI/);
  assert.match(detail("both"), /2\.1 · On CI .*storytree saw: failing, from CI/);
  assert.match(detail("both"), /2\.2 · Local .*storytree saw: passing, verified locally/);
  assert.equal(whyLine(html("both")), "Why not green: 2.1 is failing, from CI. The agent moves this one.");
  assert.equal(whyLine(html("older")), "Why not green: 3.1 is failing. The agent moves this one.");
  assert.doesNotMatch(detail("older"), /locally|from CI/);
});
