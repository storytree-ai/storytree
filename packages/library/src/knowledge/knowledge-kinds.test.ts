/**
 * Capability 6 · Knowledge and memory, grown by ADR-0640: contracts 6.6 and 6.7 in
 * the library story, each run on BOTH backends, as 6.1-6.5 are (knowledge-memory.test.ts):
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
      assert.equal(saved.type, kind);
      assert.deepEqual(saved.fields, fields, `${kind} is stored as given`);
      assert.deepEqual((await transactions.get(saved.id))?.fields, fields, `${kind} reads back`);

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
}
