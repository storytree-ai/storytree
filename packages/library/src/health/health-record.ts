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
import { couldBeId, liveRecord, MissingReferenceError, recordNamed } from "../references.js";
import type { SchemaRecord, SchemaRecords, WriteOptions } from "../schema/index.js";
import type { FieldsOf, RecordType } from "../schema/types.js";
import type { ArcNode, CapabilityNode, ContractNode, ProjectTree, StoryNode, WorkModel } from "../work/index.js";

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
}

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
}

/** A contract in the annotated tree, with its own health. */
export interface AnnotatedContract extends ContractNode {
  health: NodeHealth;
}

/**
 * A capability's word, as its card says it (ADR-0744): `proposed` while its flag is on; once the
 * agent switches it off, `healthy` when every contract is verified passing, `unhealthy` when any
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
  /**
   * Built, in a project whose health nothing verifies (ADR-0630: any user's project in the MVP): what
   * the agent reports is all there is to show, labelled as the agent's, and no agent can move its word.
   */
  reportOnly?: true;
}

/**
 * Why a capability is not healthy (ADR-0825 D1), from a closed set: `not built` while it is
 * proposed; otherwise from its contracts' verified columns. Only `needs owner` is the owner's.
 */
export type HealthReason = "not built" | "failing" | "not re-run" | "no test names it" | "out of CI's reach" | "needs owner";

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
   * The run in progress it waits on: present when every contract carrying its reason has a pending
   * mark (markVerifiedPending) newer than its verified entry and within PENDING_FOR, so it is not offered.
   */
  waits?: PendingRun;
}

/** A test run in progress that will record a contract's verified column: when it said so, who, and its note. */
export interface PendingRun {
  since: string;
  by?: string;
  note?: string;
}

/**
 * How long a pending mark holds: the Own health job's own time limit (.github/workflows/own-health.yml's
 * 45 minutes), so a run that died without recording holds nothing after it.
 */
export const PENDING_FOR = 45 * 60 * 1000;

/** A story in the annotated tree, with its health rolled up from all its capabilities' contracts. */
export interface AnnotatedStory extends Omit<StoryNode, "capabilities"> {
  capabilities: AnnotatedCapability[];
  health: NodeHealth;
}

/** WorkModel.projectTree()'s tree with every story, capability and contract's health added. */
export interface AnnotatedTree {
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

  constructor(records: SchemaRecords, work: WorkModel) {
    this.#records = records;
    this.#work = work;
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

  /** Write what storytree verified about contract `contractId`, by seeing it for itself: as reportHealth, in the verified column. */
  recordVerified(contractId: string, state: HealthState, options: HealthOptions = {}): Promise<HealthEntry> {
    return this.#write("verified", contractId, state, options);
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
    const entries = await this.#entries();
    if (node.type === "contract") return ownHealth(node.id, entries);
    const contracts = await this.#contractsUnder(node);
    return rolledUp(contracts.map((id) => ownHealth(id, entries)));
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
   * tree holds under it. The tree given is not changed. With no tree, the plan as it is now.
   */
  async annotate(tree?: ProjectTree): Promise<AnnotatedTree> {
    const plan = tree ?? (await this.#work.projectTree());
    const entries = await this.#entries();
    const unverified = ![...entries.values()].some(({ fields }) => fields.column === "verified");
    return {
      ...(unverified ? { unverified } : {}),
      stories: plan.stories.map((story) => {
        const capabilities = story.capabilities.map((capability) => {
          const contracts = capability.contracts.map((contract) => ({ ...contract, health: ownHealth(contract.id, entries) }));
          const health = rolledUp(contracts.map((contract) => contract.health));
          const status = capabilityStatus(capability.proposed, contracts.map((contract) => contract.health.verified.state));
          const reportOnly = unverified && !capability.proposed;
          const why = reportOnly ? undefined : capabilityWhy(capability.proposed, contracts.map((contract) => ({ id: contract.id, verified: contract.health.verified })));
          return { ...capability, dependsOn: [...capability.dependsOn], contracts, health, status, ...(why === undefined ? {} : { why }), ...(reportOnly ? { reportOnly } : {}) };
        });
        const health = rolledUp(capabilities.flatMap((capability) => capability.contracts.map((contract) => contract.health)));
        return { ...story, capabilities, health };
      }),
      arcs: plan.arcs.map((arc) => ({ ...arc, stories: [...arc.stories] })),
    };
  }

  /**
   * The health worklist (ADR-0825 D4): every capability that is not healthy, with its reason, who
   * moves it and since when, oldest first (the plan's order on a tie). Since is when its reason was
   * recorded, or, where nothing was (not built, no test names it), when the capability was. One an
   * increment not yet closed lists among its capabilities is routed (ADR-0949 D2), and is left off until that increment closes.
   */
  async worklist({ now = new Date() }: { now?: Date } = {}): Promise<HealthWorkItem[]> {
    const routed = new Set((await this.#records.list("increment")).filter(({ fields }) => fields.status !== "closed").flatMap(({ fields }) => fields.capabilities ?? []));
    const recorded = new Map((await this.#records.list("capability")).map(({ id, createdAt }) => [id, createdAt]));
    const marks = new Map((await this.#records.list("health")).filter(({ id }) => id.endsWith(PENDING)).map((record) => [record.fields.node, record]));
    return (await this.annotate()).stories
      .flatMap((story) => story.capabilities.flatMap(({ id, title, status, why, contracts }) => {
        if (why === undefined || routed.has(id)) return [];
        const verified = new Map(contracts.map((contract) => [contract.id, contract.health.verified]));
        const waits = waitingOn(why.contracts.map((carrying) => ({ mark: marks.get(carrying), verified: verified.get(carrying) })), now);
        return [{ capability: id, title, story: story.id, status, why, since: why.since ?? recorded.get(id) ?? "", ...(waits === undefined ? {} : { waits }) }];
      }))
      .sort((a, b) => (a.since < b.since ? -1 : a.since > b.since ? 1 : 0));
  }

  /**
   * Save a new entry as the column's record. The contract is checked first, and a broken reference
   * throws with nothing written; the entry itself is checked against the health type inside the
   * write, as capability 3 checks every write.
   */
  async #write(column: HealthColumnName, contractId: string, state: HealthState, options: HealthOptions, kept: HealthColumnName | "pending" = column): Promise<HealthEntry> {
    const target = await recordNamed(this.#records, contractId);
    if (target?.type !== "contract") {
      throw new MissingReferenceError("node", contractId, "contract", target?.type, target === null ? undefined : ROLLED_UP[target.type]);
    }
    const { by, note, skip, was } = options;
    const actor = options.actor ?? by;
    const record = await this.#records.create(
      "health",
      {
        node: contractId,
        column,
        state,
        ...(by === undefined ? {} : { by }),
        ...(note === undefined ? {} : { note }),
        ...(skip === undefined ? {} : { skip }),
        ...(was === undefined ? {} : { was: was.state, wasAt: was.at }),
      },
      { id: healthId(contractId, kept), ...(actor === undefined ? {} : { actor }), ...(options.signal === undefined ? {} : { signal: options.signal }) },
    );
    return entryOf(record.fields, record.updatedAt);
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
    return contracts.filter((contract) => capabilities.has(contract.fields.capability)).map(({ id }) => id);
  }
}

/** The id of the record holding a contract's column, one record per contract and column, or its pending mark. */
function healthId(contractId: string, column: HealthColumnName | "pending"): string {
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

/** A contract's own health: each column's latest entry, or not-checked. */
function ownHealth(contractId: string, entries: ReadonlyMap<string, SchemaRecord<"health">>): NodeHealth {
  return {
    reported: columnOf(entries.get(healthId(contractId, "reported"))),
    verified: columnOf(entries.get(healthId(contractId, "verified"))),
  };
}

/** A contract's column as its record leaves it: not-checked when there is no record. */
function columnOf(record: SchemaRecord<"health"> | undefined): HealthColumn {
  if (record === undefined) return { state: "not-checked" };
  const { column: _column, ...entry } = entryOf(record.fields, record.updatedAt);
  return entry;
}

/** The health rolled up, column by column, from the health of some contracts. */
function rolledUp(contracts: readonly NodeHealth[]): NodeHealth {
  return {
    reported: rollUp(contracts.map((health) => health.reported.state)),
    verified: rollUp(contracts.map((health) => health.verified.state)),
  };
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
 * and `no test names it` for one never recorded. The capability's is the first of those, in that
 * order, its contracts have: the agent's work is ranked before the owner's, so the owner is asked
 * only once nothing an agent can do remains.
 */
export function capabilityWhy(proposed: boolean, contracts: readonly { id: string; verified: HealthColumn }[]): CapabilityWhy | undefined {
  if (proposed) return { reason: "not built", mover: "agent", contracts: [] };
  if (contracts.length === 0) return { reason: "no test names it", mover: "agent", contracts: [] };
  const reasons = contracts.map((contract) => ({ ...contract, reason: contractReason(contract.verified) }));
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
 * agent link say it.
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
 * newest run they wait on; undefined when it holds none. How the command line and the agent link say it.
 */
export function heldBack(items: readonly HealthWorkItem[]): string | undefined {
  const runs = items.flatMap(({ waits }) => (waits === undefined ? [] : [waits]));
  if (runs.length === 0) return undefined;
  const newest = runs.reduce((a, b) => (b.since > a.since ? b : a));
  return `${runs.length} held back while a test run in progress records them: ${newest.note ?? newest.by ?? "a run"}, since ${newest.since.slice(0, 16).replace("T", " ")}.`;
}

/** What a report-only capability says in place of a reason (ADR-0630). */
export const NOT_VERIFIED = "storytree does not check this project's tests yet";

/** The agent's reported state, as a report-only capability says it. */
const REPORTS: Readonly<Record<HealthState, string>> = { passing: "reports passing", failing: "reports failing", "not-checked": "has reported nothing yet" };

/** The reasons a built capability can have, the one it shows first. */
const RANKED: readonly HealthReason[] = ["failing", "not re-run", "no test names it", "out of CI's reach", "needs owner"];

/** Why one contract is not verified passing; undefined when it is. */
function contractReason(verified: HealthColumn): HealthReason | undefined {
  if (verified.state === "passing") return undefined;
  if (verified.state === "failing") return "failing";
  if (verified.skip === "owner") return "needs owner";
  if (verified.skip?.startsWith("platform:")) return "out of CI's reach";
  if (verified.skip !== undefined || verified.was !== undefined) return "not re-run";
  return "no test names it";
}

/** An entry: a health record's fields, and when they were written. Each optional field only when there is one. */
function entryOf(fields: FieldsOf<"health">, at: string): HealthEntry {
  const { column, state, by, note, skip, was, wasAt } = fields;
  return {
    column,
    state,
    ...(by === undefined ? {} : { by }),
    at,
    ...(note === undefined ? {} : { note }),
    ...(skip === undefined ? {} : { skip: skip as SkipKind }),
    ...(was === undefined || wasAt === undefined ? {} : { was: { state: was, at: wasAt } }),
  };
}
