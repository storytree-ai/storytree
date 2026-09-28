/** Visible rows, safe text and the context slot before composition arrives. */
import { createElement } from "react";
import assert from "node:assert/strict";
import { test } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { SessionsList } from "./sessions-list.js";
import { sessionColour } from "../agent-claims/agent-claims.js";
import type { SessionRow } from "../sessions-list/sessions-list.js";

const row: SessionRow = { id: "parent", label: "Build <signup>", agent: "Codex", state: "idle",
  needsYou: true, totalTokens: 120_000, stories: ["signup"], files: [], offPlan: [], children: [
    { id: "child", label: "Read the library", agent: "Subagent", state: "observed", needsYou: false,
      totalTokens: undefined, stories: [], files: [], offPlan: [], children: [] },
  ] };

test("7.1–7.5 rows start folded, show safe words and available total beside an empty slot", () => {
  const html = renderToStaticMarkup(createElement(SessionsList, { rows: [row], onHighlight() {} }));
  assert.match(html, /Build &lt;signup&gt;/);
  assert.match(html, /aria-expanded="false"/);
  assert.match(html, />\+1<\/button>/);
  assert.doesNotMatch(html, /data-session-id="child"/);
  assert.match(html, /class="session-needs-you">needs you/);
  assert.match(html, /class="session-context-slot" aria-hidden="true"><\/span>/);
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
