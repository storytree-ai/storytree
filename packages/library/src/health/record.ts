// Capability 5 · Health record
import type { ProjectTree, WorkModel } from "../plan/index.js";
import { liveRecord, MissingReferenceError, referTo, unstorable, type SchemaRecord, type SchemaRecords, type WriteOptions } from "../storage/rules/index.js";
import type { HistoryEntry } from "../storage/store/index.js";
import type { ParkedOn } from "../work/arcs/index.js";
import {
  contractHealth,
  entryOf,
  healthFields,
  keptVerdict,
  readHealth,
  sideId,
  sideOf,
  turnOf,
  unchecked,
  verdictEntries,
  type HealthFields,
  type Reading,
} from "./reading.js";
import { headingOf, Teller, type Flight } from "./telling.js";
import { annotateTree, inside, rolledHealth, unclaimedOf } from "./tree.js";
import type {
  AnnotatedTree,
  ChangedOnMain,
  FlakeSeen,
  HealthColumn,
  HealthColumnName,
  HealthEntry,
  HealthOptions,
  HealthState,
  HealthWorkItem,
  NamedOnMain,
  NodeHealth,
  OpenWait,
  PendingRun,
  ToldTurn,
  VerifiedVerdict,
} from "./types.js";

const PENDING_LIMIT = 90 * 60_000;
const MERGE_LIMIT = 150 * 60_000;

interface Saved {
  readonly entry: HealthEntry;
  readonly seq: number;
  readonly earlier: readonly HistoryEntry[];
}

export class HealthRecord {
  readonly #records: SchemaRecords;
  readonly #work: WorkModel;
  readonly #flight: Flight | undefined;
  readonly #teller: Teller;

  constructor(records: SchemaRecords, work: WorkModel, flight?: Flight) {
    this.#records = records;
    this.#work = work;
    this.#flight = flight;
    this.#teller = new Teller(records, flight);
  }

  async reportHealth(contractId: string, state: HealthState, options: HealthOptions = {}): Promise<HealthEntry> {
    await this.#contract(contractId);
    const fields = this.#checked(contractId, "reported", state, options);
    return (await this.#records.inOneWrite(() => this.#saveMain(fields, options), options.signal)).entry;
  }

  async recordVerified(contractId: string, state: HealthState, options: HealthOptions = {}): Promise<HealthEntry> {
    const contract = await this.#contract(contractId);
    const fields = this.#checked(contractId, "verified", state, options);
    const saved = await this.#records.inOneWrite(async () => {
      const main = await this.#saveMain(fields, options);
      if (fields.source === "ci") await this.#records.create("health", fields, { id: sideId("ci", contractId), ...actorOf(options) });
      return main;
    }, options.signal);
    await this.#teller.act(contract, saved.entry, turnOf(keptVerdict(saved.earlier), state), { told: false, investigate: true }, options);
    return saved.entry;
  }

  async recordVerifiedAll(verdicts: readonly VerifiedVerdict[], { signal }: Pick<WriteOptions, "signal"> = {}): Promise<(HealthEntry | undefined)[]> {
    const shaped = verdicts.map(({ contractId, state, options = {} }) => ({ fields: this.#checked(contractId, "verified", state, options), options }));
    const ids = verdicts.map(({ contractId }) => contractId);
    if (new Set(ids).size !== ids.length) throw new RangeError("recordVerifiedAll takes each contract once");
    if (verdicts.length === 0) return [];
    return await this.#records.inOneWrite(async () => {
      const storable = ids.filter((id) => unstorable(id) === undefined);
      const live = new Map((storable.length === 0 ? [] : await this.#records.list("contract", { ids: storable })).map((contract) => [contract.id, contract]));
      const refused = ids.find((id) => !live.has(id));
      if (refused !== undefined) throw new MissingReferenceError("node", refused, "contract");
      const reading = await readHealth(this.#records);
      const kept = new Map([...verdictEntries(reading).values()].map((entries) => [(entries[0]!.record.fields as HealthFields).node, keptVerdict(entries)]));
      let open: SchemaRecord<"increment">[] | undefined;
      const tells = async ({ fields }: (typeof shaped)[number]): Promise<boolean> => {
        const turn = turnOf(kept.get(fields.node), fields.state);
        if (turn === "red" || turn === "green" || (fields.state === "failing" && (fields.flaky ?? []).length > 0)) return true;
        if (turn !== "still" || this.#flight === undefined) return false;
        open ??= await this.#open();
        const capability = live.get(fields.node)?.fields.capability;
        return open.some(({ fields: increment }) => (increment.waitsFor ?? []).some(({ releaser }) => releaser === "event")
          && ((increment.links ?? []).includes(fields.node) || (capability !== undefined && (increment.capabilities ?? []).includes(capability))));
      };
      const written: number[] = [];
      for (const [index, verdict] of shaped.entries()) if (!(await tells(verdict))) written.push(index);
      if (written.length === 0) return verdicts.map(() => undefined);
      const batch = written.flatMap((index) => {
        const { fields, options } = shaped[index]!;
        const id = reading.verified.get(fields.node)?.id;
        const main = { type: "health" as const, fields, options: { ...(id === undefined ? {} : { id }), ...actorOf(options) } };
        return fields.source === "ci" ? [main, { type: "health" as const, fields, options: { id: sideId("ci", fields.node), ...actorOf(options) } }] : [main];
      });
      const saved = await this.#records.createAll(batch);
      const at = new Map((await this.#records.history({ types: ["health"], newest: saved.length })).map((entry) => [entry.recordId, entry.at]));
      const entries = new Map<number, HealthEntry>();
      let position = 0;
      for (const index of written) {
        const { fields } = shaped[index]!;
        entries.set(index, entryOf({ fields, at: at.get(saved[position]!.id)! }));
        position += fields.source === "ci" ? 2 : 1;
      }
      return verdicts.map((_, index) => entries.get(index));
    }, signal);
  }

  async tellUntold(from: string, options: WriteOptions = {}): Promise<ToldTurn[]> {
    const reading = await readHealth(this.#records);
    const contracts = new Map((await this.#records.list("contract")).map((contract) => [contract.id, contract]));
    const told = new Set((await this.#records.list("fyi")).map(({ fields }) => `${fields.about} ${fields.at} ${fields.title}`));
    const since = Date.parse(from);
    const candidates: { contract: SchemaRecord<"contract">; entry: HistoryEntry; turn: NonNullable<ReturnType<typeof turnOf>> }[] = [];
    for (const entries of verdictEntries(reading).values()) {
      for (const [index, entry] of entries.entries()) {
        const fields = entry.record.fields as HealthFields;
        const contract = contracts.get(fields.node);
        const turn = turnOf(keptVerdict(entries.slice(0, index)), fields.state);
        if (contract !== undefined && turn !== undefined && Date.parse(entry.at) >= since) candidates.push({ contract, entry, turn });
      }
    }
    const turns: ToldTurn[] = [];
    for (const { contract, entry, turn } of candidates.sort((a, b) => a.entry.seq - b.entry.seq)) {
      const verdict = entryOf({ fields: this.#records.current(entry.record).fields as HealthFields, at: entry.at });
      const wasTold = told.has(`${contract.id} ${entry.at} ${headingOf(turn, contract.fields.title)}`);
      const done = await this.#teller.act(contract, verdict, turn, { asOf: entry.seq, told: wasTold, investigate: !wasTold && turn === "red" }, options);
      if (!done.told && done.released.length === 0 && done.investigated.length === 0) continue;
      turns.push({ contract: contract.id, title: contract.fields.title, at: entry.at, released: done.released, ...(done.investigated.length === 0 ? {} : { investigated: done.investigated }) });
    }
    return turns;
  }

  async investigateFlake(flake: FlakeSeen, write: WriteOptions = {}): Promise<string | undefined> {
    return await this.#teller.investigateFlake(flake, write);
  }

  async recordUnclaimed(capabilityId: string, state: HealthState, options: HealthOptions = {}): Promise<HealthEntry> {
    await referTo(this.#records, "node", capabilityId, "capability");
    const fields = this.#checked(capabilityId, "verified", state, options);
    return (await this.#records.inOneWrite(() => this.#saveMain(fields, options), options.signal)).entry;
  }

  async recordObserved(contractId: string, state: "passing" | "failing", { machine, evidence, ...write }: { machine: string; evidence: string } & WriteOptions): Promise<HealthEntry> {
    const contract = await this.#contract(contractId);
    const proof = contract.fields.proof;
    if (proof?.by !== "observability-as-proof") throw new RangeError(`${contractId} is not proved by observability as proof, so it takes no live reading`);
    const options = { ...write, by: proof.watcher, note: `${evidence}, taken on ${machine}`, source: "local" as const };
    const fields = this.#checked(contractId, "verified", state, options);
    const saved = await this.#records.inOneWrite(() => this.#saveAt(sideId("observed", contractId), fields, options), write.signal);
    await this.#teller.act(contract, saved.entry, turnOf(keptVerdict(saved.earlier), state), { told: false, investigate: false }, write);
    return saved.entry;
  }

  async markVerifiedPending(contractId: string, options: HealthOptions = {}): Promise<HealthEntry> {
    await this.#contract(contractId);
    const fields = this.#checked(contractId, "verified", "not-checked", options);
    return (await this.#records.inOneWrite(() => this.#saveAt(sideId("pending", contractId), fields, options), options.signal)).entry;
  }

  async health(nodeId: string, { now = new Date() }: { now?: Date } = {}): Promise<NodeHealth> {
    const record = await liveRecord(this.#records, nodeId);
    if (record === null || !["contract", "capability", "story"].includes(record.type)) return unchecked();
    const reading = await readHealth(this.#records);
    if (record.type === "contract") return contractHealth(reading, { id: record.id, proof: record.fields.proof }, now);
    const capabilities = (await this.#records.list("capability")).map(({ id, fields }) => ({ id, story: fields.story, parent: fields.parent }));
    const held = record.type === "story" ? capabilities.filter(({ story }) => story === record.id) : [{ id: record.id }, ...inside(record.id, capabilities)];
    const ids = new Set(held.map(({ id }) => id));
    const contracts = (await this.#records.list("contract")).filter(({ fields }) => fields.capability !== undefined && ids.has(fields.capability));
    return rolledHealth(contracts.map(({ id, fields }) => ({ health: contractHealth(reading, { id, proof: fields.proof }, now) })), held.map(({ id }) => unclaimedOf(reading, id)));
  }

  async healthHistory(contractId: string): Promise<HealthEntry[]> {
    const { entries } = await readHealth(this.#records);
    return entries
      .filter((entry) => entry.action !== "retired" && sideOf(entry.recordId) === undefined && entry.record.fields["node"] === contractId)
      .map((entry) => entryOf({ fields: this.#records.current(entry.record).fields as HealthFields, at: entry.at }));
  }

  async annotate(tree?: ProjectTree, parked?: ReadonlyMap<string, readonly ParkedOn[]>, now: Date = new Date()): Promise<AnnotatedTree> {
    return (await this.#annotated(tree, parked, now)).tree;
  }

  async worklist({ now = new Date(), changed, named }: { now?: Date; changed?: ReadonlyMap<string, ChangedOnMain>; named?: NamedOnMain } = {}): Promise<HealthWorkItem[]> {
    const { tree, reading, open } = await this.#annotated(undefined, undefined, now);
    const routed = new Set(open.flatMap(({ fields }) => fields.capabilities ?? []));
    for (const question of await this.#records.list("question")) if (question.fields.lifecycle === "settled") for (const id of question.fields.unbuilt ?? []) routed.add(id);
    const created = new Map((await this.#records.list("capability")).map(({ id, createdAt }) => [id, createdAt]));
    const contracts = new Map(tree.stories.flatMap((story) => story.capabilities.flatMap(({ contracts: own }) => own.map((contract) => [contract.id, contract] as const))));
    const items: HealthWorkItem[] = [];
    for (const story of tree.stories) {
      for (const capability of story.capabilities) {
        const why = capability.why;
        if (why === undefined || routed.has(capability.id)) continue;
        const carrying = why.contracts.map((id) => ({ id, title: contracts.get(id)?.title ?? id, verified: contracts.get(id)?.health.verified ?? { state: "not-checked" as const } }));
        const waits = heldBy(why.reason, carrying, story.id, reading, now, changed, named);
        const contractsPass = capability.status === "proposed" && capability.contracts.length > 0 && capability.contracts.every(({ health }) => health.verified.state === "passing");
        const failure = why.reason !== "failing" ? undefined : carrying[0] === undefined ? capability.unclaimed?.note : carrying[0].verified.note;
        items.push({
          capability: capability.id,
          title: capability.title,
          story: story.id,
          status: capability.status,
          why,
          since: why.since ?? created.get(capability.id) ?? now.toISOString(),
          ...(waits === undefined ? {} : { waits }),
          ...(contractsPass ? { contractsPass: true as const } : {}),
          ...(failure === undefined ? {} : { failure }),
        });
      }
    }
    return items.sort((a, b) => (a.since < b.since ? -1 : a.since > b.since ? 1 : 0));
  }

  async #annotated(tree: ProjectTree | undefined, parked: ReadonlyMap<string, readonly ParkedOn[]> | undefined, now: Date): Promise<{ tree: AnnotatedTree; reading: Reading; open: SchemaRecord<"increment">[] }> {
    const given = tree ?? (await this.#work.projectTree());
    const reading = await readHealth(this.#records);
    const open = await this.#open();
    const waitsOf = await this.#waits(open, now);
    return { tree: annotateTree({ tree: given, reading, now, parked, open, waitsOf }), reading, open };
  }

  async #open(): Promise<SchemaRecord<"increment">[]> {
    const order = (increment: SchemaRecord<"increment">): string => `${increment.fields.status === "active" ? 0 : 1} ${increment.fields.parked ?? increment.createdAt} ${increment.id}`;
    return (await this.#records.list("increment")).filter(({ fields }) => fields.status !== "closed").sort((a, b) => (order(a) < order(b) ? -1 : 1));
  }

  async #waits(open: readonly SchemaRecord<"increment">[], now: Date): Promise<(increment: string) => OpenWait[]> {
    if (this.#flight === undefined) return () => [];
    const holds = await this.#flight.holds(now);
    const blockers = new Map<string, SchemaRecord>();
    for (const id of new Set(open.flatMap(({ id }) => (holds.waits[id] ?? []).filter(({ claim }) => claim !== true).map(({ on }) => on)))) {
      const blocker = await this.#records.get(id);
      if (blocker !== null) blockers.set(id, blocker);
    }
    const free = (id: string): boolean => (holds.waits[id] ?? []).length === 0 && (holds.heldOn[id] ?? []).length === 0 && !(holds.waitsFor?.[id] ?? []).some(({ holds: holding }) => holding);
    return (id) => [
      ...(holds.waits[id] ?? []).flatMap((hold): OpenWait[] => {
        if (hold.claim === true) return [{ kind: "claim", on: hold.on, title: hold.title ?? hold.on }];
        const blocker = blockers.get(hold.on);
        if (blocker === undefined) return [];
        const title = String((blocker.fields as { title?: unknown }).title ?? hold.on);
        if (blocker.type !== "increment") return [{ kind: "work", on: hold.on, title }];
        const state = blocker.fields.status === "active" ? "active" : blocker.fields.status !== "closed" && free(hold.on) ? "ready" : undefined;
        return [{ kind: "work", on: hold.on, title, ...(state === undefined ? {} : { state }) }];
      }),
      ...(holds.heldOn[id] ?? []).map((on): OpenWait => ({ kind: "question", on })),
      ...(holds.waitsFor?.[id] ?? []).filter(({ holds: holding }) => holding).map((wait): OpenWait => ({ kind: wait.releaser, note: wait.note })),
    ];
  }

  #checked(node: string, column: HealthColumnName, state: HealthState, options: HealthOptions): HealthFields {
    const fields = healthFields(node, column, state, options);
    this.#records.check("health", fields);
    return fields;
  }

  async #contract(id: string): Promise<SchemaRecord<"contract">> {
    const record = await liveRecord(this.#records, id);
    if (record?.type === "contract") return record;
    const rolled = record?.type === "story" || record?.type === "capability" ? `a ${record.type}'s health is rolled up from its contracts` : undefined;
    throw new MissingReferenceError("node", id, "contract", record?.type, rolled);
  }

  async #saveMain(fields: HealthFields, options: HealthOptions): Promise<Saved> {
    const existing = (await this.#records.list("health", { where: { node: fields.node, column: fields.column } })).find(({ id }) => sideOf(id) === undefined);
    return await this.#saveAt(existing?.id ?? `health_${fields.node}_${fields.column}`, fields, options);
  }

  async #saveAt(id: string | undefined, fields: HealthFields, options: HealthOptions): Promise<Saved> {
    const saved = await this.#records.create("health", fields, { ...(id === undefined ? {} : { id }), ...actorOf(options) });
    const entries = await this.#records.history({ id: saved.id });
    const last = entries.at(-1)!;
    return { entry: entryOf({ fields, at: last.at }), seq: last.seq, earlier: entries.slice(0, -1) };
  }
}

function actorOf(options: HealthOptions): { actor?: string } {
  const actor = options.actor ?? options.by;
  return actor === undefined ? {} : { actor };
}

function heldBy(
  reason: string,
  carrying: readonly { readonly id: string; readonly title: string; readonly verified: HealthColumn }[],
  story: string,
  reading: Reading,
  now: Date,
  changed: ReadonlyMap<string, ChangedOnMain> | undefined,
  named: NamedOnMain | undefined,
): PendingRun | undefined {
  if (carrying.length === 0) return undefined;
  const recorded = (id: string): string => reading.verified.get(id)?.at ?? "";
  const marks = carrying.map(({ id }) => reading.pending.get(id));
  if (marks.every((mark, index) => mark !== undefined && mark.at > recorded(carrying[index]!.id) && now.getTime() - Date.parse(mark.at) < PENDING_LIMIT)) {
    const newest = marks.map((mark) => mark!).sort((a, b) => (a.at < b.at ? -1 : 1)).at(-1)!;
    return { since: newest.at, ...(newest.fields.by === undefined ? {} : { by: newest.fields.by }), ...(newest.fields.note === undefined ? {} : { note: newest.fields.note }) };
  }
  const change = changed?.get(story);
  if (change !== undefined && now.getTime() - Date.parse(change.at) < MERGE_LIMIT && carrying.every(({ id }) => recorded(id) < change.at)) {
    return { since: change.at, note: `its story's code changed on main at commit ${change.commit} after these contracts were last verified: it waits on that commit's own-health run` };
  }
  if (named !== undefined && reason === "no test names it" && carrying.every(({ id }) => named.contracts.includes(id))) {
    const numbers = carrying.map(({ id, title }) => /^(\d+\.\d+) · /.exec(title)?.[1] ?? id);
    return { since: named.at, note: `a test on main at commit ${named.commit} names ${numbers.join(", ")}, with no recorded run yet` };
  }
  return undefined;
}
