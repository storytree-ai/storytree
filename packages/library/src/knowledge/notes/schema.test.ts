// Capability 6 · Notes
import assert from "node:assert/strict";
import { test } from "node:test";

import { connect } from "../../project/index.js";
import { MemoryTransactions, OWNER_TIME_ZONE, parseSchedule, SchemaError, SchemaRecords, type Transactions } from "../../records/index.js";
import { LIBRARY_SCHEMA, SCHEMA_VERSIONS } from "../../schema/index.js";
import { dropTestDatabases, testServerUrl, uniqueProjectName } from "../../testing/pg.js";

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
    return { records: new SchemaRecords(transactions, LIBRARY_SCHEMA), transactions, cleanup: async () => {} };
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

  contract("6.32", "a friction report written before reports carried a state reads one worked out from its route and stamp, and its next write stores it so", async ({ records, transactions }) => {
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

  contract("6.33", "a process's schedule, time zone and precheck are validated: good words (a daily schedule's grace among them) are kept, bad words, a grace on any but a daily schedule, an unknown time zone, a precheck not on the fixed list, or a time zone or precheck with no schedule are refused and named", async ({ records, transactions }) => {
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

  contract("6.34", "a process's schedule reads back as written and as its rule, a daily schedule's grace in minutes, its times in its own time zone or the owner's, and its precheck as written; one with no schedule reads as before", async ({ records }) => {
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

  contract("6.35", "a write to a principle, guardrail, pattern, process, agent role or decision carries the mark of the outside text its writer had read; a write of any other kind carries none", async ({ records, transactions }) => {
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
