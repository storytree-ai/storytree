/**
 * Capability 3 · Arc surface: contracts 3.13 and 3.14, `arc status`, run with a caller on a fresh project's library and
 * activity log on the real Postgres `pnpm test` provides.
 */
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { test, type TestContext } from "node:test";

import { connect, type Library } from "@storytree/library";
import { claim, openActivityLog, readClaims, type ActivityLog } from "@storytree/session-management";
import { VerbRefusal, type DoorWords, type Verb, type VerbInputs } from "@storytree/library/verbs";

import { ARC_FAMILIES, type ArcVerbContext } from "./index.js";

const WORDS: DoorWords = { door: "command", say: (step) => `storytree ${step.command}` };
const status = ARC_FAMILIES.find((family) => family.name === "arc")!.verbs.find((one) => "name" in one.command && one.command.name === "status") as Verb<VerbInputs, ArcVerbContext>;

/** A fresh project's library and activity log, its lines written from the machine `mint`, dropped when the test ends. */
async function aProject(t: TestContext): Promise<{ library: Library; log: ActivityLog; project: string }> {
  const url = process.env.STORYTREE_TEST_PG_URL;
  if (url === undefined) throw new Error("run the tests via `pnpm test`, which starts a local Postgres");
  const storytree = await connect({ url });
  const project = `t-${randomBytes(4).toString("hex")}`;
  const library = await storytree.openProject(project);
  const log = await openActivityLog(storytree, { machine: "mint" });
  t.after(async () => {
    try {
      await log.close();
      await storytree.dropProject(project);
    } finally {
      await storytree.close();
    }
  });
  return { library, log, project };
}

const anArc = (library: Library, title: string) => library.createArc({ title, intent: `Ship ${title}`, endState: `${title} is live` });
const work = (library: Library, arc: string, title: string) => library.addIncrement({ arc, title, objective: title, body: "…" });

test("3.13 · `arc status` gives one line per active arc, moving ones first, each with its state and why: Working (increment, session, machine, since), Landed since --since (with its pull request), Ready, Waiting on you (question titles or owner-wait notes), Blocked (on what, until when) or Idle (nothing parked); the strongest state printed, the other mentioned", async (t) => {
  const { library, log, project } = await aProject(t);
  const context: ArcVerbContext = { library, log, project, session: "person:test", folder: "/work", writer: { actor: "person:test" } };

  // Made in the reverse of the order they print, so the order is the command's, not the library's.
  const idle = await anArc(library, "Ideas");
  const blocked = await anArc(library, "Search");
  const waiting = await anArc(library, "Mobile");
  const ready = await anArc(library, "Billing");
  const landed = await anArc(library, "Docs");
  const working = await anArc(library, "Sign-up");
  const parked = await anArc(library, "Someday");
  await library.parkArc(parked.id);

  const index = await work(library, blocked.id, "Index");
  const domain = await work(library, blocked.id, "Domain");
  const listing = await work(library, waiting.id, "Store listing");
  const testflight = await work(library, waiting.id, "TestFlight");
  const invoices = await work(library, ready.id, "Invoices");
  const outline = await work(library, landed.id, "Outline");
  const pages = await work(library, landed.id, "Pages");
  const schema = await work(library, working.id, "Schema");
  const form = await work(library, working.id, "Form");

  await library.addWait(index.id, invoices.id, "needs billing");
  await library.addWaitFor(domain.id, { releaser: "event", note: "DNS propagates", checkBack: "2099-01-01" });
  const store = await library.raiseQuestion({ arc: waiting.id, title: "Which store first?", stakes: "Launch waits.", statement: "Apple or Google?", context: "Both take a week.", options: "Apple or Google." });
  await library.editIncrement(listing.id, { heldOn: [store.id] });
  await library.addWaitFor(testflight.id, { releaser: "owner", note: "Sign the Apple agreement" });
  await library.closeIncrement(outline.id, { disposition: "landed", pr: "#13" });
  await library.closeIncrement(schema.id, { disposition: "landed", pr: "#12" });
  assert.equal((await claim({ log, library, project, session: "codex-lane", harness: "codex" }, form.id, "building the form")).ok, true);
  const since = (await readClaims(log, project)).find((one) => one.increment === form.id)!.since;
  // Said to the minute in UTC, worked out here by the clock rather than by cutting the stored text.
  const when = `${new Intl.DateTimeFormat("sv-SE", { timeZone: "UTC", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(since))} UTC`;

  const answer = await status.act({}, context, WORDS);

  assert.deepEqual(answer.text.split("\n"), [
    "6 active arcs, 2 moving:",
    `  Working         ${working.id}  Sign-up — ${form.id} Form: Codex session codex-lane on mint since ${when}; also landed ${schema.id} Schema (#12)`,
    `  Landed          ${landed.id}  Docs — ${outline.id} Outline (#13); next: ready, nobody holds ${pages.id} Pages`,
    `  Ready           ${ready.id}  Billing — nobody holds ${invoices.id} Invoices`,
    `  Waiting on you  ${waiting.id}  Mobile — ${listing.id} Store listing: question "Which store first?"; ${testflight.id} TestFlight: Sign the Apple agreement`,
    `  Blocked         ${blocked.id}  Search — ${index.id} Index: waits on ${invoices.id} Invoices (needs billing); ${domain.id} Domain: waits for DNS propagates until 2099-01-01`,
    `  Idle            ${idle.id}  Ideas — nothing parked`,
  ]);

  // A landing before --since is no landing: Docs is then only ready.
  const later = await status.act({ since: "2099-01-01T00:00:00Z" }, context, WORDS);
  assert.ok(later.text.split("\n").includes(`  Ready           ${landed.id}  Docs — nobody holds ${pages.id} Pages`), later.text);
  assert.ok(later.text.split("\n").includes(`  Working         ${working.id}  Sign-up — ${form.id} Form: Codex session codex-lane on mint since ${when}`), later.text);
});

test("3.14 · `arc status` reads the board's arcs and the holds once each however many arcs there are, counts landings from the last two hours unless --since names a time or a span (30m, 2h, 1d), and refuses any other --since", async (t) => {
  const { library, log, project } = await aProject(t);
  for (const title of ["One", "Two", "Three"]) {
    const arc = await anArc(library, title);
    await work(library, arc.id, `${title} work`);
    await work(library, arc.id, `${title} more`);
  }
  const asked = { arcView: 0, arcViews: 0, boardArcs: 0, closedArcs: 0, holds: 0, waitHolds: 0, heldOnQuestion: 0, waitsFor: 0 };
  const counted = new Proxy(library, {
    get(target, key) {
      if (typeof key === "string" && key in asked) asked[key as keyof typeof asked]++;
      const value = Reflect.get(target, key) as unknown;
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  const context: ArcVerbContext = { library: counted, log, project, session: "person:test", folder: "/work", writer: { actor: "person:test" } };

  const answer = await status.act({}, context, WORDS);
  assert.match(answer.text, /^3 active arcs, 0 moving:/);
  assert.deepEqual(asked, { arcView: 0, arcViews: 0, boardArcs: 1, closedArcs: 0, holds: 1, waitHolds: 0, heldOnQuestion: 0, waitsFor: 0 });

  // A landing a minute old is counted in the default two hours and in a span that reaches it, and not in one that does not.
  const arc = await anArc(library, "Docs");
  const outline = await work(library, arc.id, "Outline");
  await work(library, arc.id, "Pages");
  await library.closeIncrement(outline.id, { disposition: "landed", pr: "#13" });
  const landedLine = (text: string) => text.split("\n").find((line) => line.includes(arc.id))!;
  assert.match(landedLine((await status.act({}, context, WORDS)).text), /^ {2}Landed /);
  for (const since of ["30m", "2h", "1d"]) assert.match(landedLine((await status.act({ since }, context, WORDS)).text), /^ {2}Landed /, since);
  assert.match(landedLine((await status.act({ since: new Date(Date.now() + 60_000).toISOString() }, context, WORDS)).text), /^ {2}Ready /);

  for (const wrong of ["yesterday", "2 hours", "5w", "h2"]) {
    await assert.rejects(status.act({ since: wrong }, context, WORDS), (error: unknown) => error instanceof VerbRefusal && error.message.includes("--since"), wrong);
  }
});
