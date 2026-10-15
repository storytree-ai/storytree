/**
 * Capability 6 · Knowledge and memory, grown by ADR-0640 and ADR-0956: contracts 6.6, 6.7, 6.12, 6.13, 6.14, 6.15 and 6.16
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
import { test } from "node:test";

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

  contract("6.12", "a quality control check is saved with its question, the principles or guardrails it enforces and what graduated, and refused without its question or enforcing none or anything else", async ({ knowledge, transactions }) => {
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
      graduated: [{ part: "A constant asserted equal to itself", enforcedBy: "a Guardrails check" }],
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
}
