/**
 * Capability 6 · Decisions: one test per contract in stories/cli.md, each running the real, built
 * `storytree` command. Contract 6.3 (a superseded decision drops out of `adr list --current`) waits
 * on the library's list(kind) on its public API (0-3-library-writer-and-public-reads), and is
 * written when that lands.
 */
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { after, before, test } from "node:test";

import { BuiltCommand, inWorld } from "./testing/cli.js";

const command = new BuiltCommand();

before(() => command.build());
after(() => command.remove());

/** The number `adr new` answered with: "ADR-<n>". */
function numberIn(text: string): number {
  const number = /\bADR-(\d+)\b/.exec(text)?.[1];
  assert.ok(number !== undefined, `no ADR number in:\n${text}`);
  return Number(number);
}

test("6.1 two `adr new` run at once get different, increasing numbers", async () => {
  await inWorld(command, async (world) => {
    const first = await world.run(["adr", "new", "--title", "Use Postgres", "--text", "One database per project", "--status", "accepted"]);
    assert.equal(first.code, 0, first.stderr);
    const before = numberIn(first.stdout);

    const [a, b] = await Promise.all([
      world.run(["adr", "new", "--title", "Send through Mailgun", "--text", "Simplest API", "--status", "accepted"]),
      world.run(["adr", "new", "--title", "Ship on Tuesdays", "--text", "Quietest day", "--status", "proposed"]),
    ]);

    assert.equal(a.code, 0, a.stderr);
    assert.equal(b.code, 0, b.stderr);
    const numbers = [numberIn(a.stdout), numberIn(b.stdout)];
    assert.notEqual(numbers[0], numbers[1]);
    for (const number of numbers) assert.ok(number > before, `${number} is not after ${before}`);
  });
});

test("6.2 pull then push with no edit changes nothing", async () => {
  await inWorld(command, async (world) => {
    const library = await world.library();
    const decision = await library.recordDecision({ title: "Send through Mailgun", text: "Simplest API.\n\nIts free tier is enough.", status: "accepted", loadBearing: true });
    const file = path.join(world.folder, "adr.md");
    const pulled = await world.run(["adr", "pull", decision.id, "--out", file]);
    assert.equal(pulled.code, 0, pulled.stderr);
    const before = (await library.changesSince(0)).cursor;

    const pushed = await world.run(["adr", "push", decision.id, "--file", file]);

    assert.equal(pushed.code, 0, pushed.stderr);
    assert.deepEqual((await library.changesSince(before)).changes, []);
    assert.deepEqual((await library.decision(decision.id))?.record.fields, decision.fields);
  });
});

test("6.4 a composed statement reads stale after its decision's text changes", async () => {
  await inWorld(command, async (world) => {
    const library = await world.library();
    const decision = await library.recordDecision({ title: "Send through Mailgun", text: "Simplest API.", status: "accepted" });
    const composed = await world.run(["adr", "compose", decision.id, "--statement", "We send email through Mailgun because its API is simplest."]);
    assert.equal(composed.code, 0, composed.stderr);
    const file = path.join(world.folder, "adr.md");
    await world.run(["adr", "pull", decision.id, "--out", file]);
    assert.doesNotMatch(readFileSync(file, "utf8"), /stale/);

    writeFileSync(file, readFileSync(file, "utf8").replace("Simplest API.", "Simplest API, and the cheapest at our size."));
    const pushed = await world.run(["adr", "push", decision.id, "--file", file]);
    assert.equal(pushed.code, 0, pushed.stderr);

    const read = await world.run(["adr", "pull", decision.id]);
    assert.equal(read.code, 0, read.stderr);
    assert.match(read.stdout, /We send email through Mailgun/);
    assert.match(read.stdout, /stale/);
  });
});
