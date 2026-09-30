/** Visible rows, safe text and the context slot before composition arrives. */
import { createElement } from "react";
import assert from "node:assert/strict";
import { test } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { isSessionRows, SessionsList } from "./sessions-list.js";
import { sessionColour } from "../agent-claims/agent-claims.js";
import type { SessionRow } from "../sessions-list/sessions-list.js";

const row: SessionRow = { id: "parent", label: "Build <signup>", agent: "Codex", state: "waiting",
  needsYou: true, idle: false, totalTokens: 120_000, stories: ["signup"], worktrees: [], unmerged: [], children: [
    { id: "child", label: "Read the library", agent: "Subagent", state: "observed", needsYou: false, idle: false,
      totalTokens: undefined, stories: [], worktrees: [], unmerged: [], children: [] },
  ] };

test("7.1–7.5 rows start folded, show safe words and available total beside its bar", () => {
  const html = renderToStaticMarkup(createElement(SessionsList, { rows: [row], onHighlight() {} }));
  assert.match(html, /Build &lt;signup&gt;/);
  assert.match(html, /aria-expanded="false"/);
  assert.match(html, /class="session-children"[^>]*>\+1<\/span>/);
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

test("7.6 a row's bar is its tokens on a 1,000,000-token scale in four groups, numbers on hover; a Claude row marks its reading's context guidance, one mark (ADR-0739 D1), Codex rows none; a row without a composition is one raw segment", () => {
  const composition = { injected: 100, grounding: 100, implementation: 150, other: 50 };
  const claude = renderToStaticMarkup(createElement(SessionsList, { rows: [{ ...row, children: [], agent: "Claude Code", totalTokens: 400_000, composition, guidance: 600_000 }], onHighlight() {} }));
  for (const [group, width] of [["injected", "10%"], ["grounding", "10%"], ["implementation", "15%"], ["other", "5%"]]) {
    assert.match(claude, new RegExp(`class="session-segment" data-group="${group}" style="width:${width}"`));
  }
  assert.deepEqual(claude.match(/class="session-tick" style="left:[^"]*"/g), ['class="session-tick" style="left:60%"'], "one mark, at the guidance");
  const unread = renderToStaticMarkup(createElement(SessionsList, { rows: [{ ...row, children: [], agent: "Claude Code", totalTokens: 400_000, composition }], onHighlight() {} }));
  assert.doesNotMatch(unread, /session-tick/, "no mark where the reading carries no guidance");
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

test("the list draws its kept last rows at once, marked as refreshing; a kept value of another shape is not rows", () => {
  const html = renderToStaticMarkup(createElement(SessionsList, { rows: [row], refreshing: true, onHighlight() {} }));
  assert.match(html, /data-session-id="parent"/);
  assert.match(html, /class="sessions-list" data-fresh="no"/);
  assert.match(html, /role="status"/);
  assert.doesNotMatch(renderToStaticMarkup(createElement(SessionsList, { rows: [row], onHighlight() {} })), /data-fresh/);
  assert.equal(isSessionRows(JSON.parse(JSON.stringify([row]))), true, "rows survive being kept, a missing total and all");
  assert.equal(isSessionRows([{ id: "parent" }]), false);
  assert.equal(isSessionRows({ rows: [row] }), false);
});

test("7.8 one expander per row, counting its children; expanded, a row lists its labelled worktrees by folder name (full path on hover), its labelled window's files (gone ones muted) and then its children", () => {
  const busy: SessionRow = { ...row, worktrees: ["/home/me/code/app/.claude/worktrees/one", "/home/me/code/app/.claude/worktrees/two"] };
  const folded = renderToStaticMarkup(createElement(SessionsList, { rows: [busy, { ...row, id: "lone", children: [] }], onHighlight() {} }));
  assert.equal(folded.match(/<button/g)?.length, 2, "every row has one expander, a childless one too");
  assert.doesNotMatch(folded, /session-detail/);
  const files = new Map([["parent", { files: [{ path: "src/a.ts", resident: true }, { path: "src/b.ts", resident: false }] }]]);
  const html = renderToStaticMarkup(createElement(SessionsList, { rows: [busy], expanded: new Set(["parent"]), files, onHighlight() {} }));
  const parentRow = html.match(/data-session-id="parent".*?<\/div>/s)?.[0] ?? "";
  assert.equal(parentRow.match(/<button/g)?.length, 1, "the children do not bring a second control to the row");
  assert.match(parentRow, /^data-session-id="parent"[^>]*><button[^>]*session-children-toggle/, "the expander opens the row");
  assert.match(parentRow, /class="session-children"[^>]*>\+1<\/span>/);
  assert.match(html, /aria-expanded="true"/);
  const detail = html.match(/class="session-detail".*?<\/div>/s)?.[0] ?? "";
  assert.ok(detail.indexOf(">Worktrees<") < detail.indexOf(">one<") && detail.indexOf(">one<") < detail.indexOf(">two<")
    && detail.indexOf(">two<") < detail.indexOf(">Files<") && detail.indexOf(">Files<") < detail.indexOf("src/a.ts"), detail);
  assert.match(detail, /<li title="\/home\/me\/code\/app\/\.claude\/worktrees\/one">one<\/li>/, "a worktree by its folder's name, its full path on hover");
  assert.match(detail, /<li[^>]*>src\/a\.ts<\/li>/);
  assert.match(detail, /<li[^>]*data-resident="no"[^>]*>src\/b\.ts<\/li>/);
  assert.ok(html.indexOf("session-detail") < html.indexOf('data-session-id="child"'), "children follow the detail");
  const unread = renderToStaticMarkup(createElement(SessionsList, { rows: [busy], expanded: new Set(["parent"]),
    files: new Map([["parent", { absent: "no hook has named this session's transcript" }]]), onHighlight() {} }));
  assert.match(unread, /no hook has named this session&#x27;s transcript/);
});

test("7.13 a row named with its machine shows it beside the label; a row without names none", () => {
  const html = renderToStaticMarkup(createElement(SessionsList, { rows: [{ ...row, children: [], machine: "mint" }, { ...row, id: "lone", children: [] }], onHighlight() {} }));
  assert.equal(html.match(/class="session-machine"[^>]*>mint<\/span>/g)?.length, 1, html);
});

test("7.12 a row holding unmerged work says so under it, naming its branches; a row without says nothing (ADR-0754 D4)", () => {
  const html = renderToStaticMarkup(createElement(SessionsList, { rows: [{ ...row, children: [], unmerged: ["fix-login", "tidy-readme"] }], onHighlight() {} }));
  assert.match(html, /class="session-unmerged">Holding unmerged work: fix-login, tidy-readme</);
  assert.match(html, /aria-label="[^"]* · holding unmerged work: fix-login, tidy-readme"/);
  assert.doesNotMatch(renderToStaticMarkup(createElement(SessionsList, { rows: [row], onHighlight() {} })), /unmerged/i);
});
