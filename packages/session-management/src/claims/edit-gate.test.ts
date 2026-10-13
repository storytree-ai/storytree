/**
 * Capability 5 · Claims: the edit tools' refusal before the edit (ADR-0949 D3), against the real
 * Postgres `pnpm test` provides, in a fresh project's library and a checkout made in a temp folder.
 */
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

import { connect } from "@storytree/library";

import { openActivityLog } from "../activity/index.js";
import { declaredInTests } from "../testing/declared.js";
import { withTempDir } from "../testing/folders.js";
import { dropTestProjects, testServerUrl, uniqueProjectName } from "../testing/pg.js";
import { claim, closed, release } from "./claims.js";
import { allowIncrement, allowSaid, editRefusal, recordPromptYes, refusalMessage } from "./edit-gate.js";
import { refusalAnswer } from "../hooks/edit-gate.js";

test("5.31 an edit tool aimed at a capability its session's claimed increment does not list, or that another live session holds by claim or on its increment's list, is refused before the edit, naming the way through or the holder; a file that declares no capability, or a session's own listed capability, is never refused (ADR-0949 D3)", async () => {
  const project = uniqueProjectName();
  const storytree = await connect({ url: testServerUrl() });
  const log = await openActivityLog(testServerUrl());
  try {
    await withTempDir(async (checkout) => {
      const library = await storytree.openProject(project);
      const story = await library.addStory({ title: "Visitor can sign up" });
      const form = (await library.addCapability({ title: "1 · Email form", story: story.id })).id;
      const reset = (await library.addCapability({ title: "2 · Password reset", story: story.id })).id;
      const arc = await library.createArc({ title: "Launch sign-up", intent: "Ship sign-up", endState: "Visitors sign up", stories: [story.id] });
      const park = async (title: string, capabilities: string[]) => (await library.addIncrement({ arc: arc.id, title, objective: title, body: title, capabilities })).id;
      const src = path.join(checkout, "packages", "visitor-can-sign-up", "src");
      mkdirSync(src, { recursive: true });
      writeFileSync(path.join(src, "form.ts"), "/**\n * Capability 1 · Email form: the form.\n */\nexport const form = 1;\n");
      writeFileSync(path.join(src, "reset.ts"), "/**\n * Capability 2 · Password reset: the link.\n */\nexport const reset = 1;\n");
      writeFileSync(path.join(src, "notes.ts"), "export const notes = 1;\n");
      const as = (session: string) => ({ log, library, project, session, harness: "claude-code", folder: checkout });
      const gate = (session: string, file: string, text?: string) => editRefusal(as(session), checkout, [{ path: path.join(src, file), ...(text === undefined ? {} : { text }) }], declaredInTests);

      const mine = await park("email form", [form]);
      assert.equal((await claim(as("A"), mine, "driving the email form")).ok, true);
      assert.equal(await gate("A", "form.ts"), undefined, "a capability on the session's own list");
      assert.equal(await gate("A", "notes.ts"), undefined, "a file that declares no capability");
      const unlisted = await gate("A", "reset.ts");
      assert.deepEqual(unlisted && { ...unlisted }, { refused: "unlisted", capability: reset, title: "2 · Password reset", file: "packages/visitor-can-sign-up/src/reset.ts", increment: mine, listed: [form] });
      assert.match(refusalMessage(unlisted!), new RegExp(`storytree arc increment edit ${mine} --capabilities ${form},${reset}`));
      assert.equal((await gate("A", "new.ts", "/**\n * Capability 2 · Password reset\n */\n"))?.refused, "unlisted", "a new file is read from the text the tool will write");
      const placedBy = (lookup: Map<string, string>) => async () => lookup;
      assert.equal(await editRefusal(as("A"), checkout, [{ path: path.join(src, "reset.ts") }], placedBy(new Map())), undefined, "a file is placed only by the lookup the gate is given");
      assert.equal((await editRefusal(as("A"), checkout, [{ path: path.join(src, "notes.ts") }], placedBy(new Map([["packages/visitor-can-sign-up/src/notes.ts", reset]]))))?.refused, "unlisted", "whatever the file's text says");

      const theirs = await park("password reset", [reset]);
      assert.equal((await claim(as("B"), theirs, "driving the reset")).ok, true);
      await library.editIncrement(mine, { capabilities: [form, reset] });
      const held = await gate("A", "reset.ts");
      assert.equal(held?.refused, "held");
      assert.equal(held?.refused === "held" ? [held.holder.session, held.on].join(" ") : undefined, `B ${theirs}`, "held on the list of B's increment");
      assert.match(refusalMessage(held!), /session B holds it on the capabilities list/);
      assert.equal((await gate("C", "reset.ts"))?.refused, "held", "a session holding no increment is still refused what another holds");
      const refusals = await log.lines(project, { kinds: ["claim-refused"] });
      assert.deepEqual(refusals.map((line) => line.kind === "claim-refused" && [line.session, line.capability, line.under]), [["A", reset, mine], ["C", reset, undefined]], "each refusal is in the activity log, under the increment its session drives (5.38)");

      assert.equal((await claim(as("B"), form, "a quick fix to the form")).ok, true);
      assert.equal((await gate("A", "form.ts"))?.refused, "held", "a capability another session claimed itself");
      assert.equal((await release(as("B"), form)).ok, true);

      await closed(as("B"), theirs, "withdrawn");
      assert.equal(await gate("A", "reset.ts"), undefined, "once B's increment closes, its list holds nothing");
    });
  } finally {
    try {
      await log.close();
      await storytree.close();
    } finally {
      await dropTestProjects([project]);
    }
  }
});

test("5.40 an edit tool aimed at a file in an imported folder is refused before the edit unless the session's increment lists the explored capability covering it, saying how to go on; when it does, the user is asked for the edit, never the agent (ADR-0993 D4, ADR-1015 D1-D2)", async () => {
  const project = uniqueProjectName();
  const storytree = await connect({ url: testServerUrl() });
  const log = await openActivityLog(testServerUrl());
  try {
    await withTempDir(async (root) => {
      const checkout = path.join(root, "project");
      const viewer = path.join(root, "viewer");
      mkdirSync(path.join(viewer, "app", "stats"), { recursive: true });
      mkdirSync(path.join(viewer, "lib"), { recursive: true });
      writeFileSync(path.join(viewer, "lib", "util.ts"), "export const util = 1;\n");
      const library = await storytree.openProject(project);
      const { added: [mapped] } = await library.mapStories("https://github.com/someone/viewer.git", [{ package: ".", title: "viewer", folders: ["."] }]);
      const stats = (await library.addCapability({ title: "Stats page", story: mapped!.id, covers: ["app/stats"] })).id;
      const arc = await library.createArc({ title: "Stats", intent: "A stats page", endState: "Stats shown", stories: [mapped!.id] });
      const park = async (title: string, capabilities: string[]) => (await library.addIncrement({ arc: arc.id, title, objective: title, body: title, capabilities })).id;
      const imports = [{ folder: viewer, repository: "https://github.com/someone/viewer.git" }];
      const as = (session: string) => ({ log, library, project, session, harness: "claude-code", folder: checkout });
      const gate = (session: string, file: string) => editRefusal(as(session), checkout, [{ path: path.join(viewer, file) }], declaredInTests, imports);

      const none = await gate("A", "app/stats/page.tsx");
      assert.equal(none?.refused, "imported", "a session holding no increment is refused");
      assert.match(refusalMessage(none!), /list it on an increment you hold.*ask the user/s, "the way on: an increment listing it, or the user");
      assert.equal(await editRefusal(as("A"), checkout, [{ path: path.join(viewer, "app/stats/page.tsx") }], declaredInTests), undefined, "with no imports given, nothing outside the checkout is gated");

      const mine = await park("stats page", []);
      assert.equal((await claim(as("A"), mine, "driving the stats page")).ok, true);
      const unlisted = await gate("A", "app/stats/page.tsx");
      assert.deepEqual(unlisted && { ...unlisted }, { refused: "imported", file: "app/stats/page.tsx", folder: viewer, increment: mine, covering: { capability: stats, title: "1 · Stats page" } });
      assert.match(refusalMessage(unlisted!), new RegExp(`storytree arc increment edit ${mine} --capabilities ${stats}`));
      const unexplored = await gate("A", "lib/util.ts");
      assert.equal(unexplored?.refused === "imported" ? unexplored.covering : "not refused", undefined, "a file no explored capability covers is refused, naming none");
      assert.match(refusalMessage(unexplored!), /draw the capability you mean to change/, "and the way on starts by drawing one");

      await library.editIncrement(mine, { capabilities: [stats] });
      const asked = await gate("A", "app/stats/page.tsx");
      assert.deepEqual(asked && { ...asked }, { refused: "ask", file: "app/stats/page.tsx", folder: viewer, capability: stats, title: "1 · Stats page", increment: mine });
      assert.equal((await gate("A", "lib/util.ts"))?.refused, "imported", "the listed capability covers only its own files");
      const claudeAnswer = JSON.parse(refusalAnswer("claude-code", refusalMessage(asked!), asked!.refused === "ask")) as { decision?: string; hookSpecificOutput: { permissionDecision: string } };
      assert.deepEqual([claudeAnswer.decision, claudeAnswer.hookSpecificOutput.permissionDecision], [undefined, "ask"], "Claude Code asks its user");
      assert.equal(JSON.parse(refusalAnswer("codex", refusalMessage(asked!), asked!.refused === "ask")).decision, "block", "a harness that cannot ask its user refuses");

      assert.equal((await claim(as("B"), stats, "a fix to the stats page")).ok, true);
      assert.equal((await gate("A", "app/stats/page.tsx"))?.refused, "held", "an explored capability another live session holds is refused as any other");
    });
  } finally {
    try {
      await log.close();
      await storytree.close();
    } finally {
      await dropTestProjects([project]);
    }
  }
});

test("5.41 one yes from the user covers an increment's edits to imported code: given at the harness's prompt (recorded by the hook after the edit it let through) or typed at the user's own terminal, it covers what the increment listed and each capability covered then; a capability listed later or a cover widened since is asked again, and a yes an agent wrote is not one (ADR-1015)", async () => {
  const project = uniqueProjectName();
  const storytree = await connect({ url: testServerUrl() });
  const log = await openActivityLog(testServerUrl());
  try {
    await withTempDir(async (root) => {
      const checkout = path.join(root, "project");
      const viewer = path.join(root, "viewer");
      const library = await storytree.openProject(project);
      const { added: [mapped] } = await library.mapStories("https://github.com/someone/viewer.git", [{ package: ".", title: "viewer", folders: ["."] }]);
      const stats = (await library.addCapability({ title: "Stats page", story: mapped!.id, covers: ["app/stats"] })).id;
      const nav = (await library.addCapability({ title: "Navigation", story: mapped!.id, covers: ["components/nav"] })).id;
      const arc = await library.createArc({ title: "Stats", intent: "A stats page", endState: "Stats shown", stories: [mapped!.id] });
      const mine = (await library.addIncrement({ arc: arc.id, title: "stats page", objective: "stats page", body: "stats page", capabilities: [stats] })).id;
      const imports = [{ folder: viewer, repository: "https://github.com/someone/viewer.git" }];
      const as = { log, library, project, session: "A", harness: "claude-code", folder: checkout };
      const files = (...names: string[]) => names.map((file) => ({ path: path.join(viewer, file) }));
      const gate = async (file: string) => (await editRefusal(as, checkout, files(file), declaredInTests, imports))?.refused;
      assert.equal((await claim(as, mine, "driving the stats page")).ok, true);

      assert.equal(await gate("app/stats/page.tsx"), "ask", "with no yes, the user is asked");
      await log.append(project, { session: "A", harness: "claude-code", source: "tool", folder: checkout, kind: "user-allowed", increment: mine, how: "command", capabilities: [{ capability: stats, covers: ["."] }] });
      await log.append(project, { session: "person:mallory", source: "hook", kind: "user-allowed", increment: mine, how: "command", capabilities: [{ capability: stats, covers: ["."] }] });
      assert.equal(await gate("app/stats/page.tsx"), "ask", "a yes written from the agent's session, or not by a terminal, is not the user's");

      assert.equal(await recordPromptYes(as, checkout, files("app/stats/page.tsx"), imports), mine, "the edit the prompt let through records the yes");
      assert.equal(await gate("app/stats/chart.tsx"), undefined, "the increment's next edits under what it listed go through unasked");
      assert.equal(await recordPromptYes(as, checkout, files("app/stats/chart.tsx"), imports), undefined, "an edit that was not asked about records nothing");
      assert.equal(await gate("lib/util.ts"), "imported", "a file no listed capability covers is still refused");

      await library.editIncrement(mine, { capabilities: [stats, nav] });
      assert.equal(await gate("components/nav/menu.tsx"), "ask", "a capability listed after the yes is asked again");
      await library.editCapability(stats, { covers: ["app/stats", ".env.local"] });
      assert.equal(await gate(".env.local"), "ask", "a cover widened after the yes is asked again");
      assert.equal(await gate("app/stats/page.tsx"), undefined, "what it covered at the yes stays allowed");

      assert.deepEqual(await allowIncrement({ log, library, project, folder: checkout }, "sam", arc.id), { ok: false, reason: `${arc.id} is not an increment of this project.` });
      const allowed = await allowIncrement({ log, library, project, folder: checkout }, "sam", mine);
      assert.deepEqual(allowed.ok && allowed.capabilities, [{ capability: stats, covers: ["app/stats", ".env.local"] }, { capability: nav, covers: ["components/nav"] }]);
      assert.deepEqual([await gate(".env.local"), await gate("components/nav/menu.tsx")], [undefined, undefined], "the user's yes typed at their terminal covers what the increment lists now");
    });
  } finally {
    try {
      await log.close();
      await storytree.close();
    } finally {
      await dropTestProjects([project]);
    }
  }
});

test("5.42 a yes the user says in the conversation, recorded by the prompt hook that heard it, covers the increment's edits to imported code for the session that heard it alone: a said yes another session heard, or one an agent wrote, is not one, and a successor session on the increment is asked again (ADR-1015 D2)", async () => {
  const project = uniqueProjectName();
  const storytree = await connect({ url: testServerUrl() });
  const log = await openActivityLog(testServerUrl());
  try {
    await withTempDir(async (root) => {
      const checkout = path.join(root, "project");
      const viewer = path.join(root, "viewer");
      const library = await storytree.openProject(project);
      const { added: [mapped] } = await library.mapStories("https://github.com/someone/viewer.git", [{ package: ".", title: "viewer", folders: ["."] }]);
      const stats = (await library.addCapability({ title: "Stats page", story: mapped!.id, covers: ["app/stats"] })).id;
      const arc = await library.createArc({ title: "Stats", intent: "A stats page", endState: "Stats shown", stories: [mapped!.id] });
      const mine = (await library.addIncrement({ arc: arc.id, title: "stats page", objective: "stats page", body: "stats page", capabilities: [stats] })).id;
      const empty = (await library.addIncrement({ arc: arc.id, title: "nothing listed", objective: "nothing listed", body: "nothing listed", capabilities: [] })).id;
      const imports = [{ folder: viewer, repository: "https://github.com/someone/viewer.git" }];
      const as = (session: string) => ({ log, library, project, session, harness: "codex", folder: checkout });
      const gate = async (session: string) => (await editRefusal(as(session), checkout, [{ path: path.join(viewer, "app/stats/page.tsx") }], declaredInTests, imports))?.refused;
      assert.equal((await claim(as("A"), mine, "driving the stats page")).ok, true);

      await log.append(project, { session: "B", harness: "codex", source: "hook", folder: checkout, kind: "user-allowed", increment: mine, how: "said", capabilities: [{ capability: stats, covers: ["."] }] });
      await log.append(project, { session: "A", harness: "codex", source: "tool", folder: checkout, kind: "user-allowed", increment: mine, how: "said", capabilities: [{ capability: stats, covers: ["."] }] });
      assert.equal(await gate("A"), "ask", "a said yes another session heard, or one not written by a hook, is not this session's user's");

      assert.deepEqual(await allowSaid(as("A"), empty), { ok: false, reason: `${empty} lists no capabilities yet, so a yes would allow nothing: the agent lists the explored capability it means to change first.` });
      const said = await allowSaid(as("A"), mine);
      assert.deepEqual(said.ok && said.capabilities, [{ capability: stats, covers: ["app/stats"] }]);
      assert.equal(await gate("A"), undefined, "the session that heard the yes edits unasked");

      assert.equal((await release(as("A"), mine)).ok, true);
      assert.equal((await claim(as("C"), mine, "taking over the stats page")).ok, true);
      assert.equal(await gate("C"), "ask", "a successor session on the increment is asked again");
    });
  } finally {
    try {
      await log.close();
      await storytree.close();
    } finally {
      await dropTestProjects([project]);
    }
  }
});
