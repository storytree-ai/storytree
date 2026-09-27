/**
 * Capability 6 · Decisions: one test per contract in the command line story, each running the real, built
 * `storytree` command.
 */
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { after, before, test } from "node:test";

import { BuiltCommand, inWorld } from "./testing/cli.js";

const command = new BuiltCommand();

before(() => command.build());
after(() => command.remove());

test("6.3 a superseded decision drops out of `--current`; filters use the library's status", async () => {
  await inWorld(command, async (world) => {
    const library = await world.library();
    const old = await library.recordDecision({ title: "Mailgun", text: "Simple API", status: "accepted", loadBearing: true });
    const replacement = await library.recordDecision({ title: "SES", text: "Lower cost", status: "accepted", supersedes: [old.id], loadBearing: true });
    const proposal = await library.recordDecision({ title: "SMTP", text: "Run our own", status: "proposed" });
    const ordinary = await library.recordDecision({ title: "TLS", text: "Encrypt mail", status: "accepted" });
    for (const [flags, included, excluded] of [
      [[], [old.id, replacement.id, proposal.id, ordinary.id], []],
      [["--current"], [replacement.id, ordinary.id], [old.id, proposal.id]],
      [["--status", "superseded"], [old.id], [replacement.id, proposal.id, ordinary.id]],
      [["--status", "proposed"], [proposal.id], [old.id, replacement.id, ordinary.id]],
      [["--current", "--load-bearing"], [replacement.id], [old.id, proposal.id, ordinary.id]],
    ] as const) {
      const ran = await world.run(["adr", "list", ...flags]);
      assert.equal(ran.code, 0, ran.stderr);
      for (const id of included) assert.ok(ran.stdout.includes(id), ran.stdout);
      for (const id of excluded) assert.ok(!ran.stdout.includes(id), ran.stdout);
    }
  });
});

test("6.5 `adr pull` names a decision by id, number, or ADR number", async () => {
  await inWorld(command, async (world) => {
    const decision = await (await world.library()).recordDecision({ title: "Mailer", text: "Mailgun", status: "accepted" });
    const byId = await world.run(["adr", "pull", decision.id]);
    assert.equal(byId.code, 0, byId.stderr);
    for (const name of [String(decision.fields.number), `ADR-${String(decision.fields.number).padStart(4, "0")}`]) {
      const ran = await world.run(["adr", "pull", name]);
      assert.equal(ran.code, 0, ran.stderr);
      assert.equal(ran.stdout, byId.stdout);
    }
    const missing = await world.run(["adr", "pull", "9999"]);
    assert.equal(missing.code, 1);
    assert.match(missing.stderr, /no decision/);
  });
});

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

test("6.6 `adr new --number` keeps the supplied number and refuses reuse or invalid numbers", async () => {
  await inWorld(command, async (world) => {
    const args = ["adr", "new", "--title", "Imported", "--text", "Full record: ADR-0621", "--status", "accepted", "--number"];
    const created = await world.run([...args, "621"]);
    assert.equal(created.code, 0, created.stderr);
    assert.equal(numberIn(created.stdout), 621);
    const library = await world.library();
    const before = await library.history();
    for (const number of ["621", "-1", "0", "1.5", "wat", "9007199254740992"]) {
      const refused = await world.run([...args, number]);
      assert.equal(refused.code, 1, refused.stdout);
      assert.match(refused.stderr, /number/);
    }
    assert.deepEqual(await library.history(), before);
  });
});
