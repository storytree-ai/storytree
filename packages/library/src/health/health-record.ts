/**
 * Capability 5 · Health record (the library story): every story, capability and contract has a
 * health record with two separate columns, what the agent REPORTED and what storytree VERIFIED by
 * seeing it for itself, each `passing`, `failing` or `not-checked`. A missing entry always reads
 * as `not-checked`, never as `passing`.
 *
 * Health is RECORDED on contracts and DERIVED for capabilities and stories, rolled up from their
 * contracts column by column. HealthRecord is a layer over capability 3's SchemaRecords and
 * capability 4's WorkModel, so it runs unchanged on the in-memory twin and on Postgres.
 *
 * Each of a contract's two columns is ONE `health` record, under an id made from the contract's
 * id and the column (`health_<contractId>_reported`, `health_<contractId>_verified`). A new entry
 * is a save of that record, replacing it whole, so the record is always the column's latest entry
 * and capability 2's append-only history holds every entry it ever had: who wrote it (`by`, and
 * the change's actor), when, and its note.
 */
import { byCreation } from "../creation-order.js";
import { couldBeId, liveRecord, MissingReferenceError, recordNamed } from "../references.js";
import type { SchemaRecord, SchemaRecords, WriteOptions } from "../schema/index.js";
import type { CONTRACT_PROOFS, FieldsOf, RecordType } from "../schema/types.js";
import type { Anchor, ArcNode, CapabilityNode, ContractNode, EdgeNode, Holds, ParkedOn, ProjectTree, StoryNode, WorkInFlight, WorkModel } from "../work/index.js";

/** A column's state. A column with no entry reads `not-checked`, never `passing`. */
export type HealthState = FieldsOf<"health">["state"];

/** The two columns: what the agent `reported`, and what storytree `verified` by seeing it for itself. */
export type HealthColumnName = FieldsOf<"health">["column"];

/** One column of a node's health as it stands now. */
export interface HealthColumn {
  state: HealthState;
  /** Who wrote the entry: on a contract's column only, and only when the writer said. */
  by?: string;
  /** When the entry was written, as an ISO 8601 timestamp: on a contract's column only, once it has an entry. */
  at?: string;
  /** The note written with the entry: on a contract's column only, and only when there is one. */
  note?: string;
  /** The kind of skip that left it not checked, when a skip did (ADR-0825 D2). */
  skip?: SkipKind;
  /** The earlier verdict it did not reproduce, and when that was written: it is "not re-run". */
  was?: EarlierVerdict;
  /** Where the verdict was seen, when the writer said: verified locally, or read from CI (ADR-1193 D3). */
  source?: HealthSource;
  /** The names of the tests whose results made the verdict, when the writer said. */
  tests?: string[];
}

/** Where a verdict was seen: by a run on this computer through storytree, or read from CI. */
export type HealthSource = NonNullable<FieldsOf<"health">["source"]>;

/** Why a test was skipped, by who can run it: the owner, a run on another platform, or anyone. */
export type SkipKind = "owner" | "other" | `platform:${string}`;

/** A verdict an entry did not reproduce. */
export interface EarlierVerdict {
  state: "passing" | "failing";
  at: string;
}

/** A node's health: the two columns, side by side. */
export interface NodeHealth {
  reported: HealthColumn;
  verified: HealthColumn;
  /**
   * A contract's newest verified entry read from CI, kept beside its newest verified entry of any source, so a later local
   * run never replaces it (question_32b645261409: the map's gear takes CI's over local); absent where CI never read it.
   */
  ci?: HealthColumn;
}

/**
 * The health reporter and a note to keep with the entry. An explicit actor identifies the writer
 * in history; when omitted, the reporter (`by`) remains the actor as before.
 */
export interface HealthOptions extends WriteOptions {
  readonly by?: string;
  readonly note?: string;
  readonly skip?: SkipKind;
  readonly was?: EarlierVerdict;
  readonly source?: HealthSource;
  readonly tests?: readonly string[];
}

/** One verdict for recordVerifiedAll: what recordVerified takes for one contract. */
export interface VerifiedVerdict {
  readonly contractId: string;
  readonly state: HealthState;
  readonly options?: HealthOptions;
}

/** A verdict's turn told after it was written (5.24): the contract, the FYI's title, the verdict's time and the work it released. */
export interface ToldTurn {
  contract: string;
  title: string;
  at: string;
  released: string[];
}

/** One health entry, as it was written. */
export interface HealthEntry {
  column: HealthColumnName;
  state: HealthState;
  /** Who wrote it, when the writer said. */
  by?: string;
  /** When it was written, as an ISO 8601 timestamp. */
  at: string;
  /** The note written with it, when there is one. */
  note?: string;
  /** The kind of skip that left it not checked, when one did. */
  skip?: SkipKind;
  /** The earlier verdict it did not reproduce, when there was one. */
  was?: EarlierVerdict;
  /** Where it was seen, when the writer said. */
  source?: HealthSource;
  /** The tests that judged it, when the writer said. */
  tests?: string[];
}

/** A contract in the annotated tree, with its own health. */
export interface AnnotatedContract extends ContractNode {
  health: NodeHealth;
}

/**
 * A capability's word, as its card says it (ADR-0744): `proposed` while its flag is on (on a mapped
 * story, only until a verified result is tied to it, ADR-1274); once the agent switches it off, `healthy` when every contract is verified passing, `unhealthy` when any
 * is verified failing, and `untested` otherwise. Only storytree's verified column counts.
 */
export type CapabilityStatus = "proposed" | "healthy" | "unhealthy" | "untested";

/** A capability in the annotated tree, with its health rolled up from its contracts, and its word. */
export interface AnnotatedCapability extends Omit<CapabilityNode, "contracts"> {
  contracts: AnnotatedContract[];
  health: NodeHealth;
  status: CapabilityStatus;
  /** Why it is not healthy, and who moves it; absent when it is healthy (ADR-0825 D1), and when it is report-only. */
  why?: CapabilityWhy;
  /** The reading of the tests that reached its covered files and no contract claims (ADR-1274 D3), when a run recorded one. */
  unclaimed?: HealthColumn;
  /**
   * Built, in a project whose health nothing verifies (ADR-0630: any user's project in the MVP): what
   * the agent reports is all there is to show, labelled as the agent's, and no agent can move its word.
   */
  reportOnly?: true;
  /**
   * The arcs that park it, when it is not proven (proposed or untested) and parked on purpose (ADR-0992):
   * the map fills it grey and its card names them. Its word is unchanged; absent otherwise.
   */
  parkedOn?: ParkedOn[];
  /** The open increments naming it (ADR-1253 D1), in the order its panel reads them; absent when none does. */
  openWork?: OpenIncrement[];
}

/** An open increment naming a capability, by id and title, marked when it is active (claimed and under way), with what still holds it. */
export interface OpenIncrement {
  increment: string;
  title: string;
  active?: true;
  /** What still holds it, in the order the library reads them (5.28), said only of a capability's first open increment, the one that moves it; absent when nothing does. */
  waits?: OpenWait[];
}

/**
 * One thing still holding an open increment (5.28): other work, by its title, `active` when it is an increment under way
 * and `ready` when it is one nobody started that nothing holds; a capability's claim, by the capability's title; an
 * owner's question; or a wait for the owner or an outside event, with its note.
 */
export type OpenWait =
  | { kind: "work"; on: string; title: string; state?: "active" | "ready" }
  | { kind: "claim"; on: string; title: string }
  | { kind: "question"; on: string }
  | { kind: "owner" | "event"; note: string };

/**
 * Why a capability is not healthy (ADR-0825 D1), from a closed set: `not built` while it is
 * proposed; otherwise from its contracts' verified columns. Only `needs owner` is the owner's.
 */
export type HealthReason = "not built" | "failing" | "not re-run" | "no test names it" | "acceptance test not run" | "out of CI's reach" | "needs owner";

/** A capability's reason, who moves it, the contracts that carry it, and since when, where a time was recorded. */
export interface CapabilityWhy {
  reason: HealthReason;
  mover: "agent" | "owner";
  /** The ids of its contracts carrying the reason, in the capability's order. */
  contracts: string[];
  /** The earliest time one of them was recorded so; absent when none was ever recorded. */
  since?: string;
}

/** One capability on the health worklist (ADR-0825 D4): what is not healthy, why, who moves it, and since when. */
export interface HealthWorkItem {
  capability: string;
  title: string;
  /** The story it is in. */
  story: string;
  status: CapabilityStatus;
  why: CapabilityWhy;
  /** The reason's time where one was recorded (`why.since`), else when the capability was recorded. */
  since: string;
  /**
   * The run it waits on, so it is not offered: present when every contract carrying its reason has a
   * pending mark (markVerifiedPending) newer than its verified entry and within PENDING_FOR, or else
   * when its story's code changed on main after every one was last verified, within MERGE_WAITS_FOR,
   * or else when its reason is `no test names it` and a test on main names every one: a run has yet to record it.
   */
  waits?: PendingRun;
  /**
   * Present on a proposed one with at least one contract and every contract verified passing: its
   * tests already pass and only its proposed flag is left (friction_fd6154bff0be). Its reason stays `not built`.
   */
  contractsPass?: true;
  /**
   * Present when its reason is `failing` and the first contract carrying it has a verified note: that note, which a test
   * run writes with the first failure's message (friction_b8ae83aa48e5), so the item says why it failed.
   */
  failure?: string;
}

/** A test run in progress that will record a contract's verified column: when it said so, who, and its note. */
export interface PendingRun {
  since: string;
  by?: string;
  note?: string;
}

/**
 * How long a pending mark holds: the Own health job's own time limit (.github/workflows/own-health.yml's
 * 90 minutes), so a run that died without recording holds nothing after it.
 */
export const PENDING_FOR = 90 * 60 * 1000;

/** The newest commit on main that changed a story's code, and when it was committed (an ISO 8601 timestamp). */
export interface ChangedOnMain {
  commit: string;
  at: string;
}

/**
 * How long a commit to main holds back its story's capabilities before its own-health run records
 * them: CI's 35 minutes (.github/workflows/ci.yml), then the Own health job's 5 and 90, plus the 5 its
 * automerge may take to start it. A run that failed or never started holds nothing after it.
 */
export const MERGE_WAITS_FOR = 135 * 60 * 1000;

/** Fetched origin/main's newest commit, when it was committed, and the contracts its tests name by number. */
export interface NamedOnMain extends ChangedOnMain {
  /** The ids of the contracts a numbered test title in their story's package on main names. */
  contracts: readonly string[];
}

/** An edge in the annotated tree, its contracts each with its own health (ADR-1284 D4); they roll into no capability's or story's. */
export interface AnnotatedEdge extends Omit<EdgeNode, "contracts"> {
  contracts: AnnotatedContract[];
}

/** A story in the annotated tree, with its health rolled up from all its capabilities' contracts, and its edges' contracts' own. */
export interface AnnotatedStory extends Omit<StoryNode, "capabilities" | "edges"> {
  capabilities: AnnotatedCapability[];
  edges?: AnnotatedEdge[];
  health: NodeHealth;
}

/** WorkModel.projectTree()'s tree with every story, capability and contract's health added. */
export interface AnnotatedTree {
  /** The project's sentence, when any of it is written (ADR-1085 D1). */
  anchor?: Anchor;
  stories: AnnotatedStory[];
  arcs: ArcNode[];
  /** Present when nothing verifies this project's health: no verified entry exists anywhere in it (ADR-0630). */
  unverified?: true;
}

/** The columns, in the order a node's health shows them. */
const COLUMNS: readonly HealthColumnName[] = ["reported", "verified"];

/** The records that have health: stories and capabilities derive theirs, contracts record theirs. */
const NODE_TYPES = ["story", "capability", "contract"] as const;

/** Why health is never written on a story or a capability, for the error that refuses it. */
const ROLLED_UP: Partial<Readonly<Record<RecordType, string>>> = {
  story: "health is recorded on contracts: a story's health is rolled up from its contracts",
  capability: "health is recorded on contracts: a capability's health is rolled up from its contracts",
};

export class HealthRecord {
  readonly #records: SchemaRecords;
  readonly #work: WorkModel;
  readonly #flight: Pick<WorkInFlight, "releaseOnVerdict" | "holds"> | undefined;

  /**
   * Given `flight`, a failing verified verdict releases the increments waiting on an event about its contract (10.44), and
   * each capability's open work says what holds it (5.28).
   */
  constructor(records: SchemaRecords, work: WorkModel, flight?: Pick<WorkInFlight, "releaseOnVerdict" | "holds">) {
    this.#records = records;
    this.#work = work;
    this.#flight = flight;
  }

  /**
   * Write what the agent reported about contract `contractId`: a new entry in its reported column.
   * The id must name a live contract. Anything else is refused with a MissingReferenceError, and
   * for a story or a capability the error says why: their health is rolled up from their
   * contracts. A state other than the three, or a `by` or `note` that is not storable text, is
   * refused by the schema check inside the write (SchemaError). A refusal writes nothing.
   */
  reportHealth(contractId: string, state: HealthState, options: HealthOptions = {}): Promise<HealthEntry> {
    return this.#write("reported", contractId, state, options);
  }

  /**
   * Write what storytree verified about contract `contractId`, by seeing it for itself: as reportHealth, in the verified
   * column. A failing verdict, given work in flight, releases each open increment waiting on an event about the contract,
   * with the verdict written on it (10.44), so a red a fix did not cure goes back to ready work. A verdict that turns
   * failing, or stays failing but releases such a fix, and one that turns passing from failing, records an FYI for the
   * owner (5.23, ADR-1293 D1); a verdict that stays as it was records none.
   */
  async recordVerified(contractId: string, state: HealthState, options: HealthOptions = {}): Promise<HealthEntry> {
    const earlier = await this.#lastVerdict(contractId);
    const entry = await this.#write("verified", contractId, state, options);
    const { by: _by, note: _note, skip: _skip, was: _was, source: _source, tests: _tests, ...write } = options;
    await this.#tell(contractId, earlier, entry, write);
    return entry;
  }

  /**
   * Write, in one write, each of `verdicts` that tells nothing as recordVerified writes it: not checked, or passing after
   * no failing, with its CI copy when CI saw it (5.27). One that would tell (a failing one, which may release work, or a
   * passing one after failing) is left unwritten, for its writer to write with recordVerified, which tells it (5.29). The
   * entries in the order given, undefined for each left. Refused whole, writing nothing, as recordVerified refuses one
   * id that names no live contract (MissingReferenceError), and when two verdicts name one contract (RangeError).
   */
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

  /**
   * Tell what recordVerified could not, for each verified verdict written since `from` (an ISO 8601 time) whose writer's
   * database role refused its FYI and its release (CI's may write only health, 3.20): a turn red, still red after a fix it
   * releases, or green again is told as recordVerified tells it, at the verdict's own time, and a failing one releases
   * only work whose event wait stood unchanged since the verdict (10.45). A turn already told (an FYI of its title about the
   * contract at that time) and a verdict that stayed as it was tell nothing, so telling again tells nothing more (5.24). The turns told, in history order.
   */
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

  /**
   * What a verified `entry` on contract `contractId` sets off after `earlier`, the verdict before it: a failing one
   * releases the work waiting on an event about the contract (10.44; given `asOf`, only work whose wait stood since,
   * 10.45), and a turn red, a red that released a fix, or a turn green again records an FYI, unless `told` holds one
   * already (`<contract> <at> <title>`). The turn, when there was one to tell or work released.
   */
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
    return { contract: contractId, title, at: entry.at, released };
  }

  /** The last passing or failing verdict in contract `contractId`'s verified column: a not-checked entry keeps the one it did not reproduce. */
  async #lastVerdict(contractId: string): Promise<"passing" | "failing" | undefined> {
    if (!couldBeId(contractId)) return undefined;
    const current = await this.#records.get(healthId(contractId, "verified"));
    if (current?.type !== "health") return undefined;
    const { state, was } = current.fields as FieldsOf<"health">;
    return state === "not-checked" ? was : state;
  }

  /**
   * Write what a run of a project's tests verified about capability `capabilityId` from the tests that reached its
   * covered files and no contract claims (ADR-1274 D3): its own verified reading, kept beside its contracts'. It joins
   * their roll-up unless it is not-checked. The id must name a live capability; anything else is refused with a
   * MissingReferenceError, as reportHealth refuses a node that is no contract.
   */
  async recordUnclaimed(capabilityId: string, state: HealthState, options: HealthOptions = {}): Promise<HealthEntry> {
    const target = await recordNamed(this.#records, capabilityId);
    if (target?.type !== "capability") throw new MissingReferenceError("node", capabilityId, "capability", target?.type);
    return this.#save("verified", capabilityId, state, options, "unclaimed");
  }

  /**
   * Say that a run in progress will record contract `contractId`'s verified column: a pending mark,
   * kept apart from the column (`health_<contractId>_pending`), so its health reads as before. The
   * worklist holds back a capability every contract carrying its reason is so marked for, until the
   * run records it or PENDING_FOR passes. Refused as reportHealth is.
   */
  markVerifiedPending(contractId: string, options: HealthOptions = {}): Promise<HealthEntry> {
    return this.#write("verified", contractId, "not-checked", options, "pending");
  }

  /**
   * The node's health now. A contract's column is its latest entry (state, by, at, note), or
   * not-checked when it has none. A capability's column is rolled up from its live contracts' and
   * a story's from the live contracts of all its live capabilities: failing if any is failing,
   * passing only if there is at least one and every one is passing, and not-checked otherwise. A
   * rolled-up column holds its state alone. An id naming no live story, capability or contract has
   * no entries, so it reads not-checked in both columns.
   */
  async health(nodeId: string): Promise<NodeHealth> {
    const node = await liveRecord(this.#records, nodeId, NODE_TYPES);
    if (node === null) return rolledUp([]); // nothing to read: not-checked in both columns
    // A contract's own records alone: reading every health record for one costs a library far away megabytes.
    if (node.type === "contract") return ownHealth(node.id, new Map((await this.#records.list("health", { ids: (["reported", "verified", "ci"] as const).map((column) => healthId(node.id, column)) })).map((record) => [record.id, record])));
    const entries = await this.#entries();
    const contracts = (await this.#contractsUnder(node)).map((id) => ownHealth(id, entries));
    const capabilities = node.type === "capability" ? [node.id] : (await this.#records.list("capability")).filter((capability) => capability.fields.story === node.id).map(({ id }) => id);
    return rolledUp(contracts, capabilities.flatMap((id) => counted(unclaimedOf(id, entries))));
  }

  /**
   * Every entry of contract `contractId`'s two columns, in the order they were written, each with
   * its column, state, by, at and note. Kept after the contract is retired; [] for an id that has
   * no entries.
   */
  async healthHistory(contractId: string): Promise<HealthEntry[]> {
    if (!couldBeId(contractId)) return [];
    const columns = await Promise.all(COLUMNS.map((column) => this.#records.history({ id: healthId(contractId, column) })));
    // Every save of a column's record is an entry; a retirement of it (by hand) is not.
    return columns
      .flat()
      .filter((change) => change.action !== "retired")
      .sort((a, b) => a.seq - b.seq)
      .map((change) => entryOf(this.#records.current(change.record).fields as FieldsOf<"health">, change.at));
  }

  /**
   * `tree`, as WorkModel.projectTree() gives it, with `health` added to every story, capability and
   * contract: a contract's own, and each capability's and story's rolled up from the contracts the
   * tree holds under it; an edge's contracts carry their own and roll into neither. The tree given is not changed. With no tree, the plan as it is now. `parked`,
   * WorkInFlight.parkedCapabilities()'s reading, marks each capability not proven with the arcs that park it.
   */
  async annotate(tree?: ProjectTree, parked: ReadonlyMap<string, readonly ParkedOn[]> = new Map()): Promise<AnnotatedTree> {
    const plan = tree ?? (await this.#work.projectTree());
    const owners = new Map(plan.stories.flatMap((story) => story.capabilities.flatMap((capability) => capability.contracts.map((contract) => [contract.id, capability.id] as const))));
    const [entries, open] = await Promise.all([this.#entries(), this.#openWork(owners)]);
    const unverified = ![...entries.values()].some(({ fields }) => fields.column === "verified");
    return {
      ...(unverified ? { unverified } : {}),
      ...(plan.anchor === undefined ? {} : { anchor: { ...plan.anchor } }),
      stories: plan.stories.map(({ edges: links, ...story }) => {
        const capabilities = story.capabilities.map((capability) => {
          const contracts = capability.contracts.map((contract) => ({ ...contract, health: ownHealth(contract.id, entries) }));
          const unclaimed = unclaimedOf(capability.id, entries);
          const own = counted(unclaimed);
          const health = rolledUp(contracts.map((contract) => contract.health), own);
          const verified = [...contracts.map((contract) => contract.health.verified.state), ...own];
          // A mapped story's code already exists, so its proposed flag says nothing once a test result is tied to the
          // capability: it reads its verified roll-up, and stays proposed only while none is (ADR-1274, contract 3.50).
          const proposed = capability.proposed && !(story.mapped !== undefined && verified.some((state) => state !== "not-checked"));
          const status = capabilityStatus(proposed, verified);
          const reportOnly = unverified && !capability.proposed;
          // An explored capability of a mapped story, with nothing promised yet, has no health to want (ADR-0993 D3, D5)
          // unless tests no contract claims reached it (ADR-1274 D3); a failing reading of those makes its reason failing.
          const explored = story.mapped !== undefined && contracts.length === 0;
          const failingOwn = own.includes("failing") ? { reason: "failing" as const, mover: "agent" as const, contracts: contracts.filter((contract) => contract.health.verified.state === "failing").map(({ id }) => id), ...(unclaimed?.at === undefined ? {} : { since: unclaimed.at }) } : undefined;
          const why = reportOnly ? undefined : failingOwn ?? (explored ? undefined : capabilityWhy(proposed, contracts.map((contract) => ({ id: contract.id, verified: contract.health.verified, ...(contract.proof === undefined ? {} : { proof: contract.proof.by }) }))));
          const parkedOn = status === "proposed" || status === "untested" ? parked.get(capability.id) : undefined;
          return { ...capability, dependsOn: [...capability.dependsOn], contracts, health, status, ...(unclaimed === undefined ? {} : { unclaimed }), ...(why === undefined ? {} : { why }), ...(reportOnly ? { reportOnly } : {}), ...(parkedOn === undefined ? {} : { parkedOn: [...parkedOn] }), ...(open.has(capability.id) ? { openWork: open.get(capability.id)!.map((one) => ({ ...one })) } : {}) };
        });
        const health = rolledUp(capabilities.flatMap((capability) => capability.contracts.map((contract) => contract.health)), capabilities.flatMap((capability) => counted(capability.unclaimed)));
        const edges = links?.map((edge) => ({ ...edge, contracts: edge.contracts.map((contract) => ({ ...contract, health: ownHealth(contract.id, entries) })) }));
        return { ...story, capabilities, ...(edges === undefined ? {} : { edges }), health };
      }),
      arcs: plan.arcs.map((arc) => ({ ...arc, stories: [...arc.stories] })),
    };
  }

  /**
   * Each capability an open increment names, or owns a contract one links (`owners`: contract id to its capability), with those
   * increments, each once: the active ones first, then the rest in parked order (ADR-1253 D1). Only the first, the one the
   * panel's lead names as moving it (4.49), says what still holds it (5.28): no surface reads the rest's, and on a large
   * plan saying it of every one nearly trebled the tree the map opens on.
   */
  async #openWork(owners: ReadonlyMap<string, string>): Promise<Map<string, OpenIncrement[]>> {
    // An increment is parked as it is made, and keeps that time when returned to proposal, so parked order is creation order.
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

  /** What still holds each open increment, as OpenWait says it (5.28), from one reading of the project's holds. */
  async #waitsSaid(holds: Holds, increments: readonly { id: string; fields: { title: string; status: string } }[]): Promise<(id: string) => OpenWait[]> {
    const open = new Map(increments.map((increment) => [increment.id, increment]));
    // An arc waited on is named by its title, read only when some wait is on one.
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

  /**
   * The health worklist (ADR-0825 D4): every capability that is not healthy, with its reason, who
   * moves it and since when, oldest first (the plan's order on a tie). Since is when its reason was
   * recorded, or, where nothing was (not built, no test names it), when the capability was. One an
   * increment not yet closed lists among its capabilities is routed (ADR-0949 D2), and is left off until that increment closes.
   * `changed` gives, by story id, the newest commit on main that changed the story's code: a
   * capability its run has not recorded since waits on it (friction_cf907de5ca3b). `named` gives the
   * contracts main's tests name: one never recorded that a test there names is no missing test, and waits on a run (friction_c7a7e6754c54).
   */
  async worklist({ now = new Date(), changed = new Map(), named }: { now?: Date; changed?: ReadonlyMap<string, ChangedOnMain>; named?: NamedOnMain } = {}): Promise<HealthWorkItem[]> {
    const routed = new Set((await this.#records.list("increment")).filter(({ fields }) => fields.status !== "closed").flatMap(({ fields }) => fields.capabilities ?? []));
    const recorded = new Map((await this.#records.list("capability")).map(({ id, createdAt }) => [id, createdAt]));
    const marks = new Map((await this.#records.list("health")).filter(({ id }) => id.endsWith(PENDING)).map((record) => [record.fields.node, record]));
    return (await this.annotate()).stories
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

  /**
   * Save a new entry as the column's record. The contract is checked first, and a broken reference
   * throws with nothing written; the entry itself is checked against the health type inside the
   * write, as capability 3 checks every write.
   */
  async #write(column: HealthColumnName, contractId: string, state: HealthState, options: HealthOptions, kept: HealthColumnName | "pending" = column): Promise<HealthEntry> {
    await this.#contract(contractId);
    const entry = await this.#save(column, contractId, state, options, kept);
    if (kept === "verified" && options.source === "ci") await this.#save(column, contractId, state, options, "ci");
    return entry;
  }

  /** Refuse `contractId` (MissingReferenceError) unless it names a live contract, saying why for a story or a capability. */
  async #contract(contractId: string): Promise<void> {
    const target = await recordNamed(this.#records, contractId);
    if (target?.type !== "contract") {
      throw new MissingReferenceError("node", contractId, "contract", target?.type, target === null ? undefined : ROLLED_UP[target.type]);
    }
  }

  /** Save the entry as the record of node `nodeId`'s column (or its pending mark, or a capability's unclaimed reading), checked inside the write. */
  async #save(column: HealthColumnName, nodeId: string, state: HealthState, options: HealthOptions, kept: HealthColumnName | "pending" | "unclaimed" | "ci"): Promise<HealthEntry> {
    const { type, fields, options: write } = this.#entry(column, nodeId, state, options, kept);
    const record = await this.#records.create(type, fields, { ...write, ...(options.signal === undefined ? {} : { signal: options.signal }) });
    return entryOf(record.fields, record.updatedAt);
  }

  /** The health record #save writes for an entry, as SchemaRecords.createAll takes it. */
  #entry(column: HealthColumnName, nodeId: string, state: HealthState, options: HealthOptions, kept: HealthColumnName | "pending" | "unclaimed" | "ci"): { type: "health"; fields: FieldsOf<"health">; options: { id: string; actor?: string } } {
    const { by, note, skip, was, source, tests } = options;
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
      },
      options: { id: healthId(nodeId, kept), ...(actor === undefined ? {} : { actor }) },
    };
  }

  /** Every live health record of a column, by id: a pending mark is none. */
  async #entries(): Promise<ReadonlyMap<string, SchemaRecord<"health">>> {
    return new Map((await this.#records.list("health")).filter(({ id }) => !id.endsWith(PENDING)).map((record) => [record.id, record]));
  }

  /** The ids of the live contracts a capability's or story's health is rolled up from. */
  async #contractsUnder(node: SchemaRecord<"story" | "capability">): Promise<string[]> {
    const capabilities =
      node.type === "capability"
        ? new Set([node.id])
        : new Set((await this.#records.list("capability")).filter((capability) => capability.fields.story === node.id).map(({ id }) => id));
    const contracts = await this.#records.list("contract");
    return contracts.filter((contract) => contract.fields.capability !== undefined && capabilities.has(contract.fields.capability)).map(({ id }) => id);
  }
}

/** The verdict an entry keeps: its own, or the one a not-checked entry did not reproduce. */
function verdictOf(entry: HealthEntry): "passing" | "failing" | undefined {
  return entry.state === "not-checked" ? entry.was?.state : entry.state;
}

/** The id of the record holding a contract's column, one record per contract and column, or its pending mark, or CI's kept verdict. */
function healthId(contractId: string, column: HealthColumnName | "pending" | "unclaimed" | "ci"): string {
  return `health_${contractId}_${column}`;
}

/** How a pending mark's id ends. */
const PENDING = "_pending";

/**
 * The run a capability waits on: when every contract carrying its reason has a pending mark newer
 * than its verified entry and younger than PENDING_FOR at `now`, the newest of those marks; else none.
 */
function waitingOn(carrying: readonly { mark: SchemaRecord<"health"> | undefined; verified: HealthColumn | undefined }[], now: Date): PendingRun | undefined {
  const live = carrying.flatMap(({ mark, verified }) =>
    mark !== undefined && now.getTime() - Date.parse(mark.updatedAt) < PENDING_FOR && (verified?.at === undefined || verified.at < mark.updatedAt) ? [mark] : [],
  );
  if (live.length === 0 || live.length < carrying.length) return undefined;
  const newest = live.reduce((a, b) => (b.updatedAt > a.updatedAt ? b : a));
  const { by, note } = newest.fields;
  return { since: newest.updatedAt, ...(by === undefined ? {} : { by }), ...(note === undefined ? {} : { note }) };
}

/**
 * The commit a capability waits on: when its story's code changed on main less than MERGE_WAITS_FOR
 * before `now`, and after every contract carrying its reason (at least one) was last verified; else none.
 */
function waitingOnMerge(merged: ChangedOnMain | undefined, carrying: readonly (HealthColumn | undefined)[], now: Date): PendingRun | undefined {
  if (merged === undefined || carrying.length === 0 || now.getTime() - Date.parse(merged.at) >= MERGE_WAITS_FOR) return undefined;
  if (carrying.some((verified) => verified?.at !== undefined && Date.parse(verified.at) >= Date.parse(merged.at))) return undefined;
  return { since: merged.at, note: `commit ${merged.commit} changed its code on main; its own-health run has not recorded it yet` };
}

/**
 * The run a capability whose reason is `no test names it` waits on when a test on main names every
 * contract carrying it (at least one): main's commit, saying the contracts by number; else none.
 */
function waitingOnNamed(named: NamedOnMain | undefined, why: CapabilityWhy, contracts: readonly { id: string; title: string }[]): PendingRun | undefined {
  if (named === undefined || why.reason !== "no test names it" || why.contracts.length === 0 || !why.contracts.every((id) => named.contracts.includes(id))) return undefined;
  const titles = new Map(contracts.map(({ id, title }) => [id, title]));
  const numbers = why.contracts.map((id) => /^(\d+\.\d+) · /.exec(titles.get(id) ?? "")?.[1] ?? id);
  return { since: named.at, note: `a test on main (commit ${named.commit}) names ${numbers.join(", ")}; no recorded run has seen it yet` };
}

/** A contract's own health: each column's latest entry, or not-checked. */
function ownHealth(contractId: string, entries: ReadonlyMap<string, SchemaRecord<"health">>): NodeHealth {
  const ci = entries.get(healthId(contractId, "ci"));
  return {
    reported: columnOf(entries.get(healthId(contractId, "reported"))),
    verified: columnOf(entries.get(healthId(contractId, "verified"))),
    ...(ci === undefined ? {} : { ci: columnOf(ci) }),
  };
}

/** A contract's column as its record leaves it: not-checked when there is no record. */
function columnOf(record: SchemaRecord<"health"> | undefined): HealthColumn {
  if (record === undefined) return { state: "not-checked" };
  const { column: _column, ...entry } = entryOf(record.fields, record.updatedAt);
  return entry;
}

/** The health rolled up, column by column, from the health of some contracts and, in the verified column, the readings `own` of tests no contract claims. */
function rolledUp(contracts: readonly NodeHealth[], own: readonly HealthState[] = []): NodeHealth {
  return {
    reported: rollUp(contracts.map((health) => health.reported.state)),
    verified: rollUp([...contracts.map((health) => health.verified.state), ...own]),
  };
}

/** A capability's reading of the tests no contract claims, as its record leaves it, or undefined when it has none. */
function unclaimedOf(capabilityId: string, entries: ReadonlyMap<string, SchemaRecord<"health">>): HealthColumn | undefined {
  const record = entries.get(healthId(capabilityId, "unclaimed"));
  return record === undefined ? undefined : columnOf(record);
}

/** The state such a reading adds to a roll-up: none when there is no reading or it is not-checked. */
function counted(unclaimed: HealthColumn | undefined): HealthState[] {
  return unclaimed === undefined || unclaimed.state === "not-checked" ? [] : [unclaimed.state];
}

/** Failing if any state is failing; passing only if there is at least one and all are passing; otherwise not-checked. */
function rollUp(states: readonly HealthState[]): HealthColumn {
  if (states.includes("failing")) return { state: "failing" };
  if (states.length > 0 && states.every((state) => state === "passing")) return { state: "passing" };
  return { state: "not-checked" };
}

/**
 * The word for a capability (ADR-0744 D1, D3), from its proposed flag and its contracts' verified
 * states: proposed while the flag is on, whatever its health; then the verified roll-up in 0.2's
 * words. The agent's reported column plays no part, so it never turns a card healthy.
 */
export function capabilityStatus(proposed: boolean, verified: readonly HealthState[]): CapabilityStatus {
  if (proposed) return "proposed";
  const { state } = rollUp(verified);
  return state === "passing" ? "healthy" : state === "failing" ? "unhealthy" : "untested";
}

/**
 * Why a capability is not healthy, and who moves it (ADR-0825 D1); undefined when it is healthy.
 * Proposed, it is `not built`, whatever its health. Otherwise each contract not verified passing
 * has a reason: `failing`; not checked, `needs owner` for an owner-kind skip, `out of CI's reach`
 * for a platform one, `not re-run` for any other skip or an earlier verdict it did not reproduce,
 * and, for one never recorded, `no test names it`, or `acceptance test not run` when its proof is agentic
 * user acceptance testing, which no plain test names. The capability's is the first of those, in that
 * order, its contracts have: the agent's work is ranked before the owner's, so the owner is asked
 * only once nothing an agent can do remains.
 */
export function capabilityWhy(proposed: boolean, contracts: readonly { id: string; verified: HealthColumn; proof?: ContractProof }[]): CapabilityWhy | undefined {
  if (proposed) return { reason: "not built", mover: "agent", contracts: [] };
  if (contracts.length === 0) return { reason: "no test names it", mover: "agent", contracts: [] };
  const reasons = contracts.map((contract) => ({ ...contract, reason: contractReason(contract.verified, contract.proof) }));
  const reason = RANKED.find((candidate) => reasons.some((contract) => contract.reason === candidate));
  if (reason === undefined) return undefined;
  const carrying = reasons.filter((contract) => contract.reason === reason);
  const since = carrying.flatMap(({ verified }) => (verified.at === undefined ? [] : [verified.at])).sort()[0];
  return { reason, mover: reason === "needs owner" ? "owner" : "agent", contracts: carrying.map(({ id }) => id), ...(since === undefined ? {} : { since }) };
}

/**
 * A capability's word, and when it is not healthy its reason, who moves it and the contracts
 * carrying it, each by the number its title starts with or, without one, its id; for example
 * "untested — needs owner, the owner's to move: 8.1". A report-only one says what the agent
 * reports and that storytree does not check this project's tests yet. How the command line and the
 * Session management say it.
 */
export function wordAndWhy(capability: Pick<AnnotatedCapability, "status" | "why" | "contracts" | "health" | "reportOnly">): string {
  const { status, why } = capability;
  if (capability.reportOnly) return `the agent ${REPORTS[capability.health.reported.state]}; ${NOT_VERIFIED}`;
  if (why === undefined) return status;
  const titles = new Map(capability.contracts.map((contract) => [contract.id, contract.title]));
  const named = why.contracts.map((id) => /^(\d+\.\d+) · /.exec(titles.get(id) ?? "")?.[1] ?? id);
  return `${status} — ${why.reason}, the ${why.mover}'s to move${named.length === 0 ? "" : `: ${named.join(", ")}`}`;
}

/**
 * What the worklist says of the capabilities it holds back (HealthWorkItem.waits): how many, and the
 * newest run they wait on; undefined when it holds none. How the command line and Session management say it.
 */
export function heldBack(items: readonly HealthWorkItem[]): string | undefined {
  const runs = items.flatMap(({ waits }) => (waits === undefined ? [] : [waits]));
  if (runs.length === 0) return undefined;
  const newest = runs.reduce((a, b) => (b.since > a.since ? b : a));
  return `${runs.length} held back until a test run records them: ${newest.note ?? newest.by ?? "a run"}, since ${newest.since.slice(0, 16).replace("T", " ")}.`;
}

/** What a report-only capability says in place of a reason (ADR-0630). */
export const NOT_VERIFIED = "storytree does not check this project's tests yet";

/** The agent's reported state, as a report-only capability says it. */
const REPORTS: Readonly<Record<HealthState, string>> = { passing: "reports passing", failing: "reports failing", "not-checked": "has reported nothing yet" };

/** The reasons a built capability can have, the one it shows first. */
const RANKED: readonly HealthReason[] = ["failing", "not re-run", "no test names it", "acceptance test not run", "out of CI's reach", "needs owner"];

/** How a contract is proved (CONTRACT_PROOFS). */
type ContractProof = (typeof CONTRACT_PROOFS)[number];

/** Why one contract, proved as `proof` says, is not verified passing; undefined when it is. */
function contractReason(verified: HealthColumn, proof: ContractProof | undefined): HealthReason | undefined {
  if (verified.state === "passing") return undefined;
  if (verified.state === "failing") return "failing";
  if (verified.skip === "owner") return "needs owner";
  if (verified.skip?.startsWith("platform:")) return "out of CI's reach";
  if (verified.skip !== undefined || verified.was !== undefined) return "not re-run";
  return proof === "agentic-user-acceptance-testing" ? "acceptance test not run" : "no test names it";
}

/** An entry: a health record's fields, and when they were written. Each optional field only when there is one. */
function entryOf(fields: FieldsOf<"health">, at: string): HealthEntry {
  const { column, state, by, note, skip, was, wasAt, source, tests } = fields;
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
  };
}
