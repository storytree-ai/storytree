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
import path from "node:path";

import { byCreation } from "../creation-order.js";
import { checkReference, checkReferences, couldBeId, DependencyLoopError, liveRecord } from "../references.js";
import { SchemaError, type SchemaRecord, type SchemaRecords, type WriteOptions } from "../schema/index.js";
import type { FieldsOf } from "../schema/types.js";
import { historyOf, PR_CUTOVER_ID, type PrCutover } from "./pr-cutover.js";

/**
 * What one contract is, in two sentences: the habits card says it, and both front doors quote it when
 * a new contract's title runs past LONG_CONTRACT_TITLE characters, so two planners split one set of
 * requirements alike.
 */
export const CONTRACT_DEFINITION =
  "A contract is one behaviour seen from outside the code: what goes in (its inputs), what comes out (its outputs) and its errors. A promise that joins two such behaviours is two contracts, and one about how the code works inside is not a contract yet.";
/** A contract title past this many characters gets the advisory: about the longest eighth of 338 live contract titles, measured 2026-10-11. */
export const LONG_CONTRACT_TITLE = 300;

/** A new story's fields. A mapped story is mapStories' alone to make. */
export type NewStory = Omit<FieldsOf<"story">, "mapped">;
/** One package of an imported folder, as mapStories maps it to a story (ADR-0993 D2). */
export interface MappedPackage {
  /** The package's folder relative to the imported folder ("." for the folder itself): what a later import matches on. */
  readonly package: string;
  readonly title: string;
  readonly description?: string;
  /** The folders that hold its code. */
  readonly folders: readonly string[];
}
/** What one mapStories did: the stories it added, retired and left as they stand (ids, in the import's order). */
export interface MappedStories {
  readonly added: SchemaRecord<"story">[];
  readonly retired: string[];
  readonly kept: string[];
}
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
/** An edit of a story: some of its fields. A field set to undefined is removed. Mapped is mapStories' alone. */
export type StoryEdit = { [F in keyof NewStory]?: NewStory[F] | undefined };
/** An edit of a contract: some of its fields. A field set to undefined is removed. */
export type ContractEdit = { [F in keyof FieldsOf<"contract">]?: FieldsOf<"contract">[F] | undefined };
/** How a contract is added: as any write, and skipping the contract numbers `testedNumbers` (its capability's tests) carry. */
export interface ContractWriteOptions extends WriteOptions {
  readonly testedNumbers?: readonly string[];
}
/** An edit of an arc: some of its fields. A field set to undefined is removed. */
export type ArcEdit = { [F in keyof NewArc]?: NewArc[F] | undefined };
/** The project's sentence (ADR-1085 D1): what it is, and who it is for. Either half may be missing. */
export type Anchor = FieldsOf<"anchor">;
/** An edit of the anchor: some of its halves. A half set to undefined is removed. */
export type AnchorEdit = { [F in keyof Anchor]?: Anchor[F] | undefined };
/** The id the project's one anchor is kept at. */
export const ANCHOR_ID = "project-anchor";

/**
 * The plan-health reading of rule 1 (ADR-1085 D1): what the plan has not yet said. It never fails anything,
 * and it reads only that the words are there: the anchor's halves it lacks. Only the project names an
 * audience, so no story is ever named here (ADR-1096).
 */
export interface AnchorGaps {
  /** The anchor's halves not written, in the order the sentence reads: "what", then "audience". */
  anchor: ("what" | "audience")[];
}

/** `tree`'s anchor gaps (ADR-1085 D1): the anchor's halves it lacks. */
export function anchorGaps(tree: { anchor?: Anchor | undefined }): AnchorGaps {
  return { anchor: (["what", "audience"] as const).filter((half) => tree.anchor?.[half] === undefined) };
}

/** The plan of work as the forest reads it: story › capability › contract, and the arcs. */
export interface ProjectTree {
  /** The project's sentence, when any of it is written (ADR-1085 D1). */
  anchor?: Anchor;
  /** Every story, in creation order, each holding its capabilities. */
  stories: StoryNode[];
  /** Every arc, in creation order. */
  arcs: ArcNode[];
}

/** One extra check a story or capability carries, and what sets it off: a change to it, or a formal release. */
export type Guardrail = NonNullable<FieldsOf<"story">["guardrails"]>[number];

export interface StoryNode {
  id: string;
  title: string;
  description?: string;
  /** Where a mapped story's code is (ADR-0993 D2): its import, its package and the folders holding its code. */
  mapped?: { from: string; package: string; folders: string[] };
  /** Its risk reading as stored (question_1740edf77e9e), when one was read. */
  risk?: NonNullable<FieldsOf<"story">["risk"]>;
  /** Its own guardrails as stored (question_4cec0ba23052): the extra checks only it carries. */
  guardrails?: Guardrail[];
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
  /** An explored capability of a mapped story: the folders and files of its import it covers (ADR-0993 D5). */
  covers?: string[];
  /** Its own guardrails as stored (question_4cec0ba23052). */
  guardrails?: Guardrail[];
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
   * field, as is any other field a story does not have, and `mapped`, which only mapStories writes.
   */
  addStory(story: NewStory, options?: WriteOptions): Promise<SchemaRecord<"story">> {
    return this.#serially(() => {
      refuseMapped(story);
      return this.#records.create("story", story, options);
    });
  }

  /**
   * Map the packages of the import `from` to stories (ADR-0993 D2, D6), the only way a story is made
   * mapped: a package no live story of `from` maps gets a new mapped story, with no capabilities;
   * a live story of `from` whose package is not among `packages` is retired; every other story,
   * of `from` or not, stands as it is, so the folders an agent has redrawn are kept.
   */
  mapStories(from: string, packages: readonly MappedPackage[], options?: WriteOptions): Promise<MappedStories> {
    return this.#serially(async () => {
      const mapped = new Map<string, SchemaRecord<"story">>();
      for (const story of (await this.#records.list("story")).sort(byCreation)) {
        if (story.fields.mapped?.from === from) mapped.set(story.fields.mapped.package, story);
      }
      const named = new Set(packages.map((found) => found.package));
      const added: SchemaRecord<"story">[] = [];
      const kept: string[] = [];
      for (const found of packages) {
        const story = mapped.get(found.package);
        if (story !== undefined) {
          kept.push(story.id);
          continue;
        }
        const fields = { title: found.title, ...(found.description === undefined ? {} : { description: found.description }), mapped: { from, package: found.package, folders: [...found.folders] } };
        added.push(await this.#records.create("story", fields, options));
      }
      const retired: string[] = [];
      for (const [pkg, story] of mapped) {
        if (named.has(pkg)) continue;
        await this.#records.retire(story.id, `its package ${pkg} is no longer in ${from}`, options);
        retired.push(story.id);
      }
      return { added, retired, kept };
    });
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
   * A title given without a number gets the story's next free one, after the highest its live
   * capabilities carry, so the contracts planned on it are numbered from the start; a number another
   * live capability of the story carries is refused with a SchemaError on `title` naming that one and
   * the next free number, nothing written, since numbered tests map to a capability by its number. A
   * mapped story's capability is an explored one, and says what it covers, as #covered checks it.
   */
  addCapability(capability: NewCapability, options?: WriteOptions): Promise<SchemaRecord<"capability">> {
    return this.#serially(async () => {
      await checkReference(this.#records, "story", capability.story, "story");
      await checkReferences(this.#records, "dependsOn", capability.dependsOn, "capability");
      const covers = await this.#covered(capability.story, capability.covers);
      const title = await this.#capabilityNumbered(capability.title, capability.story);
      return this.#records.create("capability", { ...capability, title, proposed: capability.proposed ?? true, ...(covers === undefined ? {} : { covers }) }, options);
    });
  }

  /**
   * Change only the named fields of a capability, as capability 3's edit does. A new story or new
   * dependencies are checked as addCapability checks them, and new dependencies are also checked
   * against the dependency graph as it would be after the edit: one that would make the capability
   * depend on itself, directly or through others, is refused with a DependencyLoopError naming the
   * loop. A new story or new covers are checked, together, as addCapability checks them, and a new
   * title or story that would leave its number carried by another live capability of the story is
   * refused as addCapability refuses it. Returns null, and writes nothing, if `id` is not a live capability.
   */
  editCapability(id: string, fields: CapabilityEdit, options?: WriteOptions): Promise<SchemaRecord<"capability"> | null> {
    return this.#serially(async () => {
      const stored = (await liveRecord(this.#records, id, ["capability"])) as SchemaRecord<"capability"> | null;
      if (stored === null) return null;
      await checkReference(this.#records, "story", fields.story, "story");
      await checkReferences(this.#records, "dependsOn", fields.dependsOn, "capability");
      if (Array.isArray(fields.dependsOn)) await this.#refuseLoop(id, fields.dependsOn);
      if (fields.title !== undefined || fields.story !== undefined) await this.#refuseTakenCapabilityNumber(fields.title ?? stored.fields.title, fields.story ?? stored.fields.story, id);
      let edit = fields;
      if ("story" in fields || "covers" in fields) {
        const covers = await this.#covered(fields.story ?? stored.fields.story, "covers" in fields ? fields.covers : stored.fields.covers, id);
        if ("covers" in fields) edit = { ...fields, covers };
      }
      return (await this.#records.edit(id, edit, options)) as SchemaRecord<"capability"> | null;
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
   * `testedNumbers`, the contract numbers the capability's tests already carry, are skipped too, so
   * the next free number is past them, even one no live contract carries: a test without a contract
   * may promise something else, so only a number given binds the contract to it. A number given is
   * kept, which is how a landed or red test's contract gets planned, and written with its " · "
   * when it came without (editContract too), since that is the form readers find a number in.
   */
  addContract(contract: NewContract, options?: ContractWriteOptions): Promise<SchemaRecord<"contract">> {
    return this.#serially(async () => {
      await checkReference(this.#records, "capability", contract.capability, "capability");
      const title = await this.#numbered(contract.title, contract.capability, options?.testedNumbers ?? []);
      return this.#records.create("contract", { ...contract, title }, options);
    });
  }

  /**
   * Change only the named fields of a story, as capability 3's edit does, except `mapped`, refused
   * as addStory refuses it. Returns null, and writes nothing, if `id` is not a live story. A story
   * carries no audience (ADR-1096): one stored before is dropped by the edit, and one given is refused.
   */
  editStory(id: string, fields: StoryEdit, options?: WriteOptions): Promise<SchemaRecord<"story"> | null> {
    return this.#serially(async () => {
      refuseMapped(fields);
      if ((await liveRecord(this.#records, id, ["story"])) === null) return null;
      return (await this.#records.edit(id, { audience: undefined, ...fields } as StoryEdit, options)) as SchemaRecord<"story"> | null;
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
      const edit = typeof fields.title === "string" ? { ...fields, title: separated(fields.title) } : fields;
      return (await this.#records.edit(id, edit, options)) as SchemaRecord<"contract"> | null;
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
    const [stories, capabilities, contracts, arcs, anchor] = await Promise.all([
      this.#records.list("story"),
      this.#records.list("capability"),
      this.#records.list("contract"),
      this.#records.list("arc"),
      this.anchor(),
    ]);
    const capabilitiesOf = childrenByParent(capabilities, (capability) => capability.fields.story);
    const contractsOf = childrenByParent(contracts, (contract) => contract.fields.capability);
    return {
      ...(anchor === undefined ? {} : { anchor }),
      stories: stories.sort(byCreation).map((story) => ({
        ...nodeOf(story),
        ...(story.fields.mapped === undefined ? {} : { mapped: { ...story.fields.mapped, folders: [...story.fields.mapped.folders] } }),
        ...(story.fields.risk === undefined ? {} : { risk: structuredClone(story.fields.risk) }),
        ...guardrailsOf(story),
        capabilities: (capabilitiesOf.get(story.id) ?? []).map((capability) => ({
          ...nodeOf(capability),
          dependsOn: [...(capability.fields.dependsOn ?? [])],
          proposed: capability.fields.proposed,
          ...(capability.fields.covers === undefined ? {} : { covers: [...capability.fields.covers] }),
          ...guardrailsOf(capability),
          contracts: (contractsOf.get(capability.id) ?? []).map(nodeOf),
        })),
      })),
      arcs: arcs.sort(byCreation).map((arc) => ({ ...nodeOf(arc), stories: [...(arc.fields.stories ?? [])] })),
    };
  }

  /** The project's sentence as written (ADR-1085 D1), or undefined when neither half is. */
  async anchor(): Promise<Anchor | undefined> {
    const record = (await liveRecord(this.#records, ANCHOR_ID, ["anchor"])) as SchemaRecord<"anchor"> | null;
    if (record === null || (record.fields.what === undefined && record.fields.audience === undefined)) return undefined;
    return { ...record.fields };
  }

  /**
   * Write the project's sentence (ADR-1085 D1): only the halves given change, and a half given as undefined is
   * removed. The first write makes the anchor, at ANCHOR_ID; each is an edit like any other, so its writer is in
   * the history. An empty half is refused, as the schema refuses it, with nothing written.
   */
  setAnchor(fields: AnchorEdit, options?: WriteOptions): Promise<SchemaRecord<"anchor">> {
    return this.#serially(async () => {
      if ((await liveRecord(this.#records, ANCHOR_ID, ["anchor"])) === null) {
        const given = Object.fromEntries(Object.entries(fields).filter(([, value]) => value !== undefined));
        return this.#records.create("anchor", given as Anchor, { ...options, id: ANCHOR_ID });
      }
      return (await this.#records.edit(ANCHOR_ID, fields, options)) as SchemaRecord<"anchor">;
    });
  }

  /** The project's repository cut-over (increment_7f7599b35fe4), or undefined while it has none. */
  async prCutover(): Promise<PrCutover | undefined> {
    const record = (await liveRecord(this.#records, PR_CUTOVER_ID, ["prCutover"])) as SchemaRecord<"prCutover"> | null;
    return record === null ? undefined : { ...record.fields };
  }

  /**
   * Write the repository cut-over: the first write makes it at PR_CUTOVER_ID and needs its time and repository, `before`
   * then defaulting to that repository renamed `<name>-history`; a later write changes only the fields given. The
   * schema refuses a bad time or name with nothing written.
   */
  setPrCutover(fields: Partial<PrCutover>, options?: WriteOptions): Promise<SchemaRecord<"prCutover">> {
    return this.#serially(async () => {
      if ((await liveRecord(this.#records, PR_CUTOVER_ID, ["prCutover"])) === null) {
        const before = fields.before !== undefined ? fields.before : fields.repository === undefined ? undefined : historyOf(fields.repository);
        return this.#records.create("prCutover", { ...fields, before } as PrCutover, { ...options, id: PR_CUTOVER_ID });
      }
      return (await this.#records.edit(PR_CUTOVER_ID, fields, options)) as SchemaRecord<"prCutover">;
    });
  }

  /** The live arcs listing the story `storyId`, in creation order. */
  async arcsFor(storyId: string): Promise<SchemaRecord<"arc">[]> {
    const arcs = await this.#records.list("arc");
    return arcs.filter((arc) => arc.fields.stories?.includes(storyId) === true).sort(byCreation);
  }

  /**
   * `title` as a new contract of `capability` carries it: refused if its number is taken there, and
   * given the next free number, past its contracts' and its tests' numbers, when it has none and the
   * capability has one.
   */
  async #numbered(title: string, capability: string, tested: readonly string[]): Promise<string> {
    if (typeof title !== "string" || !couldBeId(capability)) return title; // the schema refuses it in the write
    if (contractNumber(title) !== undefined) {
      await this.#refuseTakenNumber(title, capability);
      return separated(title);
    }
    const prefix = /^(\d+) · /.exec((await this.#titleOf(capability)) ?? "")?.[1];
    if (prefix === undefined) return title;
    const own = (numbers: readonly (string | undefined)[]) => numbers.flatMap((number) => (number?.startsWith(`${prefix}.`) ? [Number(number.slice(prefix.length + 1))] : []));
    const planned = own((await this.#contractsOf(capability)).map((contract) => contractNumber(contract.fields.title)));
    return `${prefix}.${Math.max(0, ...planned, ...own(tested)) + 1} · ${title}`;
  }

  /** `title` as a new capability of `story` carries it: refused if its number is taken there, and given the story's next free number when it has none. */
  async #capabilityNumbered(title: string, story: string): Promise<string> {
    if (typeof title !== "string") return title; // the schema refuses it in the write
    if (capabilityNumber(title) !== undefined) {
      await this.#refuseTakenCapabilityNumber(title, story);
      return title;
    }
    return `${nextFree(await this.#capabilitiesOf(story))} · ${title}`;
  }

  /** Refuse `title` on `story` when another live capability there (not `self`) carries its number, naming it and the next free number. */
  async #refuseTakenCapabilityNumber(title: unknown, story: unknown, self?: string): Promise<void> {
    const number = capabilityNumber(title);
    if (number === undefined || typeof story !== "string") return;
    const theirs = await this.#capabilitiesOf(story);
    const holder = theirs.find((capability) => capability.id !== self && capabilityNumber(capability.fields.title) === number);
    if (holder !== undefined) {
      throw new SchemaError("capability", [{ field: "title", problem: `capability number ${number} is taken: ${holder.id} (${holder.fields.title}) carries it in this story; the next free number is ${nextFree(theirs)}` }]);
    }
  }

  async #capabilitiesOf(story: string): Promise<SchemaRecord<"capability">[]> {
    return (await this.#records.list("capability")).filter((capability) => capability.fields.story === story);
  }

  /**
   * `covers` as a capability of `story` (not `self`) carries it (ADR-0993 D5): none on a story storytree built, whose
   * files its numbered tests find; on a mapped story at least one path, each written from the imported folder with
   * forward slashes, inside one of the story's folders, and covering no file another of its capabilities covers, the
   * refusal naming that one so the agent corrects it rather than adding another. Undefined when it covers nothing.
   */
  async #covered(story: string, covers: readonly unknown[] | undefined, self?: string): Promise<string[] | undefined> {
    const given = covers as string[] | undefined; // what is not a list of text the schema refuses in the write
    const record = couldBeId(story) ? await this.#records.get(story) : null;
    if (record?.type !== "story") return given; // the reference check refuses it first
    const mapped = (record as SchemaRecord<"story">).fields.mapped;
    const refuse = (problem: string): never => { throw new SchemaError("capability", [{ field: "covers", problem }]); };
    if (mapped === undefined) {
      if (covers !== undefined) refuse("a capability of a story storytree built covers no folders: its numbered tests find its files");
      return undefined;
    }
    if (covers !== undefined && !Array.isArray(covers)) return given; // the schema refuses it in the write, naming the list
    if (covers === undefined || covers.length === 0) refuse(`a capability of the mapped story ${story} names the folders and files of its import it covers`);
    if (!covers!.every((cover) => typeof cover === "string" && cover !== "")) return given;
    const paths = given!.map((cover) => {
      const plain = path.posix.normalize(cover.replaceAll("\\", "/")).replace(/\/+$/, "") || ".";
      if (plain === ".." || plain.startsWith("../") || path.posix.isAbsolute(plain) || /^[A-Za-z]:/.test(plain)) refuse(`${cover} is outside the imported folder: give it from there`);
      if (!mapped.folders.some((folder) => within(plain, path.posix.normalize(folder)))) refuse(`${cover} is outside the story's folders (${mapped.folders.join(", ")})`);
      return plain;
    });
    for (const other of await this.#records.list("capability")) {
      if (other.id === self || other.fields.story !== story) continue;
      for (const theirs of other.fields.covers ?? []) {
        const mine = paths.find((plain) => within(plain, theirs) || within(theirs, plain));
        if (mine !== undefined) refuse(`${mine} overlaps ${theirs}, which ${other.id} (${other.fields.title}) covers: correct that capability instead, or cover a path it does not`);
      }
    }
    return paths;
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

/** Whether `inner` is `outer` or lies under it (both plain paths from an imported folder, "." its top). */
function within(inner: string, outer: string): boolean {
  return outer === "." || inner === outer || inner.startsWith(`${outer}/`);
}

/** Refuse a `mapped` field: only mapStories makes a story mapped (ADR-0993 D2). */
function refuseMapped(fields: object): void {
  if ("mapped" in fields) throw new SchemaError("story", [{ field: "mapped", problem: "a story is made mapped only by importing a project" }]);
}

/** What every node of the tree starts with. */
type NodeHead = Pick<StoryNode, "id" | "title" | "description">;

/** The id, title and, when it has one, description of a record in the tree. */
function nodeOf(record: PlanRecord): NodeHead {
  const { title, description } = record.fields;
  return { id: record.id, title, ...(description === undefined ? {} : { description }) };
}

/** A story's or capability's guardrails, copied, when it carries any. */
function guardrailsOf(record: SchemaRecord<"story"> | SchemaRecord<"capability">): { guardrails?: Guardrail[] } {
  const { guardrails } = record.fields;
  return guardrails === undefined ? {} : { guardrails: guardrails.map((guardrail) => ({ ...guardrail })) };
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

/** The number a capability's title starts with, if it starts with one ("3 · Email form"). */
function capabilityNumber(title: unknown): number | undefined {
  const number = typeof title === "string" ? /^(\d+) · /.exec(title)?.[1] : undefined;
  return number === undefined ? undefined : Number(number);
}

/** The number after the highest that `capabilities` carry. */
function nextFree(capabilities: readonly SchemaRecord<"capability">[]): number {
  return Math.max(0, ...capabilities.flatMap((capability) => capabilityNumber(capability.fields.title) ?? [])) + 1;
}

/** `title` with its contract number followed by " · ", as every reader of contract numbers expects: "5.38 Text" becomes "5.38 · Text". */
function separated(title: string): string {
  return title.replace(/^(\d+\.\d+)\s+(?!·)(?=\S)/, "$1 · ");
}

/** The number a contract's title starts with (capability, dot, contract), if it starts with one. */
function contractNumber(title: string): string | undefined {
  return /^(\d+\.\d+)(?![\d.])/.exec(title)?.[1];
}

/** Its section of the habits card (ADR-1021, the guidance kind): planning stories, capabilities, contracts, arcs and increments. */
export const planGuidance: readonly string[] = [
  [
  "Plan first. When the user asks you to build or change something, plan it in storytree before you build it, even when they never mention storytree and the work is small: a story for what they will be able to do, a capability for each part that makes it work, and a contract for each promise its tests will keep. The plan is how the user watches the work grow, so asking only for the work is no reason to skip it.",
  "- `focus` shows what a file, capability, promise or story depends on (up) and what depends on it (down). Start with counts, then dry_run or a narrowed show; an oversized show refuses with counts.",
  "- `show_plan` shows the plan: every story, capability and contract with its health, who holds what, and which sessions are about. `health_worklist` lists the oldest capabilities that are not healthy, with why and who moves each: route each into an increment whose capabilities list names it, held on a question when only the owner can move it.",
  `- Plan a story (something a user can do) with \`plan_story\`, the parts that make it work with \`plan_capability\`, and each testable promise with \`plan_contract\`. ${CONTRACT_DEFINITION} A story or capability starts with its founding decision: what it is for, and the one choice that shapes it. Group stories under an initiative with \`plan_arc\`. Correct any of them with \`edit_plan\`, and \`retire_from_plan\` a capability or contract no longer wanted, with the reason.`,
  "- Break an arc's work into increments with `park_increment` (the breakdown goes in its body, its capabilities list left empty); claiming one starts it, and as you plan it you fill its capabilities list, the capabilities it changes and nothing else, with `edit_plan`, citing its stories as links. `move_increment` re-homes one on another arc, keeping its id. `add_remedies` makes a parked one the fix for friction. `park_arc` parks or unparks an arc.",
  "- When one piece of work must wait for another, `set_wait` with the reason; when an increment waits for something outside the plan, an action only the owner can take that is not a decision, or an outside event, `set_wait` for the owner or the event, with a note (an event needs a day to check back). `clear_wait` when it no longer must.",
  "- When only the owner can decide (see Who decides what, below), land what is green first and push the rest to a branch named on the increment, then `raise_question` on the arc instead of only asking in chat, holding the increments that need the answer: it releases your claims on them. `correct_question` fixes its wording while it is open, and `move_question` re-homes it on another arc, keeping its id. Before you put an open question to the owner, `present_question` marks it as yours to ask; refused, another session is asking him already, so skip it, and `present_question` with done when you move on without his answer. `settle_question` with the answer, in the owner's own words; `retire_question` one that was wrong to ask.",
  ].join("\n"),
];
