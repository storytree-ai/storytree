// Capability 3 · Data schema
import assert from "node:assert/strict";
import { test } from "node:test";
import { isDeepStrictEqual } from "node:util";

import { z } from "zod";

import { connect } from "../project/index.js";
import { dropTestDatabases, testServerUrl, uniqueProjectName, withCountedProject } from "../testing/pg.js";
import { MemoryTransactions, type RecordEnvelope, type Transactions } from "../transactions/index.js";
import {
  MissingUpgradeError,
  NewerSchemaError,
  OWNER_TIME_ZONE,
  parseSchedule,
  pluginSchema,
  RECORD_SCHEMAS,
  SCHEMA_VERSIONS,
  SchemaError,
  SchemaRecords,
  UnknownTypeError,
  type FieldsOf,
  type LibrarySchema,
  type PluginRecordKind,
  type RecordType,
} from "./index.js";

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

const FULL: { readonly [T in TableType]: FieldsOf<T> } = {
  arc: { title: "Launch v1", description: "The first public release", stories: ["story-1", "story-2"], intent: "Ship sign-up", endState: "Visitors can sign up", parked: true },
  story: { title: "Visitor can sign up", description: "By email, with a confirmation link" },
  capability: {
    title: "Email form",
    story: "story-1",
    description: "The form and its checks",
    dependsOn: ["capability-0"],
    proposed: false,
  },
  contract: { title: "Rejects a bad email", capability: "capability-1", description: "An address with no @ is refused" },
  health: { node: "contract-1", column: "verified", state: "failing", by: "storytree", note: "2 of 3 cases fail" },
  decision: { title: "Use Mailgun", text: "Its API is the simplest", links: ["story-1"], status: "proposed", number: 7, supersedes: [], loadBearing: true },
  definition: { term: "arc", meaning: "An initiative that grows stories", links: [] },
};

const EMPTIEST: { readonly [T in TableType]: FieldsOf<T> } = {
  arc: { title: "A", description: "", stories: [], intent: "I", endState: "E" },
  story: { title: "S", description: "" },
  capability: { title: "C", story: "", description: "", dependsOn: [""], proposed: false },
  contract: { title: "K", capability: "", description: "" },
  health: { node: "", column: "verified", state: "passing", by: "", note: "" },
  decision: { title: "D", text: "T", links: [], status: "accepted" },
  definition: { term: "X", meaning: "Y", links: [""] },
};

const TYPES = Object.keys(MINIMAL) as TableType[];

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

  contract("3.1", "saving a story with no title is refused, the error names title, and nothing is written", async ({ records, transactions }) => {
    const untitled = { description: "By email, with a confirmation link" };
    const attempts = [
      () => records.create("story", untyped(untitled), { id: "story-1" }),
      () => records.create("story", untyped({ title: undefined, ...untitled }), { id: "story-1" }),
      () => records.create("story", untyped(untitled)),
    ];
    for (const attempt of attempts) {
      await assert.rejects(attempt(), schemaError("story", ["title"], 'story: missing required field "title"'));
    }
    assert.equal(await transactions.get("story-1"), null, "no record was saved");
    assert.deepEqual(await transactions.list("story"), [], "not under a generated id either");
    assert.deepEqual(await transactions.history(), [], "no history entry was written");

    for (const type of TYPES) {
      for (const field of Object.keys(MINIMAL[type])) {
        const { [field]: _missing, ...rest } = MINIMAL[type] as Record<string, unknown>;
        await assert.rejects(
          records.create(type, untyped(rest)),
          schemaError(type, [field], `${type}: missing required field "${field}"`),
        );
      }
    }
    const badlyFilled: [RecordType, Record<string, unknown>, string][] = [
      ["story", { title: "" }, "title"],
      ["story", { title: 42 }, "title"],
      ["story", { title: null }, "title"],
      ["story", { title: ["Visitor can sign up"] }, "title"],
      ["story", { ...MINIMAL.story, description: 7 }, "description"],
      ["arc", { ...MINIMAL.arc, stories: "story-1" }, "stories"],
      ["arc", { ...MINIMAL.arc, stories: ["story-1", 2] }, "stories"],
      ["capability", { ...MINIMAL.capability, story: ["story-1"] }, "story"],
      ["capability", { ...MINIMAL.capability, dependsOn: [null] }, "dependsOn"],
      ["contract", { ...MINIMAL.contract, capability: 5 }, "capability"],
      ["health", { ...MINIMAL.health, column: "guessed" }, "column"],
      ["health", { ...MINIMAL.health, state: "passed" }, "state"],
      ["health", { ...MINIMAL.health, state: "Passing" }, "state"],
      ["health", { ...MINIMAL.health, by: 1 }, "by"],
      ["health", { ...MINIMAL.health, note: false }, "note"],
      ["decision", { ...MINIMAL.decision, text: "" }, "text"],
      ["definition", { ...MINIMAL.definition, term: "" }, "term"],
      ["definition", { ...MINIMAL.definition, meaning: { text: "An initiative" } }, "meaning"],
    ];
    for (const [type, fields, field] of badlyFilled) {
      await assert.rejects(records.create(type, untyped(fields)), schemaError(type, [field]));
    }
    await assert.rejects(records.create("arc", untyped({ ...MINIMAL.arc, stories: "story-1" })), (error) => error instanceof SchemaError && isDeepStrictEqual(error.lists, ["stories"]));
    await assert.rejects(records.create("arc", untyped({ ...MINIMAL.arc, stories: ["story-1", 2] })), (error) => error instanceof SchemaError && isDeepStrictEqual(error.lists, []));
    assert.deepEqual(await transactions.history(), [], "none of them wrote anything");

    const saved = await records.create("story", { title: "Visitor can sign up", ...untitled }, { id: "story-1" });
    assert.deepEqual(saved.fields, { title: "Visitor can sign up", description: "By email, with a confirmation link" });
    assert.deepEqual(await transactions.get("story-1"), saved);
  });

  contract("3.2", "an unknown field (for example titel) is refused and named", async ({ records, transactions }) => {
    await assert.rejects(
      records.create("story", untyped({ title: "Visitor can sign up", titel: "Visitor can sign up" }), { id: "story-1" }),
      schemaError("story", ["titel"], 'story: unknown field "titel"'),
    );
    await assert.rejects(
      records.create("story", untyped({ titel: "Visitor can sign up" })),
      schemaError("story", ["title", "titel"]),
    );
    await assert.rejects(
      records.create("story", untyped({ ...MINIMAL.story, titel: "?", status: "open", Title: "?" })),
      schemaError("story", ["titel", "status", "Title"]),
    );
    await assert.rejects(records.create("story", untyped({ ...MINIMAL.story, story: "story-0" })), schemaError("story", ["story"]));
    for (const type of TYPES) {
      await assert.rejects(
        records.create(type, untyped({ ...FULL[type], extra: "?" })),
        schemaError(type, ["extra"], `${type}: unknown field "extra"`),
      );
    }
    for (const field of ["__proto__", "constructor", "toString", "hasOwnProperty"]) {
      const fields: Record<string, unknown> = { ...MINIMAL.story };
      Object.defineProperty(fields, field, { value: "?", enumerable: true, configurable: true, writable: true });
      await assert.rejects(records.create("story", untyped(fields)), schemaError("story", [field]));
    }
    assert.deepEqual(await transactions.history(), [], "none of them wrote anything");

    const story = await records.create("story", MINIMAL.story, { id: "story-1" });
    const before = await transactions.history();
    await assert.rejects(
      records.edit("story-1", untyped({ titel: "Visitor signs up" })),
      schemaError("story", ["titel"], 'story: unknown field "titel"'),
    );
    assert.deepEqual(await transactions.get("story-1"), story, "the record is unchanged");
    assert.deepEqual(await transactions.history(), before, "no history entry was written");
  });

  contract("3.3", "an unknown type is refused", async ({ records, transactions }) => {
    const unknownTypes = [
      "widget",
      "note",
      "Story",
      "STORY",
      "stories",
      " story",
      "story ",
      "",
      "toString",
      "constructor",
      "__proto__",
      "hasOwnProperty",
    ];
    for (const type of unknownTypes) {
      await assert.rejects(
        records.create(untyped(type), untyped({ title: "Visitor can sign up" }), { id: "record-1" }),
        unknownType(type),
      );
      await assert.rejects(records.list(untyped(type)), unknownType(type));
    }
    assert.equal(await transactions.get("record-1"), null, "no record was saved");
    assert.deepEqual(await transactions.history(), [], "no history entry was written");

    const widget = await transactions.save({ id: "widget-1", type: "widget", fields: { title: "From elsewhere" } });
    await assert.rejects(records.get("widget-1"), unknownType("widget", "widget-1"));
    const before = await transactions.history();
    await assert.rejects(records.edit("widget-1", { title: "Changed" }), unknownType("widget", "widget-1"));
    assert.deepEqual(await transactions.get("widget-1"), widget, "the record is unchanged");
    assert.deepEqual(await transactions.history(), before, "no history entry was written");

    for (const type of TYPES) assert.deepEqual(await records.list(type), [], `list("${type}")`);
  });

  contract("3.4", "every stored record carries its schema version (1 today)", async ({ records, transactions }) => {
    for (const type of TYPES) assert.ok(Number.isSafeInteger(SCHEMA_VERSIONS[type]) && SCHEMA_VERSIONS[type] >= 1, type);

    const created: RecordEnvelope[] = [];
    for (const type of TYPES) {
      for (const fields of [MINIMAL[type], FULL[type], EMPTIEST[type]]) {
        const record = await records.create(type, fields, { actor: "agent-a" });
        assert.deepEqual(
          record,
          { id: record.id, type, version: SCHEMA_VERSIONS[type], fields, createdAt: record.createdAt, updatedAt: record.createdAt },
          `a new ${type}, stamped with its type's version`,
        );
        assert.match(record.id, new RegExp(`^${type}_[0-9a-f]{12}$`), "a generated id: the type, _, and 12 lowercase hex digits");
        assert.deepEqual(await transactions.get(record.id), record);
        assert.deepEqual(await records.get(record.id), record);
        created.push(record);
      }
    }
    assert.equal(new Set(created.map((record) => record.id)).size, created.length, "every generated id is different");
    assert.deepEqual(
      (await transactions.history()).map(({ action, record, actor }) => ({ action, record, actor })),
      created.map((record) => ({ action: "created", record, actor: "agent-a" })),
    );
    for (const type of TYPES) {
      const listed = await records.list(type);
      assert.deepEqual(listed, await transactions.list(type), `list("${type}") is the stored ${type} records`);
      assert.deepEqual(listed.map((record) => record.version), [1, 1, 1].fill(SCHEMA_VERSIONS[type]));
    }

    const story = await records.create("story", MINIMAL.story, { id: "story-given" });
    assert.equal(story.id, "story-given");
    const edited = await records.edit("story-given", { description: "By email" }, { actor: "agent-b" });
    assert.ok(edited);
    assert.deepEqual(edited, {
      ...story,
      fields: { title: "Visitor can sign up", description: "By email" },
      updatedAt: edited.updatedAt,
    });
    assert.deepEqual(await transactions.get("story-given"), edited);
    assert.equal(await records.retire("story-given", "merged into another story", { actor: "agent-c" }), undefined);
    assert.equal(await records.get("story-given"), null);
    assert.equal(await transactions.get("story-given"), null);
    const trail = await records.history({ id: "story-given" });
    assert.deepEqual(trail, await transactions.history({ id: "story-given" }));
    assert.deepEqual(
      trail.map(({ action, record, actor, reason }) => ({ action, version: record.version, actor, reason })),
      [
        { action: "created", version: 1, actor: undefined, reason: undefined },
        { action: "updated", version: 1, actor: "agent-b", reason: undefined },
        { action: "retired", version: 1, actor: "agent-c", reason: "merged into another story" },
      ],
    );
    const since = trail[0]?.seq ?? assert.fail("no history for story-given");
    assert.deepEqual(await records.history({ since }), trail.slice(1));
    assert.deepEqual(await records.history(), await transactions.history());
  });

  contract("3.5", "reading a record stamped with a version newer than this code knows is refused, saying so, never guessed at", async ({ records, transactions }) => {
    const today = await records.create("story", MINIMAL.story, { id: "story-today" });
    const future = await transactions.save({
      id: "story-future",
      type: "story",
      version: 2,
      fields: { title: "From the future", audience: "everyone" },
    });
    const lookalike = await transactions.save({
      id: "definition-future",
      type: "definition",
      version: 7,
      fields: { term: "Future", meaning: "Fits version 1 exactly" },
    });

    await assert.rejects(records.get("story-future"), newerVersion("story-future", "story", 2));
    await assert.rejects(records.get("definition-future"), newerVersion("definition-future", "definition", 7));
    await assert.rejects(records.list("story"), newerVersion("story-future", "story", 2));
    await assert.rejects(records.list("definition"), newerVersion("definition-future", "definition", 7));
    await assert.rejects(records.select("story", ["title"]), newerVersion("story-future", "story", 2));

    const before = await transactions.history();
    await assert.rejects(records.edit("definition-future", { meaning: "Rewritten" }), newerVersion("definition-future", "definition", 7));
    await assert.rejects(records.edit("story-future", { title: "Rewritten" }), newerVersion("story-future", "story", 2));
    assert.deepEqual(await transactions.get("definition-future"), lookalike, "the record is unchanged");
    assert.deepEqual(await transactions.get("story-future"), future, "the record is unchanged");
    assert.deepEqual(await transactions.history(), before, "no history entry was written");

    assert.deepEqual(await records.get("story-today"), today);
    assert.deepEqual(await records.list("arc"), []);
    await records.retire("story-future", "written by a newer storytree");
    assert.deepEqual(await records.list("story"), [today]);
  });

  contract("3.6", "an edit that would leave the record invalid is refused, and nothing is written", async ({ records, transactions }) => {
    const story = await records.create("story", FULL.story, { id: "story-1" });
    const capability = await records.create("capability", FULL.capability, { id: "capability-1" });
    const health = await records.create("health", FULL.health, { id: "health-1" });
    const before = await transactions.history();

    const refused: [id: string, type: RecordType, edit: Record<string, unknown>, fields: string[], message?: string][] = [
      ["story-1", "story", { title: "" }, ["title"]],
      ["story-1", "story", { title: undefined }, ["title"], 'story: missing required field "title"'],
      ["story-1", "story", { title: 42 }, ["title"]],
      ["story-1", "story", { description: null }, ["description"]],
      ["story-1", "story", { title: "", description: 7 }, ["title", "description"]],
      ["capability-1", "capability", { story: undefined }, ["story"]],
      ["capability-1", "capability", { dependsOn: "capability-0" }, ["dependsOn"]],
      ["health-1", "health", { state: "green" }, ["state"]],
      ["health-1", "health", { column: undefined, node: undefined }, ["column", "node"]],
    ];
    for (const [id, type, edit, fields, message] of refused) {
      await assert.rejects(records.edit(id, untyped(edit)), schemaError(type, fields, message));
    }
    assert.deepEqual(await transactions.get("story-1"), story, "no record change");
    assert.deepEqual(await transactions.get("capability-1"), capability, "no record change");
    assert.deepEqual(await transactions.get("health-1"), health, "no record change");
    assert.deepEqual(await transactions.history(), before, "no history entry was written");

    const edited = await records.edit("story-1", { description: "By email or phone" });
    assert.deepEqual(edited?.fields, { title: "Visitor can sign up", description: "By email or phone" });
    const trimmed = await records.edit("story-1", { description: undefined });
    assert.deepEqual(trimmed?.fields, { title: "Visitor can sign up" });
    assert.deepEqual(await transactions.get("story-1"), trimmed);
    const history = await transactions.history();
    assert.equal(await records.edit("story-missing", { title: "Visitor can sign up" }), null);
    assert.equal(await transactions.get("story-missing"), null);
    assert.deepEqual(await transactions.history(), history);
  });

  contract("robustness", "a NUL character or a lone UTF-16 surrogate in any field is refused and named, so both backends agree", async ({ records, transactions }) => {
    const unstorable: [text: string, what: RegExp][] = [
      ["Visitor\u0000can sign up", /NUL/],
      ["Visitor can sign up \uD83C", /surrogate/],
      ["\uDF32 Visitor can sign up", /surrogate/],
      ["Visitor \uDF32\uD83C can sign up", /surrogate/],
    ];
    const story = await records.create("story", MINIMAL.story, { id: "story-1" });
    const before = await transactions.history();
    for (const [text, what] of unstorable) {
      const attempts: [type: RecordType, field: string, attempt: () => Promise<unknown>][] = [
        ["story", "title", () => records.create("story", { title: text })],
        ["story", "description", () => records.create("story", { ...MINIMAL.story, description: text })],
        ["health", "node", () => records.create("health", { ...MINIMAL.health, node: text })],
        ["definition", "meaning", () => records.create("definition", { ...MINIMAL.definition, meaning: text })],
        ["arc", "stories", () => records.create("arc", { ...MINIMAL.arc, stories: ["story-1", text] })],
        ["story", "description", () => records.edit("story-1", { description: text })],
      ];
      for (const [type, field, attempt] of attempts) {
        await assert.rejects(attempt(), (error: unknown) => {
          schemaError(type, [field])(error);
          assert.match((error as Error).message, what, "the message says what the field holds that cannot be stored");
          return true;
        });
      }
    }
    assert.deepEqual(await transactions.get("story-1"), story, "no record change");
    assert.deepEqual(await transactions.history(), before, "no history entry was written");

    const title = "\u{1F332} grows ퟿ \u0001 \u{10FFFF} ü";
    const saved = await records.create("story", { title, description: "\t\n" }, { id: "story-2" });
    assert.equal(saved.fields.title, title);
    assert.deepEqual(await records.get("story-2"), saved);
    assert.deepEqual(await transactions.get("story-2"), saved);
  });

  contract("3.7", "a record written on an older version of its type is read upgraded to the current one, step by step", async ({ records, transactions }) => {
    const signUp = await records.create("story", { title: "Visitor can sign up" }, { id: "story-1" });
    const pay = await records.create("story", { title: "Visitor can pay", description: "By card" }, { id: "story-2" });
    const before = await transactions.history();

    const later = new SchemaRecords(transactions, STORY_V2);
    assert.deepEqual(await later.get("story-1"), { ...signUp, version: 2, fields: { name: "Visitor can sign up", summary: "" } });
    assert.deepEqual(await later.list("story"), [
      { ...signUp, version: 2, fields: { name: "Visitor can sign up", summary: "" } },
      { ...pay, version: 2, fields: { name: "Visitor can pay", summary: "By card" } },
    ]);

    const muchLater = new SchemaRecords(transactions, STORY_V3);
    assert.deepEqual((await muchLater.get("story-2"))?.fields, { name: "Visitor can pay", about: "By card" });

    assert.deepEqual(await later.select("story", ["summary"] as never), [
      { ...signUp, version: 2, fields: { summary: "" } },
      { ...pay, version: 2, fields: { summary: "By card" } },
    ]);
    const unnamed = new SchemaRecords(transactions, { ...STORY_V2, upgrades: STORY_V2.upgrades.map(({ reads: _reads, ...step }) => step) });
    assert.deepEqual(await unnamed.select("story", ["summary"] as never), [
      { ...signUp, version: 2, fields: { summary: "" } },
      { ...pay, version: 2, fields: { summary: "By card" } },
    ]);
    assert.deepEqual(await records.select("story", ["title"], { ids: [pay.id] }), [{ ...pay, fields: { title: "Visitor can pay" } }]);

    assert.deepEqual(await transactions.get("story-1"), signUp);
    assert.deepEqual(await transactions.history(), before, "no history entry was written");
  });

  contract("3.8", "editing an older record merges onto its upgraded fields and stores it on the current version, in place", async ({ records, transactions }) => {
    const written = await records.create("story", { title: "Visitor can sign up", description: "With email" }, { id: "story-1" });
    const later = new SchemaRecords(transactions, STORY_V2);

    const expected = { version: 2, fields: { name: "Visitor can sign up", summary: "With email or phone" } };
    const edited = await later.edit("story-1", untyped({ summary: "With email or phone" }), { actor: "agent-a" });
    assert.deepEqual({ version: edited?.version, fields: edited?.fields }, expected);
    const stored = await transactions.get("story-1");
    assert.deepEqual({ version: stored?.version, fields: stored?.fields }, expected, "stored upgraded, in place");
    assert.equal(stored?.createdAt, written.createdAt, "the same record, not a new one");
    const last = (await transactions.history({ id: "story-1" })).at(-1);
    assert.deepEqual({ action: last?.action, record: last?.record }, { action: "updated", record: stored });

    const other = await records.create("story", { title: "Visitor can pay" }, { id: "story-2" });
    const before = await transactions.history();
    await assert.rejects(later.edit("story-2", untyped({ summary: undefined })), schemaError("story", ["summary"]));
    assert.deepEqual(await transactions.get("story-2"), other, "still on version 1, unchanged");
    assert.deepEqual(await transactions.history(), before, "no history entry was written");
  });

  contract("3.10", "a friction report written before reports carried a state reads one worked out from its route and stamp, and its next write stores it so", async ({ records, transactions }) => {
    const head = { title: "The seed refused", description: "One line", statement: "It refused", evidence: "`pnpm seed` exit code 1", impact: "The seed waits" };
    const stored = [
      ["friction-unrouted", {}, "open"],
      ["friction-nothing", { route: "nothing", routeReason: "A one-off" }, "dismissed"],
      ["friction-stamped", { route: "tool", routeReason: "Built it", dischargedBy: "#4" }, "resolved"],
      ["friction-owed", { route: "principle", routeReason: "Needs a rule" }, "routed"],
    ] as const;
    for (const [id, judgement] of stored) await transactions.save({ id, type: "friction", version: 1, fields: { ...head, ...judgement } });
    for (const [id, judgement, state] of stored) {
      const read = await records.get(id);
      assert.equal(read?.version, SCHEMA_VERSIONS.friction);
      assert.deepEqual(read?.fields, { ...head, ...judgement, state }, `${id} reads ${state}`);
    }
    assert.equal((await transactions.get("friction-owed"))?.version, 1, "reading stores nothing");
    await records.edit("friction-owed", { impact: "The seed still waits" });
    const rewritten = await transactions.get("friction-owed");
    assert.deepEqual([rewritten?.version, rewritten?.fields["state"]], [SCHEMA_VERSIONS.friction, "routed"], "an edit stores it upgraded, in place");
  });

  contract("3.9", "an older record with no upgrade step to the current version is refused, naming the missing step", async ({ records, transactions }) => {
    const written = await records.create("story", MINIMAL.story, { id: "story-1" });
    const before = await transactions.history();
    const stepless = new SchemaRecords(transactions, { ...STORY_V2, upgrades: [] });

    await assert.rejects(stepless.get("story-1"), missingUpgrade("story-1", "story", 1, 2));
    await assert.rejects(stepless.list("story"), missingUpgrade("story-1", "story", 1, 2));
    await assert.rejects(stepless.edit("story-1", untyped({ summary: "Anything" })), missingUpgrade("story-1", "story", 1, 2));
    assert.deepEqual(await transactions.get("story-1"), written, "the record is unchanged");
    assert.deepEqual(await transactions.history(), before, "no history entry was written");
  });

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

  contract("3.12", "a process's schedule, time zone and precheck are validated: good words (a daily schedule's grace among them) are kept, bad words, a grace on any but a daily schedule, an unknown time zone, a precheck not on the fixed list, or a time zone or precheck with no schedule are refused and named", async ({ records, transactions }) => {
    const process = { title: "Read the spend", description: "Daily spend reading", statement: "S", trigger: "T", steps: "1. Read", surfaces: "GCP", failureModes: "None" };
    const good = ["every run", "every hour", "every 2 hours", "Every 30 minutes", "every 1 day", "daily at 09:15", "daily at 09:15 and 21:15", "daily at 06:00, 12:00 and 18:00", "daily at 09:15, grace 2 hours", "daily at 06:00, 18:00, grace 90 minutes"];
    for (const [index, schedule] of good.entries()) {
      const saved = await records.create("process", { ...process, schedule }, { id: `process-${index}` });
      assert.equal((saved.fields as { schedule?: string }).schedule, schedule, `"${schedule}" is kept as written`);
    }
    await records.create("process", { ...process, schedule: "daily at 09:15", timeZone: "Europe/London" }, { id: "process-zoned" });
    await records.create("process", { ...process, schedule: "every run", precheck: "feedback-waiting" }, { id: "process-checked" });

    const before = await transactions.history();
    const refused: [fields: Record<string, unknown>, field: string][] = [
      [{ schedule: "sometimes" }, "schedule"],
      [{ schedule: "every" }, "schedule"],
      [{ schedule: "every hours" }, "schedule"],
      [{ schedule: "every 0 minutes" }, "schedule"],
      [{ schedule: "every 2 fortnights" }, "schedule"],
      [{ schedule: "daily at 9:15" }, "schedule"],
      [{ schedule: "daily at 24:00" }, "schedule"],
      [{ schedule: "daily at 09:15 and noon" }, "schedule"],
      [{ schedule: "" }, "schedule"],
      [{ schedule: "every run, grace 2 hours" }, "schedule"],
      [{ schedule: "every 2 hours, grace 1 hour" }, "schedule"],
      [{ schedule: "daily at 09:15, grace 0 minutes" }, "schedule"],
      [{ schedule: "daily at 09:15, grace a while" }, "schedule"],
      [{ schedule: "every run", precheck: "echo nothing to do" }, "precheck"],
      [{ precheck: "feedback-waiting" }, "precheck"],
      [{ schedule: "every run", timeZone: "Mars/Olympus_Mons" }, "timeZone"],
      [{ timeZone: "Australia/Sydney" }, "timeZone"],
    ];
    for (const [fields, field] of refused) {
      await assert.rejects(records.create("process", untyped({ ...process, ...fields })), schemaError("process", [field]), JSON.stringify(fields));
    }
    await assert.rejects(records.edit("process-0", { schedule: "now and then" }), schemaError("process", ["schedule"]));
    await assert.rejects(records.edit("process-zoned", { schedule: undefined }), schemaError("process", ["timeZone"]));
    assert.deepEqual(await transactions.history(), before, "nothing refused was written");
    await records.edit("process-0", { schedule: "every 4 hours", timeZone: "Australia/Perth" });
    assert.deepEqual(await records.get("process-0").then((record) => record?.fields), { ...process, schedule: "every 4 hours", timeZone: "Australia/Perth" });
  });

  contract("3.13", "a process's schedule reads back as written and as its rule, a daily schedule's grace in minutes, its times in its own time zone or the owner's, and its precheck as written; one with no schedule reads as before", async ({ records }) => {
    const process = { title: "Check the backups", description: "Backup check", statement: "S", trigger: "When the box starts", steps: "1. Look", surfaces: "Drive", failureModes: "None" };
    await records.create("process", process, { id: "process-plain" });
    await records.create("process", { ...process, schedule: "daily at 21:15 and 09:15" }, { id: "process-daily" });
    await records.create("process", { ...process, schedule: "every 2 hours", timeZone: "Europe/London" }, { id: "process-zoned" });

    const read = async (id: string) => (await records.get(id))?.fields as { schedule?: string; timeZone?: string } | undefined;
    assert.deepEqual(await read("process-plain"), process, "a process with no schedule reads as it was");
    const daily = await read("process-daily");
    assert.equal(daily?.schedule, "daily at 21:15 and 09:15");
    assert.deepEqual(parseSchedule(daily?.schedule ?? ""), { rule: { kind: "daily", times: ["09:15", "21:15"] } });
    assert.equal(daily?.timeZone ?? OWNER_TIME_ZONE, "Australia/Sydney", "no time zone means the owner's");
    const zoned = await read("process-zoned");
    assert.deepEqual(parseSchedule(zoned?.schedule ?? ""), { rule: { kind: "interval", minutes: 120 } });
    assert.equal(zoned?.timeZone, "Europe/London");
    assert.deepEqual(parseSchedule("every run"), { rule: { kind: "every-run" } });
    assert.deepEqual(parseSchedule("Daily at 21:15 and 09:15, grace 2 hours"), { rule: { kind: "daily", times: ["09:15", "21:15"], graceMinutes: 120 } });
    assert.deepEqual(parseSchedule("daily at 09:15 grace 1 day"), { rule: { kind: "daily", times: ["09:15"], graceMinutes: 1440 } }, "the comma before a grace is optional");
    assert.ok("refused" in parseSchedule("daily at 09:15,, grace 2 hours"), "only one comma before a grace is dropped");
    assert.ok("refused" in parseSchedule("daily at 09:15, grace 2 hours grace 1 hour"), "the grace is everything after the first");
    await records.create("process", { ...process, schedule: "every run", precheck: "feedback-waiting" }, { id: "process-checked" });
    assert.equal(((await records.get("process-checked"))?.fields as { precheck?: string } | undefined)?.precheck, "feedback-waiting");
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
  contract("3.15", "a kind a plugin declares, `<plugin>.<kind>` with its fields' shape as JSON Schema, is written and read back like a core kind, and read upgraded by the steps its plugin declares as data", async ({ transactions }) => {
    const voice = new SchemaRecords(transactions, pluginSchema([VOICE_NOTE]));
    const note = await voice.create(plugin("voice.note"), untyped({ text: "Call the bank", heard: false }));
    assert.match(note.id, /^voice\.note_[0-9a-f]{12}$/);
    assert.deepEqual({ type: note.type, version: note.version, fields: note.fields }, { type: "voice.note", version: 1, fields: { text: "Call the bank", heard: false } });
    assert.deepEqual(await voice.get(note.id), note);
    assert.deepEqual(await voice.list(plugin("voice.note")), [note]);
    const heard = await voice.edit(note.id, untyped({ heard: true }));
    assert.deepEqual(heard?.fields, { text: "Call the bank", heard: true });
    const story = await voice.create("story", MINIMAL.story, { id: "story-1" });
    assert.deepEqual(await voice.get("story-1"), story);

    const later = new SchemaRecords(transactions, pluginSchema([VOICE_NOTE_V2]));
    assert.deepEqual((await later.get(note.id))?.fields, { words: "Call the bank", heard: true, channel: "voice" });
    assert.equal((await transactions.get(note.id))?.version, 1, "reading changes nothing stored");

    assert.throws(() => pluginSchema([{ ...VOICE_NOTE, kind: "note" }]), /"note" is not named <plugin>\.<kind>/);
    assert.throws(() => pluginSchema([VOICE_NOTE, VOICE_NOTE]), /"voice\.note" is declared twice/);
    assert.throws(() => pluginSchema([{ ...VOICE_NOTE, fields: { type: "string" } }]), /"voice\.note"'s fields must be a JSON Schema of type "object"/);
  });

  contract("3.16", "a dotted kind no loaded plugin declared is refused on write, and nothing is written", async ({ records, transactions }) => {
    const before = await transactions.history();
    await assert.rejects(records.create(plugin("voice.note"), untyped({ text: "Call the bank" })), unknownType("voice.note"));
    const voice = new SchemaRecords(transactions, pluginSchema([VOICE_NOTE]));
    await assert.rejects(voice.create(plugin("voice.memo"), untyped({ text: "Call the bank" })), unknownType("voice.memo"));
    assert.deepEqual(await transactions.history(), before, "nothing refused was written");
  });

  contract("3.17", "a write that breaks the shape its plugin declared is refused, naming each field at fault, and nothing is written", async ({ transactions }) => {
    const voice = new SchemaRecords(transactions, pluginSchema([VOICE_NOTE]));
    const note = await voice.create(plugin("voice.note"), untyped({ text: "Call the bank" }), { id: "voice.note_1" });
    const before = await transactions.history();
    await assert.rejects(voice.create(plugin("voice.note"), untyped({ heard: true })), schemaError("voice.note", ["text"]));
    await assert.rejects(voice.create(plugin("voice.note"), untyped({ text: "Hi", txt: "Hi" })), schemaError("voice.note", ["txt"]));
    await assert.rejects(voice.create(plugin("voice.note"), untyped({ text: 7 })), schemaError("voice.note", ["text"]));
    await assert.rejects(voice.edit(note.id, untyped({ text: "" })), schemaError("voice.note", ["text"]));
    assert.deepEqual(await transactions.get(note.id), note);
    assert.deepEqual(await transactions.history(), before, "nothing refused was written");
  });

  contract("3.18", "a plugin kind no loaded plugin declares reads dormant: kept intact and readable by id, hidden from lists, refused an edit; declared again, its records read as before", async ({ records, transactions }) => {
    const voice = new SchemaRecords(transactions, pluginSchema([VOICE_NOTE]));
    const note = await voice.create(plugin("voice.note"), untyped({ text: "Call the bank" }), { id: "voice.note_1" });

    assert.deepEqual(await records.get(note.id), { ...note, dormant: true });
    assert.deepEqual(await records.list(plugin("voice.note")), []);
    assert.deepEqual(await records.select(plugin("voice.note"), untyped(["text"])), []);
    const before = await transactions.history();
    await assert.rejects(records.edit(note.id, untyped({ text: "Call the bank today" })), unknownType("voice.note", note.id));
    assert.deepEqual(await transactions.get(note.id), note, "kept intact");
    assert.deepEqual(await transactions.history(), before, "nothing refused was written");

    const again = new SchemaRecords(transactions, pluginSchema([VOICE_NOTE]));
    assert.deepEqual(await again.get(note.id), note);
    assert.deepEqual(await again.list(plugin("voice.note")), [note]);
  });

  contract("3.19", "a write to a principle, guardrail, pattern, process, agent role or decision carries the mark of the outside text its writer had read; a write of any other kind carries none", async ({ records, transactions }) => {
    const read = ["gh issue view 7"];
    let asked = 0;
    const writer = { actor: "session:one", outsideRead: async () => { asked += 1; return read; } };
    const head = { title: "Read before you write", description: "One line." };
    const principle = await records.create("principle", { ...head, statement: "S.", why: "W.", howToApply: "H." }, writer);
    const story = await records.create("story", { title: "The kettle" }, writer);
    assert.equal(asked, 1, "a new record of an unmarked kind never asks what was read");
    await records.edit(principle.id, { statement: "S, edited." }, writer);
    await records.edit(story.id, { title: "The kettle, edited" }, writer);
    await records.edit(principle.id, { statement: "S, by a writer who read nothing outside." }, { actor: "session:two", outsideRead: async () => [] });
    await records.retire(principle.id, "overtaken", writer);

    const marks = (await transactions.history()).map((entry) => [entry.type, entry.action, entry.outsideRead]);
    assert.deepEqual(marks, [
      ["principle", "created", read],
      ["story", "created", undefined],
      ["principle", "updated", read],
      ["story", "updated", undefined],
      ["principle", "updated", undefined],
      ["principle", "retired", read],
    ]);
  });
}

test("3.20 · a projected read of records stored on an older version of their type comes back as the same fields of them upgraded, and takes no more bytes than of the same records stored on the current one", async () => {
  await withCountedProject(async ({ records, transactions }, received) => {
    const body = "b".repeat(4000);
    const stored = { 1: { status: "ready", touches: ["capability_a", "story_b"] }, 2: { status: "active", touches: ["capability_a", "story_b"] }, 3: { status: "active", capabilities: ["capability_a"], links: ["story_b"] } };
    for (const [version, fields] of Object.entries(stored)) {
      for (let index = 0; index < 40; index++) {
        await transactions.save({ id: `increment-v${version}-${String(index).padStart(2, "0")}`, type: "increment", version: Number(version), fields: { arc: "arc_1", title: "Work", body, ...fields } });
      }
    }
    const fields = ["arc", "status", "capabilities", "links"] as const;
    const measure = async (version: string) => {
      const ids = Array.from({ length: 40 }, (_, index) => `increment-v${version}-${String(index).padStart(2, "0")}`);
      const before = received();
      const selected = await records.select("increment", fields, { ids });
      const bytes = received() - before;
      const upgraded = (await records.list("increment", { ids })).map((record) => ({ ...record, fields: pick(record.fields, fields) }));
      assert.deepEqual(selected, upgraded, `version ${version}'s selection is its upgraded records' fields`);
      return bytes;
    };
    await measure("3");
    const current = await measure("3");
    for (const version of ["1", "2"]) {
      const bytes = await measure(version);
      assert.ok(bytes <= current, `version ${version}'s records took ${bytes} bytes, the current version's ${current}`);
    }
  });
});

function pick(fields: Record<string, unknown>, names: readonly string[]): Record<string, unknown> {
  return Object.fromEntries(names.filter((name) => Object.hasOwn(fields, name)).map((name) => [name, fields[name]]));
}

const STORY_V2: LibrarySchema = {
  versions: { ...SCHEMA_VERSIONS, story: 2 },
  schemas: { ...RECORD_SCHEMAS, story: z.object({ name: z.string().min(1), summary: z.string() }).strict() },
  upgrades: [
    {
      type: "story",
      from: 1,
      name: "title-becomes-name",
      reads: ["title", "description"],
      up: ({ title, description, ...rest }) => ({ ...rest, name: title, summary: description ?? "" }),
    },
  ],
};

const STORY_V3: LibrarySchema = {
  versions: { ...SCHEMA_VERSIONS, story: 3 },
  schemas: { ...RECORD_SCHEMAS, story: z.object({ name: z.string().min(1), about: z.string() }).strict() },
  upgrades: [
    { type: "story", from: 2, name: "summary-becomes-about", reads: ["summary"], up: ({ summary, ...rest }) => ({ ...rest, about: summary }) },
    ...STORY_V2.upgrades,
  ],
};

const VOICE_NOTE: PluginRecordKind = {
  kind: "voice.note",
  version: 1,
  writers: ["storytree_voice"],
  fields: { type: "object", properties: { text: { type: "string", minLength: 1 }, heard: { type: "boolean" } }, required: ["text"], additionalProperties: false },
};

const VOICE_NOTE_V2: PluginRecordKind = {
  ...VOICE_NOTE,
  version: 2,
  fields: {
    type: "object",
    properties: { words: { type: "string", minLength: 1 }, heard: { type: "boolean" }, channel: { type: "string" } },
    required: ["words", "channel"],
    additionalProperties: false,
  },
  upgrades: [{ from: 1, name: "text-becomes-words", rename: { text: "words" }, set: { channel: "voice" } }],
};

function plugin(kind: string): RecordType {
  return kind as RecordType;
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

function unknownType(type: string, id?: string): (error: unknown) => true {
  return (error) => {
    assert.ok(error instanceof UnknownTypeError, `expected an UnknownTypeError, got: ${String(error)}`);
    assert.equal(error.type, type);
    assert.equal(error.id, id);
    assert.ok(error.message.includes(JSON.stringify(type)), `the message names the type: ${error.message}`);
    if (id !== undefined) {
      assert.ok(error.message.includes(JSON.stringify(id)), `the message names the record: ${error.message}`);
    }
    return true;
  };
}

function newerVersion(id: string, type: RecordType, version: number): (error: unknown) => true {
  return (error) => {
    assert.ok(error instanceof NewerSchemaError, `expected a NewerSchemaError, got: ${String(error)}`);
    assert.deepEqual(
      { id: error.id, type: error.type, version: error.version, knownVersion: error.knownVersion },
      { id, type, version, knownVersion: 1 },
    );
    assert.match(error.message, /newer/, `the message says the version is newer: ${error.message}`);
    for (const part of [JSON.stringify(id), type, `version ${version}`, "version 1"]) {
      assert.ok(error.message.includes(part), `the message names ${part}: ${error.message}`);
    }
    assert.match(error.message, /git pull/);
    assert.match(error.message, /pnpm install/);
    assert.match(error.message, /restart the MCP server from a current worktree/);
    assert.match(error.message, /The running code(?: is \d+ commits? behind locally fetched origin\/main|'s distance from locally fetched origin\/main is unknown)\./);
    return true;
  };
}

function missingUpgrade(id: string, type: RecordType, from: number, knownVersion: number): (error: unknown) => true {
  return (error) => {
    assert.ok(error instanceof MissingUpgradeError, `expected a MissingUpgradeError, got: ${String(error)}`);
    assert.deepEqual(
      { id: error.id, type: error.type, from: error.from, knownVersion: error.knownVersion },
      { id, type, from, knownVersion },
    );
    for (const part of [JSON.stringify(id), `version ${from} to ${from + 1}`]) {
      assert.ok(error.message.includes(part), `the message names ${part}: ${error.message}`);
    }
    return true;
  };
}
