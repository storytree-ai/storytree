/**
 * Capability 4 · Arcs and increments: one test per contract in the command line story, each running
 * the real, built `storytree` command.
 */
import assert from "node:assert/strict";
import { userInfo } from "node:os";
import { after, before, test } from "node:test";

import { claim, openActivityLog, readClaims } from "@storytree/agent-link";

import { parseArgs } from "./args.js";
import type { Context } from "./door.js";
import { arcs } from "./families/arc.js";
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
    const dated = await anArc(world);
    await library.parkArc(dated, { until: "2099-01-01" });
    const retired = await anArc(world);
    await library.retire(retired, "Duplicate plan");
    const ran = await world.run(["arc", "list"]);
    assert.equal(ran.code, 0, ran.stderr);
    for (const id of [first, parked]) {
      const view = await library.arcView(id);
      const line = ran.stdout.split("\n").find((line) => line.includes(id));
      assert.ok(line?.includes(view!.arc.fields.title) && line.includes(view!.state), ran.stdout);
    }
    assert.ok(ran.stdout.split("\n").find((line) => line.includes(dated))?.includes("parked until 2099-01-01"), ran.stdout);
    assert.ok(!ran.stdout.includes(retired), ran.stdout);
  });
});

test("4.5 `arc list` reads every arc in one ask, however many arcs the project has (ADR-0836 D3)", async () => {
  await inWorld(command, async (world) => {
    const library = await world.library();
    for (let n = 0; n < 3; n++) await anArc(world);
    const asked = { arcView: 0, arcViews: 0 };
    const counted = new Proxy(library, {
      get(target, key) {
        if (key === "arcView" || key === "arcViews") asked[key]++;
        const value = Reflect.get(target, key) as unknown;
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
    const list = arcs.verbs.find((verb) => verb.name === "list")!;
    const answer = await list.act(parseArgs([], [], world.folder), { library: async () => counted } as unknown as Context);
    assert.match(answer.text, /^3 arcs:/);
    assert.deepEqual(asked, { arcView: 0, arcViews: 1 });
  });
});

test("4.8 `arc show` reads the arc's view once and every hold in one ask, however many open increments the arc has: never a hold read per increment", async () => {
  await inWorld(command, async (world) => {
    const library = await world.library();
    const arc = await anArc(world);
    const first = await library.addIncrement({ arc, title: "Schema", objective: "Tables", body: "…" });
    for (const title of ["Form", "Email", "Thanks page"]) {
      const next = await library.addIncrement({ arc, title, objective: title, body: "…" });
      await library.addWait(next.id, first.id, "needs the tables");
    }
    const asked = { arcView: 0, holds: 0, waitHolds: 0, heldOnQuestion: 0 };
    const counted = new Proxy(library, {
      get(target, key) {
        if (typeof key === "string" && key in asked) asked[key as keyof typeof asked]++;
        const value = Reflect.get(target, key) as unknown;
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
    const show = arcs.verbs.find((verb) => verb.name === "show")!;
    const answer = await show.act(parseArgs([arc], [], world.folder), { library: async () => counted } as unknown as Context);
    assert.equal(answer.text.split("\n").filter((line) => line.includes(`waits on ${first.id}: needs the tables`)).length, 3, answer.text);
    assert.deepEqual(asked, { arcView: 1, holds: 1, waitHolds: 0, heldOnQuestion: 0 });
  });
});

test("4.9 `arc increment wait --for` makes an increment wait for you, or for an outside event until a check-back day, with a note, and `unwait --for` clears it; a wrong wait is refused readably, with nothing written", async () => {
  await inWorld(command, async (world) => {
    const library = await world.library();
    const increment = (await library.addIncrement({ arc: await anArc(world), title: "Ship to TestFlight", objective: "A build testers install", body: "…" })).id;

    const owner = await world.run(["arc", "increment", "wait", increment, "--for", "owner", "--note", "Sign the Apple developer agreement"]);
    assert.equal(owner.code, 0, owner.stderr);
    const event = await world.run(["arc", "increment", "wait", increment, "--for", "event", "--note", "Apple reviews build 12", "--check-back", "2099-01-01"]);
    assert.equal(event.code, 0, event.stderr);
    assert.deepEqual(await library.waitsFor(increment), [
      { releaser: "owner", note: "Sign the Apple developer agreement", holds: true },
      { releaser: "event", note: "Apple reviews build 12", checkBack: "2099-01-01", holds: true },
    ]);

    const before = (await library.changesSince(0)).cursor;
    for (const [words, code, said] of [
      [["--for", "event", "--note", "DNS has propagated"], 1, /check-back day/],
      [["--for", "owner"], 2, /--note[\s\S]*--for owner\|event --note <text\|@file> \[--check-back YYYY-MM-DD\]/],
      [["--for", "owner", "--note", "Pay it", "--on", increment, "--reason", "why"], 2, /--on[\s\S]*--for/],
      [["--for", "someone", "--note", "Pay it"], 2, /owner or event/],
    ] as const) {
      const ran = await world.run(["arc", "increment", "wait", increment, ...words]);
      assert.equal(ran.code, code, `${words.join(" ")}: ${ran.stdout}${ran.stderr}`);
      assert.match(ran.stderr, said);
    }
    assert.deepEqual((await library.changesSince(before)).changes, []);

    const cleared = await world.run(["arc", "increment", "unwait", increment, "--for", "owner"]);
    assert.equal(cleared.code, 0, cleared.stderr);
    assert.deepEqual((await library.waitsFor(increment)).map(({ releaser }) => releaser), ["event"]);
  });
});

test("4.4 `arc show` names each wait for you or an outside event under its increment, and an event whose check-back day has come", async () => {
  await inWorld(command, async (world) => {
    const library = await world.library();
    const arc = await anArc(world);
    const [sign, review, dns] = await Promise.all(["Ship to TestFlight", "Release", "Point the domain"].map((title) => library.addIncrement({ arc, title, objective: title, body: "…" })));
    await library.addWaitFor(sign!.id, { releaser: "owner", note: "Sign the Apple developer agreement" });
    await library.addWaitFor(review!.id, { releaser: "event", note: "Apple reviews build 12", checkBack: "2099-01-01" });
    await library.addWaitFor(dns!.id, { releaser: "event", note: "DNS has propagated", checkBack: today() });

    const ran = await world.run(["arc", "show", arc]);

    assert.equal(ran.code, 0, ran.stderr);
    const lines = ran.stdout.split(/\r?\n/);
    const under = (id: string) => lines[lines.findIndex((line) => line.includes(id)) + 1]?.trim();
    assert.equal(under(sign!.id), "waiting on you: Sign the Apple developer agreement", ran.stdout);
    assert.equal(under(review!.id), "waits for an event: Apple reviews build 12 (check back 2099-01-01)", ran.stdout);
    assert.equal(under(dns!.id), `check-back passed ${today()}: DNS has propagated`, ran.stdout);
  });
});

test("4.10 `arc waits` lists every open increment's waits for you or an outside event across arcs, yours first, then events by check-back day with the overdue flagged, from one read of the holds and one of the arcs", async () => {
  await inWorld(command, async (world) => {
    const library = await world.library();
    const verb = arcs.verbs.find((one) => one.name === "waits")!;
    const none = await verb.act(parseArgs([], [], world.folder), { library: async () => library } as unknown as Context);
    assert.equal(none.text, "No waits for you or an outside event.");

    const launch = await anArc(world);
    const docs = (await library.createArc({ title: "Docs site", intent: "Explain it", endState: "Readers find answers" })).id;
    const release = await library.addIncrement({ arc: launch, title: "Release", objective: "On the store", body: "…" });
    const dns = await library.addIncrement({ arc: docs, title: "Point the domain", objective: "docs.example", body: "…" });
    const sign = await library.addIncrement({ arc: docs, title: "Ship to TestFlight", objective: "A build", body: "…" });
    const gone = await library.addIncrement({ arc: launch, title: "Old plan", objective: "Dropped", body: "…" });
    await library.addWaitFor(release.id, { releaser: "event", note: "Apple reviews build 12", checkBack: "2099-01-01" });
    await library.addWaitFor(dns.id, { releaser: "event", note: "DNS has propagated", checkBack: today() });
    await library.addWaitFor(sign.id, { releaser: "owner", note: "Sign the Apple developer agreement" });
    await library.addWaitFor(gone.id, { releaser: "owner", note: "Never listed: its increment is closed" });
    await library.closeIncrement(gone.id, { disposition: "withdrawn", note: "Folded in" });
    const asked = { arcView: 0, arcViews: 0, holds: 0, waitsFor: 0 };
    const counted = new Proxy(library, {
      get(target, key) {
        if (typeof key === "string" && key in asked) asked[key as keyof typeof asked]++;
        const value = Reflect.get(target, key) as unknown;
        return typeof value === "function" ? value.bind(target) : value;
      },
    });

    const answer = await verb.act(parseArgs([], [], world.folder), { library: async () => counted } as unknown as Context);

    assert.deepEqual(answer.text.split("\n"), [
      "3 waits for you or an outside event:",
      `  - you    Sign the Apple developer agreement — ${sign.id}  Ship to TestFlight, on ${docs}  Docs site`,
      `  - event  DNS has propagated — ${dns.id}  Point the domain, on ${docs}  Docs site; check back ${today()}, overdue`,
      `  - event  Apple reviews build 12 — ${release.id}  Release, on ${launch}  Launch v1; check back 2099-01-01`,
    ]);
    assert.deepEqual(asked, { arcView: 0, arcViews: 1, holds: 1, waitsFor: 0 });
    assert.ok(answer.next?.some((step) => step.command.startsWith("storytree arc increment unwait")), JSON.stringify(answer.next));
  });
});

/** Today, as the library dates a check-back: YYYY-MM-DD in UTC. */
function today(): string {
  return new Date().toISOString().slice(0, 10);
}

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

test("4.2 correct-closure requires a reason and corrects a closed outcome visibly in its history", async () => {
  await inWorld(command, async (world) => {
    const library = await world.library();
    const arc = await anArc(world);
    const increment = await library.addIncrement({ arc, title: "Schema", objective: "Tables", body: "…" });
    const args = ["arc", "increment", "correct-closure", increment.id, "--disposition", "landed", "--pr", "857"];
    const reason = "Its own pull request merged; withdrawn was a mistake";
    const before = await library.history({ id: increment.id });
    const open = await world.run([...args, "--reason", reason]);
    assert.equal(open.code, 1, open.stderr);
    assert.match(open.stderr, /must be closed/);
    assert.deepEqual(await library.history({ id: increment.id }), before);
    await library.closeIncrement(increment.id, { disposition: "withdrawn", date: "2026-10-01", note: "Already done" });
    const closed = await library.history({ id: increment.id });
    const bare = await world.run(args);
    assert.equal(bare.code, 2, bare.stderr);
    assert.match(bare.stderr, /--reason/);
    const invalid = await world.run(["arc", "increment", "correct-closure", increment.id, "--disposition", "failed", "--reason", reason]);
    assert.equal(invalid.code, 1, invalid.stderr);
    assert.match(invalid.stderr, /note/);
    assert.deepEqual(await library.history({ id: increment.id }), closed, "refused corrections write nothing");

    const corrected = await world.run([...args, "--reason", reason]);
    assert.equal(corrected.code, 0, corrected.stderr);
    assert.match(corrected.stdout, /Corrected closure.*landed/);
    const record = await library.get(increment.id);
    assert.ok(record?.type === "increment");
    assert.equal(record.fields.status, "closed");
    assert.deepEqual(record.fields.outcome, { disposition: "landed", pr: "857", date: "2026-10-01" });
    const history = await world.run(["library", "history", increment.id, "--fields"]);
    assert.equal(history.code, 0, history.stderr);
    assert.ok(history.stdout.includes(reason), history.stdout);
    assert.match(history.stdout, /withdrawn/);
    assert.match(history.stdout, /landed/);
    const shown = await world.run(["arc", "show", arc]);
    assert.equal(shown.code, 0, shown.stderr);
    assert.match(shown.stdout, /2026-10-01\s+landed\s+857/);
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

test("4.11 `arc show` names a stale wait: one whose blocker has landed, which no longer holds, with the command that clears it", async () => {
  await inWorld(command, async (world) => {
    const library = await world.library();
    const arc = await anArc(world);
    const first = await library.addIncrement({ arc, title: "Schema", objective: "Tables", body: "…" });
    const second = await library.addIncrement({ arc, title: "Form", objective: "The form", body: "…" });
    await library.addWait(second.id, first.id, "needs the tables");
    await library.closeIncrement(first.id, { pr: "#1", disposition: "landed" });

    const ran = await world.run(["arc", "show", arc]);

    assert.equal(ran.code, 0, ran.stderr);
    const lines = ran.stdout.split(/\r?\n/);
    const form = lines.findIndex((line) => line.includes(second.id));
    const block = lines.slice(form, form + 3).join("\n");
    assert.ok(block.includes(first.id) && /landed/.test(block) && /stale/.test(block), `no stale wait under ${second.id}:\n${ran.stdout}`);
    assert.ok(block.includes(`storytree arc increment unwait ${second.id} --on ${first.id}`), block);
  });
});

test("4.12 `arc increment unstart` returns an active increment nobody holds to proposal; a held, proposed or closed one is refused, naming why, with nothing written", async () => {
  await inWorld(command, async (world) => {
    const library = await world.library();
    const arc = await anArc(world);
    const log = await openActivityLog(testServerUrl());
    try {
      const held = await library.addIncrement({ arc, title: "Email form", objective: "Build it", body: "…" });
      assert.equal((await claim({ log, library, project: world.project, session: "holder", harness: "claude-code" }, held.id, "building the form")).ok, true);
      const proposal = await library.addIncrement({ arc, title: "Copy", objective: "Write it", body: "…" });
      const closed = await library.addIncrement({ arc, title: "Done", objective: "Done", body: "…", outcome: { pr: "#2", disposition: "landed" } });
      for (const [id, why] of [[held.id, /holder/], [proposal.id, /proposal/], [closed.id, /closed/]] as const) {
        const history = await library.history({ id });
        const refused = await world.run(["arc", "increment", "unstart", id]);
        assert.equal(refused.code, 1, refused.stdout);
        assert.match(refused.stderr, why);
        assert.deepEqual(await library.history({ id }), history, "nothing was written");
      }

      const stranded = await library.addIncrement({ arc, title: "Stranded", objective: "Left active", body: "…" });
      await library.advanceIncrement(stranded.id, "active");
      const ran = await world.run(["arc", "increment", "unstart", stranded.id]);
      assert.equal(ran.code, 0, ran.stderr);
      assert.match(ran.stdout, /proposal/);
      assert.equal((await library.arcView(arc))?.increments.find(({ id }) => id === stranded.id)?.fields.status, "proposal");
    } finally {
      await log.close();
    }
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

test("4.7 `arc increment move` re-homes open work with its claim and closed history with its outcome", async () => {
  await inWorld(command, async (world) => {
    const library = await world.library();
    const [from, to] = [await anArc(world), await anArc(world)];
    const increment = await library.addIncrement({ arc: from, title: "Email form", objective: "Build it", body: "…" });
    const log = await openActivityLog(testServerUrl());
    try {
      assert.equal((await claim({ log, library, project: world.project, session: "holder", harness: "claude-code" }, increment.id, "building the form")).ok, true);
      const bare = await world.run(["arc", "increment", "move", increment.id, "--to", to]);
      assert.notEqual(bare.code, 0, bare.stdout);
      assert.match(bare.stderr, /--reason/);

      const ran = await world.run(["arc", "increment", "move", increment.id, "--to", to, "--reason", "belongs with the launch"]);
      assert.equal(ran.code, 0, ran.stderr);
      assert.deepEqual((await library.arcView(to))?.increments.map(({ id }) => id), [increment.id]);
      assert.deepEqual((await library.arcView(from))?.increments, []);
      assert.equal((await readClaims(log, world.project))[0]?.increment, increment.id, "the claim survives the move");

      await library.closeIncrement(increment.id, { disposition: "landed", pr: "#7" });
      const historyArc = await anArc(world);
      const closedSeed = await library.addIncrement({ arc: historyArc, title: "Earlier", objective: "Done", body: "Done" });
      await library.closeIncrement(closedSeed.id, { disposition: "landed", pr: "#6" });
      const historyMove = await world.run(["arc", "increment", "move", increment.id, "--to", historyArc, "--reason", "separate the completed phase"]);
      assert.equal(historyMove.code, 0, historyMove.stderr);
      const moved = (await library.arcView(historyArc))?.increments.find(({ id }) => id === increment.id);
      assert.equal(moved?.fields.status, "closed");
      assert.equal(moved?.fields.outcome?.pr, "#7");
    } finally {
      await log.close();
    }
  });
});
