/** Visible rows, safe text and the context slot before composition arrives. */
import { createElement } from "react";
import assert from "node:assert/strict";
import { test } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { SessionsList } from "./sessions-list.js";
import { sessionColour } from "../agent-claims/agent-claims.js";
import type { SessionRow } from "../sessions-list/sessions-list.js";

const row: SessionRow = { id: "parent", label: "Build <signup>", agent: "Codex", state: "idle",
  needsYou: true, totalTokens: 120_000, stories: ["signup"], children: [
    { id: "child", label: "Read the library", agent: "Subagent", state: "observed", needsYou: false,
      totalTokens: undefined, stories: [], children: [] },
  ] };

test("7.1–7.5 rows start folded, show safe words and available total beside its bar", () => {
  const html = renderToStaticMarkup(createElement(SessionsList, { rows: [row], onHighlight() {} }));
  assert.match(html, /Build &lt;signup&gt;/);
  assert.match(html, /aria-expanded="false"/);
  assert.match(html, />\+1<\/button>/);
  assert.doesNotMatch(html, /data-session-id="child"/);
  assert.match(html, /class="session-needs-you">needs you/);
  assert.match(html, /class="session-context-slot" title="120,000 tokens"/);
  assert.match(html, /120,000 context tokens/);
  assert.match(html, />120K<\/span>/);
  const unavailable = renderToStaticMarkup(createElement(SessionsList, { rows: [{ ...row, totalTokens: undefined }], onHighlight() {} }));
  assert.match(unavailable, /Context total unavailable">—/);
});

test("5.5 a row wears its session's wisp colour, and a hovered wisp highlights its row", () => {
  const html = renderToStaticMarkup(createElement(SessionsList, { rows: [row], highlighted: "parent", onHighlight() {} }));
  assert.ok(html.includes(`class="session-colour" style="background:${sessionColour("parent")}"`), html);
  assert.match(html, /data-session-id="parent"[^>]*data-highlighted="true"/);
  const plain = renderToStaticMarkup(createElement(SessionsList, { rows: [row], onHighlight() {} }));
  assert.doesNotMatch(plain, /data-highlighted/);
});

test("7.6 a row's bar is its tokens on a 1,000,000-token scale in four groups, numbers on hover; Claude rows mark 700K and 850K, Codex rows none; a row without a composition is one raw segment", () => {
  const composition = { injected: 100, grounding: 100, implementation: 150, other: 50 };
  const claude = renderToStaticMarkup(createElement(SessionsList, { rows: [{ ...row, children: [], agent: "Claude Code", totalTokens: 400_000, composition }], onHighlight() {} }));
  for (const [group, width] of [["injected", "10%"], ["grounding", "10%"], ["implementation", "15%"], ["other", "5%"]]) {
    assert.match(claude, new RegExp(`class="session-segment" data-group="${group}" style="width:${width}"`));
  }
  assert.match(claude, /class="session-tick" style="left:70%"/);
  assert.match(claude, /class="session-tick" style="left:85%"/);
  assert.match(claude, /title="400,000 tokens: Injected 100,000 · Grounding 100,000 · Implementation 150,000 · Other 50,000 \(an estimated split\)"/);

  const codex = renderToStaticMarkup(createElement(SessionsList, { rows: [{ ...row, children: [], agent: "Codex", totalTokens: 1_200_000, composition: undefined }], onHighlight() {} }));
  assert.match(codex, /class="session-segment" data-group="raw" style="width:100%"/);
  assert.doesNotMatch(codex, /session-tick/);
  assert.match(codex, /title="1,200,000 tokens"/);
});

test("7.6 the header names the bar's four colours in bar order", () => {
  const html = renderToStaticMarkup(createElement(SessionsList, { rows: [row], onHighlight() {} }));
  const header = html.match(/<header>.*<\/header>/)?.[0] ?? "";
  assert.deepEqual([...header.matchAll(/data-group="(\w+)"><span class="session-swatch"[^>]*><\/span>(\w+)/g)].map(m => [m[1], m[2]]),
    [["injected", "Injected"], ["grounding", "Grounding"], ["implementation", "Implementation"], ["other", "Other"]]);
});
