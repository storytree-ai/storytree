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

function line(id: string, state: CapabilityLine["state"], reported: CapabilityLine["reported"]): CapabilityLine {
  return {
    id,
    title: `The ${id}`,
    description: `What ${id} does.`,
    reported,
    state,
    contracts: [{ id: `${id}-k`, title: `${id} keeps its promise`, reported, trail: "green only" }],
  };
}

const panel: StoryPanel = {
  story: "s",
  title: "Story s",
  description: "What s is. Why.",
  capabilities: [line("base", "landed", "passing"), line("next", "in-progress", "failing")],
  arrows: [
    { from: "next", to: "base", toTitle: "The base", landed: true },
    { from: "base", to: "away", toTitle: "The away", toStory: "Story t", landed: false },
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
  assert.match(below, /in progress/);
  assert.match(below, /the agent reports: failing/);
  assert.match(below, /<details><summary>1 contract<\/summary>[\s\S]*next keeps its promise/, "its contracts, folded until asked for");
  assert.doesNotMatch(html, /What base does\./, "no other capability's sentences");
  assert.doesNotMatch(html, /base keeps its promise/, "nor its contracts");
  assert.doesNotMatch(html, /panel-capabilities/, "no list of every capability");
  assert.doesNotMatch(html, /Front covers|panel-shelf|data-book-id/, "no front covers (ADR-0659 D4)");
});

test("4.8 each of the story's capabilities is a box you can click, marked when selected and tinted by its health; another story's is not", () => {
  const html = renderStoryPanel(panel, "next");
  const next = box(html, "The next");
  assert.match(next, /data-capability-id="next"/);
  assert.match(next, /role="button"/);
  assert.match(next, /tabindex="0"/);
  assert.match(next, /aria-pressed="true"/);
  assert.match(next, /\bselected\b/);
  assert.match(next, /\bhealth-failing\b/);
  assert.match(next, /\bpending\b/, "not landed yet: dashed");
  const base = box(html, "The base");
  assert.match(base, /aria-pressed="false"/);
  assert.match(base, /\bhealth-passing\b/);
  assert.doesNotMatch(base, /\bpending\b|\bselected\b/);
  const away = box(html, "Story t · The away");
  assert.match(away, /\belsewhere\b/);
  assert.doesNotMatch(away, /data-capability-id|role=|tabindex|aria-pressed/, "another story's capability is context, not a surface (ADR-0659 D3)");
});

test("4.10 each card has a strip naming its work state in words, and the agent's report and storytree's as labelled marks", () => {
  const html = renderStoryPanel({ ...panel, capabilities: [{ ...line("base", "landed", "passing"), verified: "failing" }, line("next", "in-progress", "failing")] }, "next");
  const base = box(html, "The base");
  assert.match(base, /class="card-strip"/);
  assert.match(base, /<text class="card-status"[^>]*>landed<\/text>/);
  assert.match(base, /\bstate-landed\b/, "the strip is coloured by the work state");
  assert.match(base, /the agent reports: passing/);
  assert.match(base, /storytree saw: failing/);
  const next = box(html, "The next");
  assert.match(next, /<text class="card-status"[^>]*>in progress<\/text>/);
  assert.match(next, /\bstate-in-progress\b/);
  assert.match(next, /the agent reports: failing/);
  assert.doesNotMatch(next, /storytree saw/, "storytree's mark only where something wrote it");
  const away = box(html, "Story t · The away");
  assert.match(away, /<text class="card-status"[^>]*>not landed yet<\/text>/);
});

test("4.8 a story with no capabilities shows its sentences and nothing below", () => {
  const html = renderStoryPanel({ ...panel, capabilities: [], arrows: [] }, undefined);
  assert.match(html, /What s is\. Why\./);
  assert.doesNotMatch(html, /panel-diagram|panel-detail/);
});
