/**
 * Capability 3 · Arc surface: contracts 3.15 and 3.16, `arc recent`, and 3.19, its and `arc show`'s pull requests
 * across a repository cut-over, run with a caller on a fresh project's library on the real Postgres `pnpm test` provides.
 */
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { test, type TestContext } from "node:test";

import { connect, type Library } from "@storytree/library";
import { openActivityLog } from "@storytree/session-management";
import { VerbRefusal, type DoorWords, type Verb, type VerbInputs } from "@storytree/library/verbs";

import { ARC_FAMILIES, type ArcVerbContext } from "./index.js";

const WORDS: DoorWords = { door: "command", say: (step) => `storytree ${step.command}` };
const recent = ARC_FAMILIES.find((family) => family.name === "arc")!.verbs.find((one) => "name" in one.command && one.command.name === "recent") as Verb<VerbInputs, ArcVerbContext>;

/** A fresh project's library, dropped when the test ends, and a caller's context on it. */
async function aProject(t: TestContext): Promise<{ library: Library; context: ArcVerbContext }> {
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
  return { library, context: { library, log, project, session: "person:test", folder: "/work", writer: { actor: "person:test" } } };
}

const anArc = (library: Library, title: string) => library.createArc({ title, intent: `Ship ${title}`, endState: `${title} is live` });
const work = (library: Library, arc: string, title: string) => library.addIncrement({ arc, title, objective: title, body: "…" });
const today = () => new Date().toISOString().slice(0, 10);

test("3.15 · `arc recent` lists what landed since --since grouped by arc, each landing with its title and its pull request, then the arcs that closed since then; withdrawn, open and older work is left out", async (t) => {
  const { library, context } = await aProject(t);

  const signup = await anArc(library, "Sign-up");
  const docs = await anArc(library, "Docs");
  const quiet = await anArc(library, "Quiet");
  const schema = await work(library, signup.id, "Schema");
  const form = await work(library, signup.id, "Form");
  const dropped = await work(library, signup.id, "Dropped");
  await work(library, signup.id, "Still open");
  const outline = await work(library, docs.id, "Write the outline");
  const old = await work(library, quiet.id, "Old");

  await library.closeIncrement(old.id, { disposition: "landed", pr: "#1", date: "2020-01-01" });
  await library.closeIncrement(schema.id, { disposition: "landed", pr: "#12" });
  await library.closeIncrement(form.id, { disposition: "landed", note: "landed with no pull request" });
  await library.closeIncrement(dropped.id, { disposition: "withdrawn", note: "overtaken" });
  await library.closeIncrement(outline.id, { disposition: "landed", pr: "13" });

  const answer = await recent.act({ since: "1h" }, context, WORDS);
  const lines = answer.text.split("\n");
  assert.match(lines[0]!, /^3 landed since \d{4}-\d{2}-\d{2} \d{2}:\d{2} UTC, on 2 arcs:$/);
  assert.deepEqual(lines.slice(1), [
    `  ${signup.id}  Sign-up`,
    `    ${schema.id}  Schema (#12)`,
    `    ${form.id}  Form (no pull request)`,
    `  ${docs.id}  Docs`,
    `    ${outline.id}  Write the outline (#13)`,
    "1 arc closed since then:",
    `  ${docs.id}  Docs (closed ${today()})`,
  ]);

  // A window that starts after every landing has nothing to say.
  const later = await recent.act({ since: new Date(Date.now() + 60_000).toISOString() }, context, WORDS);
  assert.match(later.text, /^Nothing landed since \d{4}-\d{2}-\d{2} \d{2}:\d{2} UTC\.$/);
});

test("3.16 · `arc recent` reads the board's arcs once, counts from the last 24 hours unless --since names a time or a span (30m, 2h, 1d), and refuses any other --since", async (t) => {
  const { library, context } = await aProject(t);
  const arc = await anArc(library, "Docs");
  const yesterday = await work(library, arc.id, "Yesterday");
  await work(library, arc.id, "Pages");
  await library.closeIncrement(yesterday.id, { disposition: "landed", pr: "#9" });

  const asked = { arcView: 0, arcViews: 0, boardArcs: 0, closedArcs: 0 };
  const counted = new Proxy(library, {
    get(target, key) {
      if (typeof key === "string" && key in asked) asked[key as keyof typeof asked]++;
      const value = Reflect.get(target, key) as unknown;
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  const answer = await recent.act({}, { ...context, library: counted }, WORDS);
  assert.deepEqual(asked, { arcView: 0, arcViews: 0, boardArcs: 1, closedArcs: 0 });
  const since = Date.parse(`${/since (\S+ \S+) UTC/.exec(answer.text)![1]!.replace(" ", "T")}Z`);
  assert.ok(Math.abs(Date.now() - 24 * 3_600_000 - since) < 120_000, answer.text);
  assert.match(answer.text, /^1 landed since .*, on 1 arc:/);

  for (const span of ["30m", "2h", "1d"]) assert.match((await recent.act({ since: span }, context, WORDS)).text, /^1 landed/, span);
  for (const wrong of ["yesterday", "2 hours", "5w", "h2"]) {
    await assert.rejects(recent.act({ since: wrong }, context, WORDS), (error: unknown) => error instanceof VerbRefusal && error.message.includes("--since"), wrong);
  }
});

test("3.19 · once the project has a repository cut-over, `arc recent` and `arc show` say a pull request closed before it as the old repository's, and one closed on or after it as `#n` (increment_7f7599b35fe4)", async (t) => {
  const { library, context } = await aProject(t);
  const show = ARC_FAMILIES.find((family) => family.name === "arc")!.verbs.find((one) => "name" in one.command && one.command.name === "show") as Verb<VerbInputs, ArcVerbContext>;
  const arc = await anArc(library, "Docs");
  const outline = await work(library, arc.id, "Write the outline");
  await work(library, arc.id, "Still open");
  await library.closeIncrement(outline.id, { disposition: "landed", pr: "#12" });

  const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
  await library.setPrCutover({ at: `${tomorrow}T00:00:00.000Z`, repository: "storytree-ai/storytree", before: "storytree-ai/storytree-history" });
  assert.match((await recent.act({ since: "1h" }, context, WORDS)).text, new RegExp(`${outline.id}  Write the outline \\(storytree-ai/storytree-history#12\\)`));
  assert.match((await show.act({ arc: arc.id }, context, WORDS)).text, new RegExp(`${today()}  landed  storytree-ai/storytree-history#12  ${outline.id}`));

  await library.setPrCutover({ at: `${today()}T00:00:00.000Z` });
  assert.match((await recent.act({ since: "1h" }, context, WORDS)).text, new RegExp(`${outline.id}  Write the outline \\(#12\\)`), "closed on the cut-over's day: the new repository's");
  assert.match((await show.act({ arc: arc.id }, context, WORDS)).text, new RegExp(`${today()}  landed  #12  ${outline.id}`));
});
