import assert from "node:assert/strict";
import { test } from "node:test";

import { lateReads, projectAnswers } from "./late-reads.js";

/** A stand-in for the page reads of one opened library, named so a test can tell which library answered. */
function library(name: string) {
  return {
    listProjects: () => [`${name}'s project`],
    projectTree: async (project: unknown) => `${name}'s tree of ${String(project)}`,
  };
}

test("1.29 · a page read asked before the library opens is refused saying so; once it opens, or reopens, the library open then answers it", async () => {
  let open: ReturnType<typeof library> | undefined;
  const reads = lateReads(["listProjects", "projectTree"], () => {
    if (open === undefined) throw new Error("the library is not open");
    return open;
  });
  assert.throws(() => reads.listProjects(), /the library is not open/);
  open = library("first");
  assert.equal(await reads.projectTree("storytree"), "first's tree of storytree");
  open = library("reopened");
  assert.deepEqual(reads.listProjects(), ["reopened's project"]);
});

test("1.29 · before the library opens the page sees no projects and choosing one is refused; once it opens, the choice is the library's", () => {
  let reads: ReturnType<typeof library> | undefined;
  let projects: { read(): unknown; choose(name: unknown): unknown } | undefined;
  const answers = projectAnswers({ reads: () => reads, projects: () => projects });
  assert.deepEqual(answers.listProjects(), []);
  assert.deepEqual(answers.projectSelection(), { projects: [], current: undefined });
  assert.throws(() => answers.chooseProject("storytree"), /The library is not open/);

  reads = library("opened");
  projects = { read: () => ({ projects: ["storytree"], current: "storytree" }), choose: (name) => `chose ${String(name)}` };
  assert.deepEqual(answers.listProjects(), ["opened's project"]);
  assert.deepEqual(answers.projectSelection(), { projects: ["storytree"], current: "storytree" });
  assert.equal(answers.chooseProject("storytree"), "chose storytree");
});
