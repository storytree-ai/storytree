/**
 * Capability 2 · Library transactions: ONE behaviour suite, one test per contract 2.1-2.9, 2.12 and 2.14-2.19 in
 * the library story. Each backend registers it (memory.test.ts, pg.test.ts) and it must pass
 * unchanged on every one. Parity is the point: later stories test against the in-memory twin, so
 * the twin has to behave exactly as Postgres does.
 *
 * Every test gets a fresh, empty store from `makeStore` and disposes of it afterwards, pass or
 * fail, so the whole history a test reads is its own. Nothing here knows which backend it tests.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { setTimeout as sleep } from "node:timers/promises";

import { LaterWriterError, StaleRevertError } from "./records.js";
import type { HistoryEntry, RecordEnvelope, Transactions } from "./types.js";

/** A fresh, empty store, and how to dispose of it. */
export interface StoreUnderTest {
  readonly store: Transactions;
  cleanup(): Promise<void>;
}

/**
 * How many writers the race checks run at once. More than two, so that the writes genuinely
 * overlap even on a backend that has to open a connection for each of them.
 */
const RACERS = 8;

export function transactionsBehaviourSuite(label: string, makeStore: () => Promise<StoreUnderTest>): void {
  /** Register contract `number`'s test for this backend, run against a fresh store. */
  function contract(number: string, title: string, body: (store: Transactions) => Promise<void>): void {
    test(`${number} [${label}] ${title}`, async () => {
      const { store, cleanup } = await makeStore();
      try {
        await body(store);
      } finally {
        await cleanup();
      }
    });
  }

  contract("2.1", "save creates a record; saving the same id again replaces it; each save appends one history entry", async (store) => {
    const fields = { title: "First light", tags: ["draft"], meta: { stars: 3, done: false, due: null } };
    const created = await store.save({ id: "note-1", type: "note", fields, actor: "agent-a" });

    assertTimestamp(created.createdAt, "createdAt");
    assert.deepEqual(
      created,
      {
        id: "note-1",
        type: "note",
        version: 1,
        fields: { title: "First light", tags: ["draft"], meta: { stars: 3, done: false, due: null } },
        createdAt: created.createdAt,
        updatedAt: created.createdAt,
      },
      "a new record: the fields as given, version 1 by default, and updatedAt equal to createdAt",
    );
    assert.deepEqual(await store.get("note-1"), created, "get returns the record save returned");

    // What is stored is the store's own copy: changing the caller's objects afterwards, or the
    // records save and get handed out, changes nothing stored. (Compared with a snapshot, which
    // no store can reach.)
    const asSaved = structuredClone(created);
    fields.title = "changed by the caller";
    fields.tags.push("changed by the caller");
    for (const handedOut of [created, await store.get("note-1")]) {
      assert.ok(handedOut);
      handedOut.fields.title = "changed by a reader";
    }
    assert.deepEqual(await store.get("note-1"), asSaved, "the stored record is untouched");

    const replaced = await store.save({ id: "note-1", type: "note", fields: { title: "Second light" }, version: 2 });
    assertTimestamp(replaced.updatedAt, "updatedAt");
    assert.deepEqual(
      replaced,
      {
        id: "note-1",
        type: "note",
        version: 2,
        fields: { title: "Second light" },
        createdAt: asSaved.createdAt,
        updatedAt: replaced.updatedAt,
      },
      "replaced whole (tags and meta are gone, not merged in), and still the record created first",
    );
    assert.ok(Date.parse(replaced.updatedAt) >= Date.parse(asSaved.updatedAt), "updatedAt never goes back");
    assert.deepEqual(await store.get("note-1"), replaced);

    const other = await store.save({ id: "note-2", type: "note", fields: {} });

    assert.deepEqual(
      changesOf(await store.history()),
      [
        { recordId: "note-1", type: "note", action: "created", record: asSaved, actor: "agent-a" },
        { recordId: "note-1", type: "note", action: "updated", record: replaced },
        { recordId: "note-2", type: "note", action: "created", record: other },
      ],
      "one entry per save, each holding the record as that save left it",
    );

    // Saves of one new id racing each other: exactly one of them creates it, and every other one
    // replaces it. Each save still appends exactly one entry.
    await warmUp(store);
    const racers = await Promise.all(
      Array.from({ length: RACERS }, (_, n) => store.save({ id: "raced", type: "note", fields: { n } })),
    );
    const raced = await store.history({ id: "raced" });
    assert.deepEqual(
      raced.map((entry) => entry.action),
      ["created", ...Array<string>(RACERS - 1).fill("updated")],
      "one creation, then replacements",
    );
    assert.deepEqual(
      byN(raced.map((entry) => entry.record)),
      byN(racers),
      "each save's result is exactly the record its history entry holds",
    );
    assert.equal(new Set(racers.map((record) => record.createdAt)).size, 1, "all of them are the one record, created once");
    assert.deepEqual(await store.get("raced"), raced.at(-1)?.record, "the stored record is the last save's");
  });

  contract("2.2", "edit changes only the fields it names; every other field keeps its stored value", async (store) => {
    const saved = await store.save({
      id: "task-1",
      type: "task",
      version: 3,
      fields: { title: "Plant the seed", status: "open", tags: ["a"], meta: { x: 1, y: 2 }, note: "keep me" },
    });

    const edited = await store.edit({ id: "task-1", fields: { status: "done" }, actor: "agent-b" });
    assert.ok(edited);
    assertTimestamp(edited.updatedAt, "updatedAt");
    assert.deepEqual(
      edited,
      {
        ...saved,
        fields: { title: "Plant the seed", status: "done", tags: ["a"], meta: { x: 1, y: 2 }, note: "keep me" },
        updatedAt: edited.updatedAt,
      },
      "only status changed; every other field, the type, the version and createdAt keep their stored values",
    );
    assert.ok(Date.parse(edited.updatedAt) >= Date.parse(saved.updatedAt), "updatedAt never goes back");
    assert.deepEqual(await store.get("task-1"), edited);

    // A named field that was not there is added. null is a value like any other. undefined
    // removes the field. The merge is shallow: a named object field is replaced whole.
    const added = await store.edit({ id: "task-1", fields: { priority: 2 } });
    assert.deepEqual(added?.fields, {
      title: "Plant the seed",
      status: "done",
      tags: ["a"],
      meta: { x: 1, y: 2 },
      note: "keep me",
      priority: 2,
    });
    const nulled = await store.edit({ id: "task-1", fields: { note: null } });
    assert.deepEqual(nulled?.fields, {
      title: "Plant the seed",
      status: "done",
      tags: ["a"],
      meta: { x: 1, y: 2 },
      note: null,
      priority: 2,
    });
    const meta = { z: 3 };
    const removed = await store.edit({ id: "task-1", fields: { note: undefined, meta } });
    assert.ok(removed);
    assert.deepEqual(removed.fields, {
      title: "Plant the seed",
      status: "done",
      tags: ["a"],
      meta: { z: 3 },
      priority: 2,
    });
    assert.deepEqual(await store.get("task-1"), removed);

    assert.deepEqual(
      changesOf(await store.history()),
      [
        { recordId: "task-1", type: "task", action: "created", record: saved },
        { recordId: "task-1", type: "task", action: "updated", record: edited, actor: "agent-b" },
        { recordId: "task-1", type: "task", action: "updated", record: added },
        { recordId: "task-1", type: "task", action: "updated", record: nulled },
        { recordId: "task-1", type: "task", action: "updated", record: removed },
      ],
      "each edit appends one entry holding the record as that edit left it",
    );

    // What is stored is the store's own copy: changing an object the caller passed in the edit,
    // or the record the edit handed back, changes nothing stored.
    const asStored = structuredClone(removed);
    meta.z = 4;
    removed.fields.title = "changed by a reader";
    assert.deepEqual(await store.get("task-1"), asStored, "the stored record is untouched");
  });

  contract("2.3", "edit merges onto what is stored now, so racing edits of different fields all survive", async (store) => {
    await store.save({ id: "plan", type: "note", fields: { a: 0, b: 0, keep: "yes" } });

    // A caller reads the record, then another writer changes b. The caller's edit of a merges onto
    // the b stored now, not onto the b in the copy it read earlier.
    const readEarlier = await store.get("plan");
    await store.edit({ id: "plan", fields: { b: 1 } });
    const merged = await store.edit({ id: "plan", fields: { a: 1 } });
    assert.deepEqual(readEarlier?.fields, { a: 0, b: 0, keep: "yes" });
    assert.deepEqual(merged?.fields, { a: 1, b: 1, keep: "yes" });

    // Edits of different fields racing each other: every one of them survives.
    await warmUp(store);
    const names = Array.from({ length: RACERS }, (_, n) => `f${n}`);
    await Promise.all(names.map((name, n) => store.edit({ id: "plan", fields: { [name]: n } })));
    const final = await store.get("plan");
    assert.deepEqual(final?.fields, {
      a: 1,
      b: 1,
      keep: "yes",
      ...Object.fromEntries(names.map((name, n) => [name, n])),
    });

    // The history shows them applied one after another, each onto the result of the one before.
    const racing = (await store.history({ id: "plan" })).slice(3);
    assert.equal(racing.length, RACERS, "one entry per raced edit");
    let previous: string[] = [];
    for (const entry of racing) {
      const present = names.filter((name) => name in entry.record.fields);
      assert.equal(present.length, previous.length + 1, "each raced edit adds exactly its own field...");
      assert.ok(
        previous.every((name) => present.includes(name)),
        "...onto everything the edit before it left",
      );
      previous = present;
    }
    assert.deepEqual(racing.at(-1)?.record, final);
  });

  contract("2.4", "edit of a missing record returns null and creates nothing", async (store) => {
    const refuseEverything = (): void => {
      throw new Error("validate should not run: there is no record to validate");
    };
    assert.equal(await store.edit({ id: "ghost", fields: { title: "Boo" }, validate: refuseEverything }), null);
    assert.equal(await store.get("ghost"), null, "no record was created");
    assert.deepEqual(await store.history(), [], "no history entry was written");

    // A retired record is missing too: editing it brings nothing back.
    await store.save({ id: "gone", type: "note", fields: { title: "Old" } });
    await store.retire({ id: "gone", reason: "obsolete" });
    const history = await store.history();
    assert.equal(await store.edit({ id: "gone", fields: { title: "Back?" } }), null);
    assert.equal(await store.get("gone"), null);
    assert.deepEqual(await store.list("note"), []);
    assert.deepEqual(await store.history(), history, "no history entry was written");
  });

  contract("2.5", "get of a missing record returns null and never throws", async (store) => {
    assert.equal(await store.get("anything"), null, "an empty store");

    await store.save({ id: "Present", type: "note", fields: {} });
    // Near misses of the stored id (case, spaces, pattern characters) and ids of every awkward shape.
    const missing = [
      "",
      " ",
      "present",
      "PRESENT",
      "Present ",
      " Present",
      "Pres%",
      "Pres_nt",
      "%",
      "*",
      '"Present"',
      "'; DROP TABLE record; --",
      "\\",
      "null",
      "ünïcödé",
      "🌲",
      "a".repeat(2000),
    ];
    for (const id of missing) {
      const shown = id.length > 40 ? `${id.slice(0, 40)}... (${id.length} characters)` : id;
      assert.equal(await store.get(id), null, `get(${JSON.stringify(shown)})`);
    }
    assert.equal((await store.get("Present"))?.id, "Present", "control: the stored record is found by its exact id");
  });

  contract("2.6", "list(type) returns only that type's current records, ordered by id, and [] when there are none", async (store) => {
    assert.deepEqual(await store.list("note"), [], "an empty store");

    // Saved out of order, under ids whose code-point order is not dictionary order.
    for (const id of ["note-b", "🌲-tree", "Note-a", "étude", "_draft", "note-a", "Ｆull"]) {
      await store.save({ id, type: "note", fields: { label: id } });
    }
    await store.edit({ id: "note-a", fields: { edited: true } }); // listed as it is now
    await store.save({ id: "task-1", type: "task", fields: {} }); // another type
    await store.save({ id: "note-c", type: "note", fields: {} });
    await store.retire({ id: "note-c", reason: "dropped" }); // retired
    await store.save({ id: "was-a-note", type: "note", fields: {} });
    await store.save({ id: "was-a-note", type: "task", fields: {} }); // replaced as another type

    const notes = await store.list("note");
    assert.deepEqual(
      notes.map((record) => record.id),
      ["Note-a", "_draft", "note-a", "note-b", "étude", "Ｆull", "🌲-tree"],
      "exactly the current notes, in code-point order of id (the order of Postgres's C collation): " +
        "not case-folded, not dictionary order, not UTF-16 code-unit order",
    );
    for (const record of notes) {
      assert.deepEqual(record, await store.get(record.id), `${record.id} is listed as it is stored now`);
    }
    assert.equal(notes.find((record) => record.id === "note-a")?.fields.edited, true);
    assert.deepEqual((await store.list("task")).map((record) => record.id), ["task-1", "was-a-note"]);
    assert.deepEqual(await store.list("Note"), [], "a type matches exactly");
    assert.deepEqual(await store.list("nothing"), [], "a type with no records");

    // The records handed out are copies: changing one changes nothing stored.
    const asStored = structuredClone(notes);
    for (const record of notes) record.fields.label = "changed by a reader";
    assert.deepEqual(await store.list("note"), asStored, "the stored records are untouched");
  });

  contract("2.7", "retire removes the record from get and list, keeps the reason in history, and is a harmless no-op when repeated or missing", async (store) => {
    const keep = await store.save({ id: "keep", type: "note", fields: { title: "Keep" } });
    const created = await store.save({ id: "drop", type: "note", fields: { title: "Drop", body: "v1" } });
    const last = await store.edit({ id: "drop", fields: { body: "v2" } });

    assert.equal(await store.retire({ id: "drop", reason: "a duplicate of keep", actor: "agent-c" }), undefined);
    assert.equal(await store.get("drop"), null, "gone from get");
    assert.deepEqual(await store.list("note"), [keep], "gone from list; the other record is untouched");
    assert.deepEqual(
      changesOf(await store.history({ id: "drop" })),
      [
        { recordId: "drop", type: "note", action: "created", record: created },
        { recordId: "drop", type: "note", action: "updated", record: last },
        { recordId: "drop", type: "note", action: "retired", record: last, reason: "a duplicate of keep", actor: "agent-c" },
      ],
      "the history keeps the record, the reason, who retired it, and the record's last state",
    );

    // Retiring it again, or retiring an id that never existed, is a harmless no-op.
    const history = await store.history();
    assert.equal(await store.retire({ id: "drop", reason: "again" }), undefined);
    assert.equal(await store.retire({ id: "never-existed", reason: "nothing to retire" }), undefined);
    assert.deepEqual(await store.history(), history, "no history entry was written");
    assert.equal(await store.get("drop"), null);
    assert.equal(await store.get("never-existed"), null);
    assert.deepEqual(await store.list("note"), [keep]);
  });

  contract("2.8", "history returns every change in order with strictly increasing seq; it filters by id and by since", async (store) => {
    const a1 = await store.save({ id: "a", type: "note", fields: { v: 1 }, actor: "ann" });
    const b1 = await store.save({ id: "b", type: "task", fields: { v: 1 } });
    const a2 = await store.edit({ id: "a", fields: { v: 2 } });
    const a3 = await store.save({ id: "a", type: "note", fields: { v: 3 } });
    await store.edit({ id: "missing", fields: { v: 1 } }); // no change, so no entry
    await store.retire({ id: "b", reason: "finished", actor: "bob" });
    await store.retire({ id: "missing", reason: "nothing there" }); // no change, so no entry
    const c1 = await store.save({ id: "c", type: "note", fields: { v: 1 } });

    const all = await store.history();
    assert.deepEqual(
      changesOf(all),
      [
        { recordId: "a", type: "note", action: "created", record: a1, actor: "ann" },
        { recordId: "b", type: "task", action: "created", record: b1 },
        { recordId: "a", type: "note", action: "updated", record: a2 },
        { recordId: "a", type: "note", action: "updated", record: a3 },
        { recordId: "b", type: "task", action: "retired", record: b1, reason: "finished", actor: "bob" },
        { recordId: "c", type: "note", action: "created", record: c1 },
      ],
      "every change, in the order it happened",
    );
    assert.deepEqual(await store.history({}), all);
    assert.deepEqual(await store.history({ since: 0 }), all, "since 0 is everything");

    // Filtered to one record, a retired one included.
    assert.deepEqual(await store.history({ id: "a" }), [all[0], all[2], all[3]]);
    assert.deepEqual(await store.history({ id: "b" }), [all[1], all[4]]);
    assert.deepEqual(await store.history({ id: "missing" }), []);

    // Only the entries after a sequence number, alone and combined with an id.
    const third = all[2]?.seq ?? assert.fail("no third entry");
    const last = all.at(-1)?.seq ?? assert.fail("no last entry");
    assert.deepEqual(await store.history({ since: third }), all.slice(3));
    assert.deepEqual(await store.history({ id: "a", since: third }), [all[3]]);
    assert.deepEqual(await store.history({ since: last }), []);

    // The entries handed out are copies: changing one changes nothing stored. (Compared with a
    // snapshot: `all` itself would change along with a store that handed out its own entries.)
    const asStored = structuredClone(all);
    for (const entry of all) entry.record.fields.v = 99;
    assert.deepEqual(await store.history(), asStored, "the stored history is untouched");

    // A reader following the history with `since` while changes are being written never misses
    // one: an entry only becomes visible once every entry before it is visible too.
    await warmUp(store);
    let writing = true;
    const writes = Promise.all(
      Array.from({ length: RACERS }, (_, n) => store.save({ id: `raced-${n}`, type: "note", fields: { n } })),
    ).finally(() => {
      writing = false;
    });
    writes.catch(() => undefined); // a failed write is reported by the `await writes` below
    const followed: HistoryEntry[] = [];
    let cursor = last;
    const follow = async (): Promise<void> => {
      const more = await store.history({ since: cursor });
      followed.push(...more);
      cursor = more.at(-1)?.seq ?? cursor;
    };
    do {
      await follow();
    } while (writing);
    await writes;
    await follow();
    assert.deepEqual(
      followed,
      (await store.history()).slice(all.length),
      "the reader saw every new entry, in order, and nothing twice",
    );
    assert.equal(followed.length, RACERS);
  });

  contract("2.12", "history narrows on the server: from a time, to some types, to the oldest or newest few, and all of them combined", async (store) => {
    await store.save({ id: "a", type: "note", fields: { v: 1 } });
    await store.save({ id: "h", type: "health", fields: { v: 1 } });
    await sleep(5); // so that some changes are made before `from` and some at or after it
    await store.save({ id: "h", type: "health", fields: { v: 2 } });
    await store.save({ id: "b", type: "task", fields: { v: 1 } });
    await store.edit({ id: "a", fields: { v: 2 } });
    await store.retire({ id: "b", reason: "finished" });
    const all = await store.history();
    const from = all[2]?.at ?? assert.fail("no third entry");
    const fromOn = all.filter((entry) => entry.at >= from);
    assert.ok(fromOn.length < all.length, "some changes were made before `from`");

    // From a time: the changes made at or after it, to the millisecond, however the time is written.
    assert.deepEqual(await store.history({ from }), fromOn);
    const elevenHoursAhead = new Date(Date.parse(from) + 11 * 3_600_000).toISOString().replace("Z", "+11:00");
    assert.deepEqual(await store.history({ from: elevenHoursAhead }), fromOn, "the same instant in another zone");
    assert.deepEqual(await store.history({ from: new Date(Date.parse(all.at(-1)!.at) + 1).toISOString() }), []);

    // To some types: their changes only, a retirement included; none for no types.
    assert.deepEqual(await store.history({ types: ["note", "task"] }), all.filter((entry) => entry.type === "note" || entry.type === "task"));
    assert.deepEqual(await store.history({ types: [] }), []);

    // The oldest or the newest few, in order either way.
    assert.deepEqual(await store.history({ oldest: 2 }), all.slice(0, 2));
    assert.deepEqual(await store.history({ newest: 2 }), all.slice(-2));
    assert.deepEqual(await store.history({ newest: 100 }), all);

    // Combined with each other and with id and since: each narrows what the others leave.
    assert.deepEqual(await store.history({ from, types: ["note"], oldest: 1 }), fromOn.filter((entry) => entry.type === "note").slice(0, 1));
    assert.deepEqual(await store.history({ id: "h", newest: 1 }), all.filter((entry) => entry.recordId === "h").slice(-1));
    assert.deepEqual(await store.history({ since: all[0]!.seq, types: ["health"] }), all.filter((entry) => entry.type === "health"));

    // A filter that is not one is refused before anything is read.
    for (const filter of [{ oldest: 0 }, { newest: -1 }, { oldest: 1.5 }, { oldest: 1, newest: 1 }, { from: "yesterday" }]) {
      await assert.rejects(store.history(filter), RangeError, JSON.stringify(filter));
    }
  });

  contract("2.13", "list narrows by ids and stored fields, limits in id order and projects only a known version", async (store) => {
    const a = await store.save({ id: "a", type: "note", fields: { status: "closed", arc: "one", outcome: { disposition: "landed", note: "long" }, body: "heavy", flag: false, count: 2, nullable: null } });
    const b = await store.save({ id: "b", type: "note", fields: { status: "active", arc: "one", body: "heavy" } });
    const c = await store.save({ id: "c", type: "note", version: 2, fields: { status: "closed", arc: "two", body: "upgrade needs this" } });
    await store.save({ id: "d", type: "other", fields: a.fields });
    await store.save({ id: "gone", type: "note", fields: a.fields });
    await store.retire({ id: "gone", reason: "retired" });
    assert.deepEqual(await store.list("note", { where: { arc: "one" } }), [a, b]);
    assert.deepEqual(await store.list("note", { where: { "outcome.disposition": "landed" } }), [a]);
    assert.deepEqual(await store.list("note", { where: { flag: false, count: 2, nullable: null } }), [a]);
    assert.deepEqual(await store.list("note", { where: { status: "CLOSED" } }), []);
    assert.deepEqual(await store.list("note", { not: { status: "closed" } }), [b]);
    assert.deepEqual(await store.list("note", { not: { missing: "anything" } }), [a, b, c]);
    assert.deepEqual(await store.list("note", { ids: ["c", "b", "b", "d", "gone"], where: { status: "closed" } }), [c]);
    assert.deepEqual(await store.list("note", { ids: [] }), []);
    assert.deepEqual(await store.list("note", { where: { status: "closed" }, limit: 1 }), [a]);
    const projected = await store.list("note", { projection: { version: 1, fields: ["arc", "missing"] } });
    assert.deepEqual(projected, [{ ...a, fields: { arc: "one" } }, { ...b, fields: { arc: "one" } }, c], "other versions stay whole for upgrade/refusal");
    assert.deepEqual(await store.list("note", { ids: ["a"], projection: { version: 1, fields: [] } }), [{ ...a, fields: {} }]);
    projected[0]!.fields["arc"] = "changed";
    assert.deepEqual(await store.get("a"), a);
    for (const limit of [0, -1, 1.5, Infinity]) await assert.rejects(store.list("note", { limit }), RangeError);
    for (const value of [undefined, {}, [], NaN]) await assert.rejects(store.list("note", { where: { status: value } } as never), RangeError);
    const odd = await store.save({ id: "odd", type: "note", fields: { "quote'--": "yes", "__proto__": null } });
    assert.deepEqual(await store.list("note", { where: { "quote'--": "yes" }, projection: { version: 1, fields: ["quote'--"] } }), [{ ...odd, fields: { "quote'--": "yes" } }]);
  });

  contract("2.9", "a validate check sees the merged result, and if it throws nothing is written", async (store) => {
    // What validate saw is copied at the moment it ran, so a later change to that object cannot hide it.
    const seen: RecordEnvelope[] = [];
    const witness = (candidate: RecordEnvelope): void => {
      seen.push(structuredClone(candidate));
    };

    const created = await store.save({
      id: "v-1",
      type: "note",
      version: 2,
      fields: { title: "Draft", body: "text" },
      validate: witness,
    });
    assert.deepEqual(seen, [created], "save's validate saw the record exactly as it was then stored");

    const edited = await store.edit({ id: "v-1", fields: { title: "Final", body: undefined, tags: ["x"] }, validate: witness });
    assert.ok(edited);
    assert.deepEqual(seen, [created, edited], "edit's validate saw the record exactly as it was then stored");
    assert.deepEqual(edited.fields, { title: "Final", tags: ["x"] }, "that is the merged result, not the edit alone");

    // A rule that needs the merged record to judge: a note keeps a non-empty title.
    const refusal = new Error("a note needs a title");
    const needsTitle = (candidate: RecordEnvelope): void => {
      if (typeof candidate.fields.title !== "string" || candidate.fields.title === "") throw refusal;
    };
    // This edit names no title, but the merged record has one, so the rule passes it.
    const tagged = await store.edit({ id: "v-1", fields: { tags: ["x", "y"] }, validate: needsTitle });
    assert.deepEqual(tagged?.fields, { title: "Final", tags: ["x", "y"] });

    // Every write the rule refuses rejects with the rule's own error and writes nothing.
    const before = { record: await store.get("v-1"), history: await store.history() };
    const refusedWrites = [
      () => store.edit({ id: "v-1", fields: { title: undefined }, validate: needsTitle }),
      () => store.edit({ id: "v-1", fields: { title: "" }, validate: needsTitle }),
      () => store.save({ id: "v-1", type: "note", fields: { body: "no title" }, validate: needsTitle }),
      () => store.save({ id: "v-2", type: "note", fields: { body: "no title" }, validate: needsTitle }),
    ];
    for (const write of refusedWrites) {
      await assert.rejects(write(), (error: unknown) => {
        assert.equal(error, refusal, "rejected with the error validate threw");
        return true;
      });
    }
    assert.deepEqual(await store.get("v-1"), before.record, "no record change");
    assert.equal(await store.get("v-2"), null, "no record created");
    assert.deepEqual(await store.history(), before.history, "no history entry");

    // The refused writes left the store sound: the next write goes through and appends one entry.
    const after = await store.edit({ id: "v-1", fields: { body: "back" }, validate: needsTitle });
    assert.deepEqual(after?.fields, { title: "Final", tags: ["x", "y"], body: "back" });
    const history = await store.history();
    assert.deepEqual(history.slice(0, -1), before.history);
    assert.deepEqual(changesOf(history.slice(-1)), [{ recordId: "v-1", type: "note", action: "updated", record: after }]);
  });
  contract("2.14", "revert writes a record back to one of its own history entries whole, as a new update naming the entry and its writer", async (store) => {
    const created = await store.save({ id: "r-1", type: "note", fields: { title: "Good", body: "kept" }, actor: "ann" });
    const [first] = await store.history({ id: "r-1" });
    const bad = await store.edit({ id: "r-1", fields: { title: "Bad", body: undefined, junk: "added" }, actor: "bob" });
    assert.ok(bad);
    const read = (await store.history({ id: "r-1" })).at(-1)!.seq;

    const reverted = await store.revert({ id: "r-1", to: first!.seq, read, actor: "cat", reason: "bob's edit lost the body" });
    assertTimestamp(reverted.updatedAt, "updatedAt");
    assert.deepEqual(
      reverted,
      { ...created, updatedAt: reverted.updatedAt },
      "the whole state comes back: changed fields restored, a removed field put back, an added field gone",
    );
    assert.deepEqual(await store.get("r-1"), reverted);
    const history = await store.history({ id: "r-1" });
    assert.equal(history.length, 3, "nothing in history is rewritten; the revert is one more entry");
    assert.deepEqual(history.slice(0, 2).map((entry) => entry.record), [created, bad]);
    assert.deepEqual(
      changesOf(history.slice(-1)),
      [{ recordId: "r-1", type: "note", action: "updated", record: reverted, reason: `reverted to ${first!.seq}: bob's edit lost the body`, actor: "cat" }],
      "the entry names the entry it reverts to and who reverted",
    );
  });

  contract("2.15", "revert brings a retired record back under its own id, from an entry before its retirement", async (store) => {
    const created = await store.save({ id: "gone", type: "note", fields: { title: "Gone", links: ["other"] } });
    await store.edit({ id: "gone", fields: { title: "Renamed" } });
    await store.retire({ id: "gone", reason: "thought a duplicate", actor: "bob" });
    const history = await store.history({ id: "gone" });
    const retirement = history.at(-1)!;

    await assert.rejects(store.revert({ id: "gone", to: retirement.seq, read: retirement.seq }), RangeError, "a retirement is not a state to revert to");
    const back = await store.revert({ id: "gone", to: history[0]!.seq, read: retirement.seq, actor: "cat" });
    assert.deepEqual(back, { ...created, updatedAt: back.updatedAt }, "live again under its id, as first written, created when it was");
    assert.deepEqual(await store.get("gone"), back);
    assert.deepEqual((await store.list("note")).map((record) => record.id), ["gone"]);
    assert.deepEqual(
      changesOf((await store.history({ id: "gone" })).slice(-1)),
      [{ recordId: "gone", type: "note", action: "updated", record: back, reason: `reverted to ${history[0]!.seq}`, actor: "cat" }],
    );
  });

  contract("2.16", "revert is refused, writing nothing, when the record changed since the writer read it or the entry is not its own", async (store) => {
    await store.save({ id: "s-1", type: "note", fields: { v: 1 } });
    await store.save({ id: "s-2", type: "note", fields: { v: 1 } });
    const [first] = await store.history({ id: "s-1" });
    await store.edit({ id: "s-1", fields: { v: 2 } });
    const read = (await store.history({ id: "s-1" })).at(-1)!.seq;
    await store.edit({ id: "s-1", fields: { v: 3 }, actor: "another curator" });
    const before = { history: await store.history(), record: await store.get("s-1") };

    await assert.rejects(store.revert({ id: "s-1", to: first!.seq, read }), StaleRevertError, "the curator read before another's write");
    const other = (await store.history({ id: "s-2" }))[0]!;
    await assert.rejects(store.revert({ id: "s-1", to: other.seq, read: before.history.at(-1)!.seq }), RangeError, "another record's entry");
    await assert.rejects(store.revert({ id: "never", to: first!.seq, read: first!.seq }), RangeError, "no such record");
    await assert.rejects(
      store.revert({ id: "s-1", to: first!.seq, read: (await store.history({ id: "s-1" })).at(-1)!.seq, validate: () => { throw new Error("refused by the check"); } }),
      /refused by the check/,
    );
    assert.deepEqual(await store.history(), before.history, "no history entry was written");
    assert.deepEqual(await store.get("s-1"), before.record);
  });

  contract("2.17", "history narrows to one writer's changes, on the server", async (store) => {
    await store.save({ id: "a-1", type: "note", fields: { v: 1 }, actor: "session:one" });
    await store.save({ id: "a-2", type: "note", fields: { v: 1 } });
    await store.edit({ id: "a-2", fields: { v: 2 }, actor: "session:one" });
    await store.edit({ id: "a-1", fields: { v: 2 }, actor: "session:two" });

    const own = await store.history({ actor: "session:one" });
    assert.deepEqual(own.map((entry) => [entry.recordId, entry.record.fields.v]), [["a-1", 1], ["a-2", 2]]);
    assert.deepEqual((await store.history({ actor: "session:one", id: "a-1" })).length, 1, "combined with the other filters");
    assert.deepEqual(await store.history({ actor: "nobody" }), []);
  });

  contract("2.18", "revertWrites writes every record one writer wrote back to its state before that writer's first write, in one write", async (store) => {
    const kept = await store.save({ id: "w-kept", type: "note", fields: { title: "Kept", body: "good" }, actor: "ann" });
    const gone = await store.save({ id: "w-gone", type: "note", fields: { title: "Gone" }, actor: "ann" });
    await store.save({ id: "w-health", type: "health", fields: { state: "red" }, actor: "ann" });
    const [keptFirst] = await store.history({ id: "w-kept" });
    const [goneFirst] = await store.history({ id: "w-gone" });
    await store.edit({ id: "w-kept", fields: { title: "Bad", body: undefined }, actor: "bob" });
    await store.edit({ id: "w-kept", fields: { junk: "added" }, actor: "bob" });
    await store.retire({ id: "w-gone", reason: "thought a duplicate", actor: "bob" });
    await store.save({ id: "w-new", type: "note", fields: { title: "Bob's" }, actor: "bob" });
    await store.edit({ id: "w-health", fields: { state: "green" }, actor: "bob" });
    await store.edit({ id: "w-health", fields: { state: "amber" }, actor: "cat" });
    await store.save({ id: "w-own", type: "note", fields: { title: "Bob's, retired" }, actor: "bob" });
    await store.retire({ id: "w-own", reason: "done with it", actor: "bob" });

    const reverted = await store.revertWrites({ of: "bob", actor: "cat", reason: "bob was misled" });
    assert.deepEqual(
      reverted,
      [{ id: "w-gone", action: "updated", to: goneFirst!.seq }, { id: "w-kept", action: "updated", to: keptFirst!.seq }, { id: "w-new", action: "retired" }],
      "each record bob wrote, by id; one bob made and retired himself is already as it was, and health is left out",
    );
    const back = await store.get("w-kept");
    assert.deepEqual(back, { ...kept, updatedAt: back!.updatedAt }, "the whole state from before bob's first write");
    const live = await store.get("w-gone");
    assert.deepEqual(live, { ...gone, updatedAt: live!.updatedAt }, "a record bob retired is live again");
    assert.equal(await store.get("w-new"), null, "a record bob created is retired");
    assert.equal(await store.get("w-own"), null);
    assert.equal((await store.get("w-health"))?.fields.state, "amber", "health is not a writer's work to undo");
    const entries = changesOf((await store.history()).slice(-3));
    assert.deepEqual(
      entries.map(({ recordId, action, reason, actor }) => ({ recordId, action, reason, actor })),
      [
        { recordId: "w-gone", action: "updated", reason: `reverted bob's writes, to ${goneFirst!.seq}: bob was misled`, actor: "cat" },
        { recordId: "w-kept", action: "updated", reason: `reverted bob's writes, to ${keptFirst!.seq}: bob was misled`, actor: "cat" },
        { recordId: "w-new", action: "retired", reason: "reverted bob's writes, which created it: bob was misled", actor: "cat" },
      ],
    );
    assert.deepEqual(await store.revertWrites({ of: "nobody" }), [], "a writer who wrote nothing reverts nothing");
  });

  contract("2.19", "revertWrites is refused, writing nothing, naming each record another writer wrote to after that writer's first write", async (store) => {
    await store.save({ id: "x-1", type: "note", fields: { v: 1 } });
    await store.save({ id: "x-2", type: "note", fields: { v: 1 } });
    await store.save({ id: "x-3", type: "note", fields: { v: 1 } });
    await store.edit({ id: "x-1", fields: { v: 2 }, actor: "bob" });
    await store.edit({ id: "x-2", fields: { v: 2 }, actor: "bob" });
    await store.edit({ id: "x-3", fields: { v: 2 }, actor: "bob" });
    await store.edit({ id: "x-1", fields: { v: 3 }, actor: "cat" });
    await store.edit({ id: "x-3", fields: { v: 3 } });
    await store.edit({ id: "x-3", fields: { v: 4 }, actor: "bob" });
    const before = { history: await store.history(), records: await store.list("note") };
    const [catSeq, unsignedSeq] = before.history.slice(-3, -1).map((entry) => entry.seq);

    await assert.rejects(store.revertWrites({ of: "bob", actor: "ann" }), (error: unknown) => {
      assert.ok(error instanceof LaterWriterError);
      assert.deepEqual(error.records, [{ id: "x-1", seq: catSeq, actor: "cat" }, { id: "x-3", seq: unsignedSeq }], "one written after, one between bob's writes, by a writer who gave no name");
      assert.match(error.message, /x-1.*x-3/s);
      return true;
    });
    await assert.rejects(store.revertWrites({ of: "cat", validate: () => { throw new Error("refused by the check"); } }), /refused by the check/);
    assert.deepEqual(await store.history(), before.history, "no history entry was written");
    assert.deepEqual(await store.list("note"), before.records);
  });

}

/** Assert that `value` is an ISO 8601 UTC timestamp, exactly as Date#toISOString writes one. */
function assertTimestamp(value: unknown, what: string): void {
  assert.equal(typeof value, "string", `${what} is a string`);
  assert.equal(new Date(value as string).toISOString(), value, `${what} is an ISO 8601 timestamp`);
}

/**
 * Check what every history entry must be (a positive whole seq, strictly increasing, and an ISO
 * timestamp), then return the entries without seq and at, for comparing with what a test expects.
 */
function changesOf(entries: readonly HistoryEntry[]): Omit<HistoryEntry, "seq" | "at">[] {
  let previous = 0;
  for (const entry of entries) {
    assert.ok(Number.isSafeInteger(entry.seq) && entry.seq > 0, `seq ${entry.seq} is a positive whole number`);
    assert.ok(entry.seq > previous, `seq ${entry.seq} comes after ${previous}: strictly increasing`);
    assertTimestamp(entry.at, `the at of entry ${entry.seq}`);
    previous = entry.seq;
  }
  return entries.map(({ seq: _seq, at: _at, ...change }) => change);
}

/** Records carrying a numeric field `n`, sorted by it. */
function byN(records: readonly RecordEnvelope[]): RecordEnvelope[] {
  return [...records].sort((a, b) => Number(a.fields.n) - Number(b.fields.n));
}

/**
 * Start RACERS reads at once, so that a pooled backend has a connection ready for every racer
 * that follows and the race is not decided by who got a connection first.
 */
async function warmUp(store: Transactions): Promise<void> {
  await Promise.all(Array.from({ length: RACERS }, () => store.get("warm-up")));
}
