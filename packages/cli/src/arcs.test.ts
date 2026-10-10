/**
 * Capability 4 · Arcs and increments: one test per contract in the command line story, each running
 * the real, built `storytree` command.
 */
import assert from "node:assert/strict";
import { userInfo } from "node:os";
import { after, before, test } from "node:test";

import pg from "pg";

import { claim, openActivityLog, readClaims, recordFriction, release } from "@storytree/session-management";

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

test("4.14 `arc increment wait --for owner` releases the waiting session's claims on the increment and the capability claims taken under it; `--for event` releases nothing", async () => {
  await inWorld(command, async (world) => {
    const library = await world.library();
    const arc = await anArc(world);
    const increment = (await library.addIncrement({ arc, title: "Ship to TestFlight", objective: "A build testers install", body: "…" })).id;
    const other = (await library.addIncrement({ arc, title: "Store listing", objective: "Write it", body: "…" })).id;
    const story = await library.addStory({ title: "Release" });
    const capability = (await library.addCapability({ story: story.id, title: "TestFlight upload" })).id;
    const log = await openActivityLog(testServerUrl());
    try {
      const waiter = { log, library, project: world.project, session: "codex-wait", harness: "codex" } as const;
      for (const id of [other, increment, capability]) assert.equal((await claim(waiter, id, "shipping")).ok, true, id);
      const held = async () => (await readClaims(log, world.project)).map((one) => one.increment ?? one.capability);

      const event = await world.run(["arc", "increment", "wait", increment, "--for", "event", "--note", "Apple reviews build 12", "--check-back", "2099-01-01"], { CODEX_THREAD_ID: "codex-wait" });
      assert.equal(event.code, 0, event.stderr);
      assert.doesNotMatch(event.stdout, /Released/);
      assert.deepEqual((await held()).sort(), [other, increment, capability].sort());

      const owner = await world.run(["arc", "increment", "wait", increment, "--for", "owner", "--note", "Sign the Apple developer agreement"], { CODEX_THREAD_ID: "codex-wait" });
      assert.equal(owner.code, 0, owner.stderr);
      assert.match(owner.stdout, new RegExp(`Released your claims on ${increment}, ${capability}`));
      assert.deepEqual(await held(), [other]);
    } finally {
      await log.close();
    }
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

test("4.17 `arc edit --priority` sets and clears an arc's priority, refusing anything but a whole number of 1 or more or `none`, and `arc list` orders live arcs by it (ADR-0963)", async () => {
  await inWorld(command, async (world) => {
    const library = await world.library();
    const unranked = await anArc(world);
    const second = await anArc(world);
    const first = await anArc(world);
    const cleared = await anArc(world);
    for (const [id, priority] of [[second, "2"], [first, "1"], [cleared, "1"]] as const) {
      const ran = await world.run(["arc", "edit", id, "--priority", priority]);
      assert.equal(ran.code, 0, ran.stderr);
    }
    assert.equal((await library.arcView(first))!.arc.fields.priority, 1);
    assert.equal((await world.run(["arc", "edit", cleared, "--priority", "none"])).code, 0);
    assert.equal((await library.arcView(cleared))!.arc.fields.priority, undefined);

    const before = (await library.changesSince(0)).changes.length;
    for (const wrong of ["0", "-1", "1.5", "first", ""]) {
      const ran = await world.run(["arc", "edit", unranked, "--priority", wrong]);
      assert.equal(ran.code, 1, `--priority ${wrong} was taken`);
      assert.match(ran.stderr, /priority/);
    }
    assert.equal((await library.changesSince(0)).changes.length, before, "a refused priority writes nothing");

    const listed = await world.run(["arc", "list"]);
    const order = listed.stdout.split("\n").flatMap((line) => [first, second, unranked, cleared].filter((id) => line.includes(id)));
    assert.deepEqual(order, [first, second, unranked, cleared], listed.stdout);
    assert.match(listed.stdout.split("\n").find((line) => line.includes(first))!, /priority 1/);
    assert.match((await world.run(["arc", "show", second])).stdout, /Priority: 2/);
  });
});

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

test("4.4 `arc show` reads a wait on work held on your question as waiting on you, naming the question however many hops away", async () => {
  await inWorld(command, async (world) => {
    const library = await world.library();
    const arc = await anArc(world);
    const held = await library.addIncrement({ arc, title: "Mailer", objective: "Mail", body: "…" });
    const middle = await library.addIncrement({ arc, title: "Schema", objective: "Tables", body: "…" });
    const far = await library.addIncrement({ arc, title: "Form", objective: "The form", body: "…" });
    const question = await library.raiseQuestion({ arc, title: "Which mailer?", stakes: "s", statement: "q", context: "c", options: "o" });
    await library.editIncrement(held.id, { heldOn: [question.id] });
    await library.addWait(middle.id, held.id, "needs the mailer");
    await library.addWait(far.id, middle.id, "needs the tables");

    const ran = await world.run(["arc", "show", arc]);

    assert.equal(ran.code, 0, ran.stderr);
    const lines = ran.stdout.split(/\r?\n/);
    const under = (id: string) => lines.slice(lines.findIndex((line) => line.includes(`- ${id}`)) + 1).join("\n").split("\n  - ")[0] ?? "";
    const through = `waiting on you: question ${question.id} (through other work)`;
    assert.ok(under(middle.id).includes(through), ran.stdout);
    assert.ok(under(far.id).includes(through), ran.stdout);
    assert.ok(!under(held.id).includes("through other work"), ran.stdout);
  });
});

test("4.11 `arc show` says nothing of a wait whose blocker has landed: closing the blocker cleared it", async () => {
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
    assert.ok(!lines[form + 1]?.includes(first.id), `a wait still said under ${second.id}:\n${ran.stdout}`);
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

test("4.13 `arc increment edit --remedies` adds live friction to an increment's remedies, keeping those it had, so `friction route --to tool` accepts it; friction that is not live is refused with nothing written", async () => {
  await inWorld(command, async (world) => {
    const library = await world.library();
    const arc = await anArc(world);
    const friction = (title: string) => recordFriction(library, { title, description: "Delay", statement: "Timeout", evidence: "src/mail.ts: TimeoutError", impact: "Readers wait" });
    const first = await friction("Slow mail");
    const later = await friction("Slow mail again");
    const fix = await library.addIncrement({ arc, title: "Retry mail", objective: "Retry", body: "…", remedies: [first.id] });

    const history = await library.history({ id: fix.id });
    const refused = await world.run(["arc", "increment", "edit", fix.id, "--remedies", "friction_000000000000"]);
    assert.equal(refused.code, 1, refused.stdout);
    assert.deepEqual(await library.history({ id: fix.id }), history, "nothing was written");

    const edited = await world.run(["arc", "increment", "edit", fix.id, "--remedies", later.id]);
    assert.equal(edited.code, 0, edited.stderr);
    assert.deepEqual(((await library.get(fix.id))?.fields as { remedies?: string[] } | undefined)?.remedies, [first.id, later.id]);
    const routed = await world.run(["friction", "route", later.id, "--to", "tool", "--reason", "Its fix is parked"]);
    assert.equal(routed.code, 0, routed.stderr);
  });
});

test("4.15 `arc increment new` and `edit` take --capabilities and --links, edit replacing each list; a story as a capability, or the retired --touches, is refused with nothing written (ADR-0949 D2)", async () => {
  await inWorld(command, async (world) => {
    const library = await world.library();
    const arc = await anArc(world);
    const story = await library.addStory({ title: "Sign up" });
    const [form, page] = await Promise.all(["Form", "Page"].map((title) => library.addCapability({ story: story.id, title })));
    const parked = await world.run(["arc", "increment", "new", "--arc", arc, "--title", "Form", "--objective", "Enter", "--body", "Build it", "--capabilities", form!.id, "--links", story.id]);
    assert.equal(parked.code, 0, parked.stderr);
    const id = /increment_[0-9a-f]+/.exec(parked.stdout)![0];
    const fieldsOf = async () => (await library.get(id))?.fields as { capabilities?: string[]; links?: string[] };
    assert.deepEqual([(await fieldsOf()).capabilities, (await fieldsOf()).links], [[form!.id], [story.id]]);

    const before = (await library.changesSince(0)).cursor;
    for (const flags of [["--capabilities", story.id], ["--touches", form!.id]]) {
      const refused = await world.run(["arc", "increment", "edit", id, ...flags]);
      assert.notEqual(refused.code, 0, refused.stdout);
    }
    const touched = await world.run(["arc", "increment", "new", "--arc", arc, "--title", "Old", "--objective", "Old", "--body", "Old", "--touches", form!.id]);
    assert.match(touched.stderr, /--touches is retired/);
    assert.deepEqual((await library.changesSince(before)).changes, [], "nothing was written");

    const edited = await world.run(["arc", "increment", "edit", id, "--capabilities", `${form!.id},${page!.id}`]);
    assert.equal(edited.code, 0, edited.stderr);
    assert.deepEqual([(await fieldsOf()).capabilities, (await fieldsOf()).links], [[form!.id, page!.id], [story.id]], "the list is replaced, the links kept");
  });
});

test("4.18 `arc increment edit --held-on \"\"` clears a hold put on by mistake: the increment reads held on nothing", async () => {
  await inWorld(command, async (world) => {
    const library = await world.library();
    const arc = await anArc(world);
    const held = await library.addIncrement({ arc, title: "Mailer", objective: "Mail", body: "…" });
    const question = await library.raiseQuestion({ arc, title: "Which mailer?", stakes: "s", statement: "q", context: "c", options: "o" });
    await library.editIncrement(held.id, { heldOn: [question.id] });

    const cleared = await world.run(["arc", "increment", "edit", held.id, "--held-on", ""]);

    assert.equal(cleared.code, 0, cleared.stderr);
    assert.equal(((await library.get(held.id))?.fields as { heldOn?: string[] }).heldOn, undefined);
  });
});

test("4.16 `arc increment edit --capabilities` refuses a capability already on the list of another live session's claimed increment, naming that increment and its holder, with nothing written; the caller's own lists, and a released increment's, are not refused (ADR-0949 D2)", async () => {
  await inWorld(command, async (world) => {
    const library = await world.library();
    const arc = await anArc(world);
    const story = await library.addStory({ title: "Sign up" });
    const form = await library.addCapability({ story: story.id, title: "Form" });
    const log = await openActivityLog(testServerUrl());
    try {
      const holder = { log, library, project: world.project, session: "holder", harness: "claude-code" } as const;
      const caller = { log, library, project: world.project, session: "caller", harness: "claude-code" } as const;
      const as = { CLAUDE_CODE_SESSION_ID: "caller" };
      const theirs = await library.addIncrement({ arc, title: "Email form", objective: "Build it", body: "…", capabilities: [form.id] } as never);
      assert.equal((await claim(holder, theirs.id, "driving the email form")).ok, true);
      const mine = await library.addIncrement({ arc, title: "Form copy", objective: "Reword it", body: "…" });
      const own = await library.addIncrement({ arc, title: "Form polish", objective: "Polish it", body: "…", capabilities: [form.id] } as never);
      for (const id of [mine.id, own.id]) assert.equal((await claim(caller, id, "rewording the form")).ok, true);

      const history = await library.history({ id: mine.id });
      const refused = await world.run(["arc", "increment", "edit", mine.id, "--capabilities", form.id], as);
      assert.equal(refused.code, 1, refused.stdout);
      assert.ok(refused.stderr.includes(form.id) && refused.stderr.includes(theirs.id) && refused.stderr.includes("holder"), refused.stderr);
      assert.deepEqual(await library.history({ id: mine.id }), history, "nothing was written");

      assert.equal((await release(holder, theirs.id)).ok, true);
      const edited = await world.run(["arc", "increment", "edit", mine.id, "--capabilities", form.id], as);
      assert.equal(edited.code, 0, `${edited.stderr}: the caller's own list, and a released one's, may share`);
      assert.deepEqual(((await library.get(mine.id))?.fields as { capabilities?: string[] }).capabilities, [form.id]);
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

test("4.19 `arc show` lists each open increment's pending plan changes under it, as before and after, or a retirement with its reason (ADR-0966 D3)", async () => {
  await inWorld(command, async (world) => {
    const library = await world.library();
    const arc = await anArc(world);
    const story = await library.addStory({ title: "Sign up" });
    const form = await library.addCapability({ story: story.id, title: "Form" });
    const promise = await library.addContract({ capability: form.id, title: "Accepts an address" });
    const increment = await library.addIncrement({ arc, title: "Address form", objective: "Rename it", body: "Red then green" });
    await library.advanceIncrement(increment.id, "active");
    await library.pendChange(increment.id, { record: form.id, fields: { description: "Where they type it" } });
    await library.pendChange(increment.id, { record: promise.id, retire: "overtaken" });

    const shown = await world.run(["arc", "show", arc]);
    assert.equal(shown.code, 0, shown.stderr);
    const below = shown.stdout.slice(shown.stdout.indexOf(increment.id));
    assert.match(below, /Pending changes \(2\)/);
    assert.match(below, new RegExp(`${form.id}.*\\n.*description: \\(none\\) -> Where they type it`));
    assert.match(below, new RegExp(`${promise.id}.*\\n.*retire: overtaken`));
  });
});

test("4.20 `arc increment settle-pending` applies the leftover pending plan changes of every closed increment that landed and drops those of every one that did not, naming each, and says so when none is left", async () => {
  await inWorld(command, async (world) => {
    const library = await world.library();
    const arc = await anArc(world);
    const story = await library.addStory({ title: "Sign up" });
    const form = await library.addCapability({ story: story.id, title: "Form" });
    const promise = await library.addContract({ capability: form.id, title: "Accepts an address" });
    const landed = await library.addIncrement({ arc, title: "Address form", objective: "Rename it", body: "Red then green" });
    const failed = await library.addIncrement({ arc, title: "Drop the check", objective: "Drop it", body: "Red then green" });
    await library.advanceIncrement(landed.id, "active");
    await library.advanceIncrement(failed.id, "active");
    await library.pendChange(landed.id, { record: form.id, fields: { description: "Where they type it" } });
    await library.pendChange(failed.id, { record: promise.id, retire: "overtaken" });
    // Closed as a close was written before closing applied or dropped them: the pending changes stay behind.
    const url = new URL(testServerUrl());
    url.pathname = `/storytree_${world.project}`;
    const client = new pg.Client({ connectionString: url.href });
    await client.connect();
    try {
      for (const [id, outcome] of [[landed.id, { date: "2026-10-11", pr: "1130", disposition: "landed" }], [failed.id, { date: "2026-10-11", note: "abandoned", disposition: "failed" }]] as const) {
        await client.query("UPDATE record SET fields = fields || $2::jsonb WHERE id = $1", [id, JSON.stringify({ status: "closed", outcome })]);
      }
    } finally {
      await client.end();
    }

    const settled = await world.run(["arc", "increment", "settle-pending"]);
    assert.equal(settled.code, 0, settled.stderr);
    assert.match(settled.stdout, new RegExp(`${landed.id}: applied 1 \\(${form.id}\\)`));
    assert.match(settled.stdout, new RegExp(`${failed.id}: dropped 1`));
    assert.equal(((await library.get(form.id))?.fields as { description?: string } | undefined)?.description, "Where they type it");
    assert.notEqual(await library.get(promise.id), null, "the failed increment's retirement was dropped, not applied");

    const none = await world.run(["arc", "increment", "settle-pending"]);
    assert.equal(none.code, 0, none.stderr);
    assert.match(none.stdout, /No closed increment has pending plan changes left/);
  });
});
