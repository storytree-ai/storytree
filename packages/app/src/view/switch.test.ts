import assert from "node:assert/strict";
import { test } from "node:test";
import { switchProject } from "./switch.js";

function recorder(choose: (name: string) => Promise<void>) {
  const seen: string[] = [];
  const steps = {
    choose: async (name: string) => { seen.push(`choose ${name}`); await choose(name); },
    chosen: () => { seen.push("closed"); },
    failed: (message: string) => { seen.push(`shown: ${message}`); },
    busy: (on: boolean) => { seen.push(on ? "list held" : "list free"); },
  };
  return { seen, steps };
}

test("2.1 choosing another project switches to it and closes the overlay", async () => {
  const { seen, steps } = recorder(async () => {});
  await switchProject("garden", steps);
  assert.deepEqual(seen, ["list held", "choose garden", "closed", "list free"]);
});

test("2.1 a failed choice shows its reason inside Projects, stays open, and leaves the list free to retry", async () => {
  let fail = true;
  const { seen, steps } = recorder(async () => { if (fail) throw new Error("the library is not reachable"); });
  await switchProject("garden", steps);
  assert.deepEqual(seen, ["list held", "choose garden", "shown: Couldn’t switch project: the library is not reachable", "list free"]);
  fail = false;
  seen.length = 0;
  await switchProject("garden", steps);
  assert.deepEqual(seen, ["list held", "choose garden", "closed", "list free"], "the retry goes through");
});
