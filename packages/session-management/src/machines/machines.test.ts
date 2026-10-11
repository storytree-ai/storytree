/**
 * Capability 11 · Machines (ADR-0982): the computers that work on a project, each with a short name, its hostname and
 * its id. Names are kept in the trunks database of the real Postgres `pnpm test` provides, shared by every test there,
 * so each test names its machines with names no other test uses; each machine is a throwaway storytree home, whose
 * machine.json gives it its id.
 */
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdtemp } from "node:fs/promises";
import { hostname, tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

import { connect, type Library, type Storytree } from "@storytree/library";

import { openActivityLog } from "../activity/index.js";
import { machineOf, registerTrunk } from "../routing/trunks.js";
import { MACHINE_VERBS, SESSION_VERBS, VerbRefusal, type DoorWords, type Verb } from "../sessions/verbs.js";
import { removeTempDir } from "../testing/folders.js";
import { testServerUrl, uniqueProjectName } from "../testing/pg.js";
import { machineNames, nameThisMachine } from "./machines.js";

const WORDS: DoorWords = { door: "command", say: (step) => step.command === undefined ? step.tool! : `storytree ${step.command}` };

/** A short name no other test, and no earlier run, gives a machine. */
function uniqueName(): string {
  return `m-${randomBytes(4).toString("hex")}`;
}

function command(verbs: readonly Verb[], family: string, name: string): Verb {
  const found = verbs.find((one) => "family" in one.command && one.command.family === family && one.command.name === name);
  assert.ok(found, `${family} ${name}`);
  return found;
}

/** Run `body` with a connection to the test server and two machines' homes, removed afterwards. */
async function withMachines(body: (storytree: Storytree, homes: [string, string]) => Promise<void>): Promise<void> {
  const storytree = await connect({ url: testServerUrl() });
  const homes = [await mkdtemp(path.join(tmpdir(), "machine-a-")), await mkdtemp(path.join(tmpdir(), "machine-b-"))] as [string, string];
  try {
    await body(storytree, homes);
  } finally {
    await storytree.close();
    for (const home of homes) await removeTempDir(home);
  }
}

/** What a verb needs of its caller here: the library server, through the project's library, and the storytree home. */
function caller(storytree: Storytree, home: string, project = uniqueProjectName()) {
  return { log: undefined as never, library: {} as Library, server: storytree, project, session: "claude-1", harness: "claude-code", folder: home, home };
}

test("11.1 · `storytree machine name <name>` gives this computer a short name, kept with its hostname and id; a name another machine has, or one that is not a short name, is refused", async () => {
  await withMachines(async (storytree, [here, there]) => {
    const name = command(MACHINE_VERBS, "machine", "name");
    const laptop = uniqueName();
    const named = await name.act({ name: laptop }, caller(storytree, here), WORDS);
    const id = machineOf(here).id;
    assert.equal(named.text, `Named this computer "${laptop}" (hostname ${hostname().trim()}, id ${id}).`);
    assert.deepEqual(named.data, { id, hostname: hostname().trim(), name: laptop });

    // Another machine may not take a name one already has.
    await assert.rejects(name.act({ name: laptop }, caller(storytree, there), WORDS), (error: unknown) => error instanceof VerbRefusal && error.message.includes(`"${laptop}" already names another machine`));
    // A short name is lowercase letters, digits and hyphens; "none" clears an increment's machine, so no machine is called it.
    for (const wrong of ["Laptop", "my laptop", "-laptop", "x".repeat(33), "none"]) {
      await assert.rejects(name.act({ name: wrong }, caller(storytree, there), WORDS), (error: unknown) => error instanceof VerbRefusal && error.misuse, wrong);
    }

    // Naming again replaces this computer's name, and frees the old one.
    const renamed = uniqueName();
    await name.act({ name: renamed }, caller(storytree, here), WORDS);
    await nameThisMachine(storytree, laptop, { home: there, host: "box" });
    assert.equal((await machineNames(storytree)).get("box"), laptop);
    assert.equal((await machineNames(storytree)).get(hostname().trim()), renamed);
  });
});

test("11.2 · `storytree machine list` shows the project's machines, each with its name, hostname and id, and marks this one; `storytree machine this` says which one this computer is", async () => {
  await withMachines(async (storytree, [here, there]) => {
    const project = uniqueProjectName();
    const list = command(MACHINE_VERBS, "machine", "list");
    const which = command(MACHINE_VERBS, "machine", "this");
    const hereId = machineOf(here).id;
    const thereId = machineOf(there).id;

    // Before it is named, this computer is known by its hostname and id.
    assert.equal((await which.act({}, caller(storytree, here, project), WORDS)).text, `This computer has no name yet (hostname ${hostname().trim()}, id ${hereId}): give it one with storytree machine name <name>.`);

    // A machine with a trunk of the project is one of its machines, named or not; so is this one once named.
    const thereHost = `host-${randomBytes(4).toString("hex")}`;
    assert.equal(await registerTrunk(storytree, { project, machine: thereId, machineName: thereHost, folder: path.join(there, "checkout") }), true);
    const mint = uniqueName();
    await nameThisMachine(storytree, mint, { home: here });

    const listed = await list.act({}, caller(storytree, here, project), WORDS);
    const rows = (listed.data?.machines ?? []) as { id: string; hostname: string; name?: string; here: boolean }[];
    assert.deepEqual(rows.find((row) => row.id === hereId), { id: hereId, hostname: hostname().trim(), name: mint, here: true });
    assert.deepEqual(rows.find((row) => row.id === thereId), { id: thereId, hostname: thereHost, here: false });
    assert.ok(listed.text.includes(`${mint}  ${hostname().trim()}  ${hereId}  (this computer)`), listed.text);
    assert.ok(listed.text.includes(`(no name)  ${thereHost}  ${thereId}`), listed.text);

    assert.equal((await which.act({}, caller(storytree, here, project), WORDS)).text, `This computer is "${mint}" (hostname ${hostname().trim()}, id ${hereId}).`);
  });
});

test("11.3 · The sessions list shows each session's machine by its short name, or by its hostname while it has none", async () => {
  await withMachines(async (storytree, [here]) => {
    const log = await openActivityLog(testServerUrl());
    try {
      const project = uniqueProjectName();
      const namedHost = `host-${randomBytes(4).toString("hex")}`;
      const bareHost = `host-${randomBytes(4).toString("hex")}`;
      const mint = uniqueName();
      await nameThisMachine(storytree, mint, { home: here, host: namedHost });
      await log.append(project, { session: "on-mint", harness: "codex", source: "hook", kind: "prompt-submitted", machine: namedHost });
      await log.append(project, { session: "elsewhere", harness: "claude-code", source: "hook", kind: "prompt-submitted", machine: bareHost });

      const list = command(SESSION_VERBS, "session", "list");
      const context = { ...caller(storytree, here, project), log };
      const text = (await list.act({ all: true, json: false }, context, WORDS)).text;
      const blockOf = (session: string) => text.split("\n\n").find((block) => block.includes(` ${session}:`)) ?? "";
      assert.ok(blockOf("on-mint").includes(`  machine: ${mint}`), text);
      assert.ok(blockOf("elsewhere").includes(`  machine: ${bareHost}`), text);

      const json = JSON.parse((await list.act({ all: true, json: true }, context, WORDS)).text) as { session: string; machine?: string }[];
      assert.equal(json.find((one) => one.session === "on-mint")?.machine, namedHost);
    } finally {
      await log.close();
    }
  });
});
