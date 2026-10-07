/** Capability 1 · Front door, contract 1.14: a value opening with @ is a file only when it names one. */
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

import { Refusal } from "./answer.js";
import { parseArgs } from "./args.js";

test("1.14 a value opening with @ is read from the file it names; prose naming a scoped package is kept as written; a missing one-word path is refused", () => {
  const folder = mkdtempSync(path.join(tmpdir(), "storytree-1-14-"));
  try {
    writeFileSync(path.join(folder, "body.md"), "From the file");
    const prose = "@storytree/processes/testing: testChildArgs() runs the child";
    const args = parseArgs(["--body", "@body.md", "--intent", prose, "--title", "@missing.md"], [], folder);

    assert.equal(args.text("body"), "From the file");
    assert.equal(args.text("intent"), prose);
    assert.throws(() => args.text("title"), (error: unknown) => error instanceof Refusal && /cannot read .*missing\.md/.test(error.message));
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
});
