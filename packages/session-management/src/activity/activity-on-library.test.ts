// Capability 2 · Agent activity log
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { test } from "node:test";

import { connect, type ConnectOptions } from "@storytree/library";

import { testServerUrl, uniqueProjectName } from "@storytree/project-and-caller/testing/pg";
import { ACTIVITY_DATABASE, openActivityLog, thisMachine } from "./index.js";

const CONTRACT = "2.5 lines two machines write for one project, each through its own library connection, are both read back from either, in order";

const PROOF_PROJECT = "storytree-test-two-machine-log";

async function twoMachines(library: ConnectOptions): Promise<void> {
  const project = uniqueProjectName();
  const [laptop, mint] = await Promise.all([connect(library), connect(library)]);
  try {
    const [fromLaptop, fromMint] = await Promise.all([
      openActivityLog(laptop, { machine: "laptop" }),
      openActivityLog(mint, { machine: "mint" }),
    ]);
    await fromLaptop.append(project, { session: "a", harness: "claude-code", source: "hook", kind: "command-run", command: "first" });
    await fromMint.append(project, { session: "b", harness: "codex", source: "hook", kind: "command-run", command: "second" });
    for (const log of [fromLaptop, fromMint]) {
      const { lines } = await log.since(project, 0);
      assert.deepEqual(lines.map((line) => [line.session, line.machine]), [["a", "laptop"], ["b", "mint"]]);
    }
    await Promise.all([fromLaptop.close(), fromMint.close()]);
  } finally {
    await (await laptop.ownDatabase(ACTIVITY_DATABASE)).query("DELETE FROM activity WHERE project = $1", [project]).catch(() => undefined);
    await Promise.all([laptop.close(), mint.close()]);
  }
}

async function onSharedLibrary(address: string, peer: string | undefined): Promise<void> {
  const machine = thisMachine();
  assert.ok(machine !== undefined, "this machine has a host name to stamp its line with");
  assert.notEqual(peer, machine, "the peer named is another machine, not this one");
  const library = await connect({ address });
  const log = await openActivityLog(library, { machine });
  try {
    const nonce = randomBytes(4).toString("hex");
    const mine = await log.append(PROOF_PROJECT, { session: `two-machine-proof-${machine}`, harness: "claude-code", source: "hook", kind: "command-run", command: `2.5 proof ${nonce}` });
    const { lines } = await log.since(PROOF_PROJECT, 0);
    const numbers = lines.map((line) => line.seq);
    assert.deepEqual(numbers, [...numbers].sort((a, b) => a - b), "the log reads back in the order its lines are numbered");
    const own = lines.filter((line) => line.machine === machine);
    assert.deepEqual(own.at(-1), mine, "this machine's line reads back as appending it returned it, its latest");
    if (peer !== undefined) {
      const theirs = lines.filter((line) => line.machine === peer).at(-1);
      assert.ok(theirs !== undefined, `the log holds a line the other machine (${peer}) wrote: run this proof there first`);
      assert.ok(theirs.seq < mine.seq, "the other machine's line, written first, reads back before this one");
      assert.equal(theirs.project, PROOF_PROJECT);
    }
  } finally {
    await log.close();
    await library.close();
  }
}

test(`${CONTRACT} (local server)`, () => twoMachines({ url: testServerUrl() }));

const shared = process.env.STORYTREE_TEST_SHARED_LIBRARY ?? "";
const peer = process.env.STORYTREE_TEST_SHARED_LIBRARY_PEER || undefined;
test("the shared library's activity log reads back a line from this machine in order, after the other machine's when named (live, two machines)", {
  skip: shared === "" ? "owner: the live two-machine proof needs STORYTREE_TEST_SHARED_LIBRARY (and _PEER), run on the laptop and the Mint box" : false,
}, () => onSharedLibrary(shared, peer));
