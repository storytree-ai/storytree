import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { promisify } from "node:util";

import { removeTemp } from "@storytree/test-waits";

import { EXEMPTIONS, exemptionChanges, watchExemptions } from "./exemptions-watch.mjs";

const run = promisify(execFile);
// The author and committer named whatever the machine's own git settings or environment say.
const who = { GIT_AUTHOR_NAME: "Committer", GIT_AUTHOR_EMAIL: "c@example.com", GIT_COMMITTER_NAME: "Committer", GIT_COMMITTER_EMAIL: "c@example.com" };
const git = async (args, cwd) => (await run("git", args, { cwd, env: { ...process.env, ...who } })).stdout.trim();

/** Writes the list with `lines` under its header and commits it on the branch checked out. */
async function commitList(repo, lines, message) {
  await writeFile(join(repo, EXEMPTIONS), ["# Files the secret check passes over.", ...lines, ""].join("\n"));
  await git(["add", "-A"], repo);
  await git(["commit", "--quiet", "-m", message], repo);
}

/** Merges `branch` into main as GitHub does for pull request `pr`. */
const mergePull = (repo, branch, pr) => git(["merge", "--quiet", "--no-ff", "-m", `Merge pull request #${pr} from storytree-ai/${branch}`, branch], repo);

test("4.42 · each change to the secret-check exemptions list on main is told once as an FYI, with what it added and took away, its pull request and who opened it, and none again on a re-run", async (t) => {
  // `repo` stands in for GitHub's main; the watcher reads its own clone, fetching main before each look.
  const home = await mkdtemp(join(tmpdir(), "exemptions-"));
  t.after(() => removeTemp(home));
  const repo = join(home, "origin"), clone = join(home, "clone");
  await mkdir(repo);
  await git(["init", "--quiet", "-b", "main"], repo);
  await mkdir(join(repo, ".github"));
  await commitList(repo, [], "Begin the list, empty"); // only comments: nothing exempted, nothing to tell
  await git(["checkout", "--quiet", "-b", "add-key"], repo);
  await commitList(repo, ["packages/keys/src/stand-in.test.ts"], "Exempt the stand-in key");
  await git(["checkout", "--quiet", "main"], repo);
  await mergePull(repo, "add-key", 7);
  await git(["checkout", "--quiet", "-b", "other"], repo);
  await writeFile(join(repo, "README.md"), "unrelated\n");
  await git(["add", "-A"], repo);
  await git(["commit", "--quiet", "-m", "Something else"], repo);
  await git(["checkout", "--quiet", "main"], repo);
  await mergePull(repo, "other", 8);
  await commitList(repo, ["packages/keys/src/stand-in.test.ts  # its comment edited"], "Reword a comment"); // the same entry: nothing to tell
  await git(["clone", "--quiet", repo, clone], home);

  const fyis = [];
  const look = () => watchExemptions({
    readExemptions: () => exemptionChanges({ repo: clone, openerOf: async (pr) => `opener-of-${pr}` }),
    recorded: async (about) => fyis.some((fyi) => fyi.about === about),
    record: async (fyi) => { fyis.push(fyi); },
  });
  await look();
  const merge7 = await git(["rev-parse", "main~2"], repo);
  assert.deepEqual(fyis, [{
    title: "The secret-check exemptions list changed (PR #7)",
    what: `PR #7, opened by opener-of-7, changed the files the secret check passes over (${EXEMPTIONS}) on main: it now also exempts packages/keys/src/stand-in.test.ts. Commit ${merge7.slice(0, 12)}.`,
    about: `${EXEMPTIONS}@${merge7}`,
    at: await git(["log", "-1", "--format=%cI", merge7], repo),
  }]);

  await look();
  assert.equal(fyis.length, 1, "a re-run records nothing it already told");

  // A change pushed straight to main, and one more by pull request, both since the last look: each told once, in order.
  await commitList(repo, [], "Drop the stand-in key");
  await git(["checkout", "--quiet", "-b", "two"], repo);
  await commitList(repo, ["a.test.ts", "b.test.ts"], "Exempt two");
  await git(["checkout", "--quiet", "main"], repo);
  await mergePull(repo, "two", 9);
  await look();
  await look();
  assert.deepEqual(fyis.map(({ title, what }) => ({ title, what: what.replace(/ Commit \w+\.$/, "") })), [
    { title: "The secret-check exemptions list changed (PR #7)", what: `PR #7, opened by opener-of-7, changed the files the secret check passes over (${EXEMPTIONS}) on main: it now also exempts packages/keys/src/stand-in.test.ts.` },
    { title: "The secret-check exemptions list changed", what: `A commit by Committer, pushed straight to main with no pull request, changed the files the secret check passes over (${EXEMPTIONS}) on main: it no longer exempts packages/keys/src/stand-in.test.ts.` },
    { title: "The secret-check exemptions list changed (PR #9)", what: `PR #9, opened by opener-of-9, changed the files the secret check passes over (${EXEMPTIONS}) on main: it now also exempts a.test.ts, b.test.ts.` },
  ]);
});
