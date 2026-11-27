import assert from "node:assert/strict";
import { test } from "node:test";

import type { HistoryEntry, RecordEnvelope, Transactions } from "../index.js";

export interface OpenedStore {
  readonly store: Transactions;
  cleanup(): Promise<void>;
}

const BOB = "session:bob";
const CURATOR = "session:curator";

export function transactionsBehaviourSuite(label: string, open: () => Promise<OpenedStore>): void {
  const contract = (number: string, words: string, body: (store: Transactions) => Promise<void>): void => {
    test(`${number} [${label}] ${words}`, async () => {
      const { store, cleanup } = await open();
      try {
        await body(store);
      } finally {
        await cleanup();
      }
    });
  };

  contract("2.1", "`save` creates a record. Saving the same id again replaces it, and each save appends one history entry.", async (store) => {
    const first = await store.save({ id: "note-1", type: "note", fields: { title: "First", body: "Kept?" } });
    assert.deepEqual({ id: first.id, type: first.type, fields: first.fields }, { id: "note-1", type: "note", fields: { title: "First", body: "Kept?" } });
    assert.deepEqual(await store.get("note-1"), first);
    const afterFirst = await store.history();
    assert.equal(afterFirst.length, 1, "the first save appends one entry");

    const second = await store.save({ id: "note-1", type: "note", fields: { title: "Second" } });
    assert.deepEqual(second.fields, { title: "Second" }, "replaced whole, not merged");
    assert.deepEqual(await store.get("note-1"), second);
    assert.deepEqual(await store.list("note"), [second], "still one record");
    const history = await store.history({ id: "note-1" });
    assert.equal(history.length, 2, "one entry per save");
    assert.deepEqual(history.map((entry) => entry.record), [first, second]);

    const third = await store.save({ id: "note-1", type: "principle", version: 2, fields: { name: "Third" } });
    assert.deepEqual({ id: third.id, type: third.type, version: third.version, fields: third.fields }, { id: "note-1", type: "principle", version: 2, fields: { name: "Third" } });
    assert.deepEqual(await store.get("note-1"), third);
    assert.deepEqual(await store.list("note"), [], "replaced under its new type");
    assert.deepEqual(await store.list("principle"), [third]);
    const all = await store.history();
    assert.deepEqual(all.slice(0, 1), afterFirst, "appended, never rewritten");
    assert.deepEqual(all.map((entry) => [entry.recordId, entry.record]), [["note-1", first], ["note-1", second], ["note-1", third]], "one entry per save, three saves");

    const names = ["r1", "r2", "r3", "r4", "r5", "r6", "r7", "r8"];
    const raced = await Promise.all(names.map((name) => store.save({ id: "note-raced", type: "note", fields: { name } })));
    const racedHistory = await store.history({ id: "note-raced" });
    assert.equal(racedHistory.length, 8, "eight racing saves append eight entries");
    assert.deepEqual(racedHistory.map((entry) => entry.record.fields["name"]).sort(), names);
    assert.deepEqual(raced.map((record) => record.fields["name"]), names);
    assert.deepEqual(await store.get("note-raced"), racedHistory.at(-1)!.record, "the stored record is the last save's");
    assert.deepEqual(await store.list("note"), [racedHistory.at(-1)!.record], "still one record");
  });

  contract("2.2", "`edit` changes only the fields it names; every other field keeps its stored value.", async (store) => {
    const saved = await store.save({ id: "note-1", type: "note", fields: { title: "Kept", body: "Old body", tags: ["a", "b"], count: 3 } });
    const edited = await store.edit({ id: "note-1", fields: { body: "New body" } });
    assert.deepEqual(edited?.fields, { title: "Kept", body: "New body", tags: ["a", "b"], count: 3 });
    assert.deepEqual({ id: edited?.id, type: edited?.type, createdAt: edited?.createdAt }, { id: saved.id, type: saved.type, createdAt: saved.createdAt });
    assert.deepEqual(await store.get("note-1"), edited);
  });

  contract("2.3", "`edit` merges onto what is stored NOW, not onto a copy the caller read earlier. If two edits of different fields race, both survive.", async (store) => {
    await store.save({ id: "note-1", type: "note", fields: { title: "T", body: "B", status: "open" } });
    const readEarlier = await store.get("note-1");
    await store.edit({ id: "note-1", fields: { status: "closed" } });
    await store.edit({ id: "note-1", fields: { body: `${String(readEarlier?.fields["body"])} again` } });
    assert.deepEqual((await store.get("note-1"))?.fields, { title: "T", body: "B again", status: "closed" }, "the later edit kept the earlier one");

    await Promise.all([
      store.edit({ id: "note-1", fields: { title: "Raced title" } }),
      store.edit({ id: "note-1", fields: { body: "Raced body" } }),
    ]);
    assert.deepEqual((await store.get("note-1"))?.fields, { title: "Raced title", body: "Raced body", status: "closed" });

    await Promise.all(["title", "body", "status", "a", "b", "c", "d", "e"].map((field) => store.edit({ id: "note-1", fields: { [field]: `raced ${field}` } })));
    assert.deepEqual((await store.get("note-1"))?.fields, {
      title: "raced title", body: "raced body", status: "raced status", a: "raced a", b: "raced b", c: "raced c", d: "raced d", e: "raced e",
    }, "eight racing edits of different fields all survive");
  });

  contract("2.4", "`edit` of a missing record returns `null` and creates nothing.", async (store) => {
    assert.equal(await store.edit({ id: "note-missing", fields: { title: "Never" } }), null);
    assert.equal(await store.get("note-missing"), null);
    assert.deepEqual(await store.list("note"), []);
    assert.deepEqual(await store.history(), []);

    const kept = await store.save({ id: "note-1", type: "note", fields: { title: "Kept" } });
    await store.save({ id: "note-gone", type: "note", fields: { title: "Gone" } });
    await store.retire({ id: "note-gone", reason: "gone" });
    const before = await store.history();
    assert.equal(await store.edit({ id: "note-missing", fields: { title: "Never" } }), null, "missing beside stored records");
    assert.equal(await store.edit({ id: "note", fields: { title: "Never" } }), null, "a prefix of a stored id is missing");
    assert.equal(await store.edit({ id: "note-gone", fields: { title: "Back?" } }), null, "a retired record is missing to edit");
    for (const id of ["note-missing", "note", "note-gone"]) assert.equal(await store.get(id), null, id);
    assert.deepEqual(await store.list("note"), [kept]);
    assert.deepEqual(await store.history(), before);
  });

  contract("2.5", "`get` of a missing record returns `null` and never throws.", async (store) => {
    assert.equal(await store.get("note-missing"), null);
    await store.save({ id: "note-gone", type: "note", fields: {} });
    await store.retire({ id: "note-gone", reason: "gone" });
    assert.equal(await store.get("note-gone"), null, "a retired record reads as missing too");

    const stored = await store.save({ id: "note-1", type: "note", fields: { title: "Stored" } });
    for (const id of ["note", "note-1 ", "NOTE-1", "note-%", "note-_", "", "'; DROP TABLE record; --", "ñote-1", "x".repeat(10_000), "\u0000"]) {
      assert.equal(await store.get(id), null, JSON.stringify(id).slice(0, 40));
    }
    assert.deepEqual(await store.get("note-1"), stored);
  });

  contract("2.6", "`list(type)` returns only that type's current records (none retired), and `[]` when there are none.", async (store) => {
    assert.deepEqual(await store.list("note"), []);
    const a = await store.save({ id: "note-a", type: "note", fields: { title: "A" } });
    await store.save({ id: "note-b", type: "note", fields: { title: "B" } });
    const c = await store.save({ id: "note-c", type: "note", fields: { title: "C" } });
    await store.save({ id: "story-a", type: "story", fields: { title: "Elsewhere" } });
    await store.retire({ id: "note-b", reason: "overtaken" });
    assert.deepEqual(await store.list("note"), [a, c]);
    assert.deepEqual(await store.list("principle"), []);
  });

  contract("2.7", "`retire(id, reason)` removes the record from `get`/`list`, keeps the reason in the history, and retiring an already-retired or missing record is a harmless no-op.", async (store) => {
    const kept = await store.save({ id: "note-kept", type: "note", fields: { title: "Kept" } });
    await store.save({ id: "note-1", type: "note", fields: { title: "Retired" } });
    assert.equal(await store.retire({ id: "note-1", reason: "merged into note-kept" }), undefined);
    assert.equal(await store.get("note-1"), null);
    assert.deepEqual(await store.list("note"), [kept]);
    const last = (await store.history({ id: "note-1" })).at(-1);
    assert.deepEqual([last?.action, last?.reason], ["retired", "merged into note-kept"]);

    const before = await store.history();
    await store.retire({ id: "note-1", reason: "again" });
    await store.retire({ id: "note-missing", reason: "never existed" });
    assert.deepEqual(await store.history(), before, "neither no-op wrote an entry");
    assert.deepEqual(await store.list("note"), [kept]);
  });

  contract("2.8", "`history()` returns every change in the order it happened, with strictly increasing sequence numbers. `history({ id })` filters to one record, and `history({ since })` returns only entries after that sequence number.", async (store) => {
    await store.save({ id: "note-1", type: "note", fields: { v: 1 } });
    await store.save({ id: "note-2", type: "note", fields: { v: 1 } });
    await store.edit({ id: "note-1", fields: { v: 2 } });
    await store.retire({ id: "note-2", reason: "done" });
    await store.edit({ id: "note-1", fields: { v: 3 } });

    const all = await store.history();
    assert.deepEqual(all.map((entry) => [entry.recordId, entry.action]), [
      ["note-1", "created"], ["note-2", "created"], ["note-1", "updated"], ["note-2", "retired"], ["note-1", "updated"],
    ]);
    for (let index = 1; index < all.length; index++) assert.ok(all[index]!.seq > all[index - 1]!.seq, `seq ${all[index]!.seq} follows ${all[index - 1]!.seq}`);
    assert.deepEqual(all.map((entry) => entry.record.fields["v"]), [1, 1, 2, 1, 3]);

    assert.deepEqual(await store.history({ id: "note-1" }), [all[0], all[2], all[4]]);
    assert.deepEqual(await store.history({ since: all[1]!.seq }), all.slice(2));
    assert.deepEqual(await store.history({ since: all[4]!.seq }), []);
  });

  contract("2.9", "A `validate` check passed to `save`/`edit` sees the merged result. If it throws, nothing is written (no record change and no history entry).", async (store) => {
    const seen: RecordEnvelope[] = [];
    await store.save({ id: "note-1", type: "note", fields: { a: 1, b: 2 }, validate: (candidate) => { seen.push(candidate); } });
    await store.edit({ id: "note-1", fields: { b: 20 }, validate: (candidate) => { seen.push(candidate); } });
    assert.deepEqual(seen.map((candidate) => [candidate.id, candidate.fields]), [["note-1", { a: 1, b: 2 }], ["note-1", { a: 1, b: 20 }]]);
    const stored = await store.get("note-1");
    const before = await store.history();

    const refuse = (): void => { throw new Error("refused by the check"); };
    await assert.rejects(store.save({ id: "note-2", type: "note", fields: { a: 1 }, validate: refuse }), /refused by the check/);
    await assert.rejects(store.save({ id: "note-1", type: "note", fields: { a: 9 }, validate: refuse }), /refused by the check/);
    await assert.rejects(store.edit({ id: "note-1", fields: { a: 9 }, validate: refuse }), /refused by the check/);
    assert.equal(await store.get("note-2"), null);
    assert.deepEqual(await store.get("note-1"), stored);
    assert.deepEqual(await store.history(), before);
  });

  contract("2.10", "A write naming an `actor` keeps it in history. A write without one is accepted and its history entry has no actor; an edit or retirement never inherits an earlier write's actor. Refused writes and harmless no-ops add no history entry.", async (store) => {
    await store.save({ id: "note-1", type: "note", fields: { v: 1 }, actor: "session:one" });
    await store.edit({ id: "note-1", fields: { v: 2 }, actor: "session:two" });
    await store.edit({ id: "note-1", fields: { v: 3 } });
    await store.save({ id: "note-2", type: "note", fields: { v: 1 }, actor: "session:one" });
    await store.retire({ id: "note-2", reason: "done" });
    await store.save({ id: "note-3", type: "note", fields: { v: 1 } });
    const history = await store.history();
    assert.deepEqual(history.map((entry) => [entry.recordId, entry.action, entry.actor]), [
      ["note-1", "created", "session:one"],
      ["note-1", "updated", "session:two"],
      ["note-1", "updated", undefined],
      ["note-2", "created", "session:one"],
      ["note-2", "retired", undefined],
      ["note-3", "created", undefined],
    ]);

    await assert.rejects(store.save({ id: "note-4", type: "note", fields: {}, actor: "session:one", validate: () => { throw new Error("refused by the check"); } }), /refused by the check/);
    await assert.rejects(store.edit({ id: "note-1", fields: { v: 4 }, actor: "session:one", validate: () => { throw new Error("refused by the check"); } }), /refused by the check/);
    await store.retire({ id: "note-2", reason: "again", actor: "session:one" });
    await store.retire({ id: "note-missing", reason: "never", actor: "session:one" });
    assert.equal(await store.edit({ id: "note-missing", fields: { v: 1 }, actor: "session:one" }), null);
    assert.deepEqual(await store.history(), history);
  });

  contract("2.12", "`history` also narrows on the server: `from` (a time) keeps the changes made at or after it, to the millisecond, however the time is written; `types` keeps only changes to records of those types (none for an empty list); `oldest: n` or `newest: n` keeps only the first or last n of what matches, still in order. Filters combine with each other and with `id` and `since`; a malformed one (a limit that is not a whole number above 0, both limits, or a time that is not one) is refused with a RangeError before anything is read.", async (store) => {
    for (const [id, type] of [["note-1", "note"], ["story-1", "story"], ["note-2", "note"], ["story-2", "story"]] as const) {
      await store.save({ id, type, fields: { title: id } });
    }
    await store.edit({ id: "note-1", fields: { title: "edited" } });
    const all = await store.history();
    assert.equal(all.length, 5);
    const atOrAfter = (instant: number, entries: readonly HistoryEntry[] = all): HistoryEntry[] => entries.filter((entry) => Date.parse(entry.at) >= instant);

    for (const entry of all) {
      const instant = Date.parse(entry.at);
      assert.deepEqual(await store.history({ from: entry.at }), atOrAfter(instant), `at or after ${entry.at}`);
      assert.deepEqual(await store.history({ from: new Date(instant + 1).toISOString() }), atOrAfter(instant + 1), `to the millisecond: after ${entry.at}`);
      assert.deepEqual(await store.history({ from: writtenAt(instant, 600) }), atOrAfter(instant), `${entry.at} written at +10:00`);
      assert.deepEqual(await store.history({ from: writtenAt(instant + 1, -300) }), atOrAfter(instant + 1), `a millisecond after ${entry.at} written at -05:00`);
    }
    const last = Date.parse(all.at(-1)!.at);
    assert.deepEqual(await store.history({ from: all[0]!.at }), all, "the first entry's time keeps every change");
    assert.deepEqual(await store.history({ from: new Date(last + 1).toISOString() }), [], "a millisecond after the last change keeps none");
    assert.deepEqual(await store.history({ from: writtenAt(last + 1, 600) }), [], "nor written at +10:00");

    assert.deepEqual(await store.history({ types: ["story"] }), [all[1], all[3]]);
    assert.deepEqual(await store.history({ types: ["note", "story"] }), all);
    assert.deepEqual(await store.history({ types: [] }), []);
    assert.deepEqual(await store.history({ oldest: 2 }), all.slice(0, 2));
    assert.deepEqual(await store.history({ newest: 2 }), all.slice(3));
    assert.deepEqual(await store.history({ oldest: 9 }), all);

    assert.deepEqual(await store.history({ types: ["note"], newest: 2 }), [all[2], all[4]]);
    assert.deepEqual(await store.history({ types: ["note"], oldest: 1, since: all[0]!.seq }), [all[2]]);
    assert.deepEqual(await store.history({ id: "note-1", newest: 1 }), [all[4]]);
    assert.deepEqual(await store.history({ id: "note-1", from: all[1]!.at }), atOrAfter(Date.parse(all[1]!.at), [all[0]!, all[4]!]));
    assert.deepEqual(await store.history({ types: ["story"], from: all[2]!.at }), atOrAfter(Date.parse(all[2]!.at), [all[1]!, all[3]!]));

    for (const malformed of [{ oldest: 0 }, { newest: 0 }, { oldest: -1 }, { newest: 1.5 }, { oldest: 1, newest: 1 }, { from: "yesterday" }]) {
      await assert.rejects(store.history(malformed), RangeError, JSON.stringify(malformed));
    }
  });

  contract("2.13", "Lists narrow on the server by ids and stored field values, take an ordered limit, and project only requested fields on the named schema version, and on each older version named with its own fields; a version not named arrives whole. Memory and Postgres agree.", async (store) => {
    const one = await store.save({ id: "note-1", type: "note", version: 1, fields: { name: "Old", status: "open", body: "b1" } });
    const two = await store.save({ id: "note-2", type: "note", version: 2, fields: { title: "Current", status: "closed", body: "b2" } });
    const three = await store.save({ id: "note-3", type: "note", version: 2, fields: { title: "Also current", status: "open", body: "b3", count: 3 } });
    const four = await store.save({ id: "note-4", type: "note", version: 3, fields: { heading: "Newer", status: "open" } });
    await store.save({ id: "story-1", type: "story", fields: { status: "open" } });

    assert.deepEqual(await store.list("note", { ids: ["note-3", "note-1", "note-9"] }), [one, three]);
    assert.deepEqual(await store.list("note", { where: { status: "open" } }), [one, three, four]);
    assert.deepEqual(await store.list("note", { where: { status: "open", count: 3 } }), [three]);
    assert.deepEqual(await store.list("note", { limit: 2 }), [one, two]);
    assert.deepEqual(await store.list("note", { where: { status: "open" }, limit: 2 }), [one, three]);
    assert.deepEqual(await store.list("note", { ids: ["note-2", "note-4"], where: { status: "open" } }), [four]);

    assert.deepEqual(
      await store.list("note", { projection: { version: 2, fields: ["title", "status"], older: [{ version: 1, fields: ["name"] }] } }),
      [
        { ...one, fields: { name: "Old" } },
        { ...two, fields: { title: "Current", status: "closed" } },
        { ...three, fields: { title: "Also current", status: "open" } },
        four,
      ],
    );
    assert.deepEqual(
      await store.list("note", { projection: { version: 2, fields: ["body"] } }),
      [one, { ...two, fields: { body: "b2" } }, { ...three, fields: { body: "b3" } }, four],
      "an older version not named arrives whole",
    );
  });

  contract("2.14", "`revert(id, to, read)` writes the record back to the state its own history entry `to` kept, whole: changed fields restored, removed ones put back, added ones gone. It is one more `updated` entry whose reason names the entry it reverts to, with its writer; nothing in history is rewritten.", async (store) => {
    const first = await store.save({ id: "note-1", type: "note", fields: { title: "First", body: "Removed later" } });
    await store.save({ id: "note-1", type: "note", fields: { title: "Changed", added: "Gone after the revert" } });
    const before = await store.history({ id: "note-1" });
    const [to, read] = [before[0]!.seq, before[1]!.seq];

    const reverted = await store.revert({ id: "note-1", to, read, actor: CURATOR });
    assert.deepEqual(reverted.fields, { title: "First", body: "Removed later" });
    assert.deepEqual({ id: reverted.id, type: reverted.type, createdAt: reverted.createdAt }, { id: first.id, type: first.type, createdAt: first.createdAt });
    assert.deepEqual(await store.get("note-1"), reverted);

    const after = await store.history({ id: "note-1" });
    assert.deepEqual(after.slice(0, 2), before, "nothing in history is rewritten");
    assert.equal(after.length, 3);
    const entry = after[2]!;
    assert.deepEqual([entry.action, entry.actor, entry.record], ["updated", CURATOR, reverted]);
    assert.match(entry.reason ?? "", new RegExp(`\\b${to}\\b`), "the reason names the entry it reverts to");
  });

  contract("2.15", "A revert of a retired record to an entry before its retirement brings it back live under its own id, created when it first was, so links to that id reconnect. A retirement entry is not a state to revert to.", async (store) => {
    const first = await store.save({ id: "note-1", type: "note", fields: { title: "First" } });
    await store.edit({ id: "note-1", fields: { title: "Second" } });
    await store.retire({ id: "note-1", reason: "thought overtaken" });
    const [created, , retired] = await store.history({ id: "note-1" });

    const back = await store.revert({ id: "note-1", to: created!.seq, read: retired!.seq, actor: CURATOR });
    assert.deepEqual(back, { ...first, updatedAt: back.updatedAt });
    assert.deepEqual(await store.get("note-1"), back);
    assert.deepEqual(await store.list("note"), [back]);

    await store.retire({ id: "note-1", reason: "overtaken after all" });
    const again = (await store.history({ id: "note-1" })).at(-1)!;
    const before = await store.history();
    await assert.rejects(store.revert({ id: "note-1", to: again.seq, read: again.seq, actor: CURATOR }));
    await assert.rejects(store.revert({ id: "note-1", to: retired!.seq, read: again.seq, actor: CURATOR }));
    assert.equal(await store.get("note-1"), null);
    assert.deepEqual(await store.history(), before);
  });

  contract("2.16", "A revert is refused, writing nothing, when the record was written to after the entry the writer read (`read` is not its newest seq), when the entry is not the record's own, or when its validate check throws.", async (store) => {
    await store.save({ id: "note-1", type: "note", fields: { v: 1 } });
    await store.edit({ id: "note-1", fields: { v: 2 } });
    await store.save({ id: "note-2", type: "note", fields: { v: 1 } });
    const [first, newest] = await store.history({ id: "note-1" });
    const [foreign] = await store.history({ id: "note-2" });
    const stored = await store.get("note-1");
    const before = await store.history();

    await assert.rejects(store.revert({ id: "note-1", to: first!.seq, read: first!.seq }), "a stale read");
    await assert.rejects(store.revert({ id: "note-1", to: foreign!.seq, read: newest!.seq }), "another record's entry");
    await assert.rejects(store.revert({ id: "note-1", to: Math.max(...before.map((entry) => entry.seq)) + 1, read: newest!.seq }), "an entry no record has");
    await assert.rejects(store.revert({ id: "note-1", to: first!.seq, read: newest!.seq, validate: () => { throw new Error("check refused"); } }), /check refused/);
    assert.deepEqual(await store.get("note-1"), stored);
    assert.deepEqual(await store.history(), before);

    const reverted = await store.revert({ id: "note-1", to: first!.seq, read: newest!.seq });
    assert.deepEqual(reverted.fields, { v: 1 }, "the same revert, read fresh, goes through");
  });

  contract("2.17", "`history({ actor })` keeps only the changes one writer made, as their entries name them, on the server, combined with the other filters.", async (store) => {
    await store.save({ id: "note-1", type: "note", fields: { v: 1 }, actor: "session:one" });
    await store.save({ id: "story-1", type: "story", fields: { v: 1 }, actor: "session:one" });
    await store.edit({ id: "note-1", fields: { v: 2 }, actor: "session:two" });
    await store.edit({ id: "note-1", fields: { v: 3 } });
    await store.save({ id: "note-2", type: "note", fields: { v: 1 }, actor: "session:one" });
    const all = await store.history();

    assert.deepEqual(await store.history({ actor: "session:one" }), [all[0], all[1], all[4]]);
    assert.deepEqual(await store.history({ actor: "session:two" }), [all[2]]);
    assert.deepEqual(await store.history({ actor: "session:three" }), []);
    assert.deepEqual(await store.history({ actor: "session:one", types: ["note"] }), [all[0], all[4]]);
    assert.deepEqual(await store.history({ actor: "session:one", id: "note-1" }), [all[0]]);
    assert.deepEqual(await store.history({ actor: "session:one", since: all[0]!.seq, newest: 1 }), [all[4]]);
  });

  contract("2.18", "`revertWrites({ of })` writes every record `of` wrote (health left out) back, in one write, to its state before `of`'s first write to it: a changed record to its entry before, a record `of` retired live again, a record `of` made retired. Each is one more entry naming the writer reverted and the entry it goes back to, with its own writer and reason; a record `of` made and retired itself is left alone. It returns what it changed, by id.", async (store) => {
    const ann = { actor: "session:ann" };
    const changed = await store.save({ id: "rec-changed", type: "note", fields: { v: "ann's" }, ...ann });
    const retired = await store.save({ id: "rec-retired", type: "note", fields: { v: "ann's" }, ...ann });
    await store.save({ id: "rec-health", type: "health", fields: { state: "passing" }, ...ann });
    const untouched = await store.save({ id: "rec-untouched", type: "note", fields: { v: "ann's" }, ...ann });
    await store.edit({ id: "rec-changed", fields: { v: "bob's" }, actor: BOB });
    await store.edit({ id: "rec-changed", fields: { v: "bob's again", extra: true }, actor: BOB });
    await store.retire({ id: "rec-retired", reason: "bob thought it overtaken", actor: BOB });
    await store.save({ id: "rec-made", type: "note", fields: { v: "bob's" }, actor: BOB });
    await store.save({ id: "rec-made-and-gone", type: "note", fields: { v: "bob's" }, actor: BOB });
    await store.retire({ id: "rec-made-and-gone", reason: "bob's own mistake", actor: BOB });
    const health = await store.edit({ id: "rec-health", fields: { state: "failing" }, actor: BOB });
    const [changedBefore] = await store.history({ id: "rec-changed" });
    const [retiredBefore] = await store.history({ id: "rec-retired" });
    const goneHistory = await store.history({ id: "rec-made-and-gone" });

    const done = await store.revertWrites({ of: BOB, actor: CURATOR, reason: "bob was misled" });
    assert.deepEqual(
      [...done].sort((a, b) => a.id.localeCompare(b.id)).map((write) => [write.id, write.action, write.to]),
      [["rec-changed", "updated", changedBefore!.seq], ["rec-made", "retired", undefined], ["rec-retired", "updated", retiredBefore!.seq]],
    );

    assert.deepEqual((await store.get("rec-changed"))?.fields, changed.fields);
    assert.deepEqual((await store.get("rec-retired"))?.fields, retired.fields, "live again");
    assert.equal((await store.get("rec-retired"))?.createdAt, retired.createdAt);
    assert.equal(await store.get("rec-made"), null, "made by bob, now retired");
    assert.deepEqual(await store.get("rec-health"), health, "health is left out");
    assert.deepEqual(await store.get("rec-untouched"), untouched);
    assert.deepEqual(await store.history({ id: "rec-made-and-gone" }), goneHistory, "made and retired by bob: left alone");

    for (const [id, action, to] of [["rec-changed", "updated", changedBefore!.seq], ["rec-retired", "updated", retiredBefore!.seq], ["rec-made", "retired", undefined]] as const) {
      const last = (await store.history({ id })).at(-1)!;
      assert.deepEqual([last.action, last.actor], [action, CURATOR], id);
      assert.ok(last.reason?.includes(BOB), `${id}'s entry names the writer reverted: ${last.reason}`);
      assert.ok(last.reason?.includes("bob was misled"), `${id}'s entry carries the reason given: ${last.reason}`);
      if (to !== undefined) assert.match(last.reason ?? "", new RegExp(`\\b${to}\\b`), `${id}'s entry names the entry it goes back to`);
    }
  });

  contract("2.19", "`revertWrites` is refused, writing nothing, when another writer (named or not) wrote to any record `of` wrote after `of`'s first write to it: LaterWriterError names each such record with the first such entry and its writer. A check that throws refuses it whole too.", async (store) => {
    await store.save({ id: "rec-named-later", type: "note", fields: { v: 0 } });
    await store.save({ id: "rec-unnamed-later", type: "note", fields: { v: 0 } });
    await store.edit({ id: "rec-named-later", fields: { v: 1 }, actor: BOB });
    await store.edit({ id: "rec-unnamed-later", fields: { v: 1 }, actor: BOB });
    await store.save({ id: "rec-bob-only", type: "note", fields: { v: 1 }, actor: BOB });
    await store.edit({ id: "rec-named-later", fields: { v: 2 }, actor: "session:cat" });
    await store.edit({ id: "rec-named-later", fields: { v: 3 }, actor: "session:dee" });
    await store.edit({ id: "rec-unnamed-later", fields: { v: 2 } });
    const catEntry = (await store.history({ id: "rec-named-later" })).find((entry) => entry.actor === "session:cat")!;
    const unnamedEntry = (await store.history({ id: "rec-unnamed-later" })).at(-1)!;
    const before = await store.history();

    await assert.rejects(store.revertWrites({ of: BOB, actor: CURATOR }), (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.equal(error.name, "LaterWriterError");
      for (const part of ["rec-named-later", String(catEntry.seq), "session:cat", "rec-unnamed-later", String(unnamedEntry.seq)]) {
        assert.ok(error.message.includes(part), `the error names ${part}: ${error.message}`);
      }
      return true;
    });
    assert.deepEqual(await store.history(), before, "nothing was written");
    assert.deepEqual((await store.get("rec-bob-only"))?.fields, { v: 1 });

    await store.save({ id: "rec-dan", type: "note", fields: { v: 0 } });
    await store.edit({ id: "rec-dan", fields: { v: 1 }, actor: "session:dan" });
    await store.save({ id: "rec-dan-made", type: "note", fields: { v: 1 }, actor: "session:dan" });
    const beforeCheck = await store.history();
    await assert.rejects(store.revertWrites({ of: "session:dan", actor: CURATOR, validate: (candidate) => { if (candidate.id === "rec-dan") throw new Error("check refused"); } }), /check refused/);
    assert.deepEqual(await store.history(), beforeCheck, "nothing was written");
    assert.deepEqual((await store.get("rec-dan-made"))?.fields, { v: 1 });
  });

  contract("2.20", "A write made for a writer who had read outside text keeps what it read in its history entry; a write without one carries no mark", async (store) => {
    const read = ["gh issue view 7", "gh pr view 12"];
    const outsideRead = (): readonly string[] => read;
    await store.save({ id: "note-1", type: "note", fields: { v: 1 }, actor: "session:one", outsideRead });
    await store.edit({ id: "note-1", fields: { v: 2 }, actor: "session:one", outsideRead });
    await store.save({ id: "note-2", type: "note", fields: { v: 1 }, actor: "session:one" });
    await store.edit({ id: "note-2", fields: { v: 2 }, actor: "session:one", outsideRead: () => undefined });
    await store.retire({ id: "note-1", reason: "overtaken", actor: "session:one", outsideRead });
    await store.retire({ id: "note-2", reason: "overtaken", actor: "session:one" });
    assert.deepEqual((await store.history()).map((entry) => [entry.recordId, entry.action, entry.outsideRead]), [
      ["note-1", "created", read],
      ["note-1", "updated", read],
      ["note-2", "created", undefined],
      ["note-2", "updated", undefined],
      ["note-1", "retired", read],
      ["note-2", "retired", undefined],
    ]);
  });

  contract("2.23", "`history({ actions })` keeps only the changes of those actions (created, updated, retired), on the server, combined with the other filters; none for an empty list, and an action no change has is refused with a RangeError before anything is read.", async (store) => {
    await store.save({ id: "note-1", type: "note", fields: { v: 1 } });
    await store.save({ id: "story-1", type: "story", fields: { v: 1 } });
    await store.edit({ id: "note-1", fields: { v: 2 } });
    await store.edit({ id: "story-1", fields: { v: 2 } });
    await store.retire({ id: "note-1", reason: "done" });
    const all = await store.history();

    assert.deepEqual(await store.history({ actions: ["created"] }), [all[0], all[1]]);
    assert.deepEqual(await store.history({ actions: ["updated", "retired"] }), all.slice(2));
    assert.deepEqual(await store.history({ actions: ["retired"] }), [all[4]]);
    assert.deepEqual(await store.history({ actions: [] }), []);
    assert.deepEqual(await store.history({ actions: ["updated"], types: ["story"] }), [all[3]]);
    assert.deepEqual(await store.history({ actions: ["created", "updated"], id: "note-1" }), [all[0], all[2]]);
    assert.deepEqual(await store.history({ actions: ["updated"], newest: 1 }), [all[3]]);

    for (const action of ["deleted", "Created", ""]) {
      await assert.rejects(store.history({ actions: [action as HistoryEntry["action"]] }), RangeError, action);
    }
  });

  contract("2.24", "inOneWrite commits every write its work makes together, or none when the work throws", async (store) => {
    await store.save({ id: "note-0", type: "note", fields: { v: 0 } });
    const kept = await store.save({ id: "note-2", type: "note", fields: { v: 2 } });
    const before = await store.history();
    await assert.rejects(store.inOneWrite(async () => {
      await store.save({ id: "note-1", type: "note", fields: { v: 1 } });
      await store.edit({ id: "note-0", fields: { v: 1 } });
      await store.retire({ id: "note-2", reason: "inside the work" });
      throw new Error("the work failed");
    }), /the work failed/);
    assert.equal(await store.get("note-1"), null);
    assert.deepEqual((await store.get("note-0"))?.fields, { v: 0 });
    assert.deepEqual(await store.get("note-2"), kept, "its retirement is not committed either");
    assert.deepEqual(await store.history(), before, "none of its writes committed");

    let reached!: () => void;
    const midway = new Promise<void>((resolve) => { reached = resolve; });
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const working = store.inOneWrite(async () => {
      await store.save({ id: "note-1", type: "note", fields: { v: 1 } });
      await store.edit({ id: "note-0", fields: { v: 1 } });
      await store.retire({ id: "note-2", reason: "inside the work" });
      reached();
      await gate;
      return "done";
    });
    let alongside: Promise<RecordEnvelope> | undefined;
    try {
      await midway;
      alongside = store.save({ id: "note-alongside", type: "note", fields: { v: "outside" } });
      assert.equal(await store.get("note-1"), null, "a read outside the work sees none of its writes before they commit");
      assert.deepEqual((await store.get("note-0"))?.fields, { v: 0 });
      assert.deepEqual(await store.get("note-2"), kept);
      assert.deepEqual(await store.history(), before);
    } finally {
      release();
    }
    const result = await working;
    await alongside;
    assert.equal(result, "done");
    assert.deepEqual((await store.get("note-1"))?.fields, { v: 1 });
    assert.deepEqual((await store.get("note-0"))?.fields, { v: 1 });
    assert.equal(await store.get("note-2"), null);
    assert.deepEqual(
      (await store.history()).slice(before.length).map((entry) => [entry.recordId, entry.action]),
      [["note-1", "created"], ["note-0", "updated"], ["note-2", "retired"], ["note-alongside", "created"]],
      "a write made outside while the work ran lands after the work's writes, never between them",
    );

    const settled = await store.history();
    await assert.rejects(store.inOneWrite(async () => {
      await store.inOneWrite(async () => {
        await store.save({ id: "note-3", type: "note", fields: { v: 3 } });
      });
      await store.edit({ id: "note-0", fields: { v: 2 } });
      throw new Error("the outer work failed");
    }), /the outer work failed/);
    assert.equal(await store.get("note-3"), null, "a write the work made through a nested inOneWrite is not committed when the work throws");
    assert.deepEqual((await store.get("note-0"))?.fields, { v: 1 });
    assert.deepEqual(await store.history(), settled);

    await store.inOneWrite(async () => {
      await store.save({ id: "note-4", type: "note", fields: { v: 4 } });
      await assert.rejects(store.save({ id: "note-5", type: "note", fields: { v: 5 }, validate: () => { throw new Error("note-5 refused"); } }), /note-5 refused/);
      await store.save({ id: "note-6", type: "note", fields: { v: 6 } });
    });
    assert.deepEqual([(await store.get("note-4"))?.fields, await store.get("note-5"), (await store.get("note-6"))?.fields], [{ v: 4 }, null, { v: 6 }], "a work that does not throw commits every write it made");
    assert.deepEqual((await store.history()).slice(settled.length).map((entry) => [entry.recordId, entry.action]), [["note-4", "created"], ["note-6", "created"]]);
  });

  contract("2.25", "saveAll saves every record given in one write, each with its history entry in the order given, or none when one is refused", async (store) => {
    const saved = await store.saveAll([
      { id: "note-c", type: "note", fields: { v: "c" } },
      { id: "note-a", type: "note", fields: { v: "a" } },
      { id: "story-b", type: "story", fields: { v: "b" } },
    ]);
    assert.deepEqual(saved.map((record) => [record.id, record.type, record.fields]), [["note-c", "note", { v: "c" }], ["note-a", "note", { v: "a" }], ["story-b", "story", { v: "b" }]]);
    for (const record of saved) assert.deepEqual(await store.get(record.id), record);
    const history = await store.history();
    assert.deepEqual(history.map((entry) => [entry.recordId, entry.action, entry.record]), saved.map((record) => [record.id, "created", record]));

    await assert.rejects(store.saveAll([
      { id: "note-d", type: "note", fields: { v: "d" } },
      { id: "note-e", type: "note", fields: { v: "e" }, validate: () => { throw new Error("note-e refused"); } },
      { id: "note-f", type: "note", fields: { v: "f" } },
    ]), /note-e refused/);
    assert.equal(await store.get("note-d"), null);
    assert.equal(await store.get("note-f"), null);
    assert.deepEqual(await store.history(), history, "the history is unchanged");

    const [g, a] = await store.saveAll([
      { id: "note-g", type: "note", fields: { v: "g" } },
      { id: "note-a", type: "note", fields: { v: "a again" } },
    ]);
    assert.deepEqual([g?.fields, a?.fields], [{ v: "g" }, { v: "a again" }]);
    assert.deepEqual(await store.get("note-a"), a, "a stored record given again is replaced");
    const replaced = await store.history();
    assert.deepEqual(replaced.slice(history.length).map((entry) => [entry.recordId, entry.record]), [["note-g", g], ["note-a", a]]);

    const c = await store.get("note-c");
    await assert.rejects(store.saveAll([
      { id: "note-c", type: "note", fields: { v: "c replaced" } },
      { id: "note-h", type: "note", fields: { v: "h" } },
      { id: "note-i", type: "note", fields: { v: "i" }, validate: () => { throw new Error("note-i refused"); } },
    ]), /note-i refused/);
    assert.deepEqual(await store.get("note-c"), c, "a replacement in a refused batch is not written");
    assert.equal(await store.get("note-h"), null);
    assert.equal(await store.get("note-i"), null);
    assert.deepEqual(await store.history(), replaced, "the history is unchanged");

    await Promise.all([
      store.saveAll([
        { id: "batch-1", type: "note", fields: {} },
        { id: "batch-2", type: "note", fields: {} },
        { id: "batch-3", type: "note", fields: {} },
      ]),
      store.save({ id: "alongside", type: "note", fields: {} }),
    ]);
    const ids = (await store.history()).slice(replaced.length).map((entry) => entry.recordId);
    const at = ids.indexOf("batch-1");
    assert.deepEqual(ids.slice(at, at + 3), ["batch-1", "batch-2", "batch-3"], `one write: no other write's entry falls between the batch's (${ids.join(", ")})`);
    assert.equal(ids.length, 4);

    const beforeEmpty = await store.history();
    assert.deepEqual(await store.saveAll([]), [], "an empty batch saves nothing");
    assert.deepEqual(await store.history(), beforeEmpty);

    const many = Array.from({ length: 1000 }, (_, index) => ({ id: `bulk-${String(999 - index).padStart(4, "0")}`, type: "bulk", fields: { n: index } }));
    const bulk = await store.saveAll(many);
    assert.deepEqual(bulk.map((record) => [record.id, record.fields]), many.map((input) => [input.id, input.fields]));
    assert.deepEqual((await store.history()).slice(beforeEmpty.length).map((entry) => entry.recordId), many.map((input) => input.id), "a thousand entries in the order given");
    assert.equal((await store.list("bulk")).length, 1000);
  });
}

function writtenAt(instant: number, offsetMinutes: number): string {
  const shifted = new Date(instant + offsetMinutes * 60_000).toISOString().slice(0, -1);
  const sign = offsetMinutes < 0 ? "-" : "+";
  const hours = String(Math.floor(Math.abs(offsetMinutes) / 60)).padStart(2, "0");
  const minutes = String(Math.abs(offsetMinutes) % 60).padStart(2, "0");
  return `${shifted}${sign}${hours}:${minutes}`;
}
