/** Visible rows, safe text and the context slot before composition arrives. */
import { createElement } from "react";
import assert from "node:assert/strict";
import { test } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { arcsAfter, cutoverAfter, FAILURES_WINDOW_MS, isSessionRows, keptPanelOpen, keptStripFull, keptTab, NEWS_STEP, readContext, refreshFailures, sessionsOutage, SessionsList, StepFailed, windowsReader } from "./sessions-list.js";
import type { ArcView } from "@storytree/library";
import { LIBRARY_UNREACHABLE } from "@storytree/library/connection-error";
import type { SessionWindow } from "@storytree/session-management";
import { sessionColour } from "../agent-claims/agent-claims.js";
import type { HistoryRow, SessionRow } from "../sessions-list/sessions-list.js";

const row: SessionRow = { id: "parent", label: "Build <signup>", agent: "Codex", state: "waiting",
  idle: false, lastSeenAt: "2026-09-28T12:00:00Z", totalTokens: 120_000, stories: ["signup"], worktrees: [], running: [], description: [], children: [
    { id: "child", label: "Read the library", agent: "Subagent", state: "observed", idle: false, lastSeenAt: "2026-09-28T12:00:00Z",
      totalTokens: undefined, stories: [], worktrees: [], running: [], description: [], children: [] },
  ] };

test("7.1–7.5 rows start collapsed, showing neither detail nor children; a row the user opened shows its detail and its children below it; rows show safe words and available total beside its bar", () => {
  const fresh = renderToStaticMarkup(createElement(SessionsList, { rows: [row], onHighlight() {} }));
  assert.match(fresh, /Build &lt;signup&gt;/);
  assert.match(fresh, /aria-expanded="false"/);
  assert.match(fresh, /class="session-children"[^>]*>\+1<\/span>/, "the count stays on a collapsed row");
  assert.doesNotMatch(fresh, /data-session-id="child"|session-detail/);
  const html = renderToStaticMarkup(createElement(SessionsList, { rows: [row], expanded: new Set(["parent"]), onHighlight() {} }));
  assert.match(html, /aria-expanded="true"/);
  assert.match(html, /data-session-id="child"/);
  assert.match(html, /class="session-detail"/);
  assert.match(html, /class="session-context-slot" title="120,000 tokens"/);
  assert.match(html, /120,000 context tokens/);
  assert.match(html, />120K<\/span>/);
  const unavailable = renderToStaticMarkup(createElement(SessionsList, { rows: [{ ...row, totalTokens: undefined }], onHighlight() {} }));
  assert.match(unavailable, /Context total unavailable">—/);
});

test("5.5 a row wears its session's colour, the one its outlines wear", () => {
  const html = renderToStaticMarkup(createElement(SessionsList, { rows: [row], onHighlight() {} }));
  assert.ok(html.includes(`class="session-colour" style="background:${sessionColour("parent")}"`), html);
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
  const folded = renderToStaticMarkup(createElement(SessionsList, { rows: [busy, { ...row, id: "lone", children: [] }], onHighlight() {} }));
  assert.equal(folded.match(/<button[^>]*session-children-toggle/g)?.length, 2, "every row has one expander, a childless one too");
  assert.doesNotMatch(folded, /session-detail/);
  const files = new Map([["parent", { files: [{ path: "src/a.ts", resident: true }, { path: "src/b.ts", resident: false }] }]]);
  const html = renderToStaticMarkup(createElement(SessionsList, { rows: [busy], files, expanded: new Set(["parent"]), onHighlight() {} }));
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

test("7.14 an expanded row opens with its description, each line its own, before its worktrees; folded, or with none, no description shows", () => {
  const said: SessionRow = { ...row, children: [], worktrees: [{ path: "/w/one", branches: [] }], description: ["Sessions list labelling", "PR #309 awaiting CI"] };
  const html = renderToStaticMarkup(createElement(SessionsList, { rows: [said], expanded: new Set(["parent"]), onHighlight() {} }));
  const detail = html.match(/class="session-detail".*?<\/ul>/s)?.[0] ?? "";
  assert.match(detail, /class="session-description"><p>Sessions list labelling<\/p><p>PR #309 awaiting CI<\/p><\/div>/, detail);
  assert.ok(detail.indexOf("session-description") < detail.indexOf(">Worktrees<"));
  assert.doesNotMatch(renderToStaticMarkup(createElement(SessionsList, { rows: [said], onHighlight() {} })), /session-description/);
  assert.doesNotMatch(renderToStaticMarkup(createElement(SessionsList, { rows: [{ ...said, description: [] }], expanded: new Set(["parent"]), onHighlight() {} })), /session-description/);
  assert.equal(isSessionRows([{ ...said, description: undefined }]), false, "rows kept by an older build are not drawn");
});

test("7.13 a row named with its machine shows it beside the label; a row without names none", () => {
  const html = renderToStaticMarkup(createElement(SessionsList, { rows: [{ ...row, children: [], machine: "mint" }, { ...row, id: "lone", children: [] }], onHighlight() {} }));
  assert.equal(html.match(/class="session-machine"[^>]*>mint<\/span>/g)?.length, 1, html);
});

test("7.20 a row flagged for work on main wears a label beside its name: a warning, on main, outside a workspace; a neutral first commit while it is pending; the reading's words on hover; an unflagged row none (ADR-0906)", () => {
  const html = renderToStaticMarkup(createElement(SessionsList, { rows: [{ ...row, children: [], onMain: "outside-workspace" },
    { ...row, id: "fresh", children: [], onMain: "first-commit-pending" }, { ...row, id: "plain", children: [] }], onHighlight() {} }));
  assert.deepEqual(html.match(/<span class="session-on-main"[^>]*>[^<]*<\/span>/g), [
    '<span class="session-on-main" data-tone="warning" title="worked on main, outside a workspace">on main</span>',
    '<span class="session-on-main" data-tone="neutral" title="setting up git, first commit pending">first commit</span>',
  ], html);
  assert.match(html, /aria-label="Build &lt;signup&gt; · Codex · worked on main, outside a workspace"/, "a screen reader hears the warning with the row");
});

test("7.9 the list prints no prose about a session: a row with a close-out why shows none of it, and the header count names no such need", () => {
  const html = renderToStaticMarkup(createElement(SessionsList, { rows: [{ ...row, children: [], needsYouWhy: "says safe, but fix-login is unmerged" } as SessionRow], onHighlight() {} }));
  assert.match(html, /Build &lt;signup&gt;/);
  assert.doesNotMatch(html, /needs you|unmerged|says safe|fix-login|needing/i);
});

test("7.15 an expanded row's worktree carries its label, unmerged or merged or its pull request's state, beside its folder's name; a worktree with none carries none", () => {
  const worktrees: SessionRow["worktrees"] = [{ path: "/w/one", branches: ["fix-one"], state: "unmerged" }, { path: "/w/two", branches: ["fix-two"], state: "merged" }, { path: "/w/site", branches: [] },
    { path: "/w/three", branches: ["fix-three"], state: "unmerged", label: "PR #40 · in CI" }];
  const html = renderToStaticMarkup(createElement(SessionsList, { rows: [{ ...row, children: [], worktrees }], expanded: new Set(["parent"]), onHighlight() {} }));
  const list = html.match(/<ul class="session-detail-worktrees".*?<\/ul>/s)?.[0] ?? "";
  assert.match(list, /<li title="\/w\/one\nfix-one">one<span class="session-worktree-state" data-state="unmerged">unmerged<\/span><\/li>/, list);
  assert.match(list, /<li title="\/w\/two\nfix-two">two<span class="session-worktree-state" data-state="merged">merged<\/span><\/li>/, list);
  assert.match(list, /<li title="\/w\/site">site<\/li>/, list);
  assert.match(list, /<li title="\/w\/three\nfix-three">three<span class="session-worktree-state" data-state="unmerged">PR #40 · in CI<\/span><\/li>/, list);
});

test("7.16 an expanded row's Running block, between its worktrees and its files, lists each running command by its words (the full command on hover) and how long it has run; with nothing running it is not drawn", () => {
  const running: SessionRow["running"] = [{ words: "pnpm run test --full", command: "pnpm run test --full --reason x", ranMs: 12_000 },
    { words: "gh pr checks --watch", command: "gh pr checks --watch", ranMs: 90_000 }, { words: "sleep 9999", command: "sleep 9999", ranMs: 3_900_000 }];
  const html = renderToStaticMarkup(createElement(SessionsList, { rows: [{ ...row, children: [], worktrees: [{ path: "/w/one", branches: [] }], running }], expanded: new Set(["parent"]), onHighlight() {} }));
  const block = html.match(/<ul class="session-detail-running".*?<\/ul>/s)?.[0] ?? "";
  assert.match(block, /<li title="pnpm run test --full --reason x"><span class="session-run-command">pnpm run test --full<\/span><span class="session-run-time">12s<\/span><\/li>/, block);
  assert.match(block, /session-run-time">1m<\/span>/, block);
  assert.match(block, /session-run-time">1h 5m<\/span>/, block);
  assert.ok(html.indexOf(">Worktrees<") < html.indexOf(">Running<") && html.indexOf(">Running<") < html.indexOf(">Files<"));
  assert.doesNotMatch(renderToStaticMarkup(createElement(SessionsList, { rows: [{ ...row, children: [], running: [] }], expanded: new Set(["parent"]), onHighlight() {} })), />Running</);
  assert.equal(isSessionRows([{ ...row, children: [], running: undefined }]), false, "rows kept by an older build are not drawn");
});

test("7.10 the Live tab lists only the sessions at work, with no idle row; the header still counts them; with only idle ones it says where they are", () => {
  const idle: SessionRow = { ...row, id: "quiet", label: "Quiet one", children: [], idle: true };
  const html = renderToStaticMarkup(createElement(SessionsList, { rows: [{ ...row, children: [] }, idle], onHighlight() {} }));
  assert.match(html, /data-session-id="parent"/);
  assert.doesNotMatch(html, /data-session-id="quiet"|session-idle-fold|\d idle</);
  assert.match(html, /class="sessions-count"[^>]*>1</, "the header counts the one at work");
  const only = renderToStaticMarkup(createElement(SessionsList, { rows: [idle, { ...idle, id: "quiet2" }], onHighlight() {} }));
  assert.match(only, /No sessions at work/);
  assert.match(only, /<button type="button" class="sessions-idle-elsewhere"[^>]*>2 idle in History<\/button>/);
  assert.doesNotMatch(only, /No running sessions|data-session-id="quiet"/);
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

test("7.17 the header carries an Expand control beside its caret that fills the forest pane, and Restore that returns it to at most 40%; the size is kept per project, a missing or foreign value reads as not expanded, and a collapsed strip shows only its header", () => {
  const strip = { rows: [{ ...row, children: [] }], onHighlight() {} };
  const usual = renderToStaticMarkup(createElement(SessionsList, strip));
  assert.doesNotMatch(usual, /<aside[^>]*data-size=/, "the usual height by default");
  assert.match(usual, /<button type="button" class="sessions-size" aria-pressed="false" aria-label="Expand sessions to fill the pane"[^>]*>Expand<\/button><span class="sessions-caret"/);
  const full = renderToStaticMarkup(createElement(SessionsList, { ...strip, full: true }));
  assert.match(full, /<aside[^>]*data-size="full"/);
  assert.match(full, /class="sessions-size" aria-pressed="true" aria-label="Restore sessions to their usual height"[^>]*>Restore</);
  const history = renderToStaticMarkup(createElement(SessionsList, { ...strip, full: true, tab: "history" }));
  assert.match(history, /<aside[^>]*data-size="full"/, "History uses the height too");
  const shut = renderToStaticMarkup(createElement(SessionsList, { ...strip, full: true, open: false }));
  assert.doesNotMatch(shut, /data-size=|sessions-size/, "collapsed, only the header: no size and no size control");

  const store = new Map<string, string>();
  const storage = { getItem: (key: string) => store.get(key) ?? null, setItem: (key: string, value: string) => void store.set(key, value) };
  assert.equal(keptStripFull("demo", storage).read(), false, "nothing kept: the usual height");
  keptStripFull("demo", storage).write(true);
  assert.equal(keptStripFull("demo", storage).read(), true, "an expanded strip stays expanded next start");
  assert.equal(keptStripFull("other", storage).read(), false, "kept per project");
  store.set("storytree.forest.sessions-size.v1:demo", "\"huge\"");
  assert.equal(keptStripFull("demo", storage).read(), false, "a foreign value is ignored");
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

test("7.21 History reads the repository cut-over its rows say old pull requests by once, and again only when a change touches it; none recorded, or no way to ask, is null", async () => {
  const asked: string[] = [];
  const cutover = { at: "2026-10-20T00:00:00Z", repository: "storytree-ai/storytree", before: "storytree-ai/storytree-history" };
  const reads = { prCutover: async (project: string) => { asked.push(project); return cutover; } };
  const change = (type: string) => ({ type });
  assert.equal(await cutoverAfter(reads, "p", { changes: [] }, undefined), cutover, "the first reading asks");
  assert.equal(await cutoverAfter(reads, "p", { changes: [change("increment")] }, null), null, "no change to it keeps the last");
  assert.equal(await cutoverAfter(reads, "p", { changes: [change("prCutover")] }, null), cutover);
  assert.deepEqual(asked, ["p", "p"]);
  assert.equal(await cutoverAfter({ prCutover: async () => undefined }, "p", { changes: [] }, undefined), null);
  assert.equal(await cutoverAfter({}, "p", { changes: [] }, undefined), null);
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

test("7.8 a failed ask for expanded rows' windows answers each as unreadable and writes the failure to the console, so app.log", async (t) => {
  const logged = t.mock.method(console, "error", () => {});
  const heard = await new Promise<ReadonlyMap<string, unknown>>(resolve =>
    windowsReader(async () => { throw new Error("the window was not read"); }, resolve).ask(["a"]));
  assert.deepEqual(heard.get("a"), { absent: "the window could not be read" });
  assert.deepEqual(logged.mock.calls.map(call => [call.arguments[0], (call.arguments[1] as Error).message]),
    [["forest sessions list: the expanded rows' windows could not be read", "the window was not read"]]);
});

test("7.33 a failed read of the rows' context readings or of the idle-after and leave-after settings keeps what was read last and is written to the console", async (t) => {
  const logged = t.mock.method(console, "error", () => {});
  const heard: unknown[] = [];
  const hear = { idleAfterMs: (ms: number) => heard.push(["idle", ms]), leaveAfterMs: (ms: number) => heard.push(["leave", ms]), readings: (answers: unknown) => heard.push(answers) };
  await readContext({ idleAfterMs: async () => 1, leaveAfterMs: async () => 2, contextReadings: async () => [{ session: "a", absent: "none" }] }, "p", ["a"], hear);
  assert.deepEqual(heard, [["idle", 1], ["leave", 2], [{ session: "a", absent: "none" }]], "what is read is heard");
  assert.equal(logged.mock.callCount(), 0);
  heard.length = 0;
  await readContext({}, "p", ["a"], hear);
  assert.deepEqual(heard, [], "reads that are not offered are not asked");
  await readContext({
    idleAfterMs: async () => { throw new Error("no idle-after"); },
    leaveAfterMs: async () => { throw new Error("no leave-after"); },
    contextReadings: async () => { throw new Error("no readings"); },
  }, "p", ["a"], hear);
  assert.deepEqual(heard, [], "nothing read replaces what stands");
  assert.deepEqual(logged.mock.calls.map(call => [call.arguments[0], (call.arguments[1] as Error).message]).sort(), [
    ["forest sessions list: the context readings could not be read", "no readings"],
    ["forest sessions list: the idle-after setting could not be read", "no idle-after"],
    ["forest sessions list: the leave-after setting could not be read", "no leave-after"],
  ]);
});

test("7.33 · a library outage across several polls of the context readings is written once, with no error, and its recovery once", async (t) => {
  const logged = t.mock.method(console, "error", () => {});
  const hear = { idleAfterMs: () => {}, leaveAfterMs: () => {}, readings: () => {} };
  const unreachable = async (): Promise<never> => { throw new Error(`${LIBRARY_UNREACHABLE}: connect EHOSTUNREACH`); };
  const outage = sessionsOutage();
  for (let poll = 0; poll < 3; poll++) await readContext({ idleAfterMs: unreachable, leaveAfterMs: unreachable, contextReadings: unreachable }, "p", ["a"], hear, outage);
  await readContext({ idleAfterMs: async () => 1, leaveAfterMs: async () => 2, contextReadings: async () => [] }, "p", ["a"], hear, outage);
  assert.deepEqual(logged.mock.calls.map(call => call.arguments), [
    [`forest sessions list: the idle-after setting could not be read: ${LIBRARY_UNREACHABLE}: connect EHOSTUNREACH Said once until it answers again.`],
    ["forest sessions list: the library answers again"],
  ]);
});

/** A time on 3 October 2026, local, as History's days are. */
const local = (hour: number, minute: number): string => new Date(2026, 9, 3, hour, minute).toISOString();
const past: HistoryRow[] = [
  { id: "lander", label: "Build signup", agent: "Claude Code", startedAt: local(9, 0), lastSeenAt: local(10, 30), ranMs: 90 * 60_000,
    stories: [{ id: "s1", title: "Sign up" }], outcome: { kind: "landed", prs: ["#12", "#13"] } },
  { id: "holder", label: "Choose the tabs", agent: "Codex", startedAt: local(13, 0), lastSeenAt: local(14, 0), ranMs: 60 * 60_000,
    stories: [], outcome: { kind: "held", question: "Which tab opens first?" } },
  { id: "quiet", label: "Tidy the docs", agent: "Codex", startedAt: local(15, 0), lastSeenAt: local(15, 20), ranMs: 20 * 60_000,
    stories: [], outcome: { kind: "no-close-out" } },
];

test("7.21 the History tab lists past sessions, each row led by how it ended, under a range bar of presets and a custom from–to", () => {
  const html = renderToStaticMarkup(createElement(SessionsList, { rows: [row], history: past, tab: "history", range: { preset: "yesterday" },
    now: new Date(2026, 9, 4, 12), onHighlight() {} }));
  assert.match(html, /role="tab" aria-selected="false"[^>]*>Live</);
  assert.match(html, /role="tab" aria-selected="true"[^>]*>History</);
  assert.doesNotMatch(html, /data-session-id="parent"/, "the live rows are not drawn under History");
  assert.deepEqual([...html.matchAll(/aria-pressed="(\w+)"[^>]*>(Today|Yesterday|7 days)</g)].map(m => [m[2], m[1]]),
    [["Today", "false"], ["Yesterday", "true"], ["7 days", "false"]]);
  assert.match(html, /type="date"[^>]*value="2026-10-03"[^>]*>.*type="date"[^>]*value="2026-10-03"/, "the custom days show the range chosen");
  const rows = [...html.matchAll(/class="history-row" data-session-id="(\w+)".*?<span class="history-outcome" data-outcome="([\w-]+)"[^>]*>([^<]*)</g)];
  assert.deepEqual(rows.map(m => [m[1], m[2], m[3]]), [["lander", "landed", "Landed #12 · #13"], ["holder", "held", "Held: Which tab opens first?"],
    ["quiet", "no-close-out", "Ended without a close-out"]], "outcome leads each row");
  assert.match(html, /Build signup<\/span><span class="history-agent">Claude Code<\/span><span class="history-ran">1h 30m<\/span><span class="history-stories">Sign up<\/span>/);
  const none = renderToStaticMarkup(createElement(SessionsList, { rows: [row], history: [], tab: "history", range: { preset: "today" }, onHighlight() {} }));
  assert.match(none, /No sessions ended in this range/);
});

test("7.22 the Live tab is the list as it was; the tab is kept per project, Live when nothing or a foreign value is kept", () => {
  const live = renderToStaticMarkup(createElement(SessionsList, { rows: [row], history: past, onHighlight() {} }));
  assert.match(live, /role="tab" aria-selected="true"[^>]*>Live</);
  assert.match(live, /data-session-id="parent"/);
  assert.doesNotMatch(live, /history-row/);
  const store = new Map<string, string>();
  const storage = { getItem: (key: string) => store.get(key) ?? null, setItem: (key: string, value: string) => void store.set(key, value) };
  assert.equal(keptTab("demo", storage).read(), "live");
  keptTab("demo", storage).write("history");
  assert.equal(keptTab("demo", storage).read(), "history");
  assert.equal(keptTab("other", storage).read(), "live", "kept per project");
  store.set("storytree.forest.sessions-tab.v1:demo", "\"archive\"");
  assert.equal(keptTab("demo", storage).read(), "live", "a foreign value is ignored");
});

test("7.23 the selected history row is marked as a selected live row is", () => {
  const html = renderToStaticMarkup(createElement(SessionsList, { rows: [row], history: past, tab: "history", range: { preset: "yesterday" },
    now: new Date(2026, 9, 4, 12), selected: "holder", onHighlight() {} }));
  assert.match(html, /class="history-row" data-session-id="holder" data-selected="true"/);
  assert.doesNotMatch(html, /data-session-id="lander" data-selected/);
});

const quiet: SessionRow = { ...row, id: "idler", label: "Waiting on review", agent: "Claude Code", state: "waiting", idle: true, stories: ["signup"], children: [
  { ...row.children[0]!, id: "idle-child" }] };

test("7.21 History lists every idle session still listed first, whatever the range, each led by idle and keeping its live row's labels and expander; then the sessions that left in the range", () => {
  const html = renderToStaticMarkup(createElement(SessionsList, { rows: [{ ...row, children: [] }, quiet], history: past, tab: "history", range: { preset: "today" },
    now: new Date(2026, 9, 4, 12), expanded: new Set(["idler"]), onHighlight() {} }));
  assert.doesNotMatch(html, /data-session-id="parent"/, "a session at work stays on Live");
  assert.match(html, /<span class="history-outcome" data-outcome="idle"[^>]*>idle<\/span>/);
  assert.match(html, /class="session-children-toggle" aria-expanded="true" aria-label="Hide detail and 1 children of Waiting on review"/, "its expander comes with it");
  assert.match(html, /data-session-id="idle-child"/, "expanded, its children show");
  assert.match(html, /class="session-detail"/);
  assert.match(html, /120K<\/span>/, "its context total comes with it");
  assert.match(html, /No sessions ended in this range/, "today holds no ended session, yet the idle one is listed");
  const week = renderToStaticMarkup(createElement(SessionsList, { rows: [quiet], history: past, tab: "history", range: { preset: "week" },
    now: new Date(2026, 9, 4, 12), onHighlight() {} }));
  assert.deepEqual([...week.matchAll(/data-session-id="(\w+)"/g)].map(m => m[1]), ["idler", "lander", "holder", "quiet"], "idle first, then the ended ones");
});

test("7.28 History's search keeps the rows, idle and ended, whose name, agent, outcome line and stories hold every word typed, whatever the case; emptied every row returns; none left says so", () => {
  const props = { rows: [quiet], history: past, tab: "history" as const, range: { preset: "week" } as const, now: new Date(2026, 9, 4, 12),
    storyTitles: new Map([["signup", "Sign up"]]), onHighlight() {} };
  const ids = (search: string): string[] => [...renderToStaticMarkup(createElement(SessionsList, { ...props, search }))
    .matchAll(/data-session-id="(\w+)"/g)].map(m => m[1]!);
  assert.match(renderToStaticMarkup(createElement(SessionsList, { ...props, search: "" })), /<input type="search"[^>]*aria-label="Search sessions"/);
  assert.deepEqual(ids(""), ["idler", "lander", "holder", "quiet"]);
  assert.deepEqual(ids("#13"), ["lander"], "the outcome line's pull requests");
  assert.deepEqual(ids("TAB which"), ["holder"], "every word, in any order and case, the question included");
  assert.deepEqual(ids("idle claude"), ["idler"], "an idle row's word and agent");
  assert.deepEqual(ids("sign up"), ["idler", "lander"], "stories by their titles");
  assert.deepEqual(ids("codex docs"), ["quiet"]);
  const none = renderToStaticMarkup(createElement(SessionsList, { ...props, search: "nothing like it" }));
  assert.match(none, /No sessions match the search/);
  assert.doesNotMatch(none, /history-row|No sessions ended in this range/);
});

test("7.33 a failed refresh names its step with the error on hover and is logged once per step and message; a lone failure raises no banner, three within 30 s do, and it clears on recovery or once they age out", () => {
  const logged: string[] = [];
  const failures = refreshFailures(line => logged.push(line));
  failures.failed(new StepFailed("reading the arcs", new Error("connection reset")), 0);
  assert.equal(failures.banner(0), undefined, "one failure the next ask may recover is no banner");
  failures.failed(new StepFailed("reading the arcs", new Error("connection reset")), 2_000);
  failures.failed(new StepFailed("reading the arcs", new Error("connection reset")), 4_000);
  assert.deepEqual(failures.banner(4_000), { text: "Sessions could not be refreshed: reading the arcs failed. Retrying…", detail: "connection reset" });
  assert.equal(logged.length, 1, "the same step and message is logged once");
  assert.match(logged[0]!, /^storytree sessions list: reading the arcs failed: Error: connection reset\n\s+at /, "with its stack");
  assert.equal(failures.banner(4_000 + FAILURES_WINDOW_MS), undefined, "aged out");
  failures.failed(new Error("fetch failed"), 10_000);
  assert.equal(failures.banner(10_000)?.text, `Sessions could not be refreshed: ${NEWS_STEP} failed. Retrying…`, "an unnamed failure is the page reading's");
  assert.equal(logged.length, 2);
  failures.recovered();
  assert.equal(failures.banner(10_000), undefined, "news handled again clears it");
  failures.failed(new StepFailed("reading the arcs", new Error("connection reset")), 11_000);
  assert.equal(logged.length, 3, "after a recovery the same failure is logged again");
  const html = renderToStaticMarkup(createElement(SessionsList, { rows: [row], onHighlight() {}, error: "Sessions could not be refreshed: drawing the rows failed. Retrying…", errorDetail: "x is undefined" }));
  assert.match(html, /<p role="status" title="x is undefined">Sessions could not be refreshed: drawing the rows failed\. Retrying…<\/p>/);
  assert.match(html, /Build &lt;signup&gt;/, "the rows last drawn stay under the banner");
});

test("7.34 · when the persisting failures say the library cannot be reached, the banner says so plainly rather than naming a failed read, and clears once news is handled again", () => {
  const failures = refreshFailures(() => {});
  const outage = new Error(`${LIBRARY_UNREACHABLE}: Storytree could not reach the library at postgres://box:5432/.`);
  for (const at of [0, 2_000, 4_000]) failures.failed(new StepFailed(NEWS_STEP, outage), at);
  assert.deepEqual(failures.banner(4_000), { text: "The library cannot be reached. Retrying…", detail: outage.message });
  failures.recovered();
  assert.equal(failures.banner(4_000), undefined);
});
