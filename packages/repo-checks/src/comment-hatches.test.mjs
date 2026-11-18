// Capability 8 · Storytree's own test and gate entries.
import assert from "node:assert/strict";
import { test } from "node:test";

import { tellHatches } from "./comment-hatches.mjs";
import { gateSteps } from "./gate-steps.mjs";

const OLD = { file: "packages/a/src/old.mjs", line: 5, comment: "matches the tail first", reason: "the regex reads backwards without it" };
const NEW = { file: "packages/b/src/new.ts", line: 3, comment: "keep: block", reason: "a tool reads this block" };
const OLD_WHAT = "packages/a/src/old.mjs:5 keeps the comment \"matches the tail first\", disabling storytree/no-comments because: the regex reads backwards without it";
const NEW_WHAT = "packages/b/src/new.ts:3 keeps the comment \"keep: block\", disabling storytree/no-comments because: a tool reads this block";

function library(fyis) {
  const calls = [];
  const storytree = async (args) => {
    calls.push(args);
    if (args.length === 7 && args[0] === "library" && args[1] === "list" && args[2] === "fyi" && args[3] === "--where" && args[5] === "--where") {
      const about = args[4].replace(/^about=/, "");
      const what = args[6].replace(/^what=/, "");
      const found = fyis.filter((fyi) => fyi.about === about && fyi.what === what);
      if (found.length === 0) return "No fyi records match.\n\nnext:\n  - storytree library read <id>   (read one whole)\n";
      return `${found.length} fyi records:\n${found.map((fyi) => `  ${fyi.id}  ${fyi.title}\n`).join("")}\nnext:\n  - storytree library read <id>   (read one whole)\n`;
    }
    if (args[0] === "fyi" && args[1] === "new") {
      const flag = (name) => args[args.indexOf(name) + 1];
      const id = `fyi_${String(fyis.length).padStart(12, "0")}`;
      fyis.push({ id, title: flag("--title"), what: flag("--what"), about: flag("--about"), heard: false });
      return `Recorded ${id}.\n`;
    }
    throw new Error(`storytree ${args.join(" ")}: not a call the step makes`);
  };
  return { calls, storytree };
}

test("8.22 · the gate's step fyi:comment-hatches runs packages/repo-checks/src/comment-hatches.mjs, every time", () => {
  const step = gateSteps.find(({ name }) => name === "fyi:comment-hatches");
  assert.ok(step, gateSteps.map(({ name }) => name).join(", "));
  assert.equal(step.when, undefined);
  assert.equal(step.command().args.at(-1), "packages/repo-checks/src/comment-hatches.mjs");
});

test("8.22 · tellHatches records one FYI per hatch the branch adds through storytree fyi new, its what naming file, line, comment and reason, about the file, in the project; a hatch an FYI already tells, heard or not, by library list fyi on its about and what, is not told again, so a second run tells nothing more", async () => {
  const fyis = [{ id: "fyi_aaaaaaaaaaaa", title: "told before", what: OLD_WHAT, about: OLD.file, heard: true }];
  const { calls, storytree } = library(fyis);
  const log = [];

  assert.equal(await tellHatches({ root: "/checkout", project: "storytree", hatches: [OLD, NEW], storytree, log: (line) => log.push(line) }), 0);
  assert.deepEqual(calls, [
    ["library", "list", "fyi", "--where", `about=${OLD.file}`, "--where", `what=${OLD_WHAT}`],
    ["library", "list", "fyi", "--where", `about=${NEW.file}`, "--where", `what=${NEW_WHAT}`],
    ["fyi", "new", "--title", "A comment kept by the escape hatch: packages/b/src/new.ts:3", "--what", NEW_WHAT, "--about", NEW.file, "--project", "storytree"],
  ]);
  assert.deepEqual(fyis.map(({ about, what }) => ({ about, what })), [
    { about: OLD.file, what: OLD_WHAT },
    { about: NEW.file, what: NEW_WHAT },
  ]);

  calls.length = 0;
  assert.equal(await tellHatches({ root: "/checkout", project: "storytree", hatches: [OLD, NEW], storytree, log: (line) => log.push(line) }), 0);
  assert.deepEqual(calls.filter(([family]) => family === "fyi"), []);
  assert.equal(fyis.length, 2);
});

test("8.22 · a branch adding no hatch records nothing, calls no storytree command, and says it adds no comment escape hatch", async () => {
  const { calls, storytree } = library([]);
  const log = [];
  assert.equal(await tellHatches({ root: "/checkout", project: "storytree", hatches: [], storytree, log: (line) => log.push(line) }), 0);
  assert.deepEqual(calls, []);
  assert.ok(log.some((line) => /adds no comment escape hatch/.test(line)), log.join("\n"));
});

test("8.22 · a library the step cannot reach fails it, 1, with a line saying why", async () => {
  const log = [];
  const storytree = async () => {
    throw new Error("connect ECONNREFUSED 100.64.0.7:5432");
  };
  assert.equal(await tellHatches({ root: "/checkout", project: "storytree", hatches: [NEW], storytree, log: (line) => log.push(line) }), 1);
  assert.ok(log.some((line) => line.includes("connect ECONNREFUSED 100.64.0.7:5432")), log.join("\n"));
});
