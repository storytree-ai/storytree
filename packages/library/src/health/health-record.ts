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
  /** Why it is not healthy, and who moves it; absent when it is healthy (ADR-0825 D1). */
  why?: CapabilityWhy;
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

/** A story in the annotated tree, with its health rolled up from all its capabilities' contracts. */
export interface AnnotatedStory extends Omit<StoryNode, "capabilities"> {
  capabilities: AnnotatedCapability[];
  health: NodeHealth;
}

/** WorkModel.projectTree()'s tree with every story, capability and contract's health added. */
export interface AnnotatedTree {
  stories: AnnotatedStory[];
  arcs: ArcNode[];
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
    return {
      stories: plan.stories.map((story) => {
        const capabilities = story.capabilities.map((capability) => {
          const contracts = capability.contracts.map((contract) => ({ ...contract, health: ownHealth(contract.id, entries) }));
          const health = rolledUp(contracts.map((contract) => contract.health));
          const status = capabilityStatus(capability.proposed, contracts.map((contract) => contract.health.verified.state));
          const why = capabilityWhy(capability.proposed, contracts.map((contract) => ({ id: contract.id, verified: contract.health.verified })));
          return { ...capability, dependsOn: [...capability.dependsOn], contracts, health, status, ...(why === undefined ? {} : { why }) };
        });
        const health = rolledUp(capabilities.flatMap((capability) => capability.contracts.map((contract) => contract.health)));
        return { ...story, capabilities, health };
      }),
      arcs: plan.arcs.map((arc) => ({ ...arc, stories: [...arc.stories] })),
    };
  }

  /**
   * Save a new entry as the column's record. The contract is checked first, and a broken reference
   * throws with nothing written; the entry itself is checked against the health type inside the
   * write, as capability 3 checks every write.
   */
  async #write(column: HealthColumnName, contractId: string, state: HealthState, options: HealthOptions): Promise<HealthEntry> {
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
      { id: healthId(contractId, column), ...(actor === undefined ? {} : { actor }), ...(options.signal === undefined ? {} : { signal: options.signal }) },
    );
    return entryOf(record.fields, record.updatedAt);
  }

  /** Every live health record, by id. */
  async #entries(): Promise<ReadonlyMap<string, SchemaRecord<"health">>> {
    return new Map((await this.#records.list("health")).map((record) => [record.id, record]));
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

/** The id of the record holding a contract's column: one record per contract and column. */
function healthId(contractId: string, column: HealthColumnName): string {
  return `health_${contractId}_${column}`;
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
