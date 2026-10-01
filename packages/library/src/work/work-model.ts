/**
 * Capability 4 · Work model (the library story): each project's plan of work. Stories belong to
 * the project; a capability points at its story, a contract at its capability, and an arc may list
 * the stories it grows. The library refuses broken structure.
 *
 * WorkModel is a layer over capability 3's SchemaRecords, so it runs unchanged on the in-memory
 * twin and on Postgres. Every write checks its references (and, for an edit of a capability's
 * dependencies, the would-be dependency graph) BEFORE writing, and a refusal throws with nothing
 * written. The record itself is then checked against its type inside the write, as capability 3
 * checks every write.
 */
import { byCreation } from "../creation-order.js";
import { checkReference, checkReferences, couldBeId, DependencyLoopError, liveRecord } from "../references.js";
import { SchemaError, type SchemaRecord, type SchemaRecords, type WriteOptions } from "../schema/index.js";
import type { FieldsOf } from "../schema/types.js";

/** A new story's fields. */
export type NewStory = FieldsOf<"story">;
/**
 * A new arc's fields: its intent and end state (capability 10), and the stories it grows, when
 * given, each an existing story; an arc may list none. Parking is capability 10's parkArc.
 */
export type NewArc = Omit<FieldsOf<"arc">, "parked">;
/** A new capability's fields: `story` and every `dependsOn` id must name existing records. It is proposed unless told otherwise. */
export type NewCapability = Omit<FieldsOf<"capability">, "proposed"> & { proposed?: boolean };
/** A new contract's fields: `capability` must name an existing capability. */
export type NewContract = FieldsOf<"contract">;
/** An edit of a capability: some of its fields. A field set to undefined is removed. */
export type CapabilityEdit = { [F in keyof FieldsOf<"capability">]?: FieldsOf<"capability">[F] | undefined };
/** An edit of a story: some of its fields. A field set to undefined is removed. */
export type StoryEdit = { [F in keyof FieldsOf<"story">]?: FieldsOf<"story">[F] | undefined };
/** An edit of a contract: some of its fields. A field set to undefined is removed. */
export type ContractEdit = { [F in keyof FieldsOf<"contract">]?: FieldsOf<"contract">[F] | undefined };
/** An edit of an arc: some of its fields. A field set to undefined is removed. */
export type ArcEdit = { [F in keyof NewArc]?: NewArc[F] | undefined };

/** The plan of work as the forest reads it: story › capability › contract, and the arcs. */
export interface ProjectTree {
  /** Every story, in creation order, each holding its capabilities. */
  stories: StoryNode[];
  /** Every arc, in creation order. */
  arcs: ArcNode[];
}

export interface StoryNode {
  id: string;
  title: string;
  description?: string;
  /** The capabilities pointing at this story, in creation order. */
  capabilities: CapabilityNode[];
}

export interface CapabilityNode {
  id: string;
  title: string;
  description?: string;
  /** The capabilities this one depends on, as stored. */
  dependsOn: string[];
  /** Whether it is still proposed: on until the agent says it is built (ADR-0744 D2). */
  proposed: boolean;
  /** The contracts pointing at this capability, in creation order. */
  contracts: ContractNode[];
}

export interface ContractNode {
  id: string;
  title: string;
  description?: string;
}

export interface ArcNode {
  id: string;
  title: string;
  description?: string;
  /** The stories the arc lists, as stored: empty for an arc that lists none. */
  stories: string[];
}

/** A record the tree shows by id, title and description: a story, capability, contract or arc. */
type PlanRecord = SchemaRecord<"story" | "capability" | "contract" | "arc">;

export class WorkModel {
  readonly #records: SchemaRecords;
  /** The last write queued through this model; the next one starts once it has settled. */
  #lastWrite: Promise<unknown> = Promise.resolve();

  constructor(records: SchemaRecords) {
    this.#records = records;
  }

  /**
   * Add a story to the project. Its id is generated: an `id` in `story` is refused as an unknown
   * field, as is any other field a story does not have.
   */
  addStory(story: NewStory, options?: WriteOptions): Promise<SchemaRecord<"story">> {
    return this.#serially(() => this.#records.create("story", story, options));
  }

  /**
   * Create an arc. Every story it lists must be a live story (MissingReferenceError otherwise,
   * naming the first one that is not); it may list none at all.
   */
  createArc(arc: NewArc, options?: WriteOptions): Promise<SchemaRecord<"arc">> {
    return this.#serially(async () => {
      await checkReferences(this.#records, "stories", arc.stories, "story");
      return this.#records.create("arc", arc, options);
    });
  }

  /**
   * Add a capability to a story. The story, and every capability it depends on, must be live
   * records of those types (MissingReferenceError otherwise). A new capability cannot close a
   * dependency loop, since nothing can depend on it yet. It is born proposed unless told otherwise.
   */
  addCapability(capability: NewCapability, options?: WriteOptions): Promise<SchemaRecord<"capability">> {
    return this.#serially(async () => {
      await checkReference(this.#records, "story", capability.story, "story");
      await checkReferences(this.#records, "dependsOn", capability.dependsOn, "capability");
      return this.#records.create("capability", { ...capability, proposed: capability.proposed ?? true }, options);
    });
  }

  /**
   * Change only the named fields of a capability, as capability 3's edit does. A new story or new
   * dependencies are checked as addCapability checks them, and new dependencies are also checked
   * against the dependency graph as it would be after the edit: one that would make the capability
   * depend on itself, directly or through others, is refused with a DependencyLoopError naming the
   * loop. Returns null, and writes nothing, if `id` is not a live capability.
   */
  editCapability(id: string, fields: CapabilityEdit, options?: WriteOptions): Promise<SchemaRecord<"capability"> | null> {
    return this.#serially(async () => {
      if ((await liveRecord(this.#records, id, ["capability"])) === null) return null;
      await checkReference(this.#records, "story", fields.story, "story");
      await checkReferences(this.#records, "dependsOn", fields.dependsOn, "capability");
      if (Array.isArray(fields.dependsOn)) await this.#refuseLoop(id, fields.dependsOn);
      return (await this.#records.edit(id, fields, options)) as SchemaRecord<"capability"> | null;
    });
  }

  /**
   * Switch capability `id`'s proposed flag (ADR-0744 D2): off when the agent considers it built, on
   * to say it is not. An edit like any other, so its writer is in the history. Switching it off
   * makes nothing healthy: the word comes from the verified column (HealthRecord's capabilityStatus).
   * Null, with nothing written, if `id` is not a live capability.
   */
  setProposed(id: string, proposed: boolean, options?: WriteOptions): Promise<SchemaRecord<"capability"> | null> {
    return this.editCapability(id, { proposed }, options);
  }

  /**
   * Add a contract to a capability, which must be a live capability (MissingReferenceError
   * otherwise). Under a numbered capability (its title starts with its number) a title given
   * without a number gets the capability's next free one, after the highest its live contracts
   * carry, and a title whose number another live contract of the capability carries is refused
   * with a SchemaError on `title`, nothing written. A capability with no number numbers nothing.
   */
  addContract(contract: NewContract, options?: WriteOptions): Promise<SchemaRecord<"contract">> {
    return this.#serially(async () => {
      await checkReference(this.#records, "capability", contract.capability, "capability");
      const title = await this.#numbered(contract.title, contract.capability);
      return this.#records.create("contract", { ...contract, title }, options);
    });
  }

  /**
   * Change only the named fields of a story, as capability 3's edit does. Returns null, and writes
   * nothing, if `id` is not a live story.
   */
  editStory(id: string, fields: StoryEdit, options?: WriteOptions): Promise<SchemaRecord<"story"> | null> {
    return this.#serially(async () => {
      if ((await liveRecord(this.#records, id, ["story"])) === null) return null;
      return (await this.#records.edit(id, fields, options)) as SchemaRecord<"story"> | null;
    });
  }

  /**
   * Change only the named fields of a contract, as capability 3's edit does. A new capability is
   * checked as addContract checks it, and a title or capability that would leave its number carried
   * by another live contract of the capability is refused as addContract refuses it. Returns null,
   * and writes nothing, if `id` is not a live contract.
   */
  editContract(id: string, fields: ContractEdit, options?: WriteOptions): Promise<SchemaRecord<"contract"> | null> {
    return this.#serially(async () => {
      if ((await liveRecord(this.#records, id, ["contract"])) === null) return null;
      await checkReference(this.#records, "capability", fields.capability, "capability");
      if (fields.title !== undefined || fields.capability !== undefined) {
        const stored = (await this.#records.get(id)) as SchemaRecord<"contract">;
        const title = fields.title ?? stored.fields.title;
        const capability = fields.capability ?? stored.fields.capability;
        if (typeof title === "string" && couldBeId(capability)) await this.#refuseTakenNumber(title, capability, id);
      }
      return (await this.#records.edit(id, fields, options)) as SchemaRecord<"contract"> | null;
    });
  }

  /**
   * Change only the named fields of an arc, as capability 3's edit does. New stories are checked as
   * createArc checks them. Returns null, and writes nothing, if `id` is not a live arc.
   */
  editArc(id: string, fields: ArcEdit, options?: WriteOptions): Promise<SchemaRecord<"arc"> | null> {
    return this.#serially(async () => {
      if ((await liveRecord(this.#records, id, ["arc"])) === null) return null;
      await checkReferences(this.#records, "stories", fields.stories, "story");
      return (await this.#records.edit(id, fields, options)) as SchemaRecord<"arc"> | null;
    });
  }

  /**
   * The plan as it is now: every story holding its capabilities, each holding its contracts, and
   * every arc, all in creation order. A capability or contract whose parent is not a live record
   * has no place in it.
   */
  async projectTree(): Promise<ProjectTree> {
    const [stories, capabilities, contracts, arcs] = await Promise.all([
      this.#records.list("story"),
      this.#records.list("capability"),
      this.#records.list("contract"),
      this.#records.list("arc"),
    ]);
    const capabilitiesOf = childrenByParent(capabilities, (capability) => capability.fields.story);
    const contractsOf = childrenByParent(contracts, (contract) => contract.fields.capability);
    return {
      stories: stories.sort(byCreation).map((story) => ({
        ...nodeOf(story),
        capabilities: (capabilitiesOf.get(story.id) ?? []).map((capability) => ({
          ...nodeOf(capability),
          dependsOn: [...(capability.fields.dependsOn ?? [])],
          proposed: capability.fields.proposed,
          contracts: (contractsOf.get(capability.id) ?? []).map(nodeOf),
        })),
      })),
      arcs: arcs.sort(byCreation).map((arc) => ({ ...nodeOf(arc), stories: [...(arc.fields.stories ?? [])] })),
    };
  }

  /** The live arcs listing the story `storyId`, in creation order. */
  async arcsFor(storyId: string): Promise<SchemaRecord<"arc">[]> {
    const arcs = await this.#records.list("arc");
    return arcs.filter((arc) => arc.fields.stories?.includes(storyId) === true).sort(byCreation);
  }

  /**
   * `title` as a new contract of `capability` carries it: refused if its number is taken there, and
   * given the next free number when it has none and the capability has one.
   */
  async #numbered(title: string, capability: string): Promise<string> {
    if (typeof title !== "string" || !couldBeId(capability)) return title; // the schema refuses it in the write
    if (contractNumber(title) !== undefined) {
      await this.#refuseTakenNumber(title, capability);
      return title;
    }
    const prefix = /^(\d+) · /.exec((await this.#titleOf(capability)) ?? "")?.[1];
    if (prefix === undefined) return title;
    const taken = (await this.#contractsOf(capability)).flatMap((contract) => {
      const number = contractNumber(contract.fields.title);
      return number?.startsWith(`${prefix}.`) ? [Number(number.slice(prefix.length + 1))] : [];
    });
    return `${prefix}.${Math.max(0, ...taken) + 1} · ${title}`;
  }

  /** Refuse `title` under `capability` when another live contract there (not `self`) carries its number. */
  async #refuseTakenNumber(title: string, capability: string, self?: string): Promise<void> {
    const number = contractNumber(title);
    if (number === undefined) return;
    const holder = (await this.#contractsOf(capability)).find((contract) => contract.id !== self && contractNumber(contract.fields.title) === number);
    if (holder !== undefined) {
      throw new SchemaError("contract", [{ field: "title", problem: `contract number ${number} is taken: ${holder.id} carries it in this capability; leave the number off to be given the next free one` }]);
    }
  }

  async #contractsOf(capability: string): Promise<SchemaRecord<"contract">[]> {
    return (await this.#records.list("contract")).filter((contract) => contract.fields.capability === capability);
  }

  /** The title of `capability`, when it names a stored capability (the schema refuses the rest in the write). */
  async #titleOf(capability: string): Promise<string | undefined> {
    const record = await this.#records.get(capability);
    return record?.type === "capability" ? (record as SchemaRecord<"capability">).fields.title : undefined;
  }

  /**
   * Throw a DependencyLoopError if capability `id` depending on `dependsOn` would close a loop:
   * that is, if the would-be graph (every live capability's dependencies as stored, with `id`'s
   * replaced by `dependsOn`) leads from `id` back round to `id`.
   */
  async #refuseLoop(id: string, dependsOn: readonly unknown[]): Promise<void> {
    const graph = new Map<string, readonly unknown[]>();
    for (const capability of await this.#records.list("capability")) {
      graph.set(capability.id, capability.fields.dependsOn ?? []);
    }
    graph.set(id, dependsOn);
    const loop = loopThrough(id, graph);
    if (loop !== undefined) throw new DependencyLoopError(loop);
  }

  /**
   * Run `write` once every write queued through this model before it has settled, so that a
   * write's checks and the write itself happen together: no other write through this model
   * comes between them. (Without this, two edits racing each other could each pass their loop
   * check against a graph without the other's edge, and together store a loop.)
   */
  #serially<T>(write: () => Promise<T>): Promise<T> {
    const result = this.#lastWrite.then(() => write());
    this.#lastWrite = result.catch(() => undefined);
    return result;
  }
}

/** What every node of the tree starts with. */
type NodeHead = Pick<StoryNode, "id" | "title" | "description">;

/** The id, title and, when it has one, description of a record in the tree. */
function nodeOf(record: PlanRecord): NodeHead {
  const { title, description } = record.fields;
  return { id: record.id, title, ...(description === undefined ? {} : { description }) };
}

/** `children` grouped by the id of the parent each points at, each group in creation order. */
function childrenByParent<R extends PlanRecord>(children: readonly R[], parentOf: (child: R) => string): Map<string, R[]> {
  const groups = new Map<string, R[]>();
  for (const child of [...children].sort(byCreation)) {
    const parent = parentOf(child);
    const siblings = groups.get(parent);
    if (siblings === undefined) groups.set(parent, [child]);
    else siblings.push(child);
  }
  return groups;
}

/**
 * A path along `graph`'s dependency edges from `start` back round to `start`, or undefined if
 * there is none. Depth-first, following each capability's dependencies in their stored order, so
 * the same loop is reported every time; iterative, so a long chain cannot overflow the stack.
 */
function loopThrough(start: string, graph: ReadonlyMap<string, readonly unknown[]>): string[] | undefined {
  const dependenciesOf = (id: string): Iterator<unknown> => (graph.get(id) ?? []).values();
  // The path walked from `start`, each step with the dependencies it has still to follow.
  const path = [{ id: start, next: dependenciesOf(start) }];
  const reached = new Set([start]);
  for (let step = path.at(-1); step !== undefined; step = path.at(-1)) {
    const next = step.next.next();
    if (next.done === true) {
      path.pop(); // every dependency of this step followed: back up
      continue;
    }
    const dependency = next.value;
    if (dependency === start) return [...path.map(({ id }) => id), start];
    if (typeof dependency !== "string" || reached.has(dependency)) continue;
    reached.add(dependency);
    path.push({ id: dependency, next: dependenciesOf(dependency) });
  }
  return undefined;
}

/** The number a contract's title starts with (capability, dot, contract), if it starts with one. */
function contractNumber(title: string): string | undefined {
  return /^(\d+\.\d+)(?![\d.])/.exec(title)?.[1];
}
