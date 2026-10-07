/** Running sessions: the forest's session-to-island reading. */
import assert from "node:assert/strict";
import { test } from "node:test";
import { LogFold, type Line, type NewLine } from "@storytree/agent-link/readings";
import type { AnnotatedTree, ArcView } from "@storytree/library";
import { atWork, clickedSelection, dayRange, globeRoster, historyRows, historySelection, presetRange, sessionRoster, sessionRows, windowFiles } from "./sessions-list.js";
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
  increments: [{ id: "inc", fields: { title: "Finish signup", status: "active", touches: ["cap-two"] } }],
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

test("7.4 a row's islands come only from capabilities it claimed: an increment claim's touches light none (ADR-0923 D2)", () => {
  const lines = log({ ...off, kind: "claimed", increment: "inc", reason: "Finish signup" });
  assert.deepEqual(sessionRows(tree, lines, [arc], now)[0]!.stories, [], "the increment touches cap-two, but touching is not claiming");
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

test("7.13 each row names the machine its session runs on only when the listed sessions span more than one machine", () => {
  const lines = log({ ...parent, kind: "session-started", machine: "laptop" }, { ...off, kind: "session-started", machine: "mint" },
    { session: "quiet", harness: "codex", source: "hook", kind: "session-started" });
  assert.deepEqual(sessionRows(tree, lines, [], now).map(row => row.machine), ["laptop", "mint", undefined]);
  const one = log({ ...parent, kind: "session-started", machine: "laptop" }, { ...off, kind: "session-started", machine: "laptop" });
  assert.deepEqual(sessionRows(tree, one, [], now).map(row => row.machine), [undefined, undefined], "one machine is not worth naming");
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

test("7.8 a row's files are its window's opened files, each once in the order first opened, those no longer in the window marked; no reading says why", () => {
  const open = (id: string, resident: boolean, kind: "file" | "note" = "file") => ({ kind, id, call: id, tool: "Read", resident });
  const files = windowFiles({ session: "parent", at: now.toISOString(), inView: [], glimpses: [], compactions: 1,
    opens: [open("a.ts", false), open("note_0123456789ab", true, "note"), open("b.ts", true), open("a.ts", true), open("c.ts", false)] });
  assert.deepEqual(files, { files: [{ path: "a.ts", resident: true }, { path: "b.ts", resident: true }, { path: "c.ts", resident: false }] });
  assert.deepEqual(windowFiles({ session: "parent", at: now.toISOString(), absent: "no hook has named this session's transcript" }),
    { absent: "no hook has named this session's transcript" });
});

test("7.9–7.11 the header counts sessions at work; a quiet session folds as idle by its state alone, a close-out that says not safe keeping it listed but never out of the fold; a verified one is gone (ADR-0758)", () => {
  const minutes = (n: number) => new Date(now.getTime() - n * 60_000).toISOString();
  const hook = (session: string) => ({ session, harness: "claude-code", source: "hook" }) as const;
  const lines = log(
    { ...hook("busy"), kind: "prompt-submitted", at: minutes(50) },
    { ...hook("asking"), kind: "prompt-submitted", at: minutes(12) }, { ...hook("asking"), kind: "turn-ended", at: minutes(10) },
    { ...hook("idle"), kind: "prompt-submitted", at: minutes(50) }, { ...hook("idle"), kind: "turn-ended", at: minutes(45) },
    { ...hook("unsure"), branch: "fix-login", kind: "file-edited", files: ["a.ts"], at: minutes(20) },
    { ...hook("unsure"), branch: "fix-login", kind: "closed-out", safe: true, why: "all merged", running: 0, at: minutes(19) },
    { ...hook("held"), kind: "prompt-submitted", at: minutes(50) }, { ...hook("held"), kind: "turn-ended", at: minutes(45) },
    { ...hook("held"), branch: "main", kind: "closed-out", safe: false, why: "waiting on the owner's look", running: 0, at: minutes(44) },
    { ...hook("done"), branch: "main", kind: "closed-out", safe: true, why: "all merged", running: 0, at: minutes(5) });
  const rows = sessionRows(tree, lines, [], now);
  assert.deepEqual(rows.map(row => [row.id, row.idle]), [["busy", false], ["asking", false], ["idle", true], ["unsure", false], ["held", true]],
    "a verified close-out leaves at once; one that says not safe stays listed, folded like any quiet session");
  assert.equal(atWork(rows), 3, "working and waiting for you count; idle does not");
  assert.equal(rows.some(row => "needsYou" in row || "needsYouWhy" in row), false, "a row carries no need of the owner's: owner decisions are open questions on the arc surface");
});

test("7.12 a session holding unmerged work stays listed; the list leaves by the leave-after it is given; a finished desktop window folds as idle (ADR-0754 D4, ADR-0758 D5)", () => {
  const hours = (n: number) => new Date(now.getTime() - n * 3_600_000).toISOString();
  const hook = (session: string) => ({ session, harness: "claude-code", source: "hook" }) as const;
  const lines = log(
    { ...hook("holding"), branch: "fix-login", kind: "file-edited", files: ["a.ts"], at: hours(5) },
    { ...hook("quiet"), kind: "prompt-submitted", at: hours(2) }, { ...hook("quiet"), kind: "turn-ended", at: hours(2) },
    { ...hook("desk"), kind: "prompt-submitted", at: hours(3) }, { ...hook("desk"), kind: "turn-ended", at: hours(3) },
    { ...hook("reader"), kind: "session-unarchived", of: "desk", app: "claude-desktop", at: hours(4) });
  const rows = sessionRows(tree, lines, [], now);
  assert.deepEqual(rows.map(row => [row.id, row.idle]), [["holding", true], ["desk", true]],
    "two hours quiet leaves at the 1-hour default; unmerged work stays; the finished desktop window folds");
  assert.deepEqual(sessionRows(tree, lines, [], now, new Map(), undefined, 3 * 3_600_000).map(row => row.id), ["holding", "quiet", "desk"],
    "a 3-hour leave-after keeps the two-hour-quiet session listed");
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

test("7.16 a row lists the commands its session started and has not seen finish, background ones included, each as its first words (held to one short line) with its full command and how long it has run; a finished command is not listed", () => {
  const hook = { session: "busy", harness: "claude-code", source: "hook" } as const;
  const minutes = (n: number) => new Date(now.getTime() - n * 60_000).toISOString();
  const long = "git push --force-with-lease origin claude/some-very-long-branch-name && gh pr create --fill";
  const lines = log(
    { ...hook, kind: "prompt-submitted", at: minutes(30) },
    { ...hook, kind: "command-started", command: "pnpm run test --full", call: "a", at: minutes(8) },
    { ...hook, kind: "command-started", command: long, call: "b", at: minutes(2) },
    { ...hook, kind: "command-started", command: "git status", call: "c", at: minutes(1) },
    { ...hook, kind: "command-run", command: "git status", call: "c", at: minutes(1) });
  const [row] = sessionRows(tree, lines, [], now);
  assert.deepEqual(row?.running.map(({ words, command, ranMs }) => [words, command, ranMs]), [
    ["pnpm run test --full", "pnpm run test --full", 8 * 60_000],
    [`${long.split(/\s+/).slice(0, 5).join(" ").slice(0, 47)}…`, long, 2 * 60_000],
  ]);
  assert.ok(row!.running[1]!.words.length <= 48, "one short line");
  assert.deepEqual(sessionRows(tree, log({ ...hook, kind: "prompt-submitted" }), [], now)[0]?.running, [], "a session running nothing lists nothing");
});

test("7.20 a row carries the agent link's work-on-main flag (4.26): outside a workspace for uncommitted work on main, first commit pending in a repository with none; an unflagged row carries none (ADR-0906)", () => {
  const hook = (session: string) => ({ session, harness: "claude-code", source: "hook", folder: `/w/${session}`, branch: "main", machine: "mint" }) as const;
  const look = (of: string, unborn: boolean): Partial<Line> & NewLine =>
    ({ session: "looker", harness: "claude-code", source: "hook", machine: "mint", kind: "main-state", of: `/w/${of}`, dirty: true, ...(unborn ? { unborn: true } : {}) });
  const lines = log({ ...hook("stray"), kind: "file-edited", files: ["/w/stray/a.ts"] }, look("stray", false),
    { ...hook("fresh"), kind: "file-edited", files: ["/w/fresh/a.ts"] }, look("fresh", true),
    { ...hook("plain"), kind: "prompt-submitted" });
  const rows = new Map(sessionRows(tree, lines, [], now).map(row => [row.id, row]));
  assert.deepEqual(["stray", "fresh", "plain"].map(id => rows.get(id)?.onMain), ["outside-workspace", "first-commit-pending", undefined]);
});

describe7_21();
function describe7_21(): void {
  const day = (at: string): string => `2026-10-0${at}`;
  const later = new Date("2026-10-04T12:00:00Z");
  const range = { from: Date.parse(day("3T00:00:00Z")), to: Date.parse(day("4T00:00:00Z")) };
  const lines = (): Line[] => [
    // Landed: a verified close-out, a merged pull request it held and an increment it closed as landed.
    { session: "lander", harness: "claude-code", source: "hook", kind: "session-started", at: day("3T09:00:00Z") },
    { session: "lander", harness: "claude-code", source: "tool", kind: "claimed", increment: "inc-a", reason: "Build signup", at: day("3T09:01:00Z"), branch: "claude/a" },
    { session: "lander", harness: "claude-code", source: "hook", kind: "subagent-started", subagent: "helper", task: "Read", at: day("3T09:05:00Z") },
    { session: "helper", harness: "claude-code", source: "hook", kind: "session-ended", at: day("3T09:06:00Z") },
    { session: "lander", harness: "claude-code", source: "tool", kind: "closed", increment: "inc-a", disposition: "landed", at: day("3T10:00:00Z") },
    { session: "ci", source: "tool", kind: "merged", increment: "inc-a", holder: "lander", branch: "claude/a", pr: 12, at: day("3T09:59:00Z") },
    { session: "lander", harness: "claude-code", source: "tool", kind: "closed-out", safe: true, why: "merged", running: 0, at: day("3T10:30:00Z") },
    // Held: its increment waits on a question asked while it ran; it ended without closing out.
    { session: "holder", harness: "codex", source: "tool", kind: "claimed", increment: "inc-b", reason: "Choose the tabs", at: day("3T13:00:00Z") },
    { session: "holder", harness: "codex", source: "hook", kind: "session-ended", at: day("3T14:00:00Z") },
    // Ended without a close-out, named by itself.
    { session: "quiet", harness: "codex", source: "hook", kind: "session-named", title: "Tidy the docs", at: day("3T15:00:00Z") },
    { session: "quiet", harness: "codex", source: "hook", kind: "session-ended", at: day("3T15:20:00Z") },
    // Outside the range: ended the day before.
    { session: "old", harness: "codex", source: "hook", kind: "session-ended", at: day("2T15:00:00Z") },
    // Still listed live: History leaves it to the Live tab.
    { session: "live", harness: "codex", source: "hook", kind: "prompt-submitted", at: day("4T11:59:00Z") },
  ].map((line, index) => ({ project: "demo", seq: index + 1, ...line }) as Line);
  const arcs = [{ arc: { id: "arc", fields: { title: "Build" } }, state: "active",
    increments: [
      { id: "inc-a", fields: { title: "Finish signup", status: "closed", touches: ["cap-one"], outcome: { date: "2026-10-03", disposition: "landed", pr: "#13" } } },
      { id: "inc-b", fields: { title: "Tabs", status: "ready", touches: ["two"], heldOn: ["q-old", "q-new"] } },
    ],
    questions: [
      { id: "q-old", createdAt: day("1T00:00:00Z"), fields: { title: "Asked before it ran", lifecycle: "settled" } },
      { id: "q-new", createdAt: day("3T13:30:00Z"), fields: { title: "Which tab opens first?", lifecycle: "open" } },
    ] }] as unknown as ArcView[];

  test("7.21 History lists the sessions the live list no longer lists that were active in the range, latest first, each led by how it ended", () => {
    const rows = historyRows(tree, lines(), arcs, range, later);
    assert.deepEqual(rows.map(row => row.id), ["quiet", "holder", "lander"], "no subagent, nothing live, nothing outside the range");
    const [quiet, holder, lander] = rows;
    assert.deepEqual(lander!.outcome, { kind: "landed", prs: [12, 13] });
    assert.equal(lander!.label, "Build signup");
    assert.equal(lander!.agent, "Claude Code");
    assert.equal(lander!.ranMs, 90 * 60_000, "first line to last");
    assert.deepEqual(lander!.stories, [{ id: "one", title: "one" }]);
    assert.deepEqual(holder!.outcome, { kind: "held", question: "Which tab opens first?" }, "a question asked while it ran, not one asked before");
    assert.deepEqual(holder!.stories, [{ id: "two", title: "two" }], "an increment may touch a story itself");
    assert.deepEqual(quiet!.outcome, { kind: "no-close-out" });
    assert.equal(quiet!.label, "Tidy the docs");
  });

  test("7.21 a session closed out with nothing landed or held reads as closed out; one active across the range's edge is included", () => {
    const edge = [{ project: "demo", seq: 1, session: "late", harness: "codex", source: "hook", kind: "session-started", at: day("2T23:00:00Z") },
      { project: "demo", seq: 2, session: "late", harness: "codex", source: "tool", kind: "closed-out", safe: true, why: "nothing to land", running: 0, at: day("3T01:00:00Z") },
      { project: "demo", seq: 3, session: "late", harness: "codex", source: "hook", kind: "session-ended", at: day("3T01:00:01Z") }] as Line[];
    // Read as the page holds it: the fold has every line, the lines kept are only those read one by one.
    const fold = new LogFold();
    fold.add(edge);
    assert.deepEqual(historyRows(tree, { fold, lines: [] }, [], range, later).map(row => [row.id, row.outcome.kind]), [["late", "closed-out"]]);
    assert.deepEqual(historyRows(tree, edge, [], { from: range.from + 86_400_000, to: range.to + 86_400_000 }, later), []);
  });

  test("7.26 History's rows read each line a bounded number of times, however many past sessions there are", () => {
    let reads = 0;
    const past = Array.from({ length: 200 }, (_, n) => [
      { kind: "session-started", at: day("3T09:00:00Z") },
      // Every third session is unnamed and claims nothing, so it is named by where it worked.
      ...(n % 3 === 0 ? [] : [{ kind: "claimed", increment: "inc-a", reason: `Work ${n}`, at: day("3T09:01:00Z") }]),
      { kind: "session-ended", at: day("3T09:30:00Z") },
    ].map(line => ({ harness: "codex", source: "hook", ...line, s: `past-${n}` }))).flat();
    const counted = past.map(({ s, ...line }, index) => Object.defineProperty({ project: "demo", seq: index + 1, ...line }, "session",
      { enumerable: true, get: () => (reads++, s) }) as unknown as Line);
    const rows = historyRows(tree, counted, arcs, range, later);
    assert.equal(rows.length, 200);
    assert.equal(rows.find(row => row.id === "past-7")!.label, "Work 7");
    assert.equal(rows.find(row => row.id === "past-6")!.label, "Codex");
    // One pass per past session would read a line's session 200 times over; a bounded number of passes reads it a few times.
    assert.ok(reads <= 10 * counted.length, `${reads} reads of ${counted.length} lines' session`);
  });

  test("7.21 the range's presets are local days, today included, and a custom range runs from its first day to the end of its last", () => {
    const at = new Date(2026, 9, 4, 15, 30);
    const midnight = (d: number): number => new Date(2026, 9, d).getTime();
    assert.deepEqual(presetRange("today", at), { from: midnight(4), to: midnight(5) });
    assert.deepEqual(presetRange("yesterday", at), { from: midnight(3), to: midnight(4) });
    assert.deepEqual(presetRange("week", at), { from: new Date(2026, 8, 28).getTime(), to: midnight(5) }, "seven days, today the last");
    assert.deepEqual(dayRange("2026-10-01", "2026-10-03"), { from: midnight(1), to: midnight(4) });
    assert.equal(dayRange("2026-10-03", "2026-10-01"), undefined, "a range that ends before it starts is none");
    assert.equal(dayRange("", "2026-10-01"), undefined);
  });

  test("7.22 7.23 the globe's roster is the live rows' whatever History holds; a selected history session joins it in its own colour", () => {
    const live = sessionRows(tree, lines(), arcs, later);
    const history = historyRows(tree, lines(), arcs, range, later);
    assert.deepEqual(globeRoster(live, history, undefined), sessionRoster(live), "opening History or changing its range changes nothing");
    assert.deepEqual(globeRoster(live, history, "live"), sessionRoster(live));
    assert.deepEqual(globeRoster(live, history, "holder"), [...sessionRoster(live),
      { session: "holder", label: "Choose the tabs", colour: sessionColour("holder"), members: ["holder"] }]);
    assert.equal(historySelection("holder", undefined), "holder");
    assert.equal(historySelection("holder", "holder"), undefined, "clicking the selected row again clears the selection");
    assert.equal(historySelection("quiet", "holder"), "quiet");
  });
}
