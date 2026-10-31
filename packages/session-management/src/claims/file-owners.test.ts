/**
 * Capability 5 · Claims: the owners query, which names each file's capability and its holder before an edit, so a
 * session claims them all in one call (ADR-1079 D2). Against the real Postgres `pnpm test` provides.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { connect } from "@storytree/library";
import type { DoorWords } from "@storytree/library/verbs";

import { openActivityLog } from "../activity/index.js";
import { dropTestProjects, testServerUrl, uniqueProjectName } from "@storytree/project-and-caller/testing/pg";
import type { SessionVerbContext } from "../sessions/verbs.js";
import { claim } from "./claims.js";
import { WORKSPACE_FAMILIES } from "./verbs.js";

const WORDS: DoorWords = { door: "command", say: (step) => step.command === undefined ? step.tool! : `storytree ${step.command}` };

test("5.60 the owners query names each file's capability and who holds it, by claim or on a live increment's list, the caller's own as its own, a file with no capability by its story's package, and offers the free ones to claim in one call", async () => {
  const project = uniqueProjectName();
  const storytree = await connect({ url: testServerUrl() });
  const log = await openActivityLog(testServerUrl());
  try {
    const library = await storytree.openProject(project);
    const story = await library.addStory({ title: "Visitor can sign up" });
    const [form, reset, profile, terms, own] = await Promise.all(["1 · Email form", "2 · Password reset", "3 · Profile", "4 · Terms", "5 · Welcome"].map(async (title) => (await library.addCapability({ title, story: story.id })).id));
    const arc = await library.createArc({ title: "Launch sign-up", intent: "Ship sign-up", endState: "Visitors sign up", stories: [story.id] });
    const theirs = (await library.addIncrement({ arc: arc.id, title: "reset", objective: "reset", body: "reset", capabilities: [reset] })).id;
    const as = (session: string): SessionVerbContext => ({ log, library, project, session, harness: "claude-code", folder: "/checkout" }) as unknown as SessionVerbContext;
    assert.equal((await claim(as("B"), form, "a fix to the form")).ok, true);
    assert.equal((await claim(as("B"), theirs, "driving the reset")).ok, true);
    assert.equal((await claim(as("A"), own, "the welcome")).ok, true);

    const pkg = "packages/visitor-can-sign-up";
    const placed = [
      { file: `${pkg}/src/form.ts`, capability: form }, { file: `${pkg}/src/reset.ts`, capability: reset },
      { file: `${pkg}/src/profile.ts`, capability: profile, inferred: true }, { file: `${pkg}/src/terms.ts`, capability: terms },
      { file: `${pkg}/src/welcome.ts`, capability: own }, { file: `${pkg}/scripts/run.mjs` }, { file: "README.md" },
    ].map((one) => ({ ...one, path: one.file, ...(one.file.startsWith("packages/") ? { story: { id: story.id, title: "Visitor can sign up" }, package: pkg } : {}) }));
    const asked: string[][] = [];
    const owners = WORKSPACE_FAMILIES[0]!.verbs.find((one) => "name" in one.command && one.command.name === "owners")!;
    const context = { ...as("A"), placeFiles: async (files: readonly string[]) => (asked.push([...files]), placed) };
    const answer = await owners.act({ paths: placed.map(({ file }) => file) }, context, WORDS);

    assert.deepEqual(asked, [placed.map(({ file }) => file)], "the door places the files given");
    const line = (file: string) => answer.text.split("\n").find((one) => one.startsWith(`${file}:`)) ?? "";
    assert.match(line(`${pkg}/src/form.ts`), new RegExp(`1 · Email form \\[${form}\\].*held by Claude Code session B \\(a fix to the form\\)`));
    assert.match(line(`${pkg}/src/reset.ts`), new RegExp(`2 · Password reset \\[${reset}\\].*held by Claude Code session B .*on ${theirs}'s capabilities list`));
    assert.match(line(`${pkg}/src/profile.ts`), new RegExp(`3 · Profile \\[${profile}\\] \\(inferred\\).*free`));
    assert.match(line(`${pkg}/src/terms.ts`), new RegExp(`4 · Terms \\[${terms}\\].*free`));
    assert.match(line(`${pkg}/src/welcome.ts`), /yours/);
    assert.match(line(`${pkg}/scripts/run.mjs`), new RegExp(`no capability.*${pkg}.*Visitor can sign up \\[${story.id}\\]`));
    assert.match(line("README.md"), /in no story's package/);
    assert.match(answer.text, new RegExp(`storytree workspace claim ${profile} ${terms} --reason`), "the free ones, offered in one call");
    assert.equal(answer.text.includes(`claim ${form}`), false, "a held one is not offered");

    await assert.rejects(owners.act({ paths: ["README.md"] }, as("A"), WORDS), /cannot place files/, "a door that hands no placement refuses");
  } finally {
    try {
      await log.close();
      await storytree.close();
    } finally {
      await dropTestProjects([project]);
    }
  }
});
