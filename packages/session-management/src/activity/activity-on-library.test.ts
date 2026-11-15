/**
 * Capability 2 · Agent activity log, contract 2.5 (ADR-0735 D3): the log opens on whichever server
 * the library resolved to, through the library's connection, so two machines sharing one library
 * share one log.
 *
 * Against the test server always, where "two machines" are two connections, each naming its own
 * machine. Against the shared library itself (since ADR-0928 the Mint box's Postgres, which the
 * laptop reaches over Tailscale and the box at 127.0.0.1) only when a run is given its address in
 * STORYTREE_TEST_SHARED_LIBRARY, as the `library` setting names it (signed in with the `postgres` key): each machine's run adds one line naming itself to one proof
 * project's log and reads the log back, and a run given STORYTREE_TEST_SHARED_LIBRARY_PEER (the
 * other machine's host name) also requires that machine's latest line before its own, in order.
 * The proof is three runs: the box, the laptop naming the box, the box naming the laptop.
 *
 * Without the address the live test is not registered at all rather than skipped: CI cannot reach
 * the box, and a skipped test would leave 2.5 "not checked" on every CI run, although the local
 * half proves the behaviour on each one.
 */
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { test } from "node:test";

import { connect, type ConnectOptions } from "@storytree/library";

import { testServerUrl, uniqueProjectName } from "@storytree/project-and-caller/testing/pg";
import { ACTIVITY_DATABASE, openActivityLog, thisMachine } from "./index.js";

const CONTRACT = "2.5 lines two machines write for one project, each through its own library connection, are both read back from either, in order";

/** The project the live proof writes to on the shared library: no library project has this name, so no one's log holds it. */
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
    // Only this test's lines go; the log's database is shared by everything on the server.
    await (await laptop.ownDatabase(ACTIVITY_DATABASE)).query("DELETE FROM activity WHERE project = $1", [project]).catch(() => undefined);
    await Promise.all([laptop.close(), mint.close()]);
  }
}

/**
 * One machine's run of the live proof on the shared library at `address`: it adds a line naming this machine to the proof
 * project's log and reads the log back from the start through its own connection, in number order, its own line last of
 * its own; given `peer`, the other machine's latest line must be read back too, before this one. The lines stay: the
 * other machine's next run reads them.
 */
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
if (shared !== "") {
  test(`${CONTRACT} (shared library, live)`, () => onSharedLibrary(shared, peer));
}
