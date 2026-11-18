/**
 * Capability 6 · Knowledge and memory, grown by ADR-0640 and ADR-0956: contracts 6.6, 6.7, 6.12, 6.13, 6.14, 6.15 and 6.16, and the kinds after them to 6.25 (6.18 and 6.19, the friction a close moves, in work-in-flight.test.ts)
 * in the library story, each run on BOTH backends, as 6.1-6.5 are (knowledge-memory.test.ts):
 *
 * - memory: a Knowledge over SchemaRecords over a fresh MemoryTransactions;
 * - postgres: the `knowledge` of a fresh project on the server `pnpm test` provides, dropped
 *   afterwards, pass or fail.
 *
 * Whether anything was written is judged one layer down, through the project's Transactions: every
 * change appends a history entry (capability 2), so an unchanged history means nothing was written.
 */
import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";

import { connect } from "../project/index.js";
import { MissingReferenceError } from "../references.js";
import { SchemaError, SchemaRecords, type KnowledgeKind } from "../schema/index.js";
import { dropTestDatabases, testServerUrl, uniqueProjectName } from "../testing/pg.js";
import { MemoryTransactions, type Transactions } from "../transactions/index.js";
import { Knowledge } from "./index.js";

interface Library {
  readonly knowledge: Knowledge;
  readonly transactions: Transactions;
  cleanup(): Promise<void>;
}

interface Backend {
  readonly label: string;
  open(): Promise<Library>;
}

const memory: Backend = {
  label: "memory",
  async open() {
    const transactions = new MemoryTransactions();
    return { knowledge: new Knowledge(new SchemaRecords(transactions)), transactions, cleanup: async () => {} };
  },
};

const postgres: Backend = {
  label: "postgres",
  async open() {
    const name = uniqueProjectName();
    const storytree = await connect({ url: testServerUrl() });
    const cleanup = async (): Promise<void> => {
      try {
        await storytree.close();
      } finally {
        await dropTestDatabases([`storytree_${name}`]);
      }
    };
    try {
      const project = await storytree.openProject(name);
      return { knowledge: project.knowledge, transactions: project.transactions, cleanup };
    } catch (error) {
      await cleanup();
      throw error;
    }
  },
};

/**
 * Each kind with every field 0.2 requires of it, plus the title and one-line description every
 * kind carries (6-a). An agent role's required reading is a list of notes, so it is filled in by
 * the test with a note it has written.
 */
function fullKinds(noteId: string): Record<string, Record<string, unknown>> {
  const head = { title: "A title", description: "One line" };
  return {
    principle: { ...head, statement: "Prefer the smallest change", why: "Big ones hide bugs", howToApply: "Ask what can be left out" },
    pattern: { ...head, statement: "Twin every store", problem: "Tests need a database", approach: "Run one suite on both" },
    guardrail: { ...head, statement: "Never erase", rule: "Writes append history", enforcedBy: "The transactions layer", failureMode: "Lost records" },
    techstack: { ...head, statement: "Postgres", whatItIs: "The database", whyThis: "It is everywhere" },
    process: { ...head, statement: "Land a change", trigger: "A branch is green", steps: "1. Open a PR", surfaces: "`gh pr create`", failureModes: "Unreviewed merges" },
    agent: { ...head, oneLine: "Writes the red test", role: "Test writer", outcome: "A failing test", context: [noteId], tools: "The editor", workflow: "Read, write, run" },
    friction: { ...head, statement: "The seed refused", evidence: "The app holds pgdata (pid 37588)", impact: "The seed waits" },
    resteer: { ...head, doing: "Adding a checker", redirect: "No checker", evidence: "\"we dont need that\"", disposition: "taste", dispositionBy: "owner" },
  };
}

/** Each kind's required fields: taking any one away must be refused, naming it. */
const REQUIRED: Record<string, readonly string[]> = {
  principle: ["title", "description", "statement", "why", "howToApply"],
  pattern: ["title", "description", "statement", "problem", "approach"],
  guardrail: ["title", "description", "statement", "rule", "enforcedBy", "failureMode"],
  techstack: ["title", "description", "statement", "whatItIs", "whyThis"],
  process: ["title", "description", "statement", "trigger", "steps", "surfaces", "failureModes"],
  agent: ["title", "description", "oneLine", "role", "outcome", "context", "tools", "workflow"],
  friction: ["title", "description", "statement", "evidence", "impact"],
  resteer: ["title", "description", "doing", "redirect", "evidence", "disposition", "dispositionBy"],
};

for (const backend of [memory, postgres]) {
  const contract = (number: string, title: string, body: (library: Library) => Promise<void>): void => {
    test(`${number} [${backend.label}] ${title}`, async () => {
      const library = await backend.open();
      try {
        await body(library);
      } finally {
        await library.cleanup();
      }
    });
  };

  contract("6.6", "each of the eight kinds is saved with its required fields, and refused, naming the field, without one", async ({ knowledge, transactions }) => {
    const reading = await knowledge.defineTerm({ term: "Delivery", meaning: "Read the story first" });
    const kinds = fullKinds(reading.id);
    assert.deepEqual(Object.keys(kinds).sort(), Object.keys(REQUIRED).sort());

    for (const [kind, fields] of Object.entries(kinds)) {
      const saved = await knowledge.writeKnowledge(kind as KnowledgeKind, fields as never);
      // A friction report is filed open (6.13): the one field the library adds.
      const stored = kind === "friction" ? { ...fields, state: "open" } : fields;
      assert.equal(saved.type, kind);
      assert.deepEqual(saved.fields, stored, `${kind} is stored as given`);
      assert.deepEqual((await transactions.get(saved.id))?.fields, stored, `${kind} reads back`);

      for (const field of REQUIRED[kind]!) {
        const { [field]: _left, ...without } = fields;
        const before = await transactions.history();
        await assert.rejects(
          knowledge.writeKnowledge(kind as KnowledgeKind, without as never),
          (error: unknown) => error instanceof SchemaError && error.fields.includes(field) && error.message.includes(`"${field}"`),
          `${kind} without ${field} is refused, naming it`,
        );
        assert.deepEqual(await transactions.history(), before, `${kind} without ${field}: nothing written`);
      }
    }
    // They are notes: found by search on their words.
    assert.equal((await knowledge.search("pgdata")).length, 1, "a friction is found by a word of its evidence");
  });

  contract("6.7", "friction with no evidence is refused, and so is a re-steer marked a defect with no failure mode", async ({ knowledge, transactions }) => {
    const { friction, resteer } = fullKinds("unused");
    const before = await transactions.history();

    for (const evidence of [undefined, ""]) {
      await assert.rejects(
        knowledge.writeKnowledge("friction", { ...friction, evidence } as never),
        (error: unknown) => error instanceof SchemaError && error.fields.includes("evidence"),
        `friction with evidence ${JSON.stringify(evidence)} is refused`,
      );
    }
    // A recurrence is evidence too: one with none is refused.
    await assert.rejects(
      knowledge.writeKnowledge("friction", { ...friction, reinforcedBy: [{ branch: "b", date: "2026-09-27" }] } as never),
      (error: unknown) => error instanceof SchemaError && error.fields.includes("reinforcedBy"),
    );
    await assert.rejects(
      knowledge.writeKnowledge("resteer", { ...resteer, disposition: "defect" } as never),
      (error: unknown) => error instanceof SchemaError && error.fields.includes("mode") && error.message.includes("defect"),
      "a defect with no failure mode is refused, saying why",
    );
    assert.deepEqual(await transactions.history(), before, "nothing was written");

    // A matter of taste has no failure mode, and a defect with one is kept.
    await knowledge.writeKnowledge("resteer", resteer as never);
    const defect = await knowledge.writeKnowledge("resteer", { ...resteer, disposition: "defect", mode: "tool-defect" } as never);
    assert.equal((defect.fields as Record<string, unknown>).mode, "tool-defect");
  });

  contract("6.13", "a friction report is filed open, refuses an edit naming its state, and routing moves it: nothing dismisses it, a route routes it, a delivery stamp resolves it", async ({ knowledge, transactions }) => {
    const { friction } = fullKinds("unused");
    const before = await transactions.history();
    await assert.rejects(
      knowledge.writeKnowledge("friction", { ...friction, state: "resolved" } as never),
      (error: unknown) => error instanceof RangeError && /state/.test(error.message),
      "filing names no state: the library writes it",
    );
    assert.deepEqual(await transactions.history(), before, "a filing naming its state writes nothing");

    const filed = await knowledge.writeKnowledge("friction", friction as never);
    assert.equal(filed.fields.state, "open", "filed open");
    const unjudged = await transactions.history();
    for (const state of ["resolved", "open"]) {
      await assert.rejects(
        knowledge.editNote(filed.id, { state } as never),
        (error: unknown) => error instanceof RangeError && /state/.test(error.message),
        `an edit naming state ${state} is refused`,
      );
    }
    assert.deepEqual(await transactions.history(), unjudged, "an edit naming the state writes nothing");

    const stateOf = async (id: string): Promise<unknown> => (await transactions.get(id))?.fields["state"];
    const routed = await knowledge.writeKnowledge("friction", friction as never);
    await knowledge.editNote(routed.id, { route: "tool", routeReason: "A verb is missing" });
    assert.equal(await stateOf(routed.id), "routed", "a route with its remedy still owed reads routed");
    await knowledge.editNote(routed.id, { routeReason: "A verb is still missing" });
    assert.equal(await stateOf(routed.id), "routed", "an edit that is not a judgement leaves it");
    await knowledge.editNote(routed.id, { dischargedBy: "#12" });
    assert.equal(await stateOf(routed.id), "resolved", "a stamp added later resolves it");

    const dismissed = await knowledge.writeKnowledge("friction", friction as never);
    await knowledge.editNote(dismissed.id, { route: "nothing", routeReason: "A one-off" });
    assert.equal(await stateOf(dismissed.id), "dismissed", "routed to nothing it is dismissed");

    const delivered = await knowledge.writeKnowledge("friction", friction as never);
    await knowledge.editNote(delivered.id, { route: "process", routeReason: "Already fixed", dischargedBy: "#9" });
    assert.equal(await stateOf(delivered.id), "resolved", "a route carrying its stamp resolves it at once");
  });

  contract("6.14", "a recurrence on a resolved or dismissed friction report reopens it, clearing its judgement from its fields and keeping it in history; on an open or routed one it leaves the state", async ({ knowledge, transactions }) => {
    const { friction } = fullKinds("unused");
    const recurrence = (n: number) => Array.from({ length: n }, (_, i) => ({ branch: `b${i}`, date: "2026-10-12", evidence: `\`pnpm test\` failed again (${i})` }));
    const fieldsOf = async (id: string): Promise<Record<string, unknown>> => (await transactions.get(id))?.fields ?? {};

    for (const judgement of [
      { route: "tool" as const, routeReason: "Built the verb", dischargedBy: "#7" },
      { route: "nothing" as const, routeReason: "A one-off" },
    ]) {
      const report = await knowledge.writeKnowledge("friction", friction as never);
      await knowledge.editNote(report.id, judgement);
      await knowledge.editNote(report.id, { reinforcedBy: recurrence(1) });
      const reopened = await fieldsOf(report.id);
      assert.equal(reopened["state"], "open", `a recurrence after ${judgement.route} reopens it`);
      for (const field of ["route", "routeReason", "dischargedBy"]) assert.equal(reopened[field], undefined, `${field} leaves its fields`);
      assert.deepEqual(reopened["reinforcedBy"], recurrence(1), "the recurrence is kept");
      const judged = (await transactions.history({ id: report.id })).map(({ record }) => record.fields).find((fields) => fields["route"] === judgement.route);
      assert.equal(judged?.["routeReason"], judgement.routeReason, "the earlier judgement stays in its history");
    }

    const open = await knowledge.writeKnowledge("friction", friction as never);
    await knowledge.editNote(open.id, { reinforcedBy: recurrence(1) });
    assert.equal((await fieldsOf(open.id))["state"], "open");
    const routed = await knowledge.writeKnowledge("friction", friction as never);
    await knowledge.editNote(routed.id, { route: "adr", routeReason: "Needs a decision" });
    await knowledge.editNote(routed.id, { reinforcedBy: recurrence(2) });
    const still = await fieldsOf(routed.id);
    assert.deepEqual([still["state"], still["route"]], ["routed", "adr"], "a recurrence on a routed report leaves its judgement standing");
  });

  contract("6.12", "a quality control check is saved with its question, the principles or guardrails it enforces and what graduated, each part with the day its trial started or it was struck and the arc a leak parks on, and refused without its question or enforcing none or anything else", async ({ knowledge, transactions }) => {
    const { principle, guardrail } = fullKinds("unused");
    const rule = await knowledge.writeKnowledge("principle", principle as never);
    const guard = await knowledge.writeKnowledge("guardrail", guardrail as never);
    const term = await knowledge.defineTerm({ term: "Tautology", meaning: "True by construction" });
    const check = {
      title: "Tautological expected value",
      description: "An expected value computed the way the code computes it",
      question: "Is any expected value computed the way the code computes it?",
      howToAnswer: "Yes when an assertion's expected side repeats the code's formula",
      enforces: [rule.id, guard.id],
      graduated: [
        { part: "A constant asserted equal to itself", enforcedBy: "a Guardrails check" },
        { part: "A variable asserted equal to itself", enforcedBy: "a Guardrails check", trial: "2026-11-01", struck: "2026-11-20", arc: "arc_graduation" },
      ],
    };

    const saved = await knowledge.writeKnowledge("check", check);
    assert.equal(saved.type, "check");
    assert.deepEqual((await transactions.get(saved.id))?.fields, check, "a check reads back as given");
    assert.deepEqual((await knowledge.search("formula")).map(({ id }) => id), [saved.id], "a check is found by a word of how to answer it");

    const before = await transactions.history();
    for (const field of ["title", "description", "question", "enforces"] as const) {
      const { [field]: _left, ...without } = check;
      await assert.rejects(
        knowledge.writeKnowledge("check", without as never),
        (error: unknown) => error instanceof SchemaError && error.fields.includes(field),
        `a check without ${field} is refused, naming it`,
      );
    }
    await assert.rejects(
      knowledge.writeKnowledge("check", { ...check, enforces: [] }),
      (error: unknown) => error instanceof SchemaError && error.fields.includes("enforces"),
      "a check enforcing nothing is refused",
    );
    await assert.rejects(
      knowledge.writeKnowledge("check", { ...check, graduated: [{ part: "All of it" }] } as never),
      (error: unknown) => error instanceof SchemaError && error.fields.includes("graduated"),
      "a graduated part says where it is now enforced",
    );
    await assert.rejects(
      knowledge.writeKnowledge("check", { ...check, graduated: [{ part: "All of it", enforcedBy: "a Guardrails check", trial: "last week" }] }),
      (error: unknown) => error instanceof SchemaError && error.fields.includes("graduated"),
      "a graduated part's trial starts on a day",
    );
    await assert.rejects(
      knowledge.writeKnowledge("check", { ...check, enforces: [term.id] }),
      (error: unknown) => error instanceof MissingReferenceError && error.message.includes(term.id),
      "a check enforcing a definition, not a principle or guardrail, is refused",
    );
    assert.deepEqual(await transactions.history(), before, "nothing was written");
  });

  contract("6.15", "a research note is saved with its title, description, the day the research was done and its findings, and refused without its findings or day, or with a day that is not one", async ({ knowledge, transactions }) => {
    const research = {
      title: "Product-analytics services",
      description: "Hosted analytics services compared",
      researched: "2026-10-02",
      findings: "PostHog self-hosts; Plausible counts pages without cookies",
    };

    const saved = await knowledge.writeKnowledge("research", research);
    assert.equal(saved.type, "research");
    assert.deepEqual((await transactions.get(saved.id))?.fields, research, "a research note reads back as given");
    assert.deepEqual((await knowledge.search("cookies")).map(({ id }) => id), [saved.id], "a research note is found by a word of its findings");

    const before = await transactions.history();
    for (const field of ["title", "description", "researched", "findings"] as const) {
      const { [field]: _left, ...without } = research;
      await assert.rejects(
        knowledge.writeKnowledge("research", without as never),
        (error: unknown) => error instanceof SchemaError && error.fields.includes(field),
        `a research note without ${field} is refused, naming it`,
      );
    }
    await assert.rejects(
      knowledge.writeKnowledge("research", { ...research, researched: "2 October" }),
      (error: unknown) => error instanceof SchemaError && error.fields.includes("researched"),
      "the day the research was done is a real day",
    );
    assert.deepEqual(await transactions.history(), before, "nothing was written");
  });

  contract("6.16", "an artifact refiled as another kind keeps its id, creation date and links, reads as the new kind, and its history keeps what it was; fields that do not fit the new kind, a friction or re-steer, or an id that is no live artifact are refused with nothing written", async ({ knowledge, transactions }) => {
    const cited = await knowledge.defineTerm({ term: "Standing delegation", meaning: "A lane acts without asking" });
    const term = await knowledge.defineTerm({ term: "OpenSpec: dated research (2026-10-10)", meaning: "OpenSpec keeps specs beside code", links: [cited.id] });
    const research = { title: "OpenSpec", description: "OpenSpec looked at", researched: "2026-10-10", findings: "OpenSpec keeps specs beside code", links: [cited.id] };

    const before = await transactions.history();
    await assert.rejects(
      knowledge.refile(term.id, "research", { ...research, researched: "someday" }),
      (error: unknown) => error instanceof SchemaError && error.fields.includes("researched"),
      "fields that do not fit the new kind are refused",
    );
    for (const kind of ["friction", "resteer"] as const) {
      await assert.rejects(knowledge.refile(term.id, kind, {} as never), RangeError, `nothing is refiled as a ${kind}, which has its own capture rules`);
    }
    await assert.rejects(knowledge.refile(term.id, "research", { ...research, links: ["definition_000000000000"] }), MissingReferenceError, "its links name live artifacts");
    assert.equal(await knowledge.refile("definition_000000000000", "research", research), null, "an id that is no live artifact refiles nothing");
    assert.deepEqual(await transactions.history(), before, "nothing was written");

    const refiled = await knowledge.refile(term.id, "research", research);
    assert.equal(refiled?.id, term.id);
    assert.equal(refiled?.type, "research");
    assert.equal(refiled?.createdAt, term.createdAt, "it keeps its creation date");
    const stored = await transactions.get(term.id);
    assert.deepEqual([stored?.type, stored?.fields], ["research", research], "it reads as the new kind, with only the new kind's fields");
    assert.deepEqual((await knowledge.definitions()).map(({ id }) => id), [cited.id], "it is no longer a definition");
    assert.deepEqual((await knowledge.relatedNotes(cited.id)).map(({ id }) => id), [term.id], "it still links where it did");
    const written = (await transactions.history({ id: term.id })).map(({ record }) => record.type);
    assert.deepEqual(written, ["definition", "research"], "its history keeps what it was");
  });

  contract("6.20", "a research note written, or refiled as research, also records an FYI about it, so it is offered to the owner until heard", async ({ knowledge, transactions }) => {
    const fyis = async () => (await transactions.list("fyi")).map(({ fields }) => fields);
    const research = { title: "Voice engines compared", description: "Three speech engines tried on the box", researched: "2026-11-05", findings: "One is fast enough" };
    await assert.rejects(knowledge.writeKnowledge("research", { ...research, findings: "" }), SchemaError);
    assert.deepEqual(await fyis(), [], "a refused write records no FYI");

    const written = await knowledge.writeKnowledge("research", research, { actor: "session:lane" });
    const [fyi, ...more] = await fyis();
    assert.deepEqual(more, []);
    assert.deepEqual(
      { ...fyi, at: undefined },
      { title: "Research report: Voice engines compared", what: "Three speech engines tried on the box", about: written.id, by: "session:lane", at: undefined },
      "it is about the report, by its writer, and unheard",
    );

    const term = await knowledge.defineTerm({ term: "Dated research", meaning: "Specs kept beside code" });
    await knowledge.refile(term.id, "research", { ...research, title: "OpenSpec" });
    assert.deepEqual((await fyis()).map(({ about }) => about).sort(), [written.id, term.id].sort(), "a note refiled as research is offered too");
    await knowledge.refile(term.id, "research", { ...research, title: "OpenSpec again" });
    assert.equal((await fyis()).length, 2, "refiling research as research offers it no second time");
    await knowledge.writeKnowledge("principle", { title: "A title", description: "One line", statement: "S", why: "W", howToApply: "H" } as never);
    assert.equal((await fyis()).length, 2, "another kind records none");
  });
}

for (const backend of [memory, postgres]) {
  test(`6.17 [${backend.label}] an experiment record is saved with its arms, hypotheses, measures, criteria, budget and stop rules; once frozen, only an outcome may be added`, async () => {
    const { knowledge, transactions, cleanup } = await backend.open();
    try {
      const experiment = {
        title: "Twin build of nextjs-vite-rewrite",
        description: "Does the Map help agents on a long multi-agent build?",
        arms: [
          { name: "map-reads-on", description: "The factory as it runs" },
          { name: "map-reads-off", description: "The factory with Map reads denied", denies: { tools: ["focus"], commands: ["storytree map"] } },
        ],
        hypotheses: ["Lanes with Map reads spend fewer tokens before their first edit"],
        measures: ["Share of the 370 tests passing after each merge", "Tokens per landed increment"],
        criteria: { helps: "The on arm's pass share rises faster", noHelp: "The curves stay within 5 points", inconclusive: "Either arm stops before 20 merges" },
        budget: "The owner's subscription; tokens are measured, not capped",
        stopRules: ["Stop an arm when its pass share has not risen for 10 merges", "Stop at 14 days of wall clock"],
      };

      const saved = await knowledge.writeKnowledge("experiment", experiment);
      assert.equal(saved.type, "experiment");
      assert.deepEqual((await transactions.get(saved.id))?.fields, experiment, "an experiment reads back as given");
      assert.deepEqual((await knowledge.search("wall clock")).map(({ id }) => id), [saved.id], "an experiment is found by a word of its stop rules");

      const before = await transactions.history();
      for (const field of ["title", "description", "arms", "hypotheses", "measures", "criteria", "budget", "stopRules"] as const) {
        const { [field]: _left, ...without } = experiment;
        await assert.rejects(
          knowledge.writeKnowledge("experiment", without as never),
          (error: unknown) => error instanceof SchemaError && error.fields.includes(field),
          `an experiment without ${field} is refused, naming it`,
        );
      }
      for (const [field, wrong, why] of [
        ["arms", { arms: [experiment.arms[0]] }, "an experiment compares at least two arms"],
        ["arms", { arms: [experiment.arms[0], experiment.arms[0]] }, "no two arms share a name"],
        ["hypotheses", { hypotheses: [] }, "an experiment states a hypothesis"],
        ["criteria", { criteria: { helps: "Rises faster", noHelp: "Flat" } }, "it says what counts as inconclusive"],
        ["outcome", { outcome: "The Map helped" }, "an outcome waits for the freeze"],
        ["frozen", { frozen: "next week" }, "a freeze is a time"],
      ] as const) {
        await assert.rejects(
          knowledge.writeKnowledge("experiment", { ...experiment, ...wrong } as never),
          (error: unknown) => error instanceof SchemaError && error.fields.includes(field),
          why,
        );
      }
      assert.deepEqual(await transactions.history(), before, "nothing was written");

      assert.equal((await knowledge.editNote(saved.id, { budget: "Two weeks of the subscription" }))?.type, "experiment", "an unfrozen experiment is edited as any artifact");
      const frozen = "2026-10-17T03:00:00.000Z";
      await knowledge.editNote(saved.id, { frozen });

      const atFreeze = await transactions.history();
      for (const edit of [
        { hypotheses: ["Lanes with Map reads finish sooner"] },
        { criteria: { ...experiment.criteria, helps: "Anything better" } },
        { arms: [...experiment.arms].reverse() },
        { stopRules: ["Never stop"] },
        { title: "A different experiment" },
        { frozen: "2026-10-18T03:00:00.000Z" },
        { frozen: undefined },
      ]) {
        await assert.rejects(knowledge.editNote(saved.id, edit as never), /frozen/, `a frozen experiment refuses ${JSON.stringify(edit)}`);
      }
      await assert.rejects(
        knowledge.refile(saved.id, "research", { title: "A note", description: "One line", researched: "2026-10-17", findings: "None" }),
        /frozen/,
        "a frozen experiment is not refiled out of its freeze",
      );
      assert.deepEqual(await transactions.history(), atFreeze, "nothing was written");

      await knowledge.editNote(saved.id, { outcome: "Inconclusive: the off arm stopped at 12 merges" });
      assert.deepEqual(
        (await transactions.get(saved.id))?.fields,
        { ...experiment, budget: "Two weeks of the subscription", frozen, outcome: "Inconclusive: the off arm stopped at 12 merges" },
        "the reading adds its outcome to the frozen record",
      );
    } finally {
      await cleanup();
    }
  });
}

for (const backend of [memory, postgres]) {
  test(`6.21 [${backend.label}] an escape pattern is saved with its instance, where it was caught and its reasoning, judged later with its reason; a judgement without its reason, a yes without its construct and places, or an escape naming no increment is refused`, async () => {
    const { knowledge, transactions, cleanup } = await backend.open();
    try {
      const pattern = {
        title: "A path joined with / that breaks on Windows",
        description: "3.112 failed on Windows at a head and passed once the join was fixed",
        instance: { run: 19234567890, pr: 941, head: "8d402aeb1234", test: "3.112 · the pins read", contract: "contract_aaaaaaaaaaaa", story: "story_bbbbbbbbbbbb", capability: "capability_cccccccccccc" },
        caughtAt: "ci" as const,
        reasoning: "It failed at 8d402aeb and passed only after the pull request changed packages/forest, the unit it is in",
      };
      const saved = await knowledge.writeKnowledge("escape", pattern);
      assert.equal(saved.type, "escape");
      assert.deepEqual((await transactions.get(saved.id))?.fields, pattern, "an unjudged pattern reads back as given");

      const judged = { construct: "a path built with a literal / and read on Windows", elsewhere: "packages/map/src/read.ts, packages/cli/src/front-door.ts", generalises: "yes" as const, generalisesWhy: "nameable, two other places, a lint shape can see it" };
      assert.deepEqual((await knowledge.editNote(saved.id, judged))?.fields, { ...pattern, ...judged }, "the agent's judgement is added to it");

      const before = await transactions.history();
      for (const [field, wrong, why] of [
        ["generalisesWhy", { generalises: "no" }, "a judgement carries its reason"],
        ["generalises", { generalises: "yes", generalisesWhy: "it recurs" }, "a yes names its construct and the other places"],
        ["instance", { caughtAt: "escaped" }, "an escaped pattern names the increment carrying its escape"],
        ["instance", { instance: { test: "3.112 · the pins read" } }, "one CI caught names its run or pull request"],
        ["caughtAt", { caughtAt: "review" }, "it was caught by CI or escaped"],
        ["reasoning", { reasoning: "" }, "it says why it is real"],
      ] as const) {
        await assert.rejects(
          knowledge.writeKnowledge("escape", { ...pattern, ...wrong } as never),
          (error: unknown) => error instanceof SchemaError && error.fields.includes(field),
          why,
        );
      }
      assert.deepEqual(await transactions.history(), before, "nothing was written");

      const escaped = await knowledge.writeKnowledge("escape", { ...pattern, instance: { pr: 900, escape: "increment_dddddddddddd", story: "story_bbbbbbbbbbbb" }, caughtAt: "escaped" as const });
      assert.equal(escaped.fields.caughtAt, "escaped", "one that reached main is saved naming its escape");
    } finally {
      await cleanup();
    }
  });
}

for (const backend of [memory, postgres]) {
  test(`6.22 [${backend.label}] an escape pattern judged yes takes the blue team's rung with its reason and, but for none, its defences; a rung without its reason, a reason without its rung, a defended rung naming no defence, an unknown rung, or a rung on a pattern not judged yes is refused`, async () => {
    const { knowledge, transactions, cleanup } = await backend.open();
    try {
      const pattern = {
        title: "A path joined with / that breaks on Windows",
        description: "3.112 failed on Windows at a head and passed once the join was fixed",
        instance: { run: 19234567890, pr: 941, head: "8d402aeb1234", test: "3.112 · the pins read" },
        caughtAt: "ci" as const,
        reasoning: "It failed at 8d402aeb and passed only after the pull request changed packages/forest, the unit it is in",
      };
      const judged = { ...pattern, construct: "a path built with a literal / and read on Windows", elsewhere: "packages/map/src/read.ts", generalises: "yes" as const, generalisesWhy: "nameable, recurs, a lint shape can see it" };
      const saved = await knowledge.writeKnowledge("escape", judged);

      const lint = { rung: "lint", rungWhy: "a literal / in a path join is a syntax shape, so the first rung holds it", defences: ["contract_eeeeeeeeeeee"] };
      assert.deepEqual((await knowledge.editNote(saved.id, lint as never))?.fields, { ...judged, ...lint }, "a judged-yes pattern is edited to add its rung, its reason and its defences");
      for (const rung of ["property", "fault-injection", "learned-break", "reviewer-check"]) {
        assert.deepEqual((await knowledge.editNote(saved.id, { rung } as never))?.fields, { ...judged, ...lint, rung }, `${rung} is a rung`);
      }

      const none = { rung: "none", rungWhy: "no lint shape, property, fault or reviewer check can see a path read only on Windows" };
      const undefended = await knowledge.writeKnowledge("escape", { ...judged, ...none } as never);
      assert.deepEqual((await transactions.get(undefended.id))?.fields, { ...judged, ...none }, "rung none is saved with its reason and no defences");

      const before = await transactions.history();
      for (const [field, wrong, why] of [
        ["rungWhy", { ...judged, rung: "lint", defences: ["contract_eeeeeeeeeeee"] }, "a rung carries its reason"],
        ["rung", { ...judged, rungWhy: "a lint shape can see it", defences: ["contract_eeeeeeeeeeee"] }, "a reason carries its rung"],
        ["rungWhy", { ...judged, ...lint, rungWhy: "" }, "a rung's reason is not empty"],
        ["defences", { ...judged, rung: "property", rungWhy: "no lint shape can see it; a property can" }, "a rung other than none names its defences"],
        ["defences", { ...judged, rung: "property", rungWhy: "no lint shape can see it; a property can", defences: [] }, "an empty defence list names no defence"],
        ["rung", { ...judged, rung: "unit-test", rungWhy: "a test can see it", defences: ["contract_eeeeeeeeeeee"] }, "a rung is one of the six"],
        ["rung", { ...judged, generalises: "no", ...lint }, "a rung is chosen only on a pattern judged yes, not no"],
        ["rung", { ...judged, generalises: "local", ...lint }, "a rung is chosen only on a pattern judged yes, not local"],
        ["rung", { ...pattern, ...lint }, "a rung is chosen only on a judged pattern"],
      ] as const) {
        await assert.rejects(
          knowledge.writeKnowledge("escape", wrong as never),
          (error: unknown) => error instanceof SchemaError && assert.deepEqual(error.fields, [field], why) === undefined,
          why,
        );
      }
      assert.deepEqual(await transactions.history(), before, "nothing was written");
    } finally {
      await cleanup();
    }
  });
}

const DRILL_LAYERS = ["test-writer", "builder", "lint", "tests", "mutation", "test-reviewer", "code-reviewer", "ci-linux", "ci-windows"] as const;
type DrillResult = "caught" | "missed" | "not-run";

/** One layer row per result, in the fixed order, each with evidence a red-team session would record. */
function drillLayers(results: readonly DrillResult[]): { layer: string; result: DrillResult; evidence: string }[] {
  assert.equal(results.length, DRILL_LAYERS.length, "the fixture gives a result for each of the nine layers");
  return DRILL_LAYERS.map((layer, at) => ({ layer, result: results[at]!, evidence: `${layer}: ${results[at]} on packages/map/src/read.ts at scratch head 3f9c2a1b` }));
}

for (const backend of [memory, postgres]) {
  test(`6.23 [${backend.label}] a red-team drill is saved with the live escape it replants, its plant, mode, each layer's result in the fixed order, the first catching layer, the fixer from the fixed table, a same-model flag on a reviewer catch, its session and date; a drill naming no live escape, a disagreeing first layer or fixer, a Windows leg that ran, or a defect drill whose test writer or builder ran is refused`, async () => {
    const { knowledge, transactions, cleanup } = await backend.open();
    try {
      const escape = await knowledge.writeKnowledge("escape", {
        title: "A path joined with / that breaks on Windows",
        description: "3.112 failed on Windows at a head and passed once the join was fixed",
        instance: { run: 19234567890, pr: 941, head: "8d402aeb1234", test: "3.112 · the pins read" },
        caughtAt: "ci" as const,
        reasoning: "It failed at 8d402aeb and passed only after the pull request changed packages/forest, the unit it is in",
        construct: "a path built with a literal / and read on Windows",
        elsewhere: "packages/map/src/read.ts, packages/cli/src/front-door.ts",
        generalises: "yes" as const,
        generalisesWhy: "nameable, two other places, a lint shape can see it",
      });
      const base = {
        title: "Drill: a / join replanted in the map's reader",
        description: "The Windows path pattern replanted as a template-string join in the map's file reader",
        pattern: escape.id,
        plant: { story: "story_bbbbbbbbbbbb", capability: "capability_cccccccccccc", file: "packages/map/src/read.ts", shape: "a template string `${root}/${name}` handed to readFile" },
        session: "red-team-lane-7f3a",
        date: "2026-11-18",
      };
      const nr = "not-run", m = "missed", c = "caught";

      for (const [why, drill] of [
        ["a defect drill caught first by mutation, then by the test reviewer, goes to the test writer", { mode: "defect", layers: drillLayers([nr, nr, m, m, c, c, m, m, nr]), caughtBy: "mutation", fixer: "test-writer" }],
        ["a defect drill caught first by the code reviewer, the same model as the planter, goes to the builder", { mode: "defect", layers: drillLayers([nr, nr, m, m, m, m, c, c, nr]), caughtBy: "code-reviewer", fixer: "builder", sameModel: true }],
        ["a defect drill no layer caught escaped", { mode: "defect", layers: drillLayers([nr, nr, m, m, nr, m, m, m, nr]), caughtBy: "none", fixer: "escaped" }],
        ["a task drill caught by the test writer goes to the builder", { mode: "task", layers: drillLayers([c, m, m, c, m, m, m, m, nr]), caughtBy: "test-writer", fixer: "builder" }],
        ["a task drill caught first by the builder goes to the builder", { mode: "task", layers: drillLayers([m, c, m, m, m, m, m, m, nr]), caughtBy: "builder", fixer: "builder" }],
        ["a drill caught first by lint goes to the builder", { mode: "defect", layers: drillLayers([nr, nr, c, c, m, m, m, m, nr]), caughtBy: "lint", fixer: "builder" }],
        ["a drill caught first by the tests goes to the builder", { mode: "defect", layers: drillLayers([nr, nr, m, c, m, m, m, m, nr]), caughtBy: "tests", fixer: "builder" }],
        ["a drill caught first by the test reviewer, another model, goes to the test writer", { mode: "defect", layers: drillLayers([nr, nr, m, m, m, c, m, m, nr]), caughtBy: "test-reviewer", fixer: "test-writer", sameModel: false }],
        ["a drill caught first by CI's Linux leg goes to the watcher's fix session", { mode: "defect", layers: drillLayers([nr, nr, m, m, m, m, m, c, nr]), caughtBy: "ci-linux", fixer: "watcher-fix-session" }],
      ] as const) {
        const fields = { ...base, ...drill };
        const saved = await knowledge.writeKnowledge("drill", fields as never);
        assert.equal(saved.type, "drill", why);
        assert.deepEqual((await transactions.get(saved.id))?.fields, fields, `${why}: it reads back as given`);
      }

      const caughtByMutation = { ...base, mode: "defect", layers: drillLayers([nr, nr, m, m, c, c, m, m, nr]), caughtBy: "mutation", fixer: "test-writer" };
      const caughtByReviewer = { ...base, mode: "defect", layers: drillLayers([nr, nr, m, m, m, m, c, m, nr]), caughtBy: "code-reviewer", fixer: "builder", sameModel: false };
      const caughtByNone = { ...base, mode: "defect", layers: drillLayers([nr, nr, m, m, m, m, m, m, nr]), caughtBy: "none", fixer: "escaped" };
      const { pattern: _pattern, ...unpatterned } = caughtByMutation;
      const { sameModel: _sameModel, ...unflagged } = caughtByReviewer;
      const { shape: _shape, ...shapeless } = base.plant;
      const swapped = drillLayers([nr, nr, m, m, c, c, m, m, nr]);
      [swapped[2], swapped[3]] = [swapped[3]!, swapped[2]!];

      const before = await transactions.history();
      for (const [field, wrong, why] of [
        ["description", { ...caughtByMutation, description: "" }, "a drill says what it planted"],
        ["pattern", unpatterned, "a drill names the escape pattern it replants"],
        ["plant", { ...caughtByMutation, plant: shapeless }, "a plant gives its shape in one line"],
        ["plant", { ...caughtByMutation, plant: { ...base.plant, file: "" } }, "a plant names its file"],
        ["plant", { ...caughtByMutation, plant: { ...base.plant, line: 42 } }, "a plant holds its story, capability, file and shape, and nothing else"],
        ["mode", { ...caughtByMutation, mode: "drill" }, "a drill is a planted defect or a planted task"],
        ["layers", { ...caughtByMutation, layers: drillLayers([nr, nr, m, m, c, c, m, m, nr]).slice(0, 8) }, "a drill gives every layer's result, CI's Windows leg included"],
        ["layers", { ...caughtByMutation, layers: swapped }, "the layers are in the fixed order"],
        ["layers", { ...caughtByMutation, layers: drillLayers([nr, nr, m, m, c, c, m, m, nr]).map((row, at) => (at === 7 ? { ...row, layer: "lint" } : row)) }, "each layer is given once"],
        ["layers", { ...caughtByMutation, layers: drillLayers([nr, nr, m, m, c, c, m, m, nr]).map((row, at) => (at === 2 ? { ...row, result: "skipped" } : row)) }, "a layer's result is caught, missed or not-run"],
        ["layers", { ...caughtByMutation, layers: drillLayers([nr, nr, m, m, c, c, m, m, nr]).map((row, at) => (at === 3 ? { ...row, evidence: "" } : row)) }, "a layer's result carries its evidence"],
        ["layers", { ...caughtByMutation, layers: drillLayers([nr, nr, m, m, c, c, m, m, c]) }, "CI's Windows leg is not run, so it caught nothing"],
        ["layers", { ...caughtByMutation, layers: drillLayers([nr, nr, m, m, c, c, m, m, m]) }, "CI's Windows leg is not run, so it missed nothing"],
        ["layers", { ...caughtByMutation, layers: drillLayers([m, nr, m, m, c, c, m, m, nr]) }, "a planted defect skips the test writer"],
        ["layers", { ...caughtByMutation, layers: drillLayers([nr, m, m, m, c, c, m, m, nr]) }, "a planted defect skips the builder"],
        ["caughtBy", { ...caughtByMutation, caughtBy: "test-reviewer", sameModel: false }, "the first catching layer is the first, not a later one that also caught it"],
        ["caughtBy", { ...caughtByMutation, caughtBy: "none", fixer: "escaped" }, "a drill some layer caught was not caught by none"],
        ["caughtBy", { ...caughtByNone, caughtBy: "lint", fixer: "builder" }, "a drill no layer caught names no catching layer"],
        ["fixer", { ...caughtByMutation, fixer: "builder" }, "a mutation survivor goes to the test writer"],
        ["fixer", { ...caughtByReviewer, fixer: "test-writer" }, "a code reviewer's catch goes to the builder"],
        ["fixer", { ...caughtByNone, fixer: "builder" }, "a drill no layer caught escaped"],
        ["fixer", { ...caughtByMutation, fixer: "owner" }, "the fixer is one of the table's four"],
        ["sameModel", unflagged, "a reviewer's catch says whether the reviewer was the planter's model"],
        ["sameModel", { ...caughtByMutation, sameModel: true }, "only a reviewer's catch carries the same-model flag"],
        ["sameModel", { ...caughtByReviewer, sameModel: "yes" }, "the same-model flag is true or false"],
        ["session", { ...caughtByMutation, session: "" }, "a drill names the session that ran it"],
        ["date", { ...caughtByMutation, date: "17/11/2026" }, "a drill's date is a day written YYYY-MM-DD"],
        ["date", { ...caughtByMutation, date: "2026-11-17T09:00:00Z" }, "a drill's date is a day, not a moment"],
      ] as const) {
        await assert.rejects(
          knowledge.writeKnowledge("drill", wrong as never),
          (error: unknown) => error instanceof SchemaError && assert.deepEqual(error.fields, [field], why) === undefined,
          why,
        );
      }
      assert.deepEqual(await transactions.history(), before, "nothing was written");

      const rule = await knowledge.writeKnowledge("principle", { title: "Paths are joined, never built", description: "One line", statement: "S", why: "W", howToApply: "H" } as never);
      const retired = await knowledge.writeKnowledge("escape", { ...escape.fields, title: "A retired escape" } as never);
      await transactions.retire({ id: retired.id, reason: "judged a duplicate" });
      const settled = await transactions.history();
      for (const [id, why] of [
        ["escape_000000000000", "a drill naming no stored escape is refused"],
        [rule.id, "a drill naming a principle, not an escape pattern, is refused"],
        [retired.id, "a drill naming a retired escape pattern is refused"],
      ] as const) {
        await assert.rejects(
          knowledge.writeKnowledge("drill", { ...caughtByMutation, pattern: id } as never),
          (error: unknown) => error instanceof MissingReferenceError && error.field === "pattern" && error.id === id,
          why,
        );
      }
      assert.deepEqual(await transactions.history(), settled, "nothing was written");
    } finally {
      await cleanup();
    }
  });
}

/** A measure's whole set of fields (contract 6.24): what it reads, its unit, its better direction, how and where it is read, its runs and version. */
function coldStart(story: string): Record<string, unknown> {
  return {
    title: "Cold start to first frame",
    description: "How long the desktop app takes from launch to drawing its first frame",
    story,
    reads: "the milliseconds from process start to the first frame the map draws",
    unit: "ms",
    better: "lower",
    howRead: "launch the packaged app five times with a cold cache and take the median",
    machine: "the Mint box",
    runs: 5,
    version: 1,
  };
}

/**
 * Write records one after another on a mocked clock (both backends stamp a record's creation with the process's Date),
 * each a second after the one before, until there are at least `count` and the ids of the even-numbered ones (and so
 * of all of them) are not in creation order: any order a test then sees them in can only be creation order.
 */
async function writeInOrder<R extends { readonly id: string; readonly createdAt: string }>(t: TestContext, count: number, write: (n: number) => Promise<R>): Promise<R[]> {
  const written: R[] = [];
  const evens = () => written.filter((_, n) => n % 2 === 0);
  t.mock.timers.enable({ apis: ["Date"], now: Date.parse("2026-11-18T09:00:00.000Z") });
  try {
    while (written.length < count || evens().every((record, n, all) => n === 0 || all[n - 1]!.id < record.id)) {
      written.push(await write(written.length));
      t.mock.timers.tick(1_000);
    }
  } finally {
    t.mock.timers.reset();
  }
  return written;
}

for (const backend of [memory, postgres]) {
  test(`6.24 [${backend.label}] a measure is saved with its live story, what it reads, its unit, its better direction, how and where it is read, its runs and its version; one missing a field, naming no live story, with a direction outside higher, lower and neither, or runs or a version that is not a whole number from 1 is refused naming the field`, async () => {
    const { knowledge, transactions, cleanup } = await backend.open();
    try {
      const records = new SchemaRecords(transactions);
      const story = await records.create("story", { title: "Desktop app" });
      const rule = await knowledge.writeKnowledge("principle", { title: "Measure before tuning", description: "One line", statement: "S", why: "W", howToApply: "H" } as never);
      const measure = coldStart(story.id);

      for (const [why, fields] of [
        ["a measure with its whole set of fields", measure],
        ["a base measure, read for every story, with links, read once, where neither direction is better", { ...measure, title: "Files in the story", base: true, better: "neither", runs: 1, links: [rule.id] }],
        ["a measure where higher is better, at a later version", { ...measure, title: "Frames drawn per second", unit: "fps", better: "higher", version: 3 }],
      ] as const) {
        const saved = await knowledge.writeKnowledge("measure", fields as never);
        assert.equal(saved.type, "measure", why);
        assert.deepEqual((await transactions.get(saved.id))?.fields, fields, `${why}: it reads back as given`);
      }

      const without = (field: string) => Object.fromEntries(Object.entries(measure).filter(([name]) => name !== field));
      const before = await transactions.history();
      for (const [field, wrong, why] of [
        ...["title", "description", "story", "reads", "unit", "better", "howRead", "machine", "runs", "version"].map((field) => [field, without(field), `a measure without its ${field} is refused`] as const),
        ["better", { ...measure, better: "faster" }, "better is higher, lower or neither"],
        ["better", { ...measure, better: "Lower" }, "better is one of the three as written"],
        ["runs", { ...measure, runs: 0 }, "a reading takes at least one run"],
        ["runs", { ...measure, runs: 2.5 }, "runs is a whole number"],
        ["runs", { ...measure, runs: "5" }, "runs is a number, not text"],
        ["version", { ...measure, version: 0 }, "a version starts at 1"],
        ["version", { ...measure, version: -1 }, "a version is never below 1"],
        ["version", { ...measure, version: 1.5 }, "a version is a whole number"],
      ] as const) {
        await assert.rejects(
          knowledge.writeKnowledge("measure", wrong as never),
          (error: unknown) => error instanceof SchemaError && assert.deepEqual(error.fields, [field], why) === undefined,
          why,
        );
      }
      assert.deepEqual(await transactions.history(), before, "nothing was written");

      const retired = await records.create("story", { title: "A retired story" });
      await transactions.retire({ id: retired.id, reason: "folded into the desktop app" });
      const settled = await transactions.history();
      for (const [id, why] of [
        ["story_000000000000", "a measure naming no stored story is refused"],
        [retired.id, "a measure naming a retired story is refused"],
        [rule.id, "a measure naming a principle, not a story, is refused"],
      ] as const) {
        await assert.rejects(
          knowledge.writeKnowledge("measure", { ...measure, story: id } as never),
          (error: unknown) => error instanceof MissingReferenceError && error.field === "story" && error.id === id,
          why,
        );
      }
      assert.deepEqual(await transactions.history(), settled, "nothing was written");
    } finally {
      await cleanup();
    }
  });

  test(`6.24 [${backend.label}] measures(story) lists that story's live measures oldest first, and measures() every live measure oldest first, a retired one in neither`, async (t) => {
    const { knowledge, transactions, cleanup } = await backend.open();
    try {
      const records = new SchemaRecords(transactions);
      const desktop = await records.create("story", { title: "Desktop app" });
      const library = await records.create("story", { title: "Library" });
      assert.deepEqual(await knowledge.measures(), [], "no measure yet");
      const written = await writeInOrder(t, 4, (n) =>
        knowledge.writeKnowledge("measure", { ...coldStart(n % 2 === 0 ? desktop.id : library.id), title: `Measure ${n}` } as never),
      );
      const retired = await knowledge.writeKnowledge("measure", { ...coldStart(desktop.id), title: "A retired measure" } as never);
      await transactions.retire({ id: retired.id, reason: "it read the wrong frame" });
      await knowledge.writeKnowledge("principle", { title: "Not a measure", description: "One line", statement: "S", why: "W", howToApply: "H" } as never);

      const ids = written.map(({ id }) => id);
      assert.deepEqual((await knowledge.measures(desktop.id)).map(({ id }) => id), ids.filter((_, n) => n % 2 === 0), "the desktop app's, oldest first, the retired one left out");
      assert.deepEqual((await knowledge.measures(library.id)).map(({ id }) => id), ids.filter((_, n) => n % 2 === 1), "the library's, oldest first");
      assert.deepEqual((await knowledge.measures()).map(({ id }) => id), ids, "every live measure, oldest first, of no other kind");
      assert.deepEqual(await knowledge.measures("story_000000000000"), [], "a story with no measure has none");
    } finally {
      await cleanup();
    }
  });

  test(`6.25 [${backend.label}] a measure's edit that changes what it reads without raising its version, or that lowers it, is refused naming version with nothing written; a title, description or links edit needs no new version`, async () => {
    const { knowledge, transactions, cleanup } = await backend.open();
    try {
      const records = new SchemaRecords(transactions);
      const desktop = await records.create("story", { title: "Desktop app" });
      const library = await records.create("story", { title: "Library" });
      const rule = await knowledge.writeKnowledge("principle", { title: "Measure before tuning", description: "One line", statement: "S", why: "W", howToApply: "H" } as never);
      const saved = await knowledge.writeKnowledge("measure", coldStart(desktop.id) as never);

      const worded = { title: "Cold start to the first map frame", description: "Launch to first frame, on the box", links: [rule.id] };
      assert.deepEqual((await knowledge.editNote(saved.id, worded as never))?.fields, { ...coldStart(desktop.id), ...worded }, "its words and links change at the same version");

      const before = await transactions.history();
      for (const [why, edit] of [
        ["what it reads", { reads: "the milliseconds from process start to the window shown" }],
        ["how it is read", { howRead: "launch it once with a warm cache" }],
        ["its unit", { unit: "s" }],
        ["its better direction", { better: "higher" }],
        ["the machine it is read on", { machine: "the laptop" }],
        ["its runs per reading", { runs: 9 }],
        ["whether it is a base measure", { base: true }],
        ["its story", { story: library.id }],
        ["what it reads, naming the same version", { reads: "the milliseconds to the window shown", version: 1 }],
      ] as const) {
        await assert.rejects(
          knowledge.editNote(saved.id, edit as never),
          (error: unknown) => error instanceof SchemaError && assert.deepEqual(error.fields, ["version"], why) === undefined,
          `an edit of ${why} is refused`,
        );
      }
      assert.deepEqual(await transactions.history(), before, "nothing was written");

      const raised = { reads: "the milliseconds from process start to the window shown", version: 2 };
      assert.deepEqual((await knowledge.editNote(saved.id, raised as never))?.fields, { ...coldStart(desktop.id), ...worded, ...raised }, "what it reads changes with its version raised");
      const raisedAt = await transactions.history();
      await assert.rejects(
        knowledge.editNote(saved.id, { version: 1 } as never),
        (error: unknown) => error instanceof SchemaError && assert.deepEqual(error.fields, ["version"]) === undefined,
        "its version never falls, even back to one it had",
      );
      await assert.rejects(
        knowledge.editNote(saved.id, { runs: 3, version: 1 } as never),
        (error: unknown) => error instanceof SchemaError && assert.deepEqual(error.fields, ["version"]) === undefined,
        "a change of what it reads with a lowered version is refused",
      );
      assert.deepEqual(await transactions.history(), raisedAt, "nothing was written");
      assert.deepEqual((await knowledge.editNote(saved.id, { story: library.id, base: true, version: 3 } as never))?.fields, { ...coldStart(desktop.id), ...worded, ...raised, story: library.id, base: true, version: 3 }, "its story and base move with its version raised");
    } finally {
      await cleanup();
    }
  });
}
