/** Visible rows, safe text and the context slot before composition arrives. */
import { createElement } from "react";
import assert from "node:assert/strict";
import { test } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { arcsAfter, isSessionRows, keptPanelOpen, SessionsList, windowsReader } from "./sessions-list.js";
import type { ArcView } from "@storytree/library";
import type { SessionWindow } from "@storytree/agent-link";
import { sessionColour } from "../agent-claims/agent-claims.js";
import type { SessionRow } from "../sessions-list/sessions-list.js";

const row: SessionRow = { id: "parent", label: "Build <signup>", agent: "Codex", state: "waiting",
  idle: false, totalTokens: 120_000, stories: ["signup"], worktrees: [], running: [], description: [], children: [
    { id: "child", label: "Read the library", agent: "Subagent", state: "observed", idle: false,
      totalTokens: undefined, stories: [], worktrees: [], running: [], description: [], children: [] },
  ] };

test("7.1–7.5 rows start expanded, each with its children below it, and a row collapsed by the caller shows neither; rows show safe words and available total beside its bar", () => {
  const html = renderToStaticMarkup(createElement(SessionsList, { rows: [row], onHighlight() {} }));
  assert.match(html, /Build &lt;signup&gt;/);
  assert.match(html, /aria-expanded="true"/);
  assert.match(html, /class="session-children"[^>]*>\+1<\/span>/);
  assert.match(html, /data-session-id="child"/);
  assert.match(html, /class="session-detail"/);
  const collapsed = renderToStaticMarkup(createElement(SessionsList, { rows: [row], collapsed: new Set(["parent"]), onHighlight() {} }));
  assert.match(collapsed, /aria-expanded="false"/);
  assert.doesNotMatch(collapsed, /data-session-id="child"|session-detail/);
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
  const busy: SessionRow = { ...row, worktrees: [{ path: "/home/me/code/app/.claude/worktrees/one", branches: [] }, { path: "/home/me/code/app/.claude/worktrees/two", branches: [] }] };
  const folded = renderToStaticMarkup(createElement(SessionsList, { rows: [busy, { ...row, id: "lone", children: [] }], collapsed: new Set(["parent", "lone"]), onHighlight() {} }));
  assert.equal(folded.match(/<button[^>]*session-children-toggle/g)?.length, 2, "every row has one expander, a childless one too");
  assert.doesNotMatch(folded, /session-detail/);
  const files = new Map([["parent", { files: [{ path: "src/a.ts", resident: true }, { path: "src/b.ts", resident: false }] }]]);
  const html = renderToStaticMarkup(createElement(SessionsList, { rows: [busy], files, onHighlight() {} }));
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
  const unread = renderToStaticMarkup(createElement(SessionsList, { rows: [busy],
    files: new Map([["parent", { absent: "no hook has named this session's transcript" }]]), onHighlight() {} }));
  assert.match(unread, /no hook has named this session&#x27;s transcript/);
});

test("7.14 an expanded row opens with its description, each line its own, before its worktrees; folded, or with none, no description shows", () => {
  const said: SessionRow = { ...row, children: [], worktrees: [{ path: "/w/one", branches: [] }], description: ["Sessions list labelling", "PR #309 awaiting CI"] };
  const html = renderToStaticMarkup(createElement(SessionsList, { rows: [said], onHighlight() {} }));
  const detail = html.match(/class="session-detail".*?<\/ul>/s)?.[0] ?? "";
  assert.match(detail, /class="session-description"><p>Sessions list labelling<\/p><p>PR #309 awaiting CI<\/p><\/div>/, detail);
  assert.ok(detail.indexOf("session-description") < detail.indexOf(">Worktrees<"));
  assert.doesNotMatch(renderToStaticMarkup(createElement(SessionsList, { rows: [said], collapsed: new Set(["parent"]), onHighlight() {} })), /session-description/);
  assert.doesNotMatch(renderToStaticMarkup(createElement(SessionsList, { rows: [{ ...said, description: [] }], onHighlight() {} })), /session-description/);
  assert.equal(isSessionRows([{ ...said, description: undefined }]), false, "rows kept by an older build are not drawn");
});

test("7.13 a row named with its machine shows it beside the label; a row without names none", () => {
  const html = renderToStaticMarkup(createElement(SessionsList, { rows: [{ ...row, children: [], machine: "mint" }, { ...row, id: "lone", children: [] }], onHighlight() {} }));
  assert.equal(html.match(/class="session-machine"[^>]*>mint<\/span>/g)?.length, 1, html);
});

test("7.9 the list prints no prose about a session: a row with a close-out why shows none of it, and the header count names no such need", () => {
  const html = renderToStaticMarkup(createElement(SessionsList, { rows: [{ ...row, children: [], needsYouWhy: "says safe, but fix-login is unmerged" } as SessionRow], onHighlight() {} }));
  assert.match(html, /Build &lt;signup&gt;/);
  assert.doesNotMatch(html, /needs you|unmerged|says safe|fix-login|needing/i);
});

test("7.15 an expanded row's worktree carries its label, unmerged or merged or its pull request's state, beside its folder's name; a worktree with none carries none", () => {
  const worktrees: SessionRow["worktrees"] = [{ path: "/w/one", branches: ["fix-one"], state: "unmerged" }, { path: "/w/two", branches: ["fix-two"], state: "merged" }, { path: "/w/site", branches: [] },
    { path: "/w/three", branches: ["fix-three"], state: "unmerged", label: "PR #40 · in CI" }];
  const html = renderToStaticMarkup(createElement(SessionsList, { rows: [{ ...row, children: [], worktrees }], onHighlight() {} }));
  const list = html.match(/<ul class="session-detail-worktrees".*?<\/ul>/s)?.[0] ?? "";
  assert.match(list, /<li title="\/w\/one\nfix-one">one<span class="session-worktree-state" data-state="unmerged">unmerged<\/span><\/li>/, list);
  assert.match(list, /<li title="\/w\/two\nfix-two">two<span class="session-worktree-state" data-state="merged">merged<\/span><\/li>/, list);
  assert.match(list, /<li title="\/w\/site">site<\/li>/, list);
  assert.match(list, /<li title="\/w\/three\nfix-three">three<span class="session-worktree-state" data-state="unmerged">PR #40 · in CI<\/span><\/li>/, list);
});

test("7.16 an expanded row's Running block, between its worktrees and its files, lists each running command by its words (the full command on hover) and how long it has run; with nothing running it is not drawn", () => {
  const running: SessionRow["running"] = [{ words: "pnpm run test --full", command: "pnpm run test --full --reason x", ranMs: 12_000 },
    { words: "gh pr checks --watch", command: "gh pr checks --watch", ranMs: 90_000 }, { words: "sleep 9999", command: "sleep 9999", ranMs: 3_900_000 }];
  const html = renderToStaticMarkup(createElement(SessionsList, { rows: [{ ...row, children: [], worktrees: [{ path: "/w/one", branches: [] }], running }], onHighlight() {} }));
  const block = html.match(/<ul class="session-detail-running".*?<\/ul>/s)?.[0] ?? "";
  assert.match(block, /<li title="pnpm run test --full --reason x"><span class="session-run-command">pnpm run test --full<\/span><span class="session-run-time">12s<\/span><\/li>/, block);
  assert.match(block, /session-run-time">1m<\/span>/, block);
  assert.match(block, /session-run-time">1h 5m<\/span>/, block);
  assert.ok(html.indexOf(">Worktrees<") < html.indexOf(">Running<") && html.indexOf(">Running<") < html.indexOf(">Files<"));
  assert.doesNotMatch(renderToStaticMarkup(createElement(SessionsList, { rows: [{ ...row, children: [], running: [] }], onHighlight() {} })), />Running</);
  assert.equal(isSessionRows([{ ...row, children: [], running: undefined }]), false, "rows kept by an older build are not drawn");
});

test("7.10 the quiet sessions stay folded into one N idle row by default, opening on its button", () => {
  const idle: SessionRow = { ...row, id: "quiet", label: "Quiet one", children: [], idle: true };
  const html = renderToStaticMarkup(createElement(SessionsList, { rows: [{ ...row, children: [] }, idle], onHighlight() {} }));
  assert.doesNotMatch(html, /data-session-id="quiet"/);
  assert.match(html, /class="session-idle-fold" aria-expanded="false"[^>]*>1 idle</);
});

test("7.17 the list is a bottom strip whose header toggles it, like the arcs bar's: it starts expanded; collapsed it leaves only the header (name, count, legend and a caret pointing up), drawing no rows; the choice is kept per project and a missing or foreign value means expanded", () => {
  const open = renderToStaticMarkup(createElement(SessionsList, { rows: [{ ...row, children: [] }], onHighlight() {} }));
  assert.match(open, /<button type="button" class="sessions-handle" aria-expanded="true" aria-controls="sessions-body" aria-label="Hide sessions"/);
  assert.match(open, /class="sessions-caret" aria-hidden="true">▾</);
  assert.match(open, /id="sessions-body"(?! hidden)/);
  assert.match(open, /data-session-id="parent"/);
  const shut = renderToStaticMarkup(createElement(SessionsList, { rows: [{ ...row, children: [] }], open: false, onHighlight() {} }));
  assert.match(shut, /aria-expanded="false" aria-controls="sessions-body" aria-label="Show sessions"/);
  assert.match(shut, /class="sessions-caret" aria-hidden="true">▴</);
  assert.match(shut, /class="sessions-count"[^>]*>1</, "the count and legend stay on the strip");
  assert.match(shut, /class="session-legend"/);
  assert.doesNotMatch(shut, /data-session-id|session-detail/);

  const store = new Map<string, string>();
  const storage = { getItem: (key: string) => store.get(key) ?? null, setItem: (key: string, value: string) => void store.set(key, value) };
  assert.equal(keptPanelOpen("demo", storage).read(), true, "nothing kept: expanded");
  keptPanelOpen("demo", storage).write(false);
  assert.equal(keptPanelOpen("demo", storage).read(), false, "a folded strip stays folded next start");
  assert.equal(keptPanelOpen("other", storage).read(), true, "kept per project");
  store.set("storytree.forest.sessions-open.v1:demo", "\"maybe\"");
  assert.equal(keptPanelOpen("demo", storage).read(), true, "a foreign value is ignored");
});

test("the list reads every arc in one ask, and again only when a change touches an arc, an increment or a question (ADR-0836 D3)", async () => {
  const asked: string[] = [];
  const views = [{ arc: { id: "arc_1" } }] as unknown as ArcView[];
  const reads = { arcViews: async (project: string) => { asked.push(project); return views; } };
  const change = (type: string) => ({ type });
  assert.equal(await arcsAfter(reads, "p", { changes: [] }, undefined), views, "the first reading asks");
  const last = [] as ArcView[];
  assert.equal(await arcsAfter(reads, "p", { changes: [change("note"), change("decision")] }, last), last, "no work change keeps the last views");
  assert.equal(await arcsAfter(reads, "p", { changes: [change("note"), change("increment")] }, last), views);
  assert.deepEqual(asked, ["p", "p"], "one ask per reading, never one per arc");
});

test("expanded rows' windows are read in one batched ask, one at a time: rows asked meanwhile wait for the next, and a session in flight is not asked twice", async () => {
  const asks: string[][] = [];
  const answers: Array<(windows: SessionWindow[]) => void> = [];
  const heard: string[] = [];
  const reader = windowsReader(sessions => { asks.push([...sessions]); return new Promise(resolve => answers.push(resolve)); },
    files => { heard.push(...files.keys()); });
  reader.ask(["a", "b"]);
  reader.ask(["b", "c"]);
  reader.ask(["d"]);
  assert.deepEqual(asks, [["a", "b"]], "one ask in flight");
  answers[0]!([{ absent: "none" }, { absent: "none" }] as SessionWindow[]);
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.deepEqual(heard, ["a", "b"]);
  assert.deepEqual(asks, [["a", "b"], ["c", "d"]], "the rows asked meanwhile, together, without b again");
});
