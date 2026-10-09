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
import { withTempDir } from "../testing/folders.js";
import { dropTestProjects, testServerUrl, uniqueProjectName } from "../testing/pg.js";
import { claim, closed, release } from "./claims.js";
import { editRefusal, refusalMessage } from "./edit-gate.js";

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
      const gate = (session: string, file: string, text?: string) => editRefusal(as(session), checkout, [{ path: path.join(src, file), ...(text === undefined ? {} : { text }) }]);

      const mine = await park("email form", [form]);
      assert.equal((await claim(as("A"), mine, "driving the email form")).ok, true);
      assert.equal(await gate("A", "form.ts"), undefined, "a capability on the session's own list");
      assert.equal(await gate("A", "notes.ts"), undefined, "a file that declares no capability");
      const unlisted = await gate("A", "reset.ts");
      assert.deepEqual(unlisted && { ...unlisted }, { refused: "unlisted", capability: reset, title: "2 · Password reset", file: "packages/visitor-can-sign-up/src/reset.ts", increment: mine, listed: [form] });
      assert.match(refusalMessage(unlisted!), new RegExp(`storytree arc increment edit ${mine} --capabilities ${form},${reset}`));
      assert.equal((await gate("A", "new.ts", "/**\n * Capability 2 · Password reset\n */\n"))?.refused, "unlisted", "a new file is read from the text the tool will write");

      const theirs = await park("password reset", [reset]);
      assert.equal((await claim(as("B"), theirs, "driving the reset")).ok, true);
      await library.editIncrement(mine, { capabilities: [form, reset] });
      const held = await gate("A", "reset.ts");
      assert.equal(held?.refused, "held");
      assert.equal(held?.refused === "held" ? [held.holder.session, held.on].join(" ") : undefined, `B ${theirs}`, "held on the list of B's increment");
      assert.match(refusalMessage(held!), /session B holds it on the capabilities list/);
      assert.equal((await gate("C", "reset.ts"))?.refused, "held", "a session holding no increment is still refused what another holds");
      const refusals = await log.lines(project, { kinds: ["claim-refused"] });
      assert.deepEqual(refusals.map((line) => line.kind === "claim-refused" && [line.session, line.capability]), [["A", reset], ["C", reset]], "each refusal is in the activity log");

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
