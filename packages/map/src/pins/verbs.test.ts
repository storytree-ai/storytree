import assert from "node:assert/strict";
import { test } from "node:test";
import { VerbRefusal, type DoorWords, type VerbContext } from "@storytree/library/verbs";
import type { SchemaRecord } from "@storytree/library";
import { checkedAt, PIN_FAMILIES, type PinVerbContext } from "./verbs.js";
import type { PinWorld } from "./pins.js";

const WORDS: DoorWords = { door: "command", say: (step) => step.command ?? step.tool! };
const unopened = new Proxy({}, { get: (_target, name) => { throw new Error(`the library was read: ${String(name)}`); } });
const context = { folder: process.cwd(), project: "p", session: "s", library: unopened, server: unopened } as unknown as VerbContext;

test("9.1 · the pin family's new verb, its pin tool, refuses an anchor or icon it cannot read as a misuse before it reads the library", async () => {
  const [family] = PIN_FAMILIES;
  assert.deepEqual(family!.verbs.map(({ command, tool }) => ["name" in command ? command.name : undefined, "name" in tool ? tool.name : undefined]), [["new", "pin"], ["list", "pins"], ["retire", "retire_pin"]]);
  const pinNew = family!.verbs[0]!;
  for (const [input, said] of [[{ on: "somewhere", icon: "cache" }, /Name what to pin on/], [{ on: "capability_0a", icon: "rocket" }, /icon is one of cache, queue, store/]] as const) {
    const error = await pinNew.act({ label: "x", evidence: "y", commit: undefined, ...input }, context, WORDS).then(() => undefined, (thrown: unknown) => thrown);
    assert.ok(error instanceof VerbRefusal, String(error));
    assert.equal(error.misuse, true);
    assert.match(error.message, said);
  }
});

const CAPABILITY = "capability_00000000000a";
const live: PinWorld = { capability: (id) => (id === CAPABILITY ? { files: [], parts: [], root: "/checkout" } : undefined), stores: [], readText: async () => undefined };

function pinLibrary() {
  const pins = new Map<string, SchemaRecord<"pin">>();
  const writes: unknown[] = [];
  return {
    pins,
    writes,
    library: {
      list: async () => [...pins.values()],
      async recordPin(fields: SchemaRecord<"pin">["fields"], writer: unknown) {
        const record = { id: `pin_00000000000${pins.size + 1}`, type: "pin", fields: { ...fields, at: "2026-11-15T09:00:00.000Z" } } as SchemaRecord<"pin">;
        pins.set(record.id, record);
        writes.push(["record", writer]);
        return record;
      },
      get: async (id: string) => pins.get(id) ?? null,
      async retire(id: string, reason: string, writer: unknown) {
        pins.delete(id);
        writes.push(["retire", id, reason, writer]);
      },
    },
  };
}

const verbNamed = (name: string) => PIN_FAMILIES[0]!.verbs.find(({ command }) => "name" in command && command.name === name)!;

test("9.1 · pin new records the checkout's HEAD as the commit it was checked at when none is given, and says so when Git cannot", async () => {
  const head = await checkedAt(undefined, process.cwd());
  assert.match(head ?? "", /^[0-9a-f]{40}$/);
  assert.equal(await checkedAt("0123abc", process.cwd()), "0123abc");
  assert.equal(await checkedAt(undefined, "/"), undefined);

  const { library, pins, writes } = pinLibrary();
  const writer = { actor: "session:s" };
  const pinContext = { ...context, library, writer, pinWorld: async () => live } as unknown as PinVerbContext;
  const answer = await verbNamed("new").act({ on: CAPABILITY, icon: "cache", label: "LRU cache", evidence: "lru.ts:1", commit: undefined }, pinContext, WORDS);
  assert.match(answer.text, new RegExp(`checked at ${head!.slice(0, 12)}`));
  assert.equal([...pins.values()][0]!.fields.commit, head);
  assert.deepEqual(writes, [["record", writer]]);

  const elsewhere = { ...pinContext, folder: "/" } as PinVerbContext;
  const error = await verbNamed("new").act({ on: CAPABILITY, icon: "cache", label: "x", evidence: "y", commit: undefined }, elsewhere, WORDS).then(() => undefined, (thrown: unknown) => thrown);
  assert.ok(error instanceof VerbRefusal);
  assert.match(error.message, /Give the commit it was checked at/);
});

test("9.2 · pin list prints each pin's icon, label, anchor, commit and evidence, stale with why, and --stale keeps only those", async () => {
  const { library } = pinLibrary();
  const writer = { actor: "session:s" };
  let now: PinWorld = { capability: (id) => (id === CAPABILITY ? { files: ["lru.ts"], parts: [], root: "/checkout" } : undefined), stores: [], readText: async () => "export function memo() {}" };
  const pinContext = { ...context, library, writer, pinWorld: async () => now } as unknown as PinVerbContext;
  for (const on of [CAPABILITY, `${CAPABILITY}#memo`]) await verbNamed("new").act({ on, icon: "cache", label: "LRU cache", evidence: "lru.ts:1 memoises", commit: "0123abcdef0123abcdef" }, pinContext, WORDS);
  now = { ...now, readText: async () => "export function remember() {}" };
  const all = await verbNamed("list").act({ stale: false }, pinContext, WORDS);
  assert.equal(all.text, [
    "2 pins, 1 stale:",
    `pin_000000000001  [cache] LRU cache  on ${CAPABILITY}  at 0123abcdef01\n    evidence: lru.ts:1 memoises`,
    `pin_000000000002  [cache] LRU cache  on ${CAPABILITY}#memo  at 0123abcdef01  STALE: no file of ${CAPABILITY} exports memo\n    evidence: lru.ts:1 memoises`,
  ].join("\n"));
  assert.deepEqual((all.data as { pins: { id: string; stale?: string }[] }).pins.map(({ id, stale }) => [id, stale]), [["pin_000000000001", undefined], ["pin_000000000002", `no file of ${CAPABILITY} exports memo`]]);
  const stale = await verbNamed("list").act({ stale: true }, pinContext, WORDS);
  assert.match(stale.text, /^1 pin, all stale:\npin_000000000002 /);
  const none = await verbNamed("list").act({ stale: true }, { ...pinContext, library: pinLibrary().library } as unknown as PinVerbContext, WORDS);
  assert.equal(none.text, "No pin is stale.");
});

test("9.5 · pin retire retires the pin through the library with the reason and the session as writer, and refuses an id that is no live pin", async () => {
  const { library, pins, writes } = pinLibrary();
  const writer = { actor: "session:s" };
  const pinContext = { ...context, library, writer, pinWorld: async () => live } as unknown as PinVerbContext;
  await verbNamed("new").act({ on: CAPABILITY, icon: "queue", label: "Jobs", evidence: "jobs.ts:3", commit: "0123abc" }, pinContext, WORDS);
  const answer = await verbNamed("retire").act({ id: "pin_000000000001", reason: "the queue moved" }, pinContext, WORDS);
  assert.equal(answer.text, "Retired pin_000000000001: the queue moved.");
  assert.equal(pins.size, 0);
  assert.deepEqual(writes.at(-1), ["retire", "pin_000000000001", "the queue moved", writer]);
  const error = await verbNamed("retire").act({ id: "pin_000000000001", reason: "again" }, pinContext, WORDS).then(() => undefined, (thrown: unknown) => thrown);
  assert.ok(error instanceof VerbRefusal);
  assert.match(error.message, /no live pin/);
});
