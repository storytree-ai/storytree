/** Capability 2 · Arm workspaces: the `experiment arm` verbs the command line mounts, refused away from the cluster that holds the library. */
import assert from "node:assert/strict";
import { test } from "node:test";

import { VerbRefusal, type DoorWords } from "@storytree/library/verbs";
import { withTempDir } from "@storytree/project-and-caller/testing/folders";

import { ARM_FAMILY, localAdmin } from "./arm-verbs.js";
import { EXPERIMENT_FAMILIES } from "./record/verbs.js";

const WORDS: DoorWords = { door: "command", say: (step) => `storytree ${step.command}` };

test("2.4 · Experiments declares `experiment arm make`, `grant` and `drop`, which act on the cluster holding the caller's library on this machine and are refused, making nothing, where the library is not there", async () => {
  const [family] = EXPERIMENT_FAMILIES;
  assert.ok(family!.families!.includes(ARM_FAMILY));
  const arm = ARM_FAMILY;
  assert.deepEqual([family!.name, arm.name, ...arm.verbs.map((one) => (one.command as { name: string }).name)], ["experiment", "arm", "make", "grant", "drop"]);

  const before = process.env.STORYTREE_HOME;
  await withTempDir(async (home) => {
    process.env.STORYTREE_HOME = home;
    try {
      for (const one of arm.verbs) {
        await assert.rejects(
          one.act({ experiment: "twin-build", arm: "map-reads-off", home: undefined }, { folder: home }, WORDS),
          (error: unknown) => error instanceof VerbRefusal && /cluster that holds your library, on this machine/.test(error.message),
        );
      }
    } finally {
      if (before === undefined) delete process.env.STORYTREE_HOME;
      else process.env.STORYTREE_HOME = before;
    }
  });
});

test("2.6 · The arm verbs sign in to the cluster as this machine's own user over its local socket, with no password, never as the library's role", () => {
  const admin = localAdmin("postgres://storytree_library@127.0.0.1:5433/storytree", "storytree-activity");
  assert.equal(admin.user, process.env.USER ?? process.env.USERNAME);
  assert.equal(admin.password, undefined);
  assert.equal(admin.host, "/var/run/postgresql");
  assert.equal(admin.port, 5433);
  assert.equal(admin.database, "storytree-activity");
});
