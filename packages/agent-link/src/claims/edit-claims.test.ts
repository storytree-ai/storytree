/**
 * Capability 5 · Claims, contracts 5.20-5.22: writing a capability's files claims it (ADR-0924),
 * against the real Postgres `pnpm test` provides. Each test plans a story "Sign up" with two
 * capabilities in a fresh project's library, lays out its package in a throwaway checkout (a
 * numbered test reaching each capability's file), and writes the edit lines a hook would.
 */
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

import { connect, type Library } from "@storytree/library";

import { openActivityLog, type ActivityLog } from "../activity/index.js";
import { withTempDir } from "../testing/folders.js";
import { dropTestProjects, testServerUrl, uniqueProjectName } from "../testing/pg.js";
import { claimFromEdits, type CapabilityLookup } from "./edit-claims.js";
import { claim, readClaims, type ClaimContext } from "./index.js";
import { takeNotices } from "./notices.js";

const EMAIL = "packages/sign-up/src/email.ts";
const RESET = "packages/sign-up/src/reset.ts";

interface World {
  log: ActivityLog;
  library: Library;
  project: string;
  home: string;
  checkout: string;
  emailForm: string;
  /** Session A (Claude Code) or B (Codex) edits `file`, a path in the checkout, as its hook records it. */
  edit(session: "A" | "B", file: string): Promise<void>;
  /** One pass of claiming from edits, as the upkeep copy of a hook takes it. */
  pass(options?: { lookup?: CapabilityLookup; library?: Library }): Promise<void>;
  as(session: "A" | "B"): ClaimContext;
}

async function withWorld(body: (world: World) => Promise<void>): Promise<void> {
  const project = uniqueProjectName();
  const storytree = await connect({ url: testServerUrl() });
  const log = await openActivityLog(testServerUrl());
  try {
    await withTempDir(async (dir) => {
      const library = await storytree.openProject(project);
      const story = await library.addStory({ title: "Sign up" });
      const emailForm = (await library.addCapability({ title: "1 · Email form", story: story.id })).id;
      await library.addCapability({ title: "2 · Password reset", story: story.id });
      const checkout = path.join(dir, "checkout");
      const src = path.join(checkout, "packages", "sign-up", "src");
      mkdirSync(src, { recursive: true });
      writeFileSync(path.join(checkout, "packages", "sign-up", "package.json"), JSON.stringify({ name: "sign-up" }));
      writeFileSync(path.join(src, "email.ts"), "export const email = 1;\n");
      writeFileSync(path.join(src, "reset.ts"), "export const reset = 1;\n");
      writeFileSync(path.join(src, "email.test.ts"), 'import { email } from "./email.js";\ntest("1.1 the email form", () => email);\n');
      writeFileSync(path.join(src, "reset.test.ts"), 'import { reset } from "./reset.js";\ntest("2.1 the password reset", () => reset);\n');
      const home = path.join(dir, "home");
      const harnessOf = { A: "claude-code", B: "codex" } as const;
      await body({
        log,
        library,
        project,
        home,
        checkout,
        emailForm,
        edit: async (session, file) => {
          await log.append(project, { session, harness: harnessOf[session], source: "hook", folder: checkout, kind: "file-edited", files: [path.join(checkout, file)] });
        },
        pass: (options = {}) => claimFromEdits({ log, library: options.library ?? library, project, home, ...(options.lookup === undefined ? {} : { lookup: options.lookup }) }),
        as: (session) => ({ log, library, project, session, harness: harnessOf[session] }),
      });
    });
  } finally {
    try {
      await log.close();
      await storytree.close();
    } finally {
      await dropTestProjects([project]);
    }
  }
}

test("5.23 an edit-claims look reads the plan once, and a look whose edits are to what their editors already hold reads no work besides", async () => {
  await withWorld(async ({ library, emailForm, edit, pass, log, project }) => {
    const asked = { projectTree: 0, arcViews: 0, holds: 0, waitHolds: 0 };
    const counted = new Proxy(library, {
      get(target, key) {
        if (typeof key === "string" && key in asked) asked[key as keyof typeof asked]++;
        const value = Reflect.get(target, key) as unknown;
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
    await edit("A", EMAIL);
    await pass({ library: counted });
    assert.deepEqual((await readClaims(log, project)).map(({ capability }) => capability), [emailForm]);
    assert.equal(asked.projectTree, 1, "the plan once, for the titles and the lookup both");

    for (const key of Object.keys(asked) as (keyof typeof asked)[]) asked[key] = 0;
    await edit("A", EMAIL);
    await pass({ library: counted });
    assert.deepEqual(asked, { projectTree: 1, arcViews: 0, holds: 0, waitHolds: 0 });
  });
});

test('5.20 an edit to a file of "email form" claims it for A, recording the file, with its title as the reason; A is told what, from which file, and how to release it; a second edit, and an edit to a file of no capability, claim and say nothing', async () => {
  await withWorld(async ({ log, project, home, emailForm, edit, pass }) => {
    await edit("A", EMAIL);
    await pass();

    assert.deepEqual((await readClaims(log, project)).map(({ capability, session, reason }) => ({ capability, session, reason })),
      [{ capability: emailForm, session: "A", reason: "1 · Email form" }]);
    const claimed = (await log.since(project, 0)).lines.filter((line) => line.kind === "claimed");
    assert.deepEqual(claimed.map((line) => ({ source: line.source, file: "file" in line ? line.file : undefined })), [{ source: "hook", file: EMAIL }]);
    const told = takeNotices(home, "A");
    assert.equal(told.length, 1);
    for (const words of [EMAIL, "1 · Email form", emailForm, "release"]) assert.ok(told[0]!.includes(words), `A is told ${words}: ${told[0]}`);

    await edit("A", EMAIL);
    await edit("A", "README.md");
    await pass();
    assert.equal((await log.since(project, 0)).lines.filter((line) => line.kind === "claimed").length, 1, "nothing more is claimed");
    assert.deepEqual(takeNotices(home, "A"), [], "and nothing more is said");
  });
});

test('5.21 an edit by A to a file of "email form" while live B holds it stands and claims nothing; a claim-refused line records the file, A is told B holds it and for what, and B is told which file A edited', async () => {
  await withWorld(async ({ log, project, home, emailForm, edit, pass, as }) => {
    assert.equal((await claim(as("B"), emailForm, "building the email form")).ok, true);
    await edit("A", EMAIL);
    await pass();

    assert.deepEqual((await readClaims(log, project)).map(({ capability, session }) => ({ capability, session })), [{ capability: emailForm, session: "B" }]);
    const refused = (await log.since(project, 0)).lines.filter((line) => line.kind === "claim-refused");
    assert.deepEqual(refused.map((line) => ({ session: line.session, holder: "holder" in line ? line.holder : undefined, file: "file" in line ? line.file : undefined })),
      [{ session: "A", holder: "B", file: EMAIL }]);
    const editor = takeNotices(home, "A");
    assert.equal(editor.length, 1);
    for (const words of [EMAIL, "1 · Email form", "Codex session B", "building the email form"]) assert.ok(editor[0]!.includes(words), `A is told ${words}: ${editor[0]}`);
    const holder = takeNotices(home, "B");
    assert.equal(holder.length, 1);
    for (const words of [EMAIL, "1 · Email form", "Claude Code session A"]) assert.ok(holder[0]!.includes(words), `B is told ${words}: ${holder[0]}`);
  });
});

test("5.22 when the lookup or the library fails while claiming from edits, nothing is claimed, no one is told, and nothing is thrown", async () => {
  await withWorld(async ({ log, project, home, library, edit, pass }) => {
    await edit("A", EMAIL);
    await pass({ lookup: () => Promise.reject(new Error("the lookup broke")) });
    await edit("A", RESET);
    const broken = new Proxy(library, { get: (target, key, receiver) => (key === "projectTree" ? () => Promise.reject(new Error("the library broke")) : Reflect.get(target, key, receiver)) });
    await pass({ library: broken });

    assert.deepEqual(await readClaims(log, project), []);
    assert.deepEqual(takeNotices(home, "A"), []);
  });
});
