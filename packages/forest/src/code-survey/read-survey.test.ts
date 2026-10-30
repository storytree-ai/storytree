// Capability 1 · Story nodes. The desktop's answer to the page's code survey, run on the map's own survey worker.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import type { AnnotatedTree } from "@storytree/library";
import { removeTemp } from "@storytree/test-waits";

import { forestPageAnswers } from "./read-survey.js";

const tree = { arcs: [], stories: [] } as unknown as AnnotatedTree;

test("1.13 · a project whose origin has no fetchable main is answered with no code, said once in app.log naming why, not a rejected survey at every poll; once its main can be fetched, that is said once and it is surveyed", async (t) => {
  const folder = await mkdtemp(path.join(tmpdir(), "forest-survey-no-main-"));
  const git = (cwd: string, ...args: string[]) => execFileSync("git", args, { cwd, stdio: "pipe", windowsHide: true });
  const said: string[] = [];
  t.mock.method(console, "error", (line: string) => { said.push(line); });
  try {
    const origin = path.join(folder, "origin.git");
    const checkout = path.join(folder, "checkout");
    git(folder, "init", "--quiet", "--bare", "-b", "master", origin);
    git(folder, "init", "--quiet", "-b", "master", checkout);
    git(checkout, "-c", "user.name=Survey test", "-c", "user.email=survey@example.test", "-c", "commit.gpgsign=false", "commit", "--quiet", "--allow-empty", "-m", "fixture");
    git(checkout, "remote", "add", "origin", origin);
    git(checkout, "push", "--quiet", "origin", "master");
    const { answers } = forestPageAnswers[0]!({
      home: path.join(folder, "home"),
      library: () => ({ projectFolder: async () => checkout, projectTree: async () => tree, projectImports: async () => [] }),
      treeRead: () => tree,
      surveyWorker: fileURLToPath(import.meta.resolve("@storytree/map/code-survey/worker")),
    });
    for (let poll = 0; poll < 3; poll++) assert.deepEqual(await answers.codeSurvey("project"), {});
    assert.equal(said.length, 1, "the same refusal is said once, not once per poll");
    assert.match(said[0]!, /origin\/main/);
    assert.match(said[0]!, /remote ref.*main/i, "the line names why main could not be fetched");

    git(checkout, "push", "--quiet", "origin", "master:main");
    assert.deepEqual(await answers.codeSurvey("project"), {});
    assert.equal(said.length, 2);
    assert.match(said[1]!, /again/);
    await answers.codeSurvey("project");
    assert.equal(said.length, 2, "a survey that keeps answering says nothing more");
  } finally {
    await removeTemp(folder);
  }
});
