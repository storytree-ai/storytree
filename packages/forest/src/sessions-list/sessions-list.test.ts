/** Running sessions: the forest's session-to-island reading. */
import assert from "node:assert/strict";
import { test } from "node:test";
import type { AnnotatedTree, ArcView, Line, NewLine } from "@storytree/library";
import { clickedSelection, listedRows, sessionRoster, sessionRows } from "./sessions-list.js";
import { sessionColour } from "../agent-claims/agent-claims.js";

const now = new Date("2026-09-28T12:00:00Z");
const health = { reported: { state: "not-checked" }, verified: { state: "not-checked" } } as const;
const tree: AnnotatedTree = { stories: ["one", "two"].map(id => ({ id, title: id, health,
  capabilities: [{ id: `cap-${id}`, title: id, dependsOn: [], proposed: true, status: "proposed" as const, contracts: [], health }] })), arcs: [] };
function log(...events: (Partial<Line> & NewLine)[]): Line[] {
  return events.map((event, index) => ({ project: "demo", seq: index + 1, at: now.toISOString(), ...event }));
}
const parent = { session: "parent", harness: "claude-code", source: "tool" } as const;
const child = { session: "child", harness: "codex", source: "hook" } as const;
const off = { session: "off", harness: "codex", source: "hook" } as const;
const claimed = (capability: string, reason: string): NewLine => ({ ...parent, kind: "claimed", capability, reason });
const arc = { arc: { id: "arc", fields: { title: "Build" } }, state: "active",
  increments: [{ id: "inc", fields: { title: "Finish signup", status: "active", capabilities: ["cap-two"] } }],
  questions: [{ id: "q", fields: { title: "Choose wording", lifecycle: "open" } }] } as ArcView;

test("one row per non-ended claiming session, plain idle, reason and held islands follow standing claims", () => {
  const lines = log(claimed("cap-one", "Build signup"), claimed("cap-two", "Build signup"),
    { ...off, kind: "claimed", increment: "tidy", reason: "", at: "2026-09-28T11:00:00Z" },
    { ...child, kind: "session-ended" },
    { session: "quiet", harness: "codex", source: "hook", kind: "session-started" });
  const rows = sessionRows(tree, lines, [], now);
  assert.deepEqual(rows.map(row => row.id), ["parent", "off", "quiet"], "every session that has not ended shows (ADR-0749 D1)");
  assert.equal(rows[0]!.label, "Build signup");
  assert.deepEqual(rows[0]!.stories, ["one", "two"]);
  assert.equal(rows[1]!.state, "waiting");
  assert.equal(rows[0]!.totalTokens, undefined, "an unavailable total is not zero");
  lines.push(...log({ ...parent, kind: "released", capability: "cap-one" }).map(line => ({ ...line, seq: 5 })));
  assert.deepEqual(sessionRows(tree, lines, [], now)[0]!.stories, ["two"]);
});

test("7.4 a row's islands come only from capabilities it claimed: an increment claim's capabilities list lights none (ADR-0923 D2)", () => {
  const lines = log({ ...off, kind: "claimed", increment: "inc", reason: "Finish signup" });
  assert.deepEqual(sessionRows(tree, lines, [arc], now)[0]!.stories, [], "the increment lists cap-two, but listing is not claiming");
  lines.push(...log({ ...off, kind: "claimed", capability: "cap-two", reason: "Finish signup" }).map(line => ({ ...line, seq: 2 })));
  assert.deepEqual(sessionRows(tree, lines, [arc], now)[0]!.stories, ["two"]);
});

test("explicit children nest once and pass their islands up; ending a parent promotes its living child", () => {
  const lines = log(claimed("cap-one", "Build signup"),
    { ...parent, kind: "subagent-started", subagent: "child", task: "Finish signup" },
    { ...child, kind: "claimed", capability: "cap-two", reason: "Finish signup" },
    { ...parent, kind: "subagent-started", subagent: "reader", task: "Read the library" });
  const [row] = sessionRows(tree, lines, [arc], now, new Map([["reader", { totalTokens: 123 }]]));
  assert.equal(row!.children.length, 2);
  assert.equal(row!.children[0]!.id, "child");
  assert.equal(row!.children[1]!.label, "Read the library");
  assert.equal(row!.children[1]!.totalTokens, 123, "observed subagents use the supplied reading too");
  assert.deepEqual(row!.stories, ["one", "two"]);
  lines.push({ ...parent, kind: "session-ended", project: "demo", seq: 5, at: now.toISOString() });
  assert.deepEqual(sessionRows(tree, lines, [arc], now).map(row => row.id), ["child"]);
});

test("7.2 a subagent whose end is recorded, before or after its start line, reads idle and stays listed under its parent; one with no end recorded stays observed", () => {
  const lines = log({ ...parent, kind: "prompt-submitted" },
    { ...parent, kind: "subagent-ended", subagent: "early" },
    { ...parent, kind: "subagent-started", subagent: "early", task: "Answered at once" },
    { ...parent, kind: "subagent-started", subagent: "late", task: "Ran in the background" },
    { ...parent, kind: "subagent-started", subagent: "busy", task: "Still reading" },
    { ...parent, kind: "subagent-ended", subagent: "late" });
  const [row] = sessionRows(tree, lines, [], now);
  assert.equal(row!.state, "working");
  assert.deepEqual(row!.children.map(({ id, state, idle }) => ({ id, state, idle })), [
    { id: "early", state: "ended", idle: true },
    { id: "late", state: "ended", idle: true },
    { id: "busy", state: "observed", idle: false },
  ]);
});

test("7.1 a session holding no claim still gets a plain row, named from the worktree it works in, with no off-plan label (ADR-0749 D1)", () => {
  const lines = log({ ...off, folder: "/home/me/code/site", kind: "file-edited", files: ["a.ts"] },
    { ...off, folder: "/home/me/code/site/.claude/worktrees/fix-login", kind: "command-run", command: "gh pr create --fill" });
  const [row] = sessionRows(tree, lines, [], now);
  assert.equal(row?.label, "Codex · fix-login");
  assert.deepEqual(row?.stories, []);
  assert.deepEqual(row?.worktrees.map(({ path }) => path), ["/home/me/code/site", "/home/me/code/site/.claude/worktrees/fix-login"], "a row shows every worktree its session works in (D2)");
  assert.deepEqual(row?.worktrees.map(({ state }) => state), [undefined, undefined], "on no branch, a worktree has no merge label");
});

test("7.14 an unclaimed row is named by its app's title; every row carries up to three lines describing it: the app's title where the name is not it, the held increment's objective, the app's latest status", () => {
  const described = (session: string, title: string, status?: string): NewLine =>
    ({ session: "reader", harness: "claude-code", source: "hook", kind: "session-described", of: session, app: "claude-desktop", title, ...(status === undefined ? {} : { status }) });
  const lines = log({ ...off, folder: "/home/me/code/storytree03", kind: "prompt-submitted" },
    { ...parent, kind: "claimed", increment: "inc", reason: "" },
    described("off", "Sessions list labelling and machine names, and a description on expand", "PR #309 awaiting CI"),
    described("parent", "Signup work"));
  const withObjective = structuredClone(arc);
  (withObjective.increments[0]!.fields as { objective?: string }).objective = "A visitor can sign up in one step";
  const rows = sessionRows(tree, lines, [withObjective], now);
  const byId = new Map(rows.map(row => [row.id, row]));
  assert.equal(byId.get("off")!.label, "Sessions list labelling and machine nam…", "held to the label limit");
  assert.deepEqual(byId.get("off")!.description, ["Sessions list labelling and machine names, and a description on expand", "PR #309 awaiting CI"]);
  assert.equal(byId.get("parent")!.label, "Finish signup", "a held increment still names a claimed row");
  assert.deepEqual(byId.get("parent")!.description, ["Signup work", "A visitor can sign up in one step"]);
  const plain = sessionRows(tree, log({ ...off, folder: "/home/me/code/site", kind: "prompt-submitted" }), [], now)[0]!;
  assert.deepEqual([plain.label, plain.description], ["Codex · site", []], "no app words, the place names it and nothing describes it");
});

test("7.18 a session that has named itself is listed by its own name, its latest, ahead of its claim reason and its app's title; until then the row reads as before", () => {
  const named = (title: string): NewLine => ({ ...off, kind: "session-named", title });
  const before = log({ ...off, folder: "/home/me/code/site", kind: "prompt-submitted" });
  assert.equal(sessionRows(tree, before, [], now)[0]!.label, "Codex · site");
  const lines = log({ ...off, folder: "/home/me/code/site", kind: "prompt-submitted" }, named("Reading the plan"),
    { ...off, kind: "claimed", increment: "inc", reason: "Finish signup" }, named("Building the signup form"),
    { session: "reader", harness: "claude-code", source: "hook", kind: "session-described", of: "off", app: "claude-desktop", title: "Help me with signup" });
  assert.equal(sessionRows(tree, lines, [arc], now)[0]!.label, "Building the signup form");
});

test("7.35 a row named by its claim's reason shows one of 40 characters or fewer whole, and cuts a longer one at a word boundary to fit 40, ending in an ellipsis", () => {
  const reasoned = (reason: string): string => sessionRows(tree, log({ ...off, kind: "claimed", increment: "tidy", reason }), [], now)[0]!.label;
  const forty = "Claims take a reason of any length, kept";
  assert.equal(forty.length, 40);
  assert.equal(reasoned(forty), forty, "40 characters is shown whole");
  const cut = reasoned("Claims take a reason of any length; the session name is its first 40 characters");
  assert.equal(cut, "Claims take a reason of any length; the…");
  assert.ok([...cut].length <= 40, "the cut reason fits 40 with its ellipsis");
  assert.equal(reasoned("x".repeat(60)), `${"x".repeat(39)}…`, "a reason with no word boundary in reach is cut at 39 characters");
});

test("7.13 each row names the machine its session runs on only when the listed sessions span more than one machine", () => {
  const lines = log({ ...parent, kind: "session-started", machine: "laptop" }, { ...off, kind: "session-started", machine: "mint" },
    { session: "quiet", harness: "codex", source: "hook", kind: "session-started" });
  assert.deepEqual(sessionRows(tree, lines, [], now).map(row => row.machine), ["laptop", "mint", undefined]);
  const one = log({ ...parent, kind: "session-started", machine: "laptop" }, { ...off, kind: "session-started", machine: "laptop" });
  assert.deepEqual(sessionRows(tree, one, [], now).map(row => row.machine), [undefined, undefined], "one machine is not worth naming");
  const idleElsewhere = log({ ...parent, kind: "session-started", machine: "laptop" },
    { ...off, kind: "session-started", machine: "mint", at: "2026-09-28T11:15:00Z" });
  assert.deepEqual(listedRows(sessionRows(tree, idleElsewhere, [], now)).map(row => [row.id, row.machine]), [["parent", undefined]],
    "an idle session on another machine is not listed, so the list spans one machine");
});

test("a session whose hooks report no turns is judged by the idle-after setting the list is given, not a fixed 30 minutes", () => {
  const lines = log({ ...off, kind: "claimed", increment: "tidy", reason: "Tidy", at: "2026-09-28T11:45:00Z" });
  assert.equal(sessionRows(tree, lines, [], now)[0]?.state, "working", "15 minutes quiet is working at the 30-minute default");
  assert.equal(sessionRows(tree, lines, [], now, new Map(), 10 * 60 * 1000)[0]?.state, "waiting", "and waiting past a 10-minute setting");
});

test("a session that stopped reporting (gone) is hidden like an ended one, even holding a claim", () => {
  const lines = log({ ...off, kind: "claimed", increment: "tidy", reason: "Tidy", at: "2026-09-27T20:00:00Z" },
    { ...parent, kind: "claimed", capability: "cap-one", reason: "Build signup" });
  assert.deepEqual(sessionRows(tree, lines, [], now).map(row => row.id), ["parent"], "16 hours silent: gone");
});

test("supplied supervision and totals use a view seam without parsing transcripts; missing parents and cycles keep rows reachable", () => {
  const lines = log(claimed("cap-one", "Build signup"), { ...child, kind: "claimed", increment: "inc", reason: "Finish signup" });
  const details = new Map([["child", { parentSession: "parent", totalTokens: 120_000 }]]);
  const [row] = sessionRows(tree, lines, [], now, details);
  assert.equal(row!.children[0]!.totalTokens, 120_000);
  details.set("parent", { parentSession: "child", totalTokens: 80_000 });
  const walk = (rows: ReturnType<typeof sessionRows>): string[] => rows.flatMap(row => [row.id, ...walk(row.children)]);
  assert.deepEqual(walk(sessionRows(tree, lines, [], now, details)).sort(), ["child", "parent"]);
});

test("7.7 the knowledge core's roster is exactly the listed rows, each with its children, in the row's own colour (ADR-0738)", () => {
  const lines = log(claimed("cap-one", "Build signup"),
    { ...parent, kind: "subagent-started", subagent: "child", task: "Finish signup" },
    { ...off, kind: "claimed", increment: "tidy", reason: "Tidy" },
    { session: "quiet", harness: "codex", source: "hook", kind: "session-started" });
  const roster = sessionRoster(sessionRows(tree, lines, [], now));
  assert.deepEqual(roster, [
    { session: "parent", label: "Build signup", colour: sessionColour("parent"), members: ["parent", "child"] },
    { session: "off", label: "Tidy", colour: sessionColour("off"), members: ["off"] },
    { session: "quiet", label: "Codex", colour: sessionColour("quiet"), members: ["quiet"] },
  ]);
});

test("7.7 clicking a row selects its session, a child's row its parent, and clicking the selected row again clears the selection", () => {
  const lines = log(claimed("cap-one", "Build signup"),
    { ...parent, kind: "subagent-started", subagent: "child", task: "Finish signup" },
    { ...off, kind: "claimed", increment: "tidy", reason: "Tidy" });
  const rows = sessionRows(tree, lines, [], now);
  assert.equal(clickedSelection(rows, "off", undefined), "off", "a row selects its own session");
  assert.equal(clickedSelection(rows, "child", undefined), "parent", "a child's row selects its parent");
  assert.equal(clickedSelection(rows, "child", "off"), "parent", "and moves the one selection off another session");
  assert.equal(clickedSelection(rows, "parent", "parent"), undefined, "the selected row clicked again clears the selection");
  assert.equal(clickedSelection(rows, "child", "parent"), undefined, "so does its child's row");
});

test("7.10 only the sessions at work are listed: working, waiting for you within the idle-after time, or a parent whose child works; an idle one is not, whatever keeps Session management listing it, by the idle-after and leave-after it is given", () => {
  const minutes = (n: number) => new Date(now.getTime() - n * 60_000).toISOString();
  const hook = (session: string) => ({ session, harness: "claude-code", source: "hook" }) as const;
  const lines = log(
    { ...hook("busy"), kind: "prompt-submitted", at: minutes(50) },
    { ...hook("asking"), kind: "prompt-submitted", at: minutes(12) }, { ...hook("asking"), kind: "turn-ended", at: minutes(10) },
    { ...hook("quiet"), kind: "prompt-submitted", at: minutes(50) }, { ...hook("quiet"), kind: "turn-ended", at: minutes(45) },
    { ...hook("holding"), branch: "fix-login", kind: "file-edited", files: ["a.ts"], at: minutes(20) }, { ...hook("holding"), kind: "session-ended", at: minutes(15) },
    { ...hook("held"), kind: "prompt-submitted", at: minutes(50) }, { ...hook("held"), kind: "turn-ended", at: minutes(45) },
    { ...hook("held"), branch: "main", kind: "closed-out", safe: false, why: "waiting on the owner's look", running: 0, at: minutes(44) },
    { ...hook("lead"), kind: "prompt-submitted", at: minutes(50) }, { ...hook("lead"), kind: "turn-ended", at: minutes(45) },
    { ...hook("lane"), kind: "prompt-submitted", at: minutes(5) });
  const details = new Map([["lane", { parentSession: "lead" }]]);
  const rows = listedRows(sessionRows(tree, lines, [], now, details));
  assert.deepEqual(rows.map(row => row.id), ["busy", "asking", "lead"],
    "quiet past the idle-after, ended holding unmerged work, or closed out not safe: none is listed");
  assert.deepEqual(rows[2]!.children.map(child => child.id), ["lane"], "a quiet parent is at work through its working child");
  assert.deepEqual(listedRows(sessionRows(tree, lines, [], now, details, 60 * 60_000)).map(row => row.id), ["busy", "asking", "quiet", "held", "lead"],
    "a one-hour idle-after keeps the 45-minute-quiet sessions at work; an ended one is never");
  const late = log({ ...hook("late"), kind: "prompt-submitted", at: minutes(125) }, { ...hook("late"), kind: "turn-ended", at: minutes(120) });
  const hours3 = 3 * 60 * 60_000;
  assert.deepEqual(listedRows(sessionRows(tree, late, [], now, new Map(), hours3)).map(row => row.id), [], "Session management's 1-hour leave-after still lets it go");
  assert.deepEqual(listedRows(sessionRows(tree, late, [], now, new Map(), hours3, hours3)).map(row => row.id), ["late"]);
});

test("7.15 each worktree in a row's detail is labelled unmerged or merged by the branch its session recorded there and whether that branch still holds open work; the main line, or no branch, carries no label; a branch recorded with no folder is folded under the folder last worked in, and none is dropped", () => {
  const hook = { session: "work", harness: "claude-code", source: "hook" } as const;
  const site = "/w/site";
  const merged = "/w/site/.claude/worktrees/merged-one";
  const open = "/w/site/.claude/worktrees/open-one";
  const lines = log(
    { ...hook, folder: site, branch: "main", kind: "session-started", how: "startup" },
    { ...hook, folder: merged, branch: "merged-one", kind: "file-edited", files: ["a.ts"] },
    { ...hook, folder: open, branch: "open-one", kind: "file-edited", files: ["b.ts"] },
    { ...hook, source: "tool", branch: "stray", kind: "claimed", increment: "tidy", reason: "tidy" },
    { session: "looker", harness: "claude-code", source: "hook", kind: "branch-state", of: "merged-one", open: false, how: "merged", pr: 12 },
    { ...hook, folder: open, branch: "open-one", kind: "turn-ended" });
  const [row] = sessionRows(tree, lines, [], now);
  assert.deepEqual(row?.worktrees, [
    { path: site, branches: [] },
    { path: merged, branches: ["merged-one"], state: "merged" },
    { path: open, branches: ["open-one", "stray"], state: "unmerged" },
  ]);
  const unplaced = sessionRows(tree, log({ session: "solo", harness: "claude-code", source: "tool", branch: "lonely", kind: "claimed", increment: "x", reason: "x" }), [], now)[0];
  assert.deepEqual(unplaced?.worktrees, [{ path: "lonely", branches: ["lonely"], state: "unmerged" }], "a branch with no folder to fold under is still listed");
});

test("7.15 a worktree whose open branch has a pull request is labelled by it instead of unmerged: in CI while its checks run, failing, in the merge queue, a draft, or its number alone; merged and no pull request keep their labels", () => {
  const hook = { session: "work", harness: "claude-code", source: "hook" } as const;
  const looker = { session: "looker", harness: "claude-code", source: "hook", kind: "branch-state", open: true, how: "ahead" } as const;
  const folder = (name: string) => `/w/site/.claude/worktrees/${name}`;
  const names = ["ci", "failing", "queued", "draft", "passing", "none"];
  const lines = log(
    ...names.map(name => ({ ...hook, folder: folder(name), branch: name, kind: "file-edited" as const, files: ["a.ts"] })),
    { ...looker, of: "ci", pr: 1, checks: "pending" },
    { ...looker, of: "failing", pr: 2, checks: "failing" },
    { ...looker, of: "queued", pr: 3, checks: "passing", queued: true },
    { ...looker, of: "draft", pr: 4, draft: true, checks: "pending" },
    { ...looker, of: "passing", pr: 5, checks: "passing" });
  const [row] = sessionRows(tree, lines, [], now);
  assert.deepEqual(row?.worktrees.map(({ state, label }) => label ?? state),
    ["PR #1 · in CI", "PR #2 · failing", "PR #3 · in merge queue", "PR #4 · draft", "PR #5", "unmerged"]);
});

