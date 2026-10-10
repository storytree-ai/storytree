/**
 * Capability 4 · Graduated checks (the Guardrails story, ADR-0956 D5): the fixed-pattern part of a
 * quality control check, run on the files a branch changes against origin/main, in a real git checkout.
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test, type TestContext } from "node:test";

import { GRADUATED_CHECKS, graduatedChecks } from "../index.js";

const git = (cwd: string, ...args: string[]) => execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });

function write(root: string, files: Record<string, string>): void {
  for (const [file, text] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    writeFileSync(path.join(root, file), text);
  }
}

/** A git checkout whose origin/main holds `base`, removed after the test; `withMain: false` leaves origin/main out. */
function checkout(t: TestContext, base: Record<string, string>, withMain = true): string {
  const at = mkdtempSync(path.join(tmpdir(), "graduated-"));
  t.after(() => rmSync(at, { recursive: true, force: true }));
  git(at, "init", "-q");
  write(at, base);
  git(at, "add", "-A");
  git(at, "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "-m", "base");
  if (withMain) git(at, "update-ref", "refs/remotes/origin/main", "HEAD");
  return at;
}

const OLD_TRIP = 'import assert from "node:assert/strict";\nconst LIMIT = 10;\nassert.equal(LIMIT, LIMIT);\n';

test("4.1 · each graduated check reports every place it trips in the files a branch changes, by name, file and line; an untouched file's trip is not reported", (t: TestContext) => {
  const at = checkout(t, { "packages/cart/test/old.test.ts": OLD_TRIP, "packages/cart/test/cart.test.ts": "// nothing yet\n" });
  write(at, {
    "packages/cart/test/cart.test.ts": [
      'import assert from "node:assert/strict";',
      'import { LIMIT, total } from "../src/cart.js";',
      "assert.equal(LIMIT, LIMIT);",
      "assert.equal(total([1, 2]), 3);",
      "assert.deepStrictEqual(",
      "  total([1, 2]),",
      "  total( [1,  2] ),",
      '  "the same call on both sides",',
      ");",
      'assert.equal("a, b", "a, c");',
      "",
    ].join("\n"),
    "packages/cart/test/new.test.ts": "expect(LIMIT).toBe(LIMIT);\nexpect(LIMIT).toBe(10);\nexpect(LIMIT).not.toBe(LIMIT);\n",
  });

  const found = graduatedChecks(at);

  assert.deepEqual(found, {
    ran: true,
    trips: [
      { check: "self-equal-assertion", file: "packages/cart/test/cart.test.ts", line: 3 },
      { check: "self-equal-assertion", file: "packages/cart/test/cart.test.ts", line: 5 },
      { check: "self-equal-assertion", file: "packages/cart/test/new.test.ts", line: 1 },
    ],
  });
  assert.deepEqual(GRADUATED_CHECKS, ["self-equal-assertion"]);
});

test("4.1 · a change that trips nothing reports nothing", (t: TestContext) => {
  const at = checkout(t, { "src/a.test.ts": OLD_TRIP });
  write(at, { "src/b.test.ts": 'assert.strict.equal(add(1, 2), 3);\nexpect(add(1, 2)).toEqual(3);\n' });
  assert.deepEqual(graduatedChecks(at), { ran: true, trips: [] });
});

test("4.2 · it reads the checkout alone and writes nothing; without origin/main to compare with it has not run, never passed", (t: TestContext) => {
  const at = checkout(t, { "src/a.test.ts": "// base\n" }, false);
  write(at, { "src/a.test.ts": OLD_TRIP });
  const before = git(at, "status", "--porcelain");

  const found = graduatedChecks(at);

  assert.equal(found.ran, false);
  assert.match(found.ran ? "" : found.reason, /origin\/main/);
  assert.equal(git(at, "status", "--porcelain"), before);
});
