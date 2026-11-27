import assert from "node:assert/strict";
import { test } from "node:test";

import { connect } from "../projects/open/index.js";
import { SchemaError, SchemaRecords, type FieldsOf } from "../storage/rules/index.js";
import { MemoryTransactions, type Transactions } from "../storage/store/index.js";
import { dropTestDatabases, testServerUrl, uniqueProjectName } from "../testing/pg.js";

interface Library {
  readonly records: SchemaRecords;
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
    return { records: new SchemaRecords(transactions), transactions, cleanup: async () => {} };
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
      return { records: project.records, transactions: project.transactions, cleanup };
    } catch (error) {
      await cleanup();
      throw error;
    }
  },
};

type TableType = "arc" | "story" | "capability" | "contract" | "health" | "decision" | "definition";

const MINIMAL: { readonly [T in TableType]: FieldsOf<T> } = {
  arc: { title: "Launch v1", intent: "Ship sign-up", endState: "Visitors can sign up" },
  story: { title: "Visitor can sign up" },
  capability: { title: "Email form", story: "story-1", proposed: true },
  contract: { title: "Rejects a bad email", capability: "capability-1" },
  health: { node: "contract-1", column: "reported", state: "not-checked" },
  decision: { title: "Use Mailgun", text: "Its API is the simplest", status: "accepted" },
  definition: { term: "arc", meaning: "An initiative that grows stories" },
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

  contract("3.11", "a story and a capability carry their prose as text, read back whole and in order; one written without it reads as before", async ({ records }) => {
    const prose = "An opening paragraph.\n\n- **A list item,** wrapped\n  onto a second line.\n\n## A closing section\n\nIts body.";
    await records.create("story", MINIMAL.story, { id: "story-old" });
    await records.create("story", { ...MINIMAL.story, text: prose }, { id: "story-1" });
    await records.create("capability", { ...MINIMAL.capability, text: prose }, { id: "capability-1" });

    const textOf = async (id: string) => ((await records.get(id))?.fields as { text?: string } | undefined)?.text;
    assert.equal(await textOf("story-1"), prose);
    assert.equal(await textOf("capability-1"), prose);
    assert.deepEqual((await records.get("story-old"))?.fields, MINIMAL.story, "a story written before stories carried text reads as it was");
    await records.edit("story-old", { text: "Added later." });
    assert.equal(await textOf("story-old"), "Added later.");
  });

  contract("3.21", "a contract belongs to exactly one capability or one edge: naming both or neither is refused, naming the field, with nothing written; an edge is a from and a to capability with an optional description", async ({ records, transactions }) => {
    const edge = await records.create("edge", { from: "capability-1", to: "capability-0", description: "Reads the saved form" }, { id: "edge-1" });
    assert.deepEqual(edge.fields, { from: "capability-1", to: "capability-0", description: "Reads the saved form" });
    const onEdge = await records.create("contract", { title: "1.4 · The form's fields arrive whole", edge: "edge-1" }, { id: "contract-edge" });
    assert.deepEqual((await records.get(onEdge.id))?.fields, { title: "1.4 · The form's fields arrive whole", edge: "edge-1" }, "an edge's contract reads back naming its edge");

    const before = await transactions.history();
    await assert.rejects(records.create("contract", untyped({ title: "Both", capability: "capability-1", edge: "edge-1" })), schemaError("contract", ["edge"]));
    await assert.rejects(records.create("contract", untyped({ title: "Neither" })), schemaError("contract", ["capability"], 'contract: missing required field "capability"'));
    await assert.rejects(records.edit("contract-edge", { capability: "capability-1" }), schemaError("contract", ["edge"]), "an edit leaving it on both is refused too");
    await assert.rejects(records.create("edge", untyped({ from: "capability-1" })), schemaError("edge", ["to"]));
    await assert.rejects(records.create("edge", untyped({ from: "capability-1", to: "capability-0", contracts: [] })), schemaError("edge", ["contracts"]));
    assert.deepEqual(await transactions.history(), before, "nothing was written");
  });

  contract("3.22", "a contract's proof can name observability as proof with its freshness and the watcher that records its readings; one without them, or another proof carrying them, is refused", async ({ records, transactions }) => {
    const observed = { by: "observability-as-proof", reason: "Only the laptop and the box together show it.", freshness: "2d", watcher: "the Mint box's activity watcher" } as const;
    const saved = await records.create("contract", { title: "2.5 · Two machines' lines read back in order", capability: "capability-1", proof: observed }, { id: "contract-observed" });
    assert.deepEqual((await records.get(saved.id))?.fields, { title: "2.5 · Two machines' lines read back in order", capability: "capability-1", proof: observed });
    await records.edit("contract-observed", { proof: { ...observed, freshness: "36h" } });
    assert.equal(((await records.get(saved.id))?.fields as { proof: { freshness: string } }).proof.freshness, "36h", "hours as well as days");

    const before = await transactions.history();
    const { freshness: _freshness, ...unfresh } = observed;
    const { watcher: _watcher, ...unwatched } = observed;
    for (const proof of [unfresh, unwatched, { ...observed, freshness: "2 days" }, { ...observed, freshness: "0d" }, { by: "test-criterion", reason: "A test reads it.", freshness: "2d" }]) {
      await assert.rejects(records.create("contract", untyped({ title: "1.1 · Refused", capability: "capability-1", proof })), (error) => error instanceof SchemaError && error.fields.some((field) => field.startsWith("proof")), JSON.stringify(proof));
    }
    assert.deepEqual(await transactions.history(), before, "nothing was written");
  });

  contract("3.14", "a story carries a risk reading, a blast depth and a blast radius each with the day read and a reason, and a story or capability its own guardrails, each a check and the change or release that triggers it; values out of range are refused and named, and one written without them reads as before", async ({ records, transactions }) => {
    const risk = {
      depth: { value: 2, read: "2026-10-23", reason: "writes records" },
      radius: { value: 3, downstream: 11, audience: "invited", users: 5, read: "2026-10-23", reason: "11 stories depend on it" },
    } as const;
    const guardrails: { check: string; trigger: "change" | "release" }[] = [
      { check: "a model drives the real app through the change", trigger: "change" },
      { check: "a fresh-install sweep", trigger: "release" },
    ];
    await records.create("story", MINIMAL.story, { id: "story-old" });
    await records.create("story", { ...MINIMAL.story, risk, guardrails }, { id: "story-1" });
    await records.create("capability", { ...MINIMAL.capability, guardrails: guardrails.slice(0, 1) }, { id: "capability-1" });
    assert.deepEqual((await records.get("story-1"))?.fields, { ...MINIMAL.story, risk, guardrails });
    assert.deepEqual((await records.get("capability-1"))?.fields, { ...MINIMAL.capability, guardrails: guardrails.slice(0, 1) });
    assert.deepEqual((await records.get("story-old"))?.fields, MINIMAL.story, "a story written before risk readings reads as it was");

    const before = await transactions.history();
    const refused: [Record<string, unknown>, string][] = [
      [{ risk: { ...risk, depth: { ...risk.depth, value: 4 } } }, "risk"],
      [{ risk: { ...risk, depth: { ...risk.depth, value: 1.5 } } }, "risk"],
      [{ risk: { ...risk, radius: { ...risk.radius, value: 5 } } }, "risk"],
      [{ risk: { ...risk, radius: { ...risk.radius, audience: "everyone" } } }, "risk"],
      [{ risk: { ...risk, radius: { ...risk.radius, downstream: -1 } } }, "risk"],
      [{ risk: { ...risk, depth: { ...risk.depth, read: "2026-02-30" } } }, "risk"],
      [{ risk: { ...risk, depth: { ...risk.depth, reason: "" } } }, "risk"],
      [{ risk: { depth: risk.depth } }, "risk"],
      [{ guardrails: [{ check: "a sweep", trigger: "nightly" }] }, "guardrails"],
      [{ guardrails: [{ check: "", trigger: "change" }] }, "guardrails"],
    ];
    for (const [fields, field] of refused) {
      await assert.rejects(records.edit("story-1", untyped(fields)), schemaError("story", [field]), JSON.stringify(fields));
    }
    await assert.rejects(records.edit("capability-1", untyped({ guardrails: [{ check: "a sweep" }] })), schemaError("capability", ["guardrails"]));
    assert.deepEqual(await transactions.history(), before, "nothing refused was written");
  });
}

function untyped(value: unknown): never {
  return value as never;
}

function schemaError(type: string, fields: readonly string[], message?: string): (error: unknown) => true {
  return (error) => {
    assert.ok(error instanceof SchemaError, `expected a SchemaError, got: ${String(error)}`);
    assert.equal(error.type, type, `the error carries the record's type: ${error.message}`);
    assert.deepEqual([...error.fields].sort(), [...fields].sort(), `the fields at fault: ${error.message}`);
    assert.ok(error.message.startsWith(`${type}: `), `the message starts with the type: ${error.message}`);
    for (const field of fields) {
      assert.ok(error.message.includes(JSON.stringify(field)), `the message names ${field}: ${error.message}`);
    }
    if (message !== undefined) assert.equal(error.message, message);
    return true;
  };
}
