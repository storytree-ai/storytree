/**
 * Capability 1 · Front door, contracts 1.10 and 1.11: the words an agent gives `pnpm storytree` in a
 * storytree checkout reach the command as written, or the command refuses them and does nothing.
 * Each runs the checkout's own `storytree` script through the pnpm running these tests, with no shell
 * of the test's own in between: pnpm appends each word to the script's line as a JSON string and
 * hands that line to a shell (ADR-0851).
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readdirSync, rmSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { run } from "./index.js";

const checkout = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

/** `pnpm -s storytree <words…>` in the checkout, by the pnpm these tests run under. */
function pnpmStorytree(...words: string[]) {
  const pnpm = process.env.npm_execpath;
  assert.ok(pnpm !== undefined, "run these tests through pnpm (pnpm test), which names itself in npm_execpath");
  return spawnSync(process.execPath, [pnpm, "-s", "storytree", ...words], { cwd: checkout, encoding: "utf8", timeout: 50_000 });
}

test("1.10 a word given to `pnpm storytree` arrives as written, holding double quotes, >, &, |, ^, %, backslashes or backticks, and nothing else runs or is written on its way", async () => {
  const stray = "storytree-1-10-stray";
  const word = `he said "a -> ${stray} & b | c ^ d" at 50% of %PATH% in C:\\code\\storytree, \`storytree-1-10-not-a-command\``;
  const strays = () => readdirSync(checkout).filter((name) => name.startsWith(stray));
  const answered: string[] = [];
  await run([word], { cwd: checkout, out: () => {}, err: (text) => answered.push(text) });
  try {
    const ran = pnpmStorytree(word);

    assert.equal(ran.stderr, answered.join(""), "the door's own answer for the word, and nothing else");
    assert.deepEqual(strays(), [], "the > in the word wrote a file");
  } finally {
    for (const name of strays()) rmSync(path.join(checkout, name), { force: true });
  }
});

test("1.11 a word the script shell changes on its way, a line break or a $, is refused before the command runs, saying to pass it from a file", () => {
  const ran = pnpmStorytree("a word that\nruns over two lines");

  assert.notEqual(ran.status, 0, ran.stderr);
  assert.match(ran.stderr, /changed word 1/);
  assert.match(ran.stderr, /@<file>/);
  assert.doesNotMatch(ran.stderr, /has no/, "the command ran with the changed word");
});
