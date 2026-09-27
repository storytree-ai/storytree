/**
 * Capability 3 · Data schema: one test per contract 3.1-3.6 in stories/library.md, plus one
 * robustness check, each run on BOTH backends. SchemaRecords is a layer over any Transactions,
 * so it must behave the same over each:
 *
 * - memory: SchemaRecords over a fresh MemoryTransactions;
 * - postgres: the `records` of a fresh project, opened through capability 1 on the server
 *   `pnpm test` provides and named with uniqueProjectName(). Its database is dropped afterwards,
 *   pass or fail. Other test files share that server, so a test only ever reads its own project.
 *
 * Whether anything was written is judged one layer down, through the same project's
 * Transactions: every change appends a history entry (capability 2), so an unchanged history and
 * unchanged records mean nothing was written.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { z } from "zod";

import { connect } from "../project/index.js";
import { dropTestDatabases, testServerUrl, uniqueProjectName } from "../testing/pg.js";
import { MemoryTransactions, type RecordEnvelope, type Transactions } from "../transactions/index.js";
import {
  MissingUpgradeError,
  NewerSchemaError,
  RECORD_SCHEMAS,
  SCHEMA_VERSIONS,
  SchemaError,
  SchemaRecords,
  UnknownTypeError,
  type FieldsOf,
  type LibrarySchema,
  type RecordType,
} from "./index.js";

/** A fresh, empty library: the typed layer under test, and the transactions it runs over. */
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
      // The project handle's own records and transactions: the layer as later stories reach it.
      const project = await storytree.openProject(name);
      return { records: project.records, transactions: project.transactions, cleanup };
    } catch (error) {
      await cleanup();
      throw error;
    }
  },
};

/**
 * The eight types capability 3 was built with, which the tables below restate. The types added
 * later have their own capability's tests (6.6 for the eight knowledge kinds of ADR-0640), so these
 * tables do not grow with every new type.
 */
type TableType = "arc" | "story" | "capability" | "contract" | "health" | "decision" | "definition";

/**
 * One record of every type holding only its required fields: the brief's table of fields,
 * restated here rather than taken from the code. Its keys ARE each type's required fields.
 */
const MINIMAL: { readonly [T in TableType]: FieldsOf<T> } = {
  arc: { title: "Launch v1", intent: "Ship sign-up", endState: "Visitors can sign up" },
  story: { title: "Visitor can sign up" },
  capability: { title: "Email form", story: "story-1" },
  contract: { title: "Rejects a bad email", capability: "capability-1" },
  health: { node: "contract-1", column: "reported", state: "not-checked" },
  decision: { title: "Use Mailgun", text: "Its API is the simplest", status: "accepted" },
  definition: { term: "arc", meaning: "An initiative that grows stories" },
};

/** The same records with every optional field filled in as well. */
const FULL: { readonly [T in TableType]: FieldsOf<T> } = {
  arc: { title: "Launch v1", description: "The first public release", stories: ["story-1", "story-2"], intent: "Ship sign-up", endState: "Visitors can sign up", parked: true },
  story: { title: "Visitor can sign up", description: "By email, with a confirmation link" },
  capability: {
    title: "Email form",
    story: "story-1",
    description: "The form and its checks",
    dependsOn: ["capability-0"],
  },
  contract: { title: "Rejects a bad email", capability: "capability-1", description: "An address with no @ is refused" },
  health: { node: "contract-1", column: "verified", state: "failing", by: "storytree", note: "2 of 3 cases fail" },
  decision: { title: "Use Mailgun", text: "Its API is the simplest", links: ["story-1"], status: "proposed", number: 7, supersedes: [], loadBearing: true },
  definition: { term: "arc", meaning: "An initiative that grows stories", links: [] },
};

/**
 * The emptiest record of every type the brief allows: only a title, text, term or meaning must be
 * non-empty, so every other string may be "" and every list may be empty or hold "". (Whether an
 * id names a record that exists is for later capabilities, not for this layer.)
 */
const EMPTIEST: { readonly [T in TableType]: FieldsOf<T> } = {
  arc: { title: "A", description: "", stories: [], intent: "I", endState: "E" },
  story: { title: "S", description: "" },
  capability: { title: "C", story: "", description: "", dependsOn: [""] },
  contract: { title: "K", capability: "", description: "" },
  health: { node: "", column: "verified", state: "passing", by: "", note: "" },
  decision: { title: "D", text: "T", links: [], status: "accepted" },
  definition: { term: "X", meaning: "Y", links: [""] },
};

const TYPES = Object.keys(MINIMAL) as TableType[];

for (const backend of [memory, postgres]) {
  /** Register one test for this backend, run against a fresh library disposed of afterwards, pass or fail. */
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
    // No title at all, a title set to undefined (which no stored record can hold), and no id given.
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

    // The same holds for every required field of every type...
    for (const type of TYPES) {
      for (const field of Object.keys(MINIMAL[type])) {
        const { [field]: _missing, ...rest } = MINIMAL[type] as Record<string, unknown>;
        await assert.rejects(
          records.create(type, untyped(rest)),
          schemaError(type, [field], `${type}: missing required field "${field}"`),
        );
      }
    }
    // ...and for any field filled in badly: an empty title, a text or meaning, a value of the wrong
    // kind, a list item that is not an id, a state or column outside its fixed set.
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
    assert.deepEqual(await transactions.history(), [], "none of them wrote anything");

    // Control: the same story with a title is saved.
    const saved = await records.create("story", { title: "Visitor can sign up", ...untitled }, { id: "story-1" });
    assert.deepEqual(saved.fields, { title: "Visitor can sign up", description: "By email, with a confirmation link" });
    assert.deepEqual(await transactions.get("story-1"), saved);
  });

  contract("3.2", "an unknown field (for example titel) is refused and named", async ({ records, transactions }) => {
    // A misspelt field beside a good title: refused, and named alone.
    await assert.rejects(
      records.create("story", untyped({ title: "Visitor can sign up", titel: "Visitor can sign up" }), { id: "story-1" }),
      schemaError("story", ["titel"], 'story: unknown field "titel"'),
    );
    // The misspelling INSTEAD of the title: both of its problems are named.
    await assert.rejects(
      records.create("story", untyped({ titel: "Visitor can sign up" })),
      schemaError("story", ["title", "titel"]),
    );
    // Every unknown field is named, not only the first.
    await assert.rejects(
      records.create("story", untyped({ ...MINIMAL.story, titel: "?", status: "open", Title: "?" })),
      schemaError("story", ["titel", "status", "Title"]),
    );
    // Another type's field is unknown here, and every type refuses a field it does not declare.
    await assert.rejects(records.create("story", untyped({ ...MINIMAL.story, story: "story-0" })), schemaError("story", ["story"]));
    for (const type of TYPES) {
      await assert.rejects(
        records.create(type, untyped({ ...FULL[type], extra: "?" })),
        schemaError(type, ["extra"], `${type}: unknown field "extra"`),
      );
    }
    // Names that every object inherits are unknown fields like any other.
    for (const field of ["__proto__", "constructor", "toString", "hasOwnProperty"]) {
      const fields: Record<string, unknown> = { ...MINIMAL.story };
      Object.defineProperty(fields, field, { value: "?", enumerable: true, configurable: true, writable: true });
      await assert.rejects(records.create("story", untyped(fields)), schemaError("story", [field]));
    }
    assert.deepEqual(await transactions.history(), [], "none of them wrote anything");

    // An edit that brings in an unknown field is refused and named the same way, and writes nothing.
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
    // Near misses of the declared types, names every object inherits, and no name at all.
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
      // Listing one is refused too, rather than answered with an empty list.
      await assert.rejects(records.list(untyped(type)), unknownType(type));
    }
    assert.equal(await transactions.get("record-1"), null, "no record was saved");
    assert.deepEqual(await transactions.history(), [], "no history entry was written");

    // A record stored under a type this code does not know (as a later storytree might store one)
    // is refused when read, not handed out as if it were typed; an edit of it writes nothing.
    const widget = await transactions.save({ id: "widget-1", type: "widget", fields: { title: "From elsewhere" } });
    await assert.rejects(records.get("widget-1"), unknownType("widget", "widget-1"));
    const before = await transactions.history();
    await assert.rejects(records.edit("widget-1", { title: "Changed" }), unknownType("widget", "widget-1"));
    assert.deepEqual(await transactions.get("widget-1"), widget, "the record is unchanged");
    assert.deepEqual(await transactions.history(), before, "no history entry was written");

    // Control: every declared type is known. Its list is empty, not refused.
    for (const type of TYPES) assert.deepEqual(await records.list(type), [], `list("${type}")`);
  });

  contract("3.4", "every stored record carries its schema version (1 today)", async ({ records, transactions }) => {
    // Every declared type has a version, a whole number from 1. (It pinned every type at 1 until
    // ADR-0640 added types and raised two of them; a record is now checked against its type's.)
    for (const type of TYPES) assert.ok(Number.isSafeInteger(SCHEMA_VERSIONS[type]) && SCHEMA_VERSIONS[type] >= 1, type);

    // A record of every type, with only its required fields, with every field, and as empty as the
    // brief allows, none given an id.
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
        // Stored with its version (seen one layer down), and read back through the typed layer as stored.
        assert.deepEqual(await transactions.get(record.id), record);
        assert.deepEqual(await records.get(record.id), record);
        created.push(record);
      }
    }
    assert.equal(new Set(created.map((record) => record.id)).size, created.length, "every generated id is different");
    // Every history entry holds the record as stored, version and all, and who wrote it.
    assert.deepEqual(
      (await transactions.history()).map(({ action, record, actor }) => ({ action, record, actor })),
      created.map((record) => ({ action: "created", record, actor: "agent-a" })),
    );
    // list hands out the stored records unchanged, each at version 1.
    for (const type of TYPES) {
      const listed = await records.list(type);
      assert.deepEqual(listed, await transactions.list(type), `list("${type}") is the stored ${type} records`);
      assert.deepEqual(listed.map((record) => record.version), [1, 1, 1].fill(SCHEMA_VERSIONS[type]));
    }

    // A given id is used as given, an edit keeps the stamp, and retire and history pass straight through.
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
    // Written straight through the transactions layer, as a newer storytree would write them: a
    // story on version 2 with a field version 1 never had, and a memory on version 7 whose fields
    // happen to fit version 1 exactly. Neither one is guessed at.
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
    // A list holding one is refused whole: never handed out with that record missing or misread.
    await assert.rejects(records.list("story"), newerVersion("story-future", "story", 2));
    await assert.rejects(records.list("definition"), newerVersion("definition-future", "definition", 7));

    // Editing one would check it by rules older than the ones it was written on, so an edit is
    // refused the same way, and writes nothing.
    const before = await transactions.history();
    await assert.rejects(records.edit("definition-future", { meaning: "Rewritten" }), newerVersion("definition-future", "definition", 7));
    await assert.rejects(records.edit("story-future", { title: "Rewritten" }), newerVersion("story-future", "story", 2));
    assert.deepEqual(await transactions.get("definition-future"), lookalike, "the record is unchanged");
    assert.deepEqual(await transactions.get("story-future"), future, "the record is unchanged");
    assert.deepEqual(await transactions.history(), before, "no history entry was written");

    // Control: a version-1 record beside them still reads, and so does a list without one.
    assert.deepEqual(await records.get("story-today"), today);
    assert.deepEqual(await records.list("arc"), []);
    // retire passes straight through, so a newer record can be retired, and the list reads again.
    await records.retire("story-future", "written by a newer storytree");
    assert.deepEqual(await records.list("story"), [today]);
  });

  contract("3.6", "an edit that would leave the record invalid is refused, and nothing is written", async ({ records, transactions }) => {
    const story = await records.create("story", FULL.story, { id: "story-1" });
    const capability = await records.create("capability", FULL.capability, { id: "capability-1" });
    const health = await records.create("health", FULL.health, { id: "health-1" });
    const before = await transactions.history();

    const refused: [id: string, type: RecordType, edit: Record<string, unknown>, fields: string[], message?: string][] = [
      ["story-1", "story", { title: "" }, ["title"]], // blanking a required field
      ["story-1", "story", { title: undefined }, ["title"], 'story: missing required field "title"'], // removing it
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

    // It is the merged record that is checked: an edit naming no title passes, because the stored
    // title stays, and an optional field may be removed.
    const edited = await records.edit("story-1", { description: "By email or phone" });
    assert.deepEqual(edited?.fields, { title: "Visitor can sign up", description: "By email or phone" });
    const trimmed = await records.edit("story-1", { description: undefined });
    assert.deepEqual(trimmed?.fields, { title: "Visitor can sign up" });
    assert.deepEqual(await transactions.get("story-1"), trimmed);
    // An edit of a record that is not there returns null and writes nothing, as in capability 2.
    const history = await transactions.history();
    assert.equal(await records.edit("story-missing", { title: "Visitor can sign up" }), null);
    assert.equal(await transactions.get("story-missing"), null);
    assert.deepEqual(await transactions.history(), history);
  });

  contract("robustness", "a NUL character or a lone UTF-16 surrogate in any field is refused and named, so both backends agree", async ({ records, transactions }) => {
    // Postgres cannot store these anywhere in a text value, and the in-memory twin could, so the
    // two backends would disagree. This layer refuses them before either backend sees them.
    const unstorable: [text: string, what: RegExp][] = [
      ["Visitor\u0000can sign up", /NUL/],
      ["Visitor can sign up \uD83C", /surrogate/], // a high surrogate with no low one after it
      ["\uDF32 Visitor can sign up", /surrogate/], // a low surrogate with no high one before it
      ["Visitor \uDF32\uD83C can sign up", /surrogate/], // a pair the wrong way round
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

    // Control: text that can be stored comes back exactly, on both backends: an astral character
    // (a surrogate PAIR), the characters either side of the surrogate range, U+0001 beside NUL,
    // the last code point, and whitespace.
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

    // Tomorrow's code, where a story's title is renamed and its summary is required.
    const later = new SchemaRecords(transactions, STORY_V2);
    assert.deepEqual(await later.get("story-1"), { ...signUp, version: 2, fields: { name: "Visitor can sign up", summary: "" } });
    assert.deepEqual(await later.list("story"), [
      { ...signUp, version: 2, fields: { name: "Visitor can sign up", summary: "" } },
      { ...pay, version: 2, fields: { name: "Visitor can pay", summary: "By card" } },
    ]);

    // Two versions on, the steps run in order, whatever order they are listed in.
    const muchLater = new SchemaRecords(transactions, STORY_V3);
    assert.deepEqual((await muchLater.get("story-2"))?.fields, { name: "Visitor can pay", about: "By card" });

    // Reading changes nothing stored.
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

    // The upgrade is part of the write: an edit whose upgraded result does not fit is refused whole.
    const other = await records.create("story", { title: "Visitor can pay" }, { id: "story-2" });
    const before = await transactions.history();
    await assert.rejects(later.edit("story-2", untyped({ summary: undefined })), schemaError("story", ["summary"]));
    assert.deepEqual(await transactions.get("story-2"), other, "still on version 1, unchanged");
    assert.deepEqual(await transactions.history(), before, "no history entry was written");
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
}

/** Tomorrow's schema: a story's `title` is renamed `name`, and its optional `description` becomes a required `summary`. */
const STORY_V2: LibrarySchema = {
  versions: { ...SCHEMA_VERSIONS, story: 2 },
  schemas: { ...RECORD_SCHEMAS, story: z.object({ name: z.string().min(1), summary: z.string() }).strict() },
  upgrades: [
    {
      type: "story",
      from: 1,
      name: "title-becomes-name",
      up: ({ title, description, ...rest }) => ({ ...rest, name: title, summary: description ?? "" }),
    },
  ],
};

/** The day after: `summary` is renamed `about`. Its steps are listed newest first. */
const STORY_V3: LibrarySchema = {
  versions: { ...SCHEMA_VERSIONS, story: 3 },
  schemas: { ...RECORD_SCHEMAS, story: z.object({ name: z.string().min(1), about: z.string() }).strict() },
  upgrades: [
    { type: "story", from: 2, name: "summary-becomes-about", up: ({ summary, ...rest }) => ({ ...rest, about: summary }) },
    ...STORY_V2.upgrades,
  ],
};

/** A value the compiler would refuse, sent the way a JavaScript caller or an agent could send it. */
function untyped(value: unknown): never {
  return value as never;
}

/**
 * An assert.rejects check: a SchemaError for `type` whose fields at fault are exactly `fields`
 * (in any order), with a message that starts with the type and names each of them. `message`,
 * when given, is the whole message expected.
 */
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

/** An assert.rejects check: an UnknownTypeError naming `type` and, when it was read from one, the record `id`. */
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

/**
 * An assert.rejects check: a NewerSchemaError for record `id` of `type` on `version`, where this
 * code knows version 1, whose message says the version is newer and names the record, the type
 * and both versions.
 */
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
    return true;
  };
}

/** An assert.rejects check: a MissingUpgradeError for record `id` of `type`, naming the version no step leads on from. */
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
