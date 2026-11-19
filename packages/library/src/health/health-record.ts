// Capability 5 · Health record
import { createHash } from "node:crypto";

import { byCreation } from "../creation-order.js";
import { couldBeId, liveRecord, MissingReferenceError, recordNamed } from "../references.js";
import { FRESHNESS, type FieldsOf, type RecordType, type SchemaRecord, type SchemaRecords, type WriteOptions } from "../schema/index.js";
import type { Anchor, ArcNode, CapabilityNode, ContractNode, EdgeNode, Holds, ParkedOn, ProjectTree, StoryNode, WorkInFlight, WorkModel } from "../work/index.js";

export type HealthState = FieldsOf<"health">["state"];

export type HealthColumnName = FieldsOf<"health">["column"];

export interface HealthColumn {
  state: HealthState;
  by?: string;
  at?: string;
  note?: string;
  skip?: SkipKind;
  was?: EarlierVerdict;
  source?: HealthSource;
  tests?: string[];
  flaky?: string[];
}

export type HealthSource = NonNullable<FieldsOf<"health">["source"]>;

export type SkipKind = "owner" | "other" | `platform:${string}`;

export interface EarlierVerdict {
  state: "passing" | "failing";
  at: string;
}

export interface NodeHealth {
  reported: HealthColumn;
  verified: HealthColumn;
  ci?: HealthColumn;
}

export interface HealthOptions extends WriteOptions {
  readonly by?: string;
  readonly note?: string;
  readonly skip?: SkipKind;
  readonly was?: EarlierVerdict;
  readonly source?: HealthSource;
  readonly tests?: readonly string[];
  readonly flaky?: readonly string[];
}

export interface VerifiedVerdict {
  readonly contractId: string;
  readonly state: HealthState;
  readonly options?: HealthOptions;
}

export interface ToldTurn {
  contract: string;
  title: string;
  at: string;
  released: string[];
  investigated?: string[];
}

export interface FlakeSeen {
  readonly test: string;
  readonly story?: string;
  readonly of?: string;
  readonly contract?: string;
  readonly seen: string;
  readonly evidence: string;
  readonly found: string;
  readonly by: string;
  readonly at?: string;
}

export interface HealthEntry {
  column: HealthColumnName;
  state: HealthState;
  by?: string;
  at: string;
  note?: string;
  skip?: SkipKind;
  was?: EarlierVerdict;
  source?: HealthSource;
  tests?: string[];
  flaky?: string[];
}

export interface AnnotatedContract extends ContractNode {
  health: NodeHealth;
}

export type CapabilityStatus = "proposed" | "healthy" | "unhealthy" | "untested";

export interface AnnotatedCapability extends Omit<CapabilityNode, "contracts"> {
  contracts: AnnotatedContract[];
  health: NodeHealth;
  status: CapabilityStatus;
  why?: CapabilityWhy;
  unclaimed?: HealthColumn;
  reportOnly?: true;
  parkedOn?: ParkedOn[];
  openWork?: OpenIncrement[];
}

export interface OpenIncrement {
  increment: string;
  title: string;
  active?: true;
  waits?: OpenWait[];
}

export type OpenWait =
  | { kind: "work"; on: string; title: string; state?: "active" | "ready" }
  | { kind: "claim"; on: string; title: string }
  | { kind: "question"; on: string }
  | { kind: "owner" | "event"; note: string };

export type HealthReason = "not built" | "failing" | "not re-run" | "no test names it" | "no live reading" | "acceptance test not run" | "out of CI's reach" | "needs owner";

export interface CapabilityWhy {
  reason: HealthReason;
  mover: "agent" | "owner";
  contracts: string[];
  since?: string;
}

export interface HealthWorkItem {
  capability: string;
  title: string;
  story: string;
  status: CapabilityStatus;
  why: CapabilityWhy;
  since: string;
  waits?: PendingRun;
  contractsPass?: true;
  failure?: string;
}

export interface PendingRun {
  since: string;
  by?: string;
  note?: string;
}

export const PENDING_FOR = 90 * 60 * 1000;

export interface ChangedOnMain {
  commit: string;
  at: string;
}

export const MERGE_WAITS_FOR = 135 * 60 * 1000;

export interface NamedOnMain extends ChangedOnMain {
  contracts: readonly string[];
}

export interface AnnotatedEdge extends Omit<EdgeNode, "contracts"> {
  contracts: AnnotatedContract[];
}

export interface AnnotatedStory extends Omit<StoryNode, "capabilities" | "edges"> {
  capabilities: AnnotatedCapability[];
  edges?: AnnotatedEdge[];
  health: NodeHealth;
}

export interface AnnotatedTree {
  anchor?: Anchor;
  stories: AnnotatedStory[];
  arcs: ArcNode[];
  unverified?: true;
}

const COLUMNS: readonly HealthColumnName[] = ["reported", "verified"];

const NODE_TYPES = ["story", "capability", "contract"] as const;

const ROLLED_UP: Partial<Readonly<Record<RecordType, string>>> = {
  story: "health is recorded on contracts: a story's health is rolled up from its contracts",
  capability: "health is recorded on contracts: a capability's health is rolled up from its contracts",
};

export class HealthRecord {
  readonly #records: SchemaRecords;
  readonly #work: WorkModel;
  readonly #flight: Pick<WorkInFlight, "releaseOnVerdict" | "holds" | "createArc" | "addIncrement" | "editIncrement"> | undefined;

  constructor(records: SchemaRecords, work: WorkModel, flight?: Pick<WorkInFlight, "releaseOnVerdict" | "holds" | "createArc" | "addIncrement" | "editIncrement">) {
    this.#records = records;
    this.#work = work;
    this.#flight = flight;
  }

  reportHealth(contractId: string, state: HealthState, options: HealthOptions = {}): Promise<HealthEntry> {
    return this.#write("reported", contractId, state, options);
  }

  async recordVerified(contractId: string, state: HealthState, options: HealthOptions = {}): Promise<HealthEntry> {
    const earlier = await this.#lastVerdict(contractId);
    const entry = await this.#write("verified", contractId, state, options);
    const { by: _by, note: _note, skip: _skip, was: _was, source: _source, tests: _tests, flaky: _flaky, ...write } = options;
    await this.#tell(contractId, earlier, entry, write);
    return entry;
  }

  async recordVerifiedAll(verdicts: readonly VerifiedVerdict[], { signal }: Pick<WriteOptions, "signal"> = {}): Promise<(HealthEntry | undefined)[]> {
    const ids = verdicts.map(({ contractId }) => contractId);
    const twice = ids.find((id, index) => ids.indexOf(id) !== index);
    if (twice !== undefined) throw new RangeError(`recordVerifiedAll was given contract ${twice} twice`);
    const contracts = new Set((await this.#records.list("contract", { ids: ids.filter(couldBeId) })).map(({ id }) => id));
    for (const id of ids) if (!contracts.has(id)) await this.#contract(id);
    const earlier = new Map((await this.#records.list("health", { ids: ids.map((id) => healthId(id, "verified")) })).map(({ fields }) => [fields.node, fields.state === "not-checked" ? fields.was : fields.state]));
    const quiet = verdicts.map(({ contractId, state }) => state === "not-checked" || (state === "passing" && earlier.get(contractId) !== "failing"));
    const writes = verdicts.flatMap(({ contractId, state, options = {} }, index) => !quiet[index] ? [] : [
      this.#entry("verified", contractId, state, options, "verified"),
      ...(options.source === "ci" ? [this.#entry("verified", contractId, state, options, "ci")] : []),
    ]);
    const saved = new Map((await this.#records.createAll(writes, signal)).map((record) => [record.id, entryOf(record.fields, record.updatedAt)]));
    return verdicts.map(({ contractId }, index) => (quiet[index] ? saved.get(healthId(contractId, "verified")) : undefined));
  }

  async tellUntold(from: string, options: WriteOptions = {}): Promise<ToldTurn[]> {
    const [changes, fyis] = await Promise.all([
      this.#records.history({ types: ["health"], healthColumns: ["verified"], from }),
      this.#records.history({ types: ["fyi"], actions: ["created"], from }),
    ]);
    const told = new Set(fyis.map(({ record }) => { const { about, at, title } = this.#records.current(record).fields as FieldsOf<"fyi">; return `${about} ${at} ${title}`; }));
    const byContract = new Map<string, { seq: number; entry: HealthEntry }[]>();
    for (const change of changes) {
      const fields = this.#records.current(change.record).fields as FieldsOf<"health">;
      if (change.action === "retired" || change.recordId !== healthId(fields.node, "verified")) continue;
      byContract.set(fields.node, [...(byContract.get(fields.node) ?? []), { seq: change.seq, entry: entryOf(fields, change.at) }]);
    }
    const turns: { seq: number; turn: ToldTurn }[] = [];
    for (const [contractId, entries] of byContract) {
      const [before] = await this.#records.history({ id: healthId(contractId, "verified"), upTo: entries[0]!.seq - 1, newest: 1 });
      let earlier = before === undefined || before.action === "retired" ? undefined : verdictOf(entryOf(this.#records.current(before.record).fields as FieldsOf<"health">, before.at));
      for (const { seq, entry } of entries) {
        const turn = await this.#tell(contractId, earlier, entry, options, { asOf: seq, told });
        if (turn !== undefined) turns.push({ seq, turn });
        earlier = verdictOf(entry);
      }
    }
    return turns.sort((a, b) => a.seq - b.seq).map(({ turn }) => turn);
  }

  async #tell(contractId: string, earlier: "passing" | "failing" | undefined, entry: HealthEntry, write: WriteOptions, { asOf, told = new Set() }: { asOf?: number; told?: ReadonlySet<string> } = {}): Promise<ToldTurn | undefined> {
    const { state } = entry;
    if (state === "not-checked" || (state === "passing" && earlier !== "failing")) return undefined;
    const contract = await liveRecord(this.#records, contractId, ["contract"]);
    if (contract === null) return undefined;
    const by = [entry.by, entry.source].filter((part) => part !== undefined).join(", ");
    const fyi = { about: contractId, by: entry.by ?? "storytree", at: entry.at };
    if (state === "passing") {
      const title = `Green again: ${contract.fields.title}`;
      if (told.has(`${contractId} ${entry.at} ${title}`)) return undefined;
      await this.#records.create("fyi", { ...fyi, title, what: `${contract.fields.title} was verified passing${by === "" ? "" : ` by ${by}`} at ${entry.at}, after failing.` }, write);
      return { contract: contractId, title, at: entry.at, released: [] };
    }
    const verdict = `VERDICT ${entry.at}: ${contract.fields.title} verified failing${by === "" ? "" : ` by ${by}`}${entry.note === undefined ? "." : `: ${entry.note}.`}`;
    const investigated = await this.#investigate(contract, entry, write);
    const released = this.#flight === undefined ? [] : await this.#flight.releaseOnVerdict(contractId, contract.fields.capability, verdict, write, asOf);
    if (earlier === "failing" && released.length === 0) return undefined;
    const title = earlier === "failing" ? `Still red after a fix: ${contract.fields.title}` : `Red: ${contract.fields.title}`;
    const already = told.has(`${contractId} ${entry.at} ${title}`);
    if (already && released.length === 0) return undefined;
    if (!already) {
      const routed = (await this.#records.select("increment", ["title", "links", "capabilities"], { not: { status: "closed" } }))
        .filter(({ fields }) => fields.links?.includes(contractId) === true || (contract.fields.capability !== undefined && fields.capabilities?.includes(contract.fields.capability) === true))
        .sort(byCreation);
      const doing = routed.length === 0 ? "Being done: nothing routed, as no open increment lists its capability or links it." : `Being done: routed to ${routed.map(({ id, fields }) => `${id} (${fields.title})`).join(", ")}.`;
      const after = released.length === 0 ? "" : ` It was still failing on the run ${released.join(", ")} waited for, so that work is ready again.`;
      await this.#records.create("fyi", { ...fyi, title, what: `${verdict}${after} ${doing}` }, write);
    }
    return { contract: contractId, title, at: entry.at, released, ...(investigated.length === 0 ? {} : { investigated }) };
  }

  async #investigate(contract: SchemaRecord<"contract">, entry: HealthEntry, write: WriteOptions): Promise<string[]> {
    if (this.#flight === undefined || entry.flaky === undefined || entry.flaky.length === 0) return [];
    const capability = contract.fields.capability === undefined ? null : await liveRecord(this.#records, contract.fields.capability, ["capability"]);
    const story = capability === null ? null : await liveRecord(this.#records, capability.fields.story, ["story"]);
    const commit = /\bat commit ([0-9a-f]{7,40})\b/.exec(entry.note ?? "")?.[1];
    const seen = commit === undefined ? `the verdict of ${entry.at}` : `commit ${commit}`;
    const investigated: string[] = [];
    for (const test of entry.flaky) {
      const id = await this.investigateFlake({
        test,
        ...(story === null ? { of: contract.id } : { story: story.id }),
        contract: contract.id,
        seen,
        evidence: `${seen} (verdict ${entry.at}${entry.by === undefined ? "" : `, by ${entry.by}`}): ${contract.fields.title} failed${entry.note === undefined ? "" : `: ${entry.note}`}`,
        found: `Own health's run on main failed it where a passing CI run of the same commit passed it`,
        by: "storytree's telling of verified health",
        at: entry.at,
      }, write);
      if (id !== undefined) investigated.push(id);
    }
    return investigated;
  }

  async investigateFlake(flake: FlakeSeen, write: WriteOptions = {}): Promise<string | undefined> {
    if (this.#flight === undefined) throw new RangeError("investigating a flaky test needs work in flight");
    const { test, contract: contractId } = flake;
    const key = flake.story ?? flake.of;
    if (key === undefined) throw new RangeError("a flaky test is investigated under its story, or what stands for it (of)");
    const story = flake.story === undefined ? null : await liveRecord(this.#records, flake.story, ["story"]);
    const contract = contractId === undefined ? null : await liveRecord(this.#records, contractId, ["contract"]);
    const evidence = `- ${flake.evidence}`;
    const arcId = `arc_${createHash("sha256").update(`${key}\n${test}`).digest("hex").slice(0, 12)}`;
    if ((await liveRecord(this.#records, arcId, ["arc"])) === null) {
      try {
        await this.#flight.createArc({
          title: `The flaky test "${test}" passes reliably`,
          intent: `${flake.found}: "${test}"${story === null ? "" : ` (${story.fields.title})`} is a flaky test, which stays red where it is seen and is investigated here, one investigation for the test however often and wherever it flakes.`,
          endState: "Every investigation on it is closed: the test was fixed so it no longer flakes, or the fix that would change what it checks was put to the owner as a question on this arc.",
          ...(story === null ? {} : { stories: [story.id] }),
        }, { ...write, id: arcId, onlyIfNew: true });
      } catch (error) {
        if (error instanceof RangeError) return undefined;
        throw error;
      }
    }
    if (flake.at !== undefined && (await this.#landedAfter(arcId, flake.at))) return undefined;
    const open = (await this.#records.select("increment", ["arc"], { not: { status: "closed" } })).filter(({ fields }) => fields.arc === arcId).sort(byCreation);
    const [current] = open.length === 0 ? [] : await this.#records.list("increment", { ids: [open[0]!.id] });
    if (current !== undefined) {
      const { body } = current.fields as FieldsOf<"increment">;
      if (!body.includes(flake.seen)) await this.#flight.editIncrement(current.id, { body: `${body}\n${evidence}` }, write);
      return current.id;
    }
    const parked = await this.#flight.addIncrement({
      arc: arcId,
      title: `Find why "${test}" flakes, and fix the test`,
      objective: `Find why the test "${test}" fails now and then where a passing run of the same code passes it, and fix the test.`,
      body: [
        `Parked by ${flake.by}: ${flake.found}, a flake. The red stays where it was seen; this is the one investigation of the test, and each later flake of it, wherever it is found, is added to the evidence below.`,
        "",
        `Test: ${test}${story === null ? "" : ` (story: ${story.fields.title})`}${contract === null ? "" : `; contract: ${contract.fields.title}`}.`,
        "",
        "What to do: find why the test is flaky, and fix the test quietly when the fix is clear-cut (it waits for what it checks, it no longer depends on timing, order or a shared resource), keeping what it checks. Only when the fix would change what the test checks, raise an open question to the owner on this arc, holding this increment.",
        "",
        "Flakes seen:",
        evidence,
      ].join("\n"),
      ...(contract === null ? {} : { links: [contract.id] }),
    }, write);
    return parked.id;
  }

  async #landedAfter(arcId: string, at: string): Promise<boolean> {
    const landed = (await this.#records.select("increment", ["arc"], { where: { status: "closed", "outcome.disposition": "landed" } })).filter(({ fields }) => fields.arc === arcId);
    for (const { id } of landed) {
      let closedAt: string | undefined;
      let wasClosed = false;
      for (const change of await this.#records.history({ id })) {
        const isClosed = (this.#records.current(change.record).fields as FieldsOf<"increment">).status === "closed";
        if (isClosed && !wasClosed) closedAt = change.at;
        wasClosed = isClosed;
      }
      if (closedAt !== undefined && Date.parse(closedAt) > Date.parse(at)) return true;
    }
    return false;
  }

  async #lastVerdict(contractId: string): Promise<"passing" | "failing" | undefined> {
    if (!couldBeId(contractId)) return undefined;
    const current = await this.#records.get(healthId(contractId, "verified"));
    if (current?.type !== "health") return undefined;
    const { state, was } = current.fields as FieldsOf<"health">;
    return state === "not-checked" ? was : state;
  }

  async recordUnclaimed(capabilityId: string, state: HealthState, options: HealthOptions = {}): Promise<HealthEntry> {
    const target = await recordNamed(this.#records, capabilityId);
    if (target?.type !== "capability") throw new MissingReferenceError("node", capabilityId, "capability", target?.type);
    return this.#save("verified", capabilityId, state, options, "unclaimed");
  }

  async recordObserved(contractId: string, state: "passing" | "failing", { machine, evidence, ...write }: { machine: string; evidence: string } & WriteOptions): Promise<HealthEntry> {
    const contract = await liveRecord(this.#records, contractId, ["contract"]);
    if (contract === null) await this.#contract(contractId);
    const proof = (contract?.fields as FieldsOf<"contract"> | undefined)?.proof;
    if (proof?.by !== "observability-as-proof") throw new RangeError(`contract ${contractId} is not proved by observability as proof, so a live reading does not prove it`);
    const current = await this.#records.get(healthId(contractId, "observed"));
    const earlier = current?.type === "health" ? verdictOf(entryOf(current.fields as FieldsOf<"health">, current.updatedAt)) : undefined;
    const entry = await this.#save("verified", contractId, state, { ...write, by: proof.watcher, note: `${evidence}, taken on ${machine}`, source: "local" }, "observed");
    await this.#tell(contractId, earlier, entry, write);
    return entry;
  }

  markVerifiedPending(contractId: string, options: HealthOptions = {}): Promise<HealthEntry> {
    return this.#write("verified", contractId, "not-checked", options, "pending");
  }

  async health(nodeId: string, { now = new Date() }: { now?: Date } = {}): Promise<NodeHealth> {
    const node = await liveRecord(this.#records, nodeId, NODE_TYPES);
    if (node === null) return rolledUp([]);
    if (node.type === "contract") return ownHealth(node.id, new Map((await this.#records.list("health", { ids: (["reported", "verified", "ci", "observed"] as const).map((column) => healthId(node.id, column)) })).map((record) => [record.id, record])), (node.fields as FieldsOf<"contract">).proof, now);
    const entries = await this.#entries();
    const contracts = (await this.#contractsUnder(node)).map(({ id, fields }) => ownHealth(id, entries, fields.proof, now));
    const capabilities = node.type === "capability" ? [node.id] : (await this.#records.list("capability")).filter((capability) => capability.fields.story === node.id).map(({ id }) => id);
    return rolledUp(contracts, capabilities.flatMap((id) => counted(unclaimedOf(id, entries))));
  }

  async healthHistory(contractId: string): Promise<HealthEntry[]> {
    if (!couldBeId(contractId)) return [];
    const columns = await Promise.all(COLUMNS.map((column) => this.#records.history({ id: healthId(contractId, column) })));
    return columns
      .flat()
      .filter((change) => change.action !== "retired")
      .sort((a, b) => a.seq - b.seq)
      .map((change) => entryOf(this.#records.current(change.record).fields as FieldsOf<"health">, change.at));
  }

  async annotate(tree?: ProjectTree, parked: ReadonlyMap<string, readonly ParkedOn[]> = new Map(), now: Date = new Date()): Promise<AnnotatedTree> {
    const plan = tree ?? (await this.#work.projectTree());
    const owners = new Map(plan.stories.flatMap((story) => story.capabilities.flatMap((capability) => capability.contracts.map((contract) => [contract.id, capability.id] as const))));
    const [entries, open] = await Promise.all([this.#entries(), this.#openWork(owners)]);
    const unverified = ![...entries.values()].some(({ fields }) => fields.column === "verified");
    return {
      ...(unverified ? { unverified } : {}),
      ...(plan.anchor === undefined ? {} : { anchor: { ...plan.anchor } }),
      stories: plan.stories.map(({ edges: links, ...story }) => {
        const capabilities = story.capabilities.map((capability) => {
          const contracts = capability.contracts.map((contract) => ({ ...contract, health: ownHealth(contract.id, entries, contract.proof, now) }));
          const unclaimed = unclaimedOf(capability.id, entries);
          const own = counted(unclaimed);
          const health = rolledUp(contracts.map((contract) => contract.health), own);
          const verified = [...contracts.map((contract) => contract.health.verified.state), ...own];
          const proposed = capability.proposed && !(story.mapped !== undefined && verified.some((state) => state !== "not-checked"));
          const status = capabilityStatus(proposed, verified);
          const reportOnly = unverified && !capability.proposed;
          const explored = story.mapped !== undefined && contracts.length === 0;
          const failingOwn = own.includes("failing") ? { reason: "failing" as const, mover: "agent" as const, contracts: contracts.filter((contract) => contract.health.verified.state === "failing").map(({ id }) => id), ...(unclaimed?.at === undefined ? {} : { since: unclaimed.at }) } : undefined;
          const why = reportOnly ? undefined : failingOwn ?? (explored ? undefined : capabilityWhy(proposed, contracts.map((contract) => ({ id: contract.id, verified: contract.health.verified, ...(contract.proof === undefined ? {} : { proof: contract.proof.by }) }))));
          const parkedOn = status === "proposed" || status === "untested" ? parked.get(capability.id) : undefined;
          return { ...capability, dependsOn: [...capability.dependsOn], contracts, health, status, ...(unclaimed === undefined ? {} : { unclaimed }), ...(why === undefined ? {} : { why }), ...(reportOnly ? { reportOnly } : {}), ...(parkedOn === undefined ? {} : { parkedOn: [...parkedOn] }), ...(open.has(capability.id) ? { openWork: open.get(capability.id)!.map((one) => ({ ...one })) } : {}) };
        });
        const health = rolledUp(capabilities.flatMap((capability) => capability.contracts.map((contract) => contract.health)), capabilities.flatMap((capability) => counted(capability.unclaimed)));
        const edges = links?.map((edge) => ({ ...edge, contracts: edge.contracts.map((contract) => ({ ...contract, health: ownHealth(contract.id, entries, contract.proof, now) })) }));
        return { ...story, capabilities, ...(edges === undefined ? {} : { edges }), health };
      }),
      arcs: plan.arcs.map((arc) => ({ ...arc, stories: [...arc.stories] })),
    };
  }

  async #openWork(owners: ReadonlyMap<string, string>): Promise<Map<string, OpenIncrement[]>> {
    const increments = await this.#records.select("increment", ["title", "status", "capabilities", "links"], { not: { status: "closed" } });
    const ordered = increments.sort((a, b) => Number(b.fields.status === "active") - Number(a.fields.status === "active") || byCreation(a, b));
    const named = new Map<string, OpenIncrement[]>();
    for (const { id, fields } of ordered) {
      const linked = (fields.links ?? []).flatMap((link) => owners.get(link) ?? []);
      for (const capability of new Set([...(fields.capabilities ?? []), ...linked])) {
        const one: OpenIncrement = { increment: id, title: fields.title, ...(fields.status === "active" ? { active: true as const } : {}) };
        const list = named.get(capability);
        if (list === undefined) named.set(capability, [one]);
        else list.push(one);
      }
    }
    const holds = named.size === 0 ? undefined : await this.#flight?.holds();
    if (holds === undefined) return named;
    const said = await this.#waitsSaid(holds, increments);
    for (const [first] of named.values()) {
      const waits = said(first!.increment);
      if (waits.length > 0) first!.waits = waits;
    }
    return named;
  }

  async #waitsSaid(holds: Holds, increments: readonly { id: string; fields: { title: string; status: string } }[]): Promise<(id: string) => OpenWait[]> {
    const open = new Map(increments.map((increment) => [increment.id, increment]));
    const onArc = Object.values(holds.waits).some((held) => held.some(({ on, claim }) => !claim && !open.has(on)));
    const arcs = new Map(onArc ? (await this.#records.select("arc", ["title"])).map(({ id, fields }) => [id, fields.title]) : []);
    const holding = (id: string): boolean => (holds.waits[id]?.length ?? 0) > 0 || (holds.heldOn[id]?.length ?? 0) > 0 || (holds.waitsFor?.[id] ?? []).some((wait) => wait.holds);
    const work = (on: string): OpenWait => {
      const blocker = open.get(on);
      if (blocker === undefined) return { kind: "work", on, title: arcs.get(on) ?? on };
      const state = blocker.fields.status === "active" ? "active" : holding(on) ? undefined : "ready";
      return { kind: "work", on, title: blocker.fields.title, ...(state === undefined ? {} : { state }) };
    };
    return (id) => [
      ...(holds.waits[id] ?? []).map((hold): OpenWait => (hold.claim ? { kind: "claim", on: hold.on, title: hold.title ?? hold.on } : work(hold.on))),
      ...(holds.heldOn[id] ?? []).map((on): OpenWait => ({ kind: "question", on })),
      ...(holds.waitsFor?.[id] ?? []).filter((wait) => wait.holds).map(({ releaser, note }): OpenWait => ({ kind: releaser, note })),
    ];
  }

  async worklist({ now = new Date(), changed = new Map(), named }: { now?: Date; changed?: ReadonlyMap<string, ChangedOnMain>; named?: NamedOnMain } = {}): Promise<HealthWorkItem[]> {
    const routed = new Set([
      ...(await this.#records.list("increment")).filter(({ fields }) => fields.status !== "closed").flatMap(({ fields }) => fields.capabilities ?? []),
      ...(await this.#records.list("question")).filter(({ fields }) => fields.lifecycle === "settled").flatMap(({ fields }) => fields.unbuilt ?? []),
    ]);
    const recorded = new Map((await this.#records.list("capability")).map(({ id, createdAt }) => [id, createdAt]));
    const marks = new Map((await this.#records.list("health")).filter(({ id }) => id.endsWith(PENDING)).map((record) => [record.fields.node, record]));
    return (await this.annotate(undefined, undefined, now)).stories
      .flatMap((story) => story.capabilities.flatMap(({ id, title, status, why, contracts, unclaimed }) => {
        if (why === undefined || routed.has(id)) return [];
        const verified = new Map(contracts.map((contract) => [contract.id, contract.health.verified]));
        const carrying = why.contracts.map((id) => verified.get(id));
        const waits = waitingOn(why.contracts.map((id) => ({ mark: marks.get(id), verified: verified.get(id) })), now) ?? waitingOnMerge(changed.get(story.id), carrying, now) ?? waitingOnNamed(named, why, contracts);
        const contractsPass = status === "proposed" && contracts.length > 0 && contracts.every((contract) => contract.health.verified.state === "passing");
        const failure = why.reason === "failing" ? (carrying[0] ?? unclaimed)?.note : undefined;
        return [{ capability: id, title, story: story.id, status, why, since: why.since ?? recorded.get(id) ?? "", ...(waits === undefined ? {} : { waits }), ...(contractsPass ? { contractsPass } : {}), ...(failure === undefined ? {} : { failure }) }];
      }))
      .sort((a, b) => (a.since < b.since ? -1 : a.since > b.since ? 1 : 0));
  }

  async #write(column: HealthColumnName, contractId: string, state: HealthState, options: HealthOptions, kept: HealthColumnName | "pending" = column): Promise<HealthEntry> {
    await this.#contract(contractId);
    const entry = await this.#save(column, contractId, state, options, kept);
    if (kept === "verified" && options.source === "ci") await this.#save(column, contractId, state, options, "ci");
    return entry;
  }

  async #contract(contractId: string): Promise<void> {
    const target = await recordNamed(this.#records, contractId);
    if (target?.type !== "contract") {
      throw new MissingReferenceError("node", contractId, "contract", target?.type, target === null ? undefined : ROLLED_UP[target.type]);
    }
  }

  async #save(column: HealthColumnName, nodeId: string, state: HealthState, options: HealthOptions, kept: HealthColumnName | "pending" | "unclaimed" | "ci" | "observed"): Promise<HealthEntry> {
    const { type, fields, options: write } = this.#entry(column, nodeId, state, options, kept);
    const record = await this.#records.create(type, fields, { ...write, ...(options.signal === undefined ? {} : { signal: options.signal }) });
    return entryOf(record.fields, record.updatedAt);
  }

  #entry(column: HealthColumnName, nodeId: string, state: HealthState, options: HealthOptions, kept: HealthColumnName | "pending" | "unclaimed" | "ci" | "observed"): { type: "health"; fields: FieldsOf<"health">; options: { id: string; actor?: string } } {
    const { by, note, skip, was, source, tests, flaky } = options;
    const actor = options.actor ?? by;
    return {
      type: "health",
      fields: {
        node: nodeId,
        column,
        state,
        ...(by === undefined ? {} : { by }),
        ...(note === undefined ? {} : { note }),
        ...(skip === undefined ? {} : { skip }),
        ...(was === undefined ? {} : { was: was.state, wasAt: was.at }),
        ...(source === undefined ? {} : { source }),
        ...(tests === undefined ? {} : { tests: [...tests] }),
        ...(flaky === undefined || flaky.length === 0 ? {} : { flaky: [...flaky] }),
      },
      options: { id: healthId(nodeId, kept), ...(actor === undefined ? {} : { actor }) },
    };
  }

  async #entries(): Promise<ReadonlyMap<string, SchemaRecord<"health">>> {
    return new Map((await this.#records.list("health")).filter(({ id }) => !id.endsWith(PENDING)).map((record) => [record.id, record]));
  }

  async #contractsUnder(node: SchemaRecord<"story" | "capability">): Promise<SchemaRecord<"contract">[]> {
    const capabilities =
      node.type === "capability"
        ? new Set([node.id])
        : new Set((await this.#records.list("capability")).filter((capability) => capability.fields.story === node.id).map(({ id }) => id));
    const contracts = await this.#records.list("contract");
    return contracts.filter((contract) => contract.fields.capability !== undefined && capabilities.has(contract.fields.capability));
  }
}

function verdictOf(entry: HealthEntry): "passing" | "failing" | undefined {
  return entry.state === "not-checked" ? entry.was?.state : entry.state;
}

function healthId(contractId: string, column: HealthColumnName | "pending" | "unclaimed" | "ci" | "observed"): string {
  return `health_${contractId}_${column}`;
}

const PENDING = "_pending";

function waitingOn(carrying: readonly { mark: SchemaRecord<"health"> | undefined; verified: HealthColumn | undefined }[], now: Date): PendingRun | undefined {
  const live = carrying.flatMap(({ mark, verified }) =>
    mark !== undefined && now.getTime() - Date.parse(mark.updatedAt) < PENDING_FOR && (verified?.at === undefined || verified.at < mark.updatedAt) ? [mark] : [],
  );
  if (live.length === 0 || live.length < carrying.length) return undefined;
  const newest = live.reduce((a, b) => (b.updatedAt > a.updatedAt ? b : a));
  const { by, note } = newest.fields;
  return { since: newest.updatedAt, ...(by === undefined ? {} : { by }), ...(note === undefined ? {} : { note }) };
}

function waitingOnMerge(merged: ChangedOnMain | undefined, carrying: readonly (HealthColumn | undefined)[], now: Date): PendingRun | undefined {
  if (merged === undefined || carrying.length === 0 || now.getTime() - Date.parse(merged.at) >= MERGE_WAITS_FOR) return undefined;
  if (carrying.some((verified) => verified?.at !== undefined && Date.parse(verified.at) >= Date.parse(merged.at))) return undefined;
  return { since: merged.at, note: `commit ${merged.commit} changed its code on main; its own-health run has not recorded it yet` };
}

function waitingOnNamed(named: NamedOnMain | undefined, why: CapabilityWhy, contracts: readonly { id: string; title: string }[]): PendingRun | undefined {
  if (named === undefined || why.reason !== "no test names it" || why.contracts.length === 0 || !why.contracts.every((id) => named.contracts.includes(id))) return undefined;
  const titles = new Map(contracts.map(({ id, title }) => [id, title]));
  const numbers = why.contracts.map((id) => /^(\d+\.\d+) · /.exec(titles.get(id) ?? "")?.[1] ?? id);
  return { since: named.at, note: `a test on main (commit ${named.commit}) names ${numbers.join(", ")}; no recorded run has seen it yet` };
}

type ContractProof = NonNullable<FieldsOf<"contract">["proof"]>;

function ownHealth(contractId: string, entries: ReadonlyMap<string, SchemaRecord<"health">>, proof?: ContractProof, now: Date = new Date()): NodeHealth {
  const ci = entries.get(healthId(contractId, "ci"));
  const tested = columnOf(entries.get(healthId(contractId, "verified")));
  const observed = proof?.by === "observability-as-proof" && tested.state !== "failing";
  return {
    reported: columnOf(entries.get(healthId(contractId, "reported"))),
    verified: observed ? readingOf(entries.get(healthId(contractId, "observed")), proof.freshness, now) : tested,
    ...(ci === undefined ? {} : { ci: columnOf(ci) }),
  };
}

function readingOf(record: SchemaRecord<"health"> | undefined, freshness: string, now: Date): HealthColumn {
  const reading = columnOf(record);
  if (reading.state !== "passing" || reading.at === undefined) return reading;
  const { count, unit } = freshnessOf(freshness);
  if (now.getTime() - Date.parse(reading.at) <= count * (unit === "d" ? 86_400_000 : 3_600_000)) return reading;
  const { note, ...kept } = reading;
  return { ...kept, state: "not-checked", was: { state: "passing", at: reading.at }, note: `not re-run: its newest live reading, at ${reading.at}, is older than its freshness of ${freshnessSaid(freshness)}${note === undefined ? "" : `: ${note}`}` };
}

function freshnessOf(freshness: string): { count: number; unit: string } {
  const [, count = "0", unit = "h"] = FRESHNESS.exec(freshness) ?? [];
  return { count: Number(count), unit };
}

function freshnessSaid(freshness: string): string {
  const { count, unit } = freshnessOf(freshness);
  return `${count} ${unit === "d" ? "day" : "hour"}${count === 1 ? "" : "s"}`;
}

function columnOf(record: SchemaRecord<"health"> | undefined): HealthColumn {
  if (record === undefined) return { state: "not-checked" };
  const { column: _column, ...entry } = entryOf(record.fields, record.updatedAt);
  return entry;
}

function rolledUp(contracts: readonly NodeHealth[], own: readonly HealthState[] = []): NodeHealth {
  return {
    reported: rollUp(contracts.map((health) => health.reported.state)),
    verified: rollUp([...contracts.map((health) => health.verified.state), ...own]),
  };
}

function unclaimedOf(capabilityId: string, entries: ReadonlyMap<string, SchemaRecord<"health">>): HealthColumn | undefined {
  const record = entries.get(healthId(capabilityId, "unclaimed"));
  return record === undefined ? undefined : columnOf(record);
}

function counted(unclaimed: HealthColumn | undefined): HealthState[] {
  return unclaimed === undefined || unclaimed.state === "not-checked" ? [] : [unclaimed.state];
}

function rollUp(states: readonly HealthState[]): HealthColumn {
  if (states.includes("failing")) return { state: "failing" };
  if (states.length > 0 && states.every((state) => state === "passing")) return { state: "passing" };
  return { state: "not-checked" };
}

export function capabilityStatus(proposed: boolean, verified: readonly HealthState[]): CapabilityStatus {
  if (proposed) return "proposed";
  const { state } = rollUp(verified);
  return state === "passing" ? "healthy" : state === "failing" ? "unhealthy" : "untested";
}

export function capabilityWhy(proposed: boolean, contracts: readonly { id: string; verified: HealthColumn; proof?: ContractProof["by"] }[]): CapabilityWhy | undefined {
  if (proposed) return { reason: "not built", mover: "agent", contracts: [] };
  if (contracts.length === 0) return { reason: "no test names it", mover: "agent", contracts: [] };
  const reasons = contracts.map((contract) => ({ ...contract, reason: contractReason(contract.verified, contract.proof) }));
  const reason = RANKED.find((candidate) => reasons.some((contract) => contract.reason === candidate));
  if (reason === undefined) return undefined;
  const carrying = reasons.filter((contract) => contract.reason === reason);
  const since = carrying.flatMap(({ verified }) => (verified.at === undefined ? [] : [verified.at])).sort()[0];
  return { reason, mover: reason === "needs owner" ? "owner" : "agent", contracts: carrying.map(({ id }) => id), ...(since === undefined ? {} : { since }) };
}

export function wordAndWhy(capability: Pick<AnnotatedCapability, "status" | "why" | "contracts" | "health" | "reportOnly">): string {
  const { status, why } = capability;
  if (capability.reportOnly) return `the agent ${REPORTS[capability.health.reported.state]}; ${NOT_VERIFIED}`;
  if (why === undefined) return status;
  const titles = new Map(capability.contracts.map((contract) => [contract.id, contract.title]));
  const named = why.contracts.map((id) => /^(\d+\.\d+) · /.exec(titles.get(id) ?? "")?.[1] ?? id);
  return `${status} — ${why.reason}, the ${why.mover}'s to move${named.length === 0 ? "" : `: ${named.join(", ")}`}`;
}

export function heldBack(items: readonly HealthWorkItem[]): string | undefined {
  const runs = items.flatMap(({ waits }) => (waits === undefined ? [] : [waits]));
  if (runs.length === 0) return undefined;
  const newest = runs.reduce((a, b) => (b.since > a.since ? b : a));
  return `${runs.length} held back until a test run records them: ${newest.note ?? newest.by ?? "a run"}, since ${newest.since.slice(0, 16).replace("T", " ")}.`;
}

export const NOT_VERIFIED = "storytree does not check this project's tests yet";

const REPORTS: Readonly<Record<HealthState, string>> = { passing: "reports passing", failing: "reports failing", "not-checked": "has reported nothing yet" };

const RANKED: readonly HealthReason[] = ["failing", "not re-run", "no test names it", "no live reading", "acceptance test not run", "out of CI's reach", "needs owner"];

function contractReason(verified: HealthColumn, proof: ContractProof["by"] | undefined): HealthReason | undefined {
  if (verified.state === "passing") return undefined;
  if (verified.state === "failing") return "failing";
  if (verified.skip === "owner") return "needs owner";
  if (verified.skip?.startsWith("platform:")) return "out of CI's reach";
  if (verified.skip !== undefined || verified.was !== undefined) return "not re-run";
  if (proof === "observability-as-proof") return "no live reading";
  return proof === "agentic-user-acceptance-testing" ? "acceptance test not run" : "no test names it";
}

function entryOf(fields: FieldsOf<"health">, at: string): HealthEntry {
  const { column, state, by, note, skip, was, wasAt, source, tests, flaky } = fields;
  return {
    column,
    state,
    ...(by === undefined ? {} : { by }),
    at,
    ...(note === undefined ? {} : { note }),
    ...(skip === undefined ? {} : { skip: skip as SkipKind }),
    ...(was === undefined || wasAt === undefined ? {} : { was: { state: was, at: wasAt } }),
    ...(source === undefined ? {} : { source }),
    ...(tests === undefined ? {} : { tests }),
    ...(flaky === undefined ? {} : { flaky }),
  };
}
