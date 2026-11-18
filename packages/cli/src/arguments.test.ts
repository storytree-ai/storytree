// Capability 16 · Build and launch
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";

const checkout = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

const home = mkdtempSync(path.join(tmpdir(), "storytree-arguments-home-"));
process.env.STORYTREE_HOME = home;
const { run } = await import("./index.js");
after(() => rmSync(home, { recursive: true, force: true }));

function pnpmStorytree(...words: string[]) {
  const pnpm = process.env.npm_execpath;
  assert.ok(pnpm !== undefined, "run these tests through pnpm (pnpm test), which names itself in npm_execpath");
  return spawnSync(process.execPath, [pnpm, "-s", "storytree", ...words], { cwd: checkout, encoding: "utf8", timeout: 50_000 });
}

test("16.1 a word given to `pnpm storytree` arrives as written, holding double quotes, >, &, |, ^, %, backslashes or backticks, and nothing else runs or is written on its way", async () => {
  const stray = "storytree-16-1-stray";
  const word = `he said "a -> ${stray} & b | c ^ d" at 50% of %PATH% in C:\\code\\storytree, \`storytree-16-1-not-a-command\``;
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

test("16.2 a word the script shell would change on its way, a line break or a $, is refused on Windows before the command runs, saying to pass it from a file, and arrives as written elsewhere", () => {
  const word = "a word that\nruns over $HOME two lines";
  const ran = pnpmStorytree(word);

  if (process.platform === "win32") {
    assert.notEqual(ran.status, 0, ran.stderr);
    assert.match(ran.stderr, /changed word 1/);
    assert.match(ran.stderr, /@<file>/);
    assert.doesNotMatch(ran.stderr, /has no/, "the command ran with the changed word");
  } else {
    assert.doesNotMatch(ran.stderr, /changed word/);
    assert.ok(ran.stderr.includes(`has no "${word}"`), ran.stderr);
  }
});
