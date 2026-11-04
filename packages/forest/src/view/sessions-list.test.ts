/** Visible rows, safe text and the context slot before composition arrives. */
import { createElement } from "react";
import assert from "node:assert/strict";
import { test } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { arcsAfter, FAILURES_WINDOW_MS, isSessionRows, NEWS_STEP, readContext, refreshFailures, sessionsOutage, SessionsList, StepFailed } from "./sessions-list.js";
import type { ArcView } from "@storytree/library";
import { LIBRARY_UNREACHABLE } from "@storytree/library/connection-error";
import { sessionColour } from "../agent-claims/agent-claims.js";
import type { SessionRow } from "../sessions-list/sessions-list.js";

const row: SessionRow = { id: "parent", label: "Build <signup>", agent: "Codex", state: "waiting",
  idle: false, lastSeenAt: "2026-09-28T12:00:00Z", totalTokens: 120_000, stories: ["signup"], worktrees: [], description: [], children: [
    { id: "child", label: "Read the library", agent: "Subagent", state: "observed", idle: false, lastSeenAt: "2026-09-28T12:00:00Z",
      totalTokens: undefined, stories: [], worktrees: [], description: [], children: [] },
  ] };

test("7.1–7.5 rows start with their detail closed; a running row's children show beneath it without a click, with no \"+N\"; a row the user opened shows its detail before its children; rows show safe words and available total beside its bar", () => {
  const fresh = renderToStaticMarkup(createElement(SessionsList, { rows: [row], onHighlight() {} }));
  assert.match(fresh, /Build &lt;signup&gt;/);
  assert.match(fresh, /aria-expanded="false"/);
  assert.doesNotMatch(fresh, /session-detail/);
  assert.match(fresh, /data-session-id="child"/, "a running parent's child shows without a click");
  assert.doesNotMatch(fresh, /class="session-children"/, "no count while the children show");
  assert.match(fresh, /aria-label="Show detail of Build &lt;signup&gt;"/, "the expander opens only the row's own detail");
  const html = renderToStaticMarkup(createElement(SessionsList, { rows: [row], expanded: new Set(["parent"]), onHighlight() {} }));
  assert.match(html, /aria-expanded="true"/);
  assert.match(html, /class="session-detail"/);
  assert.ok(html.indexOf("session-detail") < html.indexOf('data-session-id="child"'), "children follow the detail");
  assert.match(html, /class="session-context-slot" title="120,000 tokens"/);
  assert.match(html, /120,000 context tokens/);
  assert.match(html, />120K<\/span>/);
  const unavailable = renderToStaticMarkup(createElement(SessionsList, { rows: [{ ...row, totalTokens: undefined }], onHighlight() {} }));
  assert.match(unavailable, /Context total unavailable">—/);
});

test("7.2 a finished child of a running parent stays listed, greyed; an idle parent folds its whole tree behind its \"+N\", which its expander opens", () => {
  const finished: SessionRow = { ...row, id: "lane", label: "Supervised lane", state: "waiting", idle: true, children: [] };
  const running: SessionRow = { ...row, state: "working", children: [row.children[0]!, finished] };
  const live = renderToStaticMarkup(createElement(SessionsList, { rows: [running], onHighlight() {} }));
  assert.match(live, /data-session-id="lane"[^>]*data-done="true"/, "the finished child is greyed");
  assert.doesNotMatch(live, /data-session-id="child"[^>]*data-done/, "a child not known to be finished is not");
  assert.doesNotMatch(live, /data-session-id="parent"[^>]*data-done/);
  const idle: SessionRow = { ...running, state: "waiting", idle: true, children: [{ ...row.children[0]!, state: "waiting", idle: true }, finished] };
  const folded = renderToStaticMarkup(createElement(SessionsList, { rows: [idle], onHighlight() {} }));
  assert.match(folded, /data-session-id="parent"/);
  assert.doesNotMatch(folded, /data-session-id="(child|lane)"/, "the ended parent's tree folds into it");
  assert.match(folded, /class="session-children"[^>]*>\+2<\/span>/);
  assert.match(folded, /aria-label="Show detail and 2 children of Build &lt;signup&gt;"/);
  const opened = renderToStaticMarkup(createElement(SessionsList, { rows: [idle], expanded: new Set(["parent"]), onHighlight() {} }));
  assert.match(opened, /data-session-id="child"/);
  assert.match(opened, /data-session-id="lane"/);
  assert.doesNotMatch(opened, /class="session-children"/, "opened, the children show and the count goes");
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

test("7.8 one expander per row; expanded, a row lists its labelled worktrees by folder name (full path on hover) and then its children, with no Running or Files block", () => {
  const busy: SessionRow = { ...row, worktrees: [{ path: "/home/me/code/app/.claude/worktrees/one", branches: [] }, { path: "/home/me/code/app/.claude/worktrees/two", branches: [] }] };
  const folded = renderToStaticMarkup(createElement(SessionsList, { rows: [busy, { ...row, id: "lone", children: [] }], onHighlight() {} }));
  assert.equal(folded.match(/<button[^>]*session-children-toggle/g)?.length, 3, "every row has one expander, a childless one and a running parent's child too");
  assert.doesNotMatch(folded, /session-detail/);
  const html = renderToStaticMarkup(createElement(SessionsList, { rows: [busy], expanded: new Set(["parent"]), onHighlight() {} }));
  const parentRow = html.match(/data-session-id="parent".*?<\/div>/s)?.[0] ?? "";
  assert.equal(parentRow.match(/<button/g)?.length, 1, "the children do not bring a second control to the row");
  assert.match(parentRow, /^data-session-id="parent"[^>]*><button[^>]*session-children-toggle/, "the expander opens the row");
  assert.match(html, /aria-expanded="true"/);
  const detail = html.match(/class="session-detail".*?<\/div>/s)?.[0] ?? "";
  assert.ok(detail.indexOf(">Worktrees<") < detail.indexOf(">one<") && detail.indexOf(">one<") < detail.indexOf(">two<"), detail);
  assert.deepEqual([...detail.matchAll(/class="session-detail-label">([^<]*)</g)].map(m => m[1]), ["Worktrees"], "its only block is its worktrees");
  assert.match(detail, /<li title="\/home\/me\/code\/app\/\.claude\/worktrees\/one">one<\/li>/, "a worktree by its folder's name, its full path on hover");
  assert.ok(html.indexOf("session-detail") < html.indexOf('data-session-id="child"'), "children follow the detail");
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

test("7.9 the list prints no prose about a session: a row with a close-out why shows none of it, and the header count names no such need", () => {
  const html = renderToStaticMarkup(createElement(SessionsList, { rows: [{ ...row, children: [], needsYouWhy: "says safe, but fix-login is unmerged" } as SessionRow], onHighlight() {} }));
  assert.match(html, /Build &lt;signup&gt;/);
  assert.doesNotMatch(html, /needs you|unmerged|says safe|fix-login|needing/i);
});

test("7.9 every row leads with a status dot read from its state alone: working, waiting for you within the idle-after time, or idle; a parent whose child works is working; an observed subagent's dot says its state is unavailable", () => {
  const dot = (html: string, id: string) => html.match(new RegExp(`data-session-id="${id}"[^>]*>.*?<span class="session-dot" data-dot="([a-z]+)" title="([^"]*)"`))?.slice(1);
  const working: SessionRow = { ...row, id: "w", state: "working", children: [] };
  const live = renderToStaticMarkup(createElement(SessionsList, { rows: [working, { ...row, id: "q", children: [] },
    { ...row, id: "p", idle: false, state: "waiting", children: [{ ...row.children[0]!, id: "c", state: "working" }] }, row], expanded: new Set(["parent"]), onHighlight() {} }));
  assert.deepEqual(dot(live, "w"), ["working", "Working"]);
  assert.deepEqual(dot(live, "q"), ["waiting", "Waiting for you"]);
  assert.deepEqual(dot(live, "p"), ["working", "Working"], "a parent at work through its child");
  assert.deepEqual(dot(live, "child"), ["idle", "State unavailable"]);
  assert.ok(live.indexOf('class="session-dot"') < live.indexOf('class="session-colour"') && live.indexOf('class="session-colour"') < live.indexOf('class="session-label"'), "dot, colour, then name");
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

test("7.10 the list draws the sessions at work in order and its header counts them; with none listed it says so", () => {
  const html = renderToStaticMarkup(createElement(SessionsList, { rows: [{ ...row, id: "first", children: [] }, { ...row, children: [] }], onHighlight() {} }));
  assert.deepEqual([...html.matchAll(/data-session-id="(\w+)"/g)].map(m => m[1]), ["first", "parent"]);
  assert.match(html, /class="sessions-count"[^>]*>2</, "the header counts every listed session");
  assert.match(renderToStaticMarkup(createElement(SessionsList, { rows: [], onHighlight() {} })), /No running sessions/);
});

test("7.17 · the list fills its rail tab: its header names it, counts it and carries its legend, and nothing on it hides the rows or sizes the list", () => {
  const list = renderToStaticMarkup(createElement(SessionsList, { rows: [{ ...row, children: [] }], onHighlight() {} }));
  assert.match(list, /<header><span class="sessions-name">Sessions <span class="sessions-count"[^>]*>1<\/span><\/span><span class="session-legend"/);
  assert.match(list, /class="session-legend"/);
  assert.match(list, /<div id="sessions-body" class="sessions-body" data-surface-id="sessions"><ul>.*data-session-id="parent"/s);
  assert.doesNotMatch(list, /aria-expanded="(true|false)" aria-controls="sessions-body"|Expand|Restore|hidden=""/, "no collapse or size control, and the body is never hidden");
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
