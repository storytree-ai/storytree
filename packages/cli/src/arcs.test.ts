/**
 * Capability 4 · Arcs and increments: one test per contract in the command line story, each running
 * the real, built `storytree` command.
 */
import assert from "node:assert/strict";
import { userInfo } from "node:os";
import { after, before, test } from "node:test";

import { claim, openActivityLog, readClaims } from "@storytree/agent-link";

import { BuiltCommand, inWorld, testServerUrl, type World } from "./testing/cli.js";

const command = new BuiltCommand();

before(() => command.build());
after(() => command.remove());

test("4.5 `arc list` names each live arc with the library's state", async () => {
  await inWorld(command, async (world) => {
    const library = await world.library();
    const first = await anArc(world);
    const parked = await anArc(world);
    await library.parkArc(parked);
    const retired = await anArc(world);
    await library.retire(retired, "Duplicate plan");
    const ran = await world.run(["arc", "list"]);
    assert.equal(ran.code, 0, ran.stderr);
    for (const id of [first, parked]) {
      const view = await library.arcView(id);
      const line = ran.stdout.split("\n").find((line) => line.includes(id));
      assert.ok(line?.includes(view!.arc.fields.title) && line.includes(view!.state), ran.stdout);
    }
    assert.ok(!ran.stdout.includes(retired), ran.stdout);
  });
});

/** An arc written straight into the library, for a test that is about something else. */
async function anArc(world: World): Promise<string> {
  const arc = await (await world.library()).createArc({ title: "Launch v1", intent: "Ship sign-up", endState: "Visitors sign up" });
  return arc.id;
}

/** The id the command printed for what it wrote: the first `<type>_<hex>` in its answer. */
function idIn(text: string, type: string): string {
  const id = new RegExp(`\\b${type}_[0-9a-f]+\\b`).exec(text)?.[0];
  assert.ok(id !== undefined, `no ${type} id in:\n${text}`);
  return id;
}

test("4.1 an arc with no intent is refused", async () => {
  await inWorld(command, async (world) => {
    const ran = await world.run(["arc", "new", "--title", "Launch v1", "--end-state", "Visitors sign up"]);

    assert.equal(ran.code, 1);
    assert.match(ran.stderr, /\bintent\b/);
    assert.deepEqual((await (await world.library()).changesSince(0)).changes, []);
  });
});

test("4.2 a close with no pull request needs a note", async () => {
  await inWorld(command, async (world) => {
    const arc = await anArc(world);
    // A title that reads as a number is kept as the text given.
    const parked = await world.run(["arc", "increment", "new", "--arc", arc, "--title", "2027", "--objective", "Build it", "--body", "The form, then its checks"]);
    assert.equal(parked.code, 0, parked.stderr);
    const increment = idIn(parked.stdout, "increment");
    assert.equal((await (await world.library()).arcView(arc))?.increments[0]?.fields.title, "2027");

    const bare = await world.run(["arc", "increment", "close", increment, "--disposition", "withdrawn"]);
    assert.equal(bare.code, 1);
    assert.match(bare.stderr, /\bnote\b/);

    const noted = await world.run(["arc", "increment", "close", increment, "--disposition", "withdrawn", "--note", "Folded into the sign-up page"]);
    assert.equal(noted.code, 0, noted.stderr);
    const view = await (await world.library()).arcView(arc);
    assert.deepEqual(view?.increments.map((one) => one.fields.outcome?.note), ["Folded into the sign-up page"]);
  });
});

test("4.3 a wait that would close a loop is refused, naming the loop, and nothing is written", async () => {
  await inWorld(command, async (world) => {
    const library = await world.library();
    const arc = await anArc(world);
    const first = await library.addIncrement({ arc, title: "Schema", objective: "Tables", body: "…" });
    const second = await library.addIncrement({ arc, title: "Form", objective: "The form", body: "…" });
    const waited = await world.run(["arc", "increment", "wait", second.id, "--on", first.id, "--reason", "needs the tables"]);
    assert.equal(waited.code, 0, waited.stderr);
    const before = (await library.changesSince(0)).cursor;

    const ran = await world.run(["arc", "increment", "wait", first.id, "--on", second.id, "--reason", "needs the form"]);

    assert.equal(ran.code, 1);
    assert.ok(ran.stderr.includes(first.id) && ran.stderr.includes(second.id), ran.stderr);
    assert.match(ran.stderr, /loop/);
    assert.deepEqual((await library.changesSince(before)).changes, []);
  });
});

test("4.4 `arc show` names what each waiting increment waits for", async () => {
  await inWorld(command, async (world) => {
    const library = await world.library();
    const arc = await anArc(world);
    const first = await library.addIncrement({ arc, title: "Schema", objective: "Tables", body: "…" });
    const second = await library.addIncrement({ arc, title: "Form", objective: "The form", body: "…" });
    await library.addWait(second.id, first.id, "needs the tables");

    const ran = await world.run(["arc", "show", arc]);

    assert.equal(ran.code, 0, ran.stderr);
    const lines = ran.stdout.split(/\r?\n/);
    const form = lines.findIndex((line) => line.includes(second.id));
    assert.ok(form >= 0, ran.stdout);
    const block = lines.slice(form, form + 4).join("\n");
    assert.ok(block.includes(first.id) && block.includes("needs the tables"), `no wait under ${second.id}:\n${ran.stdout}`);
    assert.match(ran.stdout, /Ship sign-up/);
    assert.match(ran.stdout, /Visitors sign up/);
  });
});

test("4.6 closing an increment ends its claim for any holder and outcome; a refused close leaves it held", async () => {
  await inWorld(command, async (world) => {
    const library = await world.library();
    const arc = await anArc(world);
    const log = await openActivityLog(testServerUrl());
    try {
      for (const [disposition, env, session] of [
        ["landed", { CLAUDE_CODE_SESSION_ID: "holder" }, "holder"],
        ["failed", { CODEX_THREAD_ID: "closer" }, "closer"],
        ["withdrawn", {}, `person:${userInfo().username}`],
      ] as const) {
        const increment = await library.addIncrement({ arc, title: "Email form", objective: "Build it", body: "…" });
        const held = await claim({ log, library, project: world.project, session: "holder", harness: "claude-code" }, increment.id, "building the form");
        assert.equal(held.ok, true);
        const before = await log.since(world.project, 0);
        const close = ["arc", "increment", "close", increment.id, "--disposition", disposition];
        const refused = await world.run(close, env);
        assert.equal(refused.code, 1, refused.stdout);
        assert.match(refused.stderr, /note/);
        assert.equal((await readClaims(log, world.project))[0]?.increment, increment.id);
        assert.deepEqual(await log.since(world.project, 0), before);

        // A bare pull request number, as the guidance's `--pr <n>` gives it, is kept as the text it is.
        const outcome = disposition === "landed" ? ["--pr", "132"] : ["--note", "Folded into the sign-up page"];
        const ran = await world.run([...close, ...outcome], env);
        assert.equal(ran.code, 0, ran.stderr);
        const closed = (await library.arcView(arc))?.increments.find((one) => one.id === increment.id)?.fields.outcome;
        assert.equal(closed?.disposition, disposition);
        if (disposition === "landed") assert.equal(closed?.pr, "132");
        assert.deepEqual(await readClaims(log, world.project), [], "closing it must end the claim");
        const line = (await log.since(world.project, 0)).lines.at(-1);
        assert.equal(line?.kind, "closed");
        if (line?.kind === "closed") assert.deepEqual([line.increment, line.disposition, line.session], [increment.id, disposition, session]);
      }
      const before = await log.since(world.project, 0);
      const missing = await world.run(["arc", "increment", "close", "increment_000000000000", "--disposition", "landed", "--pr", "#132"]);
      assert.equal(missing.code, 1);
      assert.match(missing.stderr, /no increment/);
      assert.deepEqual(await log.since(world.project, 0), before);
    } finally {
      await log.close();
    }
  });
});

test("4.7 `arc increment move` re-homes an increment to another arc, keeping its id and its claim", async () => {
  await inWorld(command, async (world) => {
    const library = await world.library();
    const [from, to] = [await anArc(world), await anArc(world)];
    const increment = await library.addIncrement({ arc: from, title: "Email form", objective: "Build it", body: "…" });
    const log = await openActivityLog(testServerUrl());
    try {
      assert.equal((await claim({ log, library, project: world.project, session: "holder", harness: "claude-code" }, increment.id, "building the form")).ok, true);
      const bare = await world.run(["arc", "increment", "move", increment.id, "--to", to]);
      assert.equal(bare.code, 1, bare.stdout);
      assert.match(bare.stderr, /--reason/);

      const ran = await world.run(["arc", "increment", "move", increment.id, "--to", to, "--reason", "belongs with the launch"]);
      assert.equal(ran.code, 0, ran.stderr);
      assert.deepEqual((await library.arcView(to))?.increments.map(({ id }) => id), [increment.id]);
      assert.deepEqual((await library.arcView(from))?.increments, []);
      assert.equal((await readClaims(log, world.project))[0]?.increment, increment.id, "the claim survives the move");
    } finally {
      await log.close();
    }
  });
});
