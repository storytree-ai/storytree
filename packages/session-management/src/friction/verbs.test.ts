/**
 * Capability 17 · Friction, its verbs (17.15-17.18): the `friction` and `resteer`
 * verbs Session management declares for both front doors, run with a context of a fresh project's library on the real Postgres
 * `pnpm test` provides.
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { removeTemp, waitUntil } from "@storytree/test-waits";

import type { Library } from "@storytree/library";
import { consumersOf, mounted, VerbRefusal, type DoorWords, type VerbContext } from "@storytree/library/verbs";

import { recordFriction } from "./filing/capture.js";
import { withLibrary } from "./testing/pg.js";
import { FRICTION_FAMILIES, FRICTION_TOOLS } from "./verbs.js";

const WORDS: DoorWords = { door: "command", say: (step) => `storytree ${step.command}` };

test("17.17 · Session management declares the `friction` and `resteer` families the command line lists 13th and 14th: friction filed on one branch, with its links and the writer, is drained on another", async () => {
  await withLibrary(async (library) => {
    const [friction, resteer] = ["friction", "resteer"].map((name) => FRICTION_FAMILIES.find((family) => family.name === name)!);
    assert.deepEqual([friction!.order, resteer!.order], [13, 14]);
    const verbOf = (name: string) => friction!.verbs.find((one) => "name" in one.command && one.command.name === name)!;
    const folder = mkdtempSync(path.join(tmpdir(), "friction-verbs-"));
    try {
      execFileSync("git", ["-C", folder, "init", "-q", "-b", "fix/mail"]);
      const context: VerbContext = { library, project: "p", session: "s", folder, writer: { actor: "session:s" } };
      const decision = await library.recordDecision({ title: "Mail by queue", text: "Send mail from a queue.", status: "proposed" });
      const filed = await verbOf("new").act({
        title: "Slow mail",
        description: "Mail is delayed",
        statement: "Sending times out",
        evidence: "src/mail.ts: TimeoutError after 30 seconds",
        impact: "Readers cannot join",
        links: decision.id,
      }, context, WORDS);
      const [note] = await library.list("friction");
      assert.equal(filed.text, `Recorded friction ${note!.id}.`);
      assert.equal(note!.fields.provenance?.branch, "fix/mail");
      assert.deepEqual(note!.fields.links, [decision.id]);
      assert.equal((await library.history({ id: note!.id })).at(-1)?.actor, "session:s");

      assert.match((await verbOf("drain").act({}, context, WORDS)).text, /^No friction is due/, "its own branch's report is not drained");
      execFileSync("git", ["-C", folder, "checkout", "-q", "-b", "main"]);
      assert.match((await verbOf("drain").act({}, context, WORDS)).text, new RegExp(`^1 friction report due for routing, each with its lookalikes from the last four weeks:\\n  ${note!.id}  \\(0 recurrences\\)  Slow mail\\n`));
    } finally {
      await removeTemp(folder);
    }
  });
});

const verbNamed = (name: string) => FRICTION_FAMILIES[0]!.verbs.find((one) => "name" in one.command && one.command.name === name)!;

/** Run `body` with a context in a fresh Git folder on `branch`, as session s. */
async function onBranch(library: Library, branch: string, body: (context: VerbContext) => Promise<void>): Promise<void> {
  const folder = mkdtempSync(path.join(tmpdir(), "friction-verbs-"));
  try {
    execFileSync("git", ["-C", folder, "init", "-q", "-b", branch]);
    await body({ library, project: "p", session: "s", folder, writer: { actor: "session:s" } });
  } finally {
    await removeTemp(folder);
  }
}

test("17.15 · `friction route` records the route and reason with the writer; a tool route with no remedy is refused unchanged and writes nothing", async () => {
  await withLibrary(async (library) => {
    await onBranch(library, "main", async (context) => {
      const note = await recordFriction(library, { title: "Slow mail", description: "Delay", statement: "Timeout", evidence: "src/mail.ts: TimeoutError", impact: "Readers cannot join" });
      const history = await library.history();
      await assert.rejects(verbNamed("route").act({ friction: note.id, to: "tool", reason: "Needs a retry" }, context, WORDS), (error: Error) => error instanceof VerbRefusal && /live increment whose remedies names/.test(error.message));
      assert.deepEqual(await library.history(), history, "refusal writes nothing");

      await verbNamed("route").act({ friction: note.id, to: "tool", reason: "Retry landed", "discharged-by": "storytree-ai/storytree#9" }, context, WORDS);
      const saved = (await library.list("friction"))[0]!;
      assert.deepEqual([saved.fields.route, saved.fields.routeReason, saved.fields.dischargedBy], ["tool", "Retry landed", "storytree-ai/storytree#9"]);
      assert.equal((await library.history({ id: note.id })).at(-1)?.actor, "session:s");
    });
  });
});

test("17.16 · `friction drain` lists the unrouted reports other branches filed for the calling branch, most recurrences first, and says how many more wait", async () => {
  await withLibrary(async (library) => {
    const fields = { description: "Delay", statement: "Timeout", evidence: "src/mail.ts: Error", impact: "Wait" };
    const provenance = (branch: string) => ({ branch, date: "2026-09-29", source: "retro" as const });
    const older = await library.writeKnowledge("friction", { ...fields, title: "Older", provenance: provenance("another/branch") });
    const recurring = await library.writeKnowledge("friction", { ...fields, title: "Recurring", provenance: provenance("another/branch") });
    await library.editNote(recurring.id, { reinforcedBy: [{ date: "2026-09-29", branch: "third/branch", evidence: "#8: again" }] });
    await library.writeKnowledge("friction", { ...fields, title: "Mine", provenance: provenance("fix/mail") });
    const routed = await library.writeKnowledge("friction", { ...fields, title: "Routed", provenance: provenance("another/branch") });
    await library.editNote(routed.id, { route: "nothing", routeReason: "Passed" });
    const later: { id: string }[] = [];
    // Creation time is to the millisecond and ties fall to the random id, so each report is written in a later millisecond.
    for (const title of ["Third", "Fourth"]) {
      const from = Date.now();
      await waitUntil(() => Date.now() > from, 1_000, "the next millisecond");
      later.push(await library.writeKnowledge("friction", { ...fields, title, provenance: provenance("another/branch") }));
    }

    await onBranch(library, "fix/mail", async (context) => {
      const drained = await verbNamed("drain").act({}, context, WORDS);
      const listed = drained.text.split("\n").filter((line) => line.includes("friction_")).map((line) => line.match(/friction_[0-9a-f]+/)![0]);
      assert.deepEqual(listed, [recurring.id, older.id, later[0]!.id]);
      assert.match(drained.text, /1 more wait/);
    });
  });
});

test("17.18 · Session management declares record_friction, reinforce, record_resteer, friction_drain and route as tools, the drain an agent's alone, and its refusals are verb refusals, which each door answers as a refusal", async () => {
  const tools = FRICTION_TOOLS.flatMap((one) => (mounted(one.tool) ? [one.tool.name] : []));
  assert.deepEqual(tools.sort(), ["friction_drain", "record_friction", "record_resteer", "reinforce", "route"]);
  assert.deepEqual(consumersOf(FRICTION_TOOLS.find((one) => mounted(one.tool) && one.tool.name === "friction_drain")!), ["agent"]);
  await withLibrary(async (library) => {
    await onBranch(library, "main", async (context) => {
      const record = FRICTION_TOOLS.find((one) => mounted(one.tool) && one.tool.name === "record_friction")!;
      await assert.rejects(record.act({ title: "Slow", description: "Slow", statement: "Slow", evidence: "it was slow", impact: "Slow" }, context, WORDS), VerbRefusal);
      assert.deepEqual(await library.history(), []);
    });
  });
});

test("17.19 · Friction marked about storytree answers with a pre-filled GitHub issue draft for the user to review and submit, the paths and project name stripped; storytree sends nothing", async () => {
  await withLibrary(async (library) => {
    await onBranch(library, "main", async (context) => {
      const project = { ...context, project: "acme-shop" };
      const filed = await verbNamed("new").act({
        title: "acme-shop: the red agent had no shell",
        description: "The red agent could not run tests",
        statement: `In acme-shop the red agent's Bash was refused at ${path.join(context.folder, ".claude", "agents", "red.md")}`,
        evidence: `Error: no shell tool, seen in ${path.join(homedir(), "notes", "run.log")} and /opt/acme-shop/logs/red.txt`,
        impact: "Tests were written blind",
        "about-storytree": true,
      }, project, WORDS);
      const [note] = await library.list("friction");
      assert.equal(note!.fields.title, "acme-shop: the red agent had no shell", "the user's own library keeps the friction as written");
      const link = filed.text.match(/https:\/\/github\.com\/\S+/)?.[0];
      assert.ok(link, "the reply carries the draft's link");
      const draft = new URL(link);
      assert.equal(`${draft.origin}${draft.pathname}`, "https://github.com/storytree-ai/storytree/issues/new");
      const [title, body] = [draft.searchParams.get("title")!, draft.searchParams.get("body")!];
      assert.match(title, /the red agent had no shell/);
      assert.match(body, /Error: no shell tool/);
      assert.match(body, /Tests were written blind/);
      for (const told of [title, body]) {
        assert.doesNotMatch(told, /acme-shop/i, "the project's name is stripped");
        assert.ok(!told.includes(context.folder) && !told.includes(homedir()), "the project's folder and the home folder are stripped");
        assert.doesNotMatch(told, /\/opt\//, "other absolute paths are stripped");
      }
      assert.match(filed.text, /submit/i, "the agent is told the user submits it");
      assert.deepEqual((filed.data as { issueDraft?: string }).issueDraft, link);

      const plain = await verbNamed("new").act({ title: "Plain", description: "Plain", statement: "Plain", evidence: "src/mail.ts: TimeoutError after 30 seconds", impact: "Plain", "none-match": true }, project, WORDS);
      assert.doesNotMatch(plain.text, /github\.com/, "friction not marked about storytree offers no draft");

      const long = await verbNamed("new").act({ title: "Long", description: "Long", statement: "Long", evidence: `src/mail.ts: TimeoutError ${"x".repeat(5_000)}`, impact: "Long", "about-storytree": true, "none-match": true }, project, WORDS);
      const cut = new URL((long.data as { issueDraft: string }).issueDraft).searchParams.get("body")!;
      assert.equal(cut.length, 4_001, "a long body is cut short of GitHub's link limit");
      assert.ok(cut.endsWith("…"), "and says it was cut");
    });
  });
});

test("17.20 · record_resteer records the call an agent makes from its purpose: what the user redirected it to and their quoted words, its title, description, what it was doing, disposition and judge defaulted; a call missing either is refused in one line naming both", async () => {
  const resteer = FRICTION_TOOLS.find((one) => mounted(one.tool) && one.tool.name === "record_resteer")!;
  assert.deepEqual(Object.entries(resteer.inputs).filter(([, input]) => !("optional" in input && input.optional === true)).map(([name]) => name), [], "a door asks for no field up front");
  await withLibrary(async (library) => {
    await onBranch(library, "main", async (context) => {
      const quote = '"Remove the cache in this task, as you suggest"';
      await resteer.act({ statement: "Remove the cache in this task, not the next one", quote } as never, context, WORDS);
      const [note] = await library.list("resteer");
      assert.equal(note!.fields.redirect, "Remove the cache in this task, not the next one");
      assert.equal(note!.fields.evidence, quote);
      assert.equal(note!.fields.disposition, "taste");
      assert.equal(note!.fields.dispositionBy, "agent");
      assert.equal(note!.fields.title, "Remove the cache in this task, not the next one", "its title is what the user redirected it to");
      assert.equal(note!.fields.description, "Remove the cache in this task, not the next one");
      assert.equal(note!.fields.doing, "not said");

      const long = `${"Keep the cache, but move its eviction into the store instead of the request handler ".repeat(2)}\nand say why`;
      await resteer.act({ redirect: long, evidence: quote } as never, context, WORDS);
      const titled = (await library.list("resteer")).find((one) => one.fields.redirect === long)!;
      assert.equal(titled.fields.title, `${long.slice(0, 79)}…`, "a long redirect's title is its first line cut to 80 characters");
      const exact = "x".repeat(80);
      await resteer.act({ redirect: `${exact}\nmore`, evidence: quote } as never, context, WORDS);
      assert.ok((await library.list("resteer")).some((one) => one.fields.title === exact), "a first line of 80 characters is kept whole");

      const before = await library.history();
      for (const given of [{ statement: "Remove the cache" }, { quote }]) {
        const refused = await resteer.act(given as never, context, WORDS).then(() => undefined, (error: unknown) => error);
        assert.ok(refused instanceof VerbRefusal, String(refused));
        assert.doesNotMatch(refused.message, /\n/, "the refusal is one line");
        assert.match(refused.message, /redirect/);
        assert.match(refused.message, /evidence/);
      }
      assert.deepEqual(await library.history(), before, "a refused call writes nothing");
    });
  });
});

test("17.21 · Filing friction through either door first shows the closest earlier reports, open, resolved and dismissed alike, by id, title, state and recurrences, writing nothing, with how to reinforce one; it files new only when told none matches (ADR-1233)", async () => {
  await withLibrary(async (library) => {
    await onBranch(library, "main", async (context) => {
      const mail = { title: "Slow mail", description: "Mail is delayed", statement: "Sending times out", evidence: "src/mail.ts: TimeoutError after 30 seconds", impact: "Readers cannot join" };
      const first = await verbNamed("new").act(mail, context, WORDS);
      const id = (first.data as { id: string }).id;
      await library.editNote(id, { route: "nothing", routeReason: "An upstream outage" });
      for (const title of ["Slow mail at night", "Slow mail abroad", "Slow mail on Mondays"]) {
        await library.writeKnowledge("friction", { ...mail, title, provenance: { branch: "another/branch", date: "2026-09-29", source: "retro" as const } });
      }
      await library.defineTerm({ term: "Slow mail", meaning: "Mail that takes over a minute to send" });

      const before = await library.history();
      const shown = await verbNamed("new").act({ ...mail, evidence: "src/mail.ts: TimeoutError again" }, context, WORDS);
      assert.deepEqual(await library.history(), before, "showing the closest reports writes nothing");
      assert.match(shown.text, new RegExp(`${id}  dismissed, 0 recurrences  Slow mail`), "the dismissed report is shown by id and title");
      const listed = shown.text.split("\n").filter((line) => line.startsWith("  "));
      assert.equal(listed.length, 3, "at most three are shown");
      assert.ok(listed.every((line) => /^  friction_[0-9a-f]+  /.test(line)), "only friction reports are shown, not other notes holding its words");
      assert.ok(shown.next?.some((step) => step.command === `friction reinforce ${id} --evidence …`), "it says how to add a recurrence to it instead");
      assert.equal(shown.next?.at(-1)?.command, "friction new … --none-match", "or how to file new");

      await verbNamed("reinforce").act({ friction: id, evidence: "src/mail.ts: TimeoutError again" }, context, WORDS);
      const reports = await library.list("friction");
      assert.equal(reports.length, 4, "the repeat is a recurrence, not another report");
      assert.equal(reports.find((one) => one.id === id)!.fields.reinforcedBy?.length, 1);

      await verbNamed("new").act({ ...mail, title: "Slow mail on Sundays", "none-match": true }, context, WORDS);
      assert.equal((await library.list("friction")).length, 5, "told none matches, it files new");
    });
  });
});

test("17.22 · The friction drain shows each report it offers with its lookalikes: the closest reports filed in the last four weeks, open, routed and settled alike, never itself, by id, state, recurrences and filing day (ADR-1241)", async () => {
  await withLibrary(async (library) => {
    const day = (ago: number) => new Date(Date.now() - ago * 86_400_000).toISOString().slice(0, 10);
    const mail = { description: "Mail is delayed", statement: "Sending times out", evidence: "src/mail.ts: TimeoutError after 30 seconds", impact: "Readers cannot join" };
    const filed = (title: string, ago: number) => library.writeKnowledge("friction", { ...mail, title, provenance: { branch: "another/branch", date: day(ago), source: "retro" as const } });
    const lead = await filed("Slow mail", 1);
    const recent = await filed("Slow mail at night", 3);
    await library.editNote(recent.id, { route: "nothing", routeReason: "An upstream outage" });
    const old = await filed("Slow mail abroad", 40);
    await library.editNote(old.id, { route: "nothing", routeReason: "An upstream outage" });
    const other = await library.writeKnowledge("friction", { title: "Seed refused", description: "Seeding", statement: "The seed is refused", evidence: "`pnpm seed` refused", impact: "No library", provenance: { branch: "another/branch", date: day(1), source: "retro" as const } });

    await onBranch(library, "fix/mail", async (context) => {
      const drained = await verbNamed("drain").act({}, context, WORDS);
      const lookalikes = (drained.data as { lookalikes: Record<string, { id: string }[]> }).lookalikes;
      assert.deepEqual(lookalikes[lead.id]!.map(({ id }) => id), [recent.id], "a settled lookalike of the last four weeks is shown; an older one and the report itself are not");
      assert.deepEqual(lookalikes[other.id], [], "a report nothing resembles has no lookalikes");
      assert.match(drained.text, new RegExp(`looks like ${recent.id}  dismissed, 0 recurrences, filed ${day(3)}  Slow mail at night`));
    });
  });
});

test("17.24 · A friction report names the increment it happened in: record_friction takes it as increment, kept on the report; an increment given in links is refused naming the increment field, and an increment that is not a live increment is refused, nothing written", async () => {
  await withLibrary(async (library) => {
    await onBranch(library, "fix/health", async (context) => {
      const story = await library.addStory({ title: "Local health" });
      const arc = await library.createArc({ title: "Health", intent: "Read health locally", endState: "Health reads", stories: [story.id] });
      const increment = (await library.addIncrement({ arc: arc.id, title: "health local", objective: "health local", body: "health local" })).id;
      const report = { title: "Health local hangs", description: "It hangs", statement: "It never answers", evidence: "`storytree health local` exit code 1", impact: "No reading", "none-match": true };

      await assert.rejects(verbNamed("new").act({ ...report, links: increment }, context, WORDS), (error: Error) => error instanceof VerbRefusal && error.message.includes(increment) && /"increment"/.test(error.message));
      await assert.rejects(verbNamed("new").act({ ...report, increment: story.id }, context, WORDS), (error: Error) => error instanceof VerbRefusal && error.message.includes(story.id));
      assert.deepEqual(await library.list("friction"), [], "a refusal writes nothing");

      const filed = await verbNamed("new").act({ ...report, increment }, context, WORDS);
      const [note] = await library.list("friction");
      assert.equal(filed.text, `Recorded friction ${note!.id}.`);
      assert.equal(note!.fields.increment, increment);
    });
  });
});

test("17.25 · A friction report records what its filing was shown: the ids of the closest earlier reports and whether it was filed new past them, an empty list when none was shown; one filed with no lookup records that none ran", async () => {
  await withLibrary(async (library) => {
    await onBranch(library, "main", async (context) => {
      const mail = { title: "Slow mail", description: "Mail is delayed", statement: "Sending times out", evidence: "src/mail.ts: TimeoutError after 30 seconds", impact: "Readers cannot join" };
      const first = (await verbNamed("new").act(mail, context, WORDS)).data as { id: string };
      assert.deepEqual((await library.get(first.id))?.fields.lookup, { shown: [], noneMatch: false }, "nothing was shown");

      const shown = (await verbNamed("new").act(mail, context, WORDS)).data as { closest: { id: string }[] };
      assert.deepEqual(shown.closest.map((one) => one.id), [first.id]);
      const again = (await verbNamed("new").act({ ...mail, "none-match": true }, context, WORDS)).data as { id: string };
      assert.deepEqual((await library.get(again.id))?.fields.lookup, { shown: [first.id], noneMatch: true }, "filed new past the one it was shown");

      const raw = await recordFriction(library, { ...mail, title: "Hook report" });
      assert.equal(raw.fields.lookup, "none", "a filing with no lookup records that none ran");
    });
  });
});
