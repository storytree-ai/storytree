/**
 * Capability 4 · Work model (the library story): each project's plan structure. Stories belong to
 * the project; a capability points at its story, and a contract at its capability. The library
 * refuses broken structure. Arcs, the work that grows the plan, are capability 10's to write
 * (ADR-1242 D2); the plan's tree reads them.
 *
 * WorkModel is a layer over capability 3's SchemaRecords, so it runs unchanged on the in-memory
 * twin and on Postgres. Every write checks its references (and, for an edit of a capability's
 * dependencies, the would-be dependency graph) BEFORE writing, and a refusal throws with nothing
 * written. The record itself is then checked against its type inside the write, as capability 3
 * checks every write.
 */
import path from "node:path";
import { isDeepStrictEqual } from "node:util";

import { byCreation } from "../creation-order.js";
import { checkReference, checkReferences, couldBeId, DependencyLoopError, liveRecord } from "../references.js";
import { SchemaError, type SchemaRecord, type SchemaRecords, type WriteOptions } from "../schema/index.js";
import type { CONTRACT_PROOFS, FieldsOf } from "../schema/types.js";
import { historyOf, PR_CUTOVER_ID, type PrCutover } from "./pr-cutover.js";

/**
 * What one contract is, in two sentences: the habits card says it, and both front doors quote it when
 * a new contract's title runs past LONG_CONTRACT_TITLE characters, so two planners split one set of
 * requirements alike.
 */
export const CONTRACT_DEFINITION =
  "A contract is one behaviour seen from outside the code: what goes in (its inputs), what comes out (its outputs) and its errors. A guarantee that joins two such behaviours is two contracts, and one about how the code works inside is not a contract yet.";
/**
 * Where a contract goes, in one sentence: the habits card says it, and plan_contract's description quotes it, so an
 * agent files each contract where its own diagnosis puts the fault, not on the entry point every test drives
 * (increment_9f30bbbf5886: a guided run planned all 21 contracts on its HTTP entry point, though it named faults in two
 * other parts and one between them).
 */
export const CONTRACT_PLACEMENT =
  "A contract goes on the part whose behaviour it pins, even when its test drives the whole service through one entry point, and a guarantee about what passes between two parts goes on their edge.";
/** A contract title past this many characters gets the advisory: about the longest eighth of 338 live contract titles, measured 2026-10-11. */
export const LONG_CONTRACT_TITLE = 300;

/** A new story's fields. A mapped story is mapStories' alone to make, and a plugin's story importPluginPlan's. */
export type NewStory = Omit<FieldsOf<"story">, "mapped" | "plugin">;
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
 * A factory plugin's plan of its own story (ADR-1187), as the plan file in its folder holds it: the one
 * source of the story, its capabilities and its contracts. Every capability and contract is numbered, since a later
 * import matches them by number; a capability's dependencies are capability ids.
 */
export interface PluginPlan {
  readonly story: { readonly title: string; readonly description?: string; readonly text?: string };
  readonly capabilities: readonly PluginPlanCapability[];
}
export interface PluginPlanCapability {
  readonly title: string;
  readonly description?: string;
  readonly text?: string;
  /** On until the plugin says it is built (ADR-0744 D2); proposed when not given. */
  readonly proposed?: boolean;
  readonly dependsOn?: string[];
  /** Each contract's proof says how it is proved (CONTRACT_PROOFS), written only here for a plugin's contract. */
  readonly contracts: readonly { readonly title: string; readonly description?: string; readonly proof?: { readonly by: (typeof CONTRACT_PROOFS)[number]; readonly reason: string } }[];
}
/** What one importPluginPlan did: the plugin's story, and the ids of the records it added, edited, retired and kept as they stood. */
export interface ImportedPluginPlan {
  readonly story: string;
  readonly added: string[];
  readonly edited: string[];
  readonly retired: string[];
  readonly kept: string[];
  /** The live records the plan does not hold that it left, since its source never held their numbers (`held`). */
  readonly left: string[];
  /** The kept records with a field the plan would change from a value its source never held (`held.versions`), left as it stands. */
  readonly stood: string[];
}
/**
 * The capability and contract numbers a plugin's plan source has ever held (every version of its plan file in the
 * source's history, and the file as it stands): an import from it retires only what these name.
 */
export interface PluginPlanHeld {
  readonly capabilities: readonly number[];
  readonly contracts: readonly string[];
  /** Every version of the plan file in the source's history, and as it stands, each as parsed: given, an import edits a kept record's text only from a value one of them held. */
  readonly versions?: readonly unknown[];
}
/** A new capability's fields: `story` and every `dependsOn` id must name existing records. It is proposed unless told otherwise. */
export type NewCapability = Omit<FieldsOf<"capability">, "proposed"> & { proposed?: boolean };
/** A new contract's fields: `capability` must name an existing capability, or `edge` an existing edge (ADR-1282 D1). */
export type NewContract = FieldsOf<"contract">;
/** A new edge's fields: `from` depends on `to`, two live capabilities of one story (ADR-1282 D1). */
export type NewEdge = FieldsOf<"edge">;
/** An edit of an edge: its description. An edge keeps its two capabilities; a field set to undefined is removed. */
export type EdgeEdit = { description?: string | undefined };
/** What one moveDependsOnToEdges did: the edges it wrote, and the capabilities whose stored dependsOn it emptied of them. */
export interface MovedToEdges {
  readonly edges: string[];
  readonly capabilities: string[];
}
/** An edit of a capability: some of its fields. A field set to undefined is removed. */
export type CapabilityEdit = { [F in keyof FieldsOf<"capability">]?: FieldsOf<"capability">[F] | undefined };
/** An edit of a story: some of its fields. A field set to undefined is removed. Mapped is mapStories' alone, and plugin importPluginPlan's. */
export type StoryEdit = { [F in keyof NewStory]?: NewStory[F] | undefined };
/** An edit of a contract: some of its fields. A field set to undefined is removed. */
export type ContractEdit = { [F in keyof FieldsOf<"contract">]?: FieldsOf<"contract">[F] | undefined };
/** How a contract is added: as any write, and skipping the contract numbers `testedNumbers` (its capability's tests) carry. */
export interface ContractWriteOptions extends WriteOptions {
  readonly testedNumbers?: readonly string[];
}
/** One pending plan change an increment holds (ADR-0966 D1). */
type PendingPlanChange = NonNullable<FieldsOf<"increment">["pending"]>[number];
/**
 * How a capability is added: as any write, and judging its number against its story as `pending`, the pending
 * changes of the increment the writer's branch drives, would leave it (ADR-0966 D3), so a number the branch's own
 * move or retirement frees is free and one its move brings in is taken.
 */
export interface CapabilityWriteOptions extends WriteOptions {
  readonly pending?: readonly PendingPlanChange[];
}
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
  /** The factory plugin whose plan file it, its capabilities and contracts are read from (ADR-1187). */
  plugin?: string;
  /** Its risk reading as stored (question_1740edf77e9e), when one was read. */
  risk?: NonNullable<FieldsOf<"story">["risk"]>;
  /** Its own guardrails as stored (question_4cec0ba23052): the extra checks only it carries. */
  guardrails?: Guardrail[];
  /** The capabilities pointing at this story, in creation order. */
  capabilities: CapabilityNode[];
  /** The edges between its capabilities, in creation order, when it has any (ADR-1282 D1). */
  edges?: EdgeNode[];
}

/** An edge inside one story (ADR-1282 D1): capability `from` depends on capability `to`, with its own contracts. */
export interface EdgeNode {
  id: string;
  from: string;
  to: string;
  description?: string;
  /** The contracts pointing at this edge, in creation order: never either capability's. */
  contracts: ContractNode[];
}

export interface CapabilityNode {
  id: string;
  title: string;
  description?: string;
  /**
   * The capabilities this one depends on: the ones its story's edges from it reach, in the edges' creation order, then
   * those stored on it (another story's, and any of its own story's not yet moved onto an edge), ADR-1282 D1.
   */
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
  /** The existing tests that prove it, as stored, when it names any (question_b5918c0ff273). */
  provedBy?: string[];
  /** How it is proved, with its reason, as stored, once chosen (ADR-1294). */
  proof?: { by: (typeof CONTRACT_PROOFS)[number]; reason: string };
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
/** A record the tree groups under a parent: a plan record or an edge. */
type GroupedRecord = PlanRecord | SchemaRecord<"edge">;

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
   * Write factory plugin `plugin`'s story from its plan (ADR-1187), the only way a story becomes a plugin's:
   * its live story is the one marked as `plugin`'s, or, the first time, the live story `adopt` names, else a new one.
   * Its capabilities are matched by number and their contracts by theirs: what changed is edited, what is new added,
   * and what the plan no longer holds retired, a capability's contracts with it, so a kept record keeps its id, links
   * and health. Given `held`, the numbers the plan's source ever held, it retires only those, and leaves any other live
   * record (one another lane landed after a stale source was cut) as it stands, reporting it left. Given `held.versions`
   * as well, it changes a kept record's text (a story's, capability's or contract's title and description, a capability's
   * text and proposed, a contract's proof) only from a value one of them held, and leaves a field another lane changed since as it stands,
   * reporting the record stood; a story it adopts has no such history. Everything is checked first, and a plan with a capability or contract carrying no number or a number
   * twice, a contract numbered under another capability, or an `adopt` that is mapped, another plugin's or not this
   * plugin's own story, is refused (SchemaError) with nothing written.
   */
  importPluginPlan(plugin: string, plan: PluginPlan, options: WriteOptions & { adopt?: string; held?: PluginPlanHeld } = {}): Promise<ImportedPluginPlan> {
    return this.#serially(async () => {
      const refuse = (field: string, problem: string): never => { throw new SchemaError("story", [{ field, problem }]); };
      if (typeof plugin !== "string" || plugin === "") refuse("plugin", "a plugin's story names its plugin");
      const stories = await this.#records.list("story");
      const own = stories.find((story) => story.fields.plugin === plugin);
      let story = own;
      if (options.adopt !== undefined && options.adopt !== own?.id) {
        if (own !== undefined) refuse("plugin", `${plugin}'s story is ${own.id}, not ${options.adopt}`);
        story = stories.find((candidate) => candidate.id === options.adopt);
        if (story === undefined) refuse("plugin", `${options.adopt} is not a live story to adopt`);
        if (story!.fields.mapped !== undefined) refuse("plugin", `${story!.id} is imported from ${story!.fields.mapped.from}, so it is that import's`);
        if (story!.fields.plugin !== undefined) refuse("plugin", `${story!.id} is ${story!.fields.plugin}'s story`);
      }
      const capabilities = new Map<number, SchemaRecord<"capability">>();
      for (const capability of story === undefined ? [] : await this.#capabilitiesOf(story.id)) {
        const number = capabilityNumber(capability.fields.title);
        if (number === undefined) refuse("plugin", `${capability.id} (${capability.fields.title}) carries no number for the plan to match it by`);
        capabilities.set(number!, capability);
      }
      const planned = new Set<number>();
      for (const capability of plan.capabilities) {
        const number = capabilityNumber(capability.title);
        if (number === undefined) refuse("plugin", `the plan's capability "${capability.title}" carries no number`);
        if (planned.has(number!)) refuse("plugin", `the plan numbers two capabilities ${number}`);
        planned.add(number!);
        const contracts = new Set<string>();
        for (const contract of capability.contracts) {
          const own = contractNumber(contract.title);
          if (own === undefined) refuse("plugin", `the plan's contract "${contract.title}" carries no number`);
          if (!own!.startsWith(`${number}.`)) refuse("plugin", `the plan's contract ${own} is under capability ${number}`);
          if (contracts.has(own!)) refuse("plugin", `the plan numbers two contracts ${own}`);
          contracts.add(own!);
          this.#records.check("contract", { ...contract, capability: "capability_000000000000" });
        }
        this.#records.check("capability", { ...withoutContracts(capability), proposed: capability.proposed ?? true, story: "story_000000000000" });
        await checkReferences(this.#records, "dependsOn", capability.dependsOn, "capability");
      }
      const storyFields = { ...plan.story, plugin };
      this.#records.check("story", storyFields);

      const done: ImportedPluginPlan = { story: "", added: [], edited: [], retired: [], kept: [], left: [], stood: [] };
      const heldCapabilities = options.held === undefined ? undefined : new Set(options.held.capabilities);
      const heldContracts = options.held === undefined ? undefined : new Set(options.held.contracts);
      const held = options.held?.versions === undefined || own === undefined ? undefined : heldValues(options.held.versions);
      /**
       * Write `fields` over `record` when they differ in any of `owned`, a field missing from `fields` being removed, but
       * none whose live value no version the source held (`held`, under `key`) had: that one stands, and so is said.
       */
      const update = async (record: SchemaRecord, fields: Record<string, unknown>, owned: readonly string[], key: string): Promise<void> => {
        const live = record.fields as Record<string, unknown>;
        const changed = owned.filter((field) => !isDeepStrictEqual(fields[field], live[field]));
        const stands = (field: string): boolean => held !== undefined && GUARDED_PLAN_FIELDS.has(field) && !(held.get(`${key}:${field}`) ?? []).some((value) => isDeepStrictEqual(value, live[field]));
        if (changed.some(stands)) done.stood.push(record.id);
        const edit = Object.fromEntries(changed.filter((field) => !stands(field)).map((field) => [field, fields[field]]));
        if (Object.keys(edit).length === 0) {
          done.kept.push(record.id);
          return;
        }
        await this.#records.edit(record.id, edit, options);
        done.edited.push(record.id);
      };
      if (story === undefined) {
        story = await this.#records.create("story", storyFields, options);
        done.added.push(story.id);
      } else await update(story, storyFields, PLUGIN_STORY_FIELDS, "story");
      const storyId = story.id;
      for (const capability of plan.capabilities) {
        // Its dependsOn is written as its links are: the story's own capabilities on edges, another story's stored (ADR-1282 D2).
        const { dependsOn: wanted, ...fields } = { ...withoutContracts(capability), proposed: capability.proposed ?? true, story: storyId };
        let stored = capabilities.get(capabilityNumber(capability.title)!);
        const contracts = new Map<string, SchemaRecord<"contract">>();
        if (stored === undefined) {
          const links = wanted === undefined ? undefined : await this.#split(storyId, wanted);
          stored = await this.#records.create("capability", { ...fields, ...(links === undefined ? {} : { dependsOn: links.cross }) }, options);
          for (const to of links?.same ?? []) await this.#records.create("edge", { from: stored.id, to }, options);
          done.added.push(stored.id);
        } else {
          const face = await this.#faceOf(stored.id);
          const relink = !sameMembers(face, wanted ?? []);
          await update(stored, { ...fields, ...(relink ? {} : { dependsOn: stored.fields.dependsOn }) }, relink ? PLUGIN_CAPABILITY_FIELDS.filter((field) => field !== "dependsOn") : PLUGIN_CAPABILITY_FIELDS, `capability ${capabilityNumber(capability.title)}`);
          if (relink) {
            await this.#applyRelink(await this.#relink({ id: stored.id, story: storyId, face: wanted ?? [] }, { id: stored.id, story: storyId, face: wanted ?? [] }), options);
            if (done.kept.at(-1) === stored.id) done.kept.pop();
            if (!done.edited.includes(stored.id)) done.edited.push(stored.id);
          }
          for (const contract of await this.#contractsOf(stored.id)) contracts.set(contractNumber(contract.fields.title) ?? contract.id, contract);
        }
        for (const contract of capability.contracts) {
          const number = contractNumber(contract.title)!;
          const fieldsOf = { ...contract, title: separated(contract.title), capability: stored.id };
          const theirs = contracts.get(number);
          contracts.delete(number);
          if (theirs === undefined) done.added.push((await this.#records.create("contract", fieldsOf, options)).id);
          else await update(theirs, fieldsOf, PLUGIN_CONTRACT_FIELDS, `contract ${number}`);
        }
        for (const [number, gone] of contracts) {
          if (heldContracts !== undefined && !heldContracts.has(number)) {
            done.left.push(gone.id);
            continue;
          }
          await this.#records.retire(gone.id, `${plugin}'s plan no longer holds it`, options);
          done.retired.push(gone.id);
        }
      }
      for (const [number, gone] of capabilities) {
        if (planned.has(number)) continue;
        if (heldCapabilities !== undefined && !heldCapabilities.has(number)) {
          done.left.push(gone.id, ...(await this.#contractsOf(gone.id)).map((contract) => contract.id));
          continue;
        }
        for (const contract of await this.#contractsOf(gone.id)) {
          await this.#records.retire(contract.id, `${plugin}'s plan no longer holds its capability`, options);
          done.retired.push(contract.id);
        }
        await this.#records.retire(gone.id, `${plugin}'s plan no longer holds it`, options);
        done.retired.push(gone.id);
      }
      return { ...done, story: storyId };
    });
  }

  /**
   * Add a capability to a story. The story, and every capability it depends on, must be live
   * records of those types (MissingReferenceError otherwise). A new capability cannot close a
   * dependency loop, since nothing can depend on it yet. It is born proposed unless told otherwise.
   * A title given without a number gets the story's next free one, after the highest its live
   * capabilities carry, so the contracts planned on it are numbered from the start; a number another
   * live capability of the story carries is refused with a SchemaError on `title` naming that one and
   * the next free number, nothing written, since numbered tests map to a capability by its number. Given
   * `pending`, the story is judged as those pending changes would leave it. A mapped story's capability is an explored one, and says what it covers, as #covered checks it.
   */
  addCapability(capability: NewCapability, options?: CapabilityWriteOptions): Promise<SchemaRecord<"capability">> {
    return this.#serially(async () => {
      this.#refusePlugins("capability", "story", await this.#pluginOfStory(capability.story));
      await checkReference(this.#records, "story", capability.story, "story");
      await checkReferences(this.#records, "dependsOn", capability.dependsOn, "capability");
      const covers = await this.#covered(capability.story, capability.covers);
      const { pending = [], ...write } = options ?? {};
      const title = await this.#capabilityNumbered(capability.title, capability.story, pending);
      // What is not a list of ids the schema refuses in the write, naming the field.
      const links = !Array.isArray(capability.dependsOn) ? undefined : await this.#split(capability.story, capability.dependsOn);
      const fields = { ...capability, title, proposed: capability.proposed ?? true, ...(covers === undefined ? {} : { covers }), ...(links === undefined ? {} : { dependsOn: links.cross }) };
      const created = await this.#records.create("capability", fields, write);
      if (links === undefined) return created;
      for (const to of links.same) await this.#records.create("edge", { from: created.id, to }, write);
      return withFace(created, await this.#faceOf(created.id));
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
      await this.refusePluginEdit(stored, fields);
      await checkReference(this.#records, "story", fields.story, "story");
      await checkReferences(this.#records, "dependsOn", fields.dependsOn, "capability");
      if (Array.isArray(fields.dependsOn)) await this.#refuseLoop(id, fields.dependsOn);
      if (fields.title !== undefined || fields.story !== undefined) await this.#refuseTakenCapabilityNumber(fields.title ?? stored.fields.title, fields.story ?? stored.fields.story, id);
      let edit: CapabilityEdit = fields;
      if ("story" in fields || "covers" in fields) {
        const covers = await this.#covered(fields.story ?? stored.fields.story, "covers" in fields ? fields.covers : stored.fields.covers, id);
        if ("covers" in fields) edit = { ...fields, covers };
      }
      const listed = !("dependsOn" in fields) || fields.dependsOn === undefined || Array.isArray(fields.dependsOn); // the schema refuses the rest in the write
      const relinks = listed && ("dependsOn" in fields || ("story" in fields && fields.story !== stored.fields.story));
      if (!relinks) return (await this.#records.edit(id, edit, options)) as SchemaRecord<"capability"> | null;
      // Its links, and on a story move each dependent's link to it, are split again into edges and stored ids (ADR-1282 D1).
      const story = fields.story ?? stored.fields.story;
      const own = { id, story, face: "dependsOn" in fields ? (fields.dependsOn ?? []) : await this.#faceOf(id) };
      const dependents = story === stored.fields.story ? [] : await this.#dependentsOf(id);
      const plans = [await this.#relink(own, own), ...(await Promise.all(dependents.map(async (dependent) => this.#relink(dependent, own))))];
      const { dependsOn: _given, ...rest } = edit;
      // The capability itself is written only when a field of its own changes: a link inside its story is an edge's write.
      const change = { ...rest, ...(isDeepStrictEqual(stored.fields.dependsOn ?? [], plans[0]!.cross) ? {} : { dependsOn: plans[0]!.cross }) };
      const written = Object.keys(change).length === 0 ? stored : ((await this.#records.edit(id, change, options)) as SchemaRecord<"capability"> | null);
      for (const plan of plans) await this.#applyRelink(plan, options);
      return written === null ? null : withFace(written, await this.#faceOf(id));
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
      if (contract.edge !== undefined && contract.capability === undefined) return this.#addEdgeContract(contract, options);
      this.#refusePlugins("contract", "capability", await this.#pluginOfCapability(contract.capability));
      await checkReference(this.#records, "capability", contract.capability, "capability");
      const title = await this.#numbered(contract.title, contract.capability!, options?.testedNumbers ?? []);
      return this.#records.create("contract", { ...contract, title }, options);
    });
  }

  /**
   * Add an edge inside one story (ADR-1282 D1): capability `from` depends on capability `to`. Both must be live
   * capabilities (MissingReferenceError otherwise) of one story; an edge between stories, from a capability to itself,
   * one the story already has, one that would close a dependency loop (DependencyLoopError), or one on a plugin's story
   * is refused, with nothing written. It holds no contracts until they are added to it.
   */
  addEdge(edge: NewEdge, options?: WriteOptions): Promise<SchemaRecord<"edge">> {
    return this.#serially(async () => {
      await checkReference(this.#records, "from", edge.from, "capability");
      await checkReference(this.#records, "to", edge.to, "capability");
      const from = couldBeId(edge.from) ? ((await this.#records.get(edge.from)) as SchemaRecord<"capability"> | null) : null;
      const to = couldBeId(edge.to) ? ((await this.#records.get(edge.to)) as SchemaRecord<"capability"> | null) : null;
      if (from !== null && to !== null) {
        this.#refusePlugins("edge", "from", await this.#pluginOfStory(from.fields.story));
        const refuse = (field: string, problem: string): never => { throw new SchemaError("edge", [{ field, problem }]); };
        if (from.id === to.id) refuse("to", "a capability does not depend on itself");
        if (from.fields.story !== to.fields.story) refuse("to", `${to.id} is another story's capability: a link between stories is a dependsOn on ${from.id}, not an edge`);
        const face = await this.#faceOf(from.id);
        if (face.includes(to.id)) refuse("to", `${from.id} already depends on ${to.id}`);
        await this.#refuseLoop(from.id, [...face, to.id]);
      }
      return this.#records.create("edge", edge, options);
    });
  }

  /**
   * Change an edge's description, as capability 3's edit does. An edge keeps its two capabilities: naming `from` or `to`
   * is refused (SchemaError), as is an edge of a plugin's story; nothing is written. Null, with nothing written, if `id`
   * is not a live edge.
   */
  editEdge(id: string, fields: EdgeEdit, options?: WriteOptions): Promise<SchemaRecord<"edge"> | null> {
    return this.#serially(async () => {
      const stored = (await liveRecord(this.#records, id, ["edge"])) as SchemaRecord<"edge"> | null;
      if (stored === null) return null;
      for (const field of ["from", "to"]) {
        if (field in fields) throw new SchemaError("edge", [{ field, problem: "an edge keeps its two capabilities: retire it and add another" }]);
      }
      this.#refusePlugins("edge", "from", await this.#pluginOfCapability(stored.fields.from));
      return (await this.#records.edit(id, fields, options)) as SchemaRecord<"edge"> | null;
    });
  }

  /** The capabilities live capability `id` depends on, as the tree gives them (ADR-1282 D1); null if it is no live capability. */
  async dependsOn(id: string): Promise<string[] | null> {
    if ((await liveRecord(this.#records, id, ["capability"])) === null) return null;
    return this.#faceOf(id);
  }

  /**
   * Move every same-story id stored in a capability's dependsOn onto an edge with no contracts (ADR-1282 D2), leaving
   * another story's ids stored: each capability's dependsOn reads back the same ids. One already on an edge is not
   * written again, so a second run writes nothing.
   */
  moveDependsOnToEdges(options?: WriteOptions): Promise<MovedToEdges> {
    return this.#serially(async () => {
      const capabilities = new Map((await this.#records.list("capability")).map((capability) => [capability.id, capability]));
      const edges = await this.#records.list("edge");
      const moved: MovedToEdges = { edges: [], capabilities: [] };
      for (const capability of [...capabilities.values()].sort(byCreation)) {
        const stored = capability.fields.dependsOn ?? [];
        const same = stored.filter((to) => to !== capability.id && capabilities.get(to)?.fields.story === capability.fields.story);
        if (same.length === 0) continue;
        for (const to of same) {
          if (edges.some((edge) => edge.fields.from === capability.id && edge.fields.to === to)) continue;
          moved.edges.push((await this.#records.create("edge", { from: capability.id, to }, options)).id);
        }
        await this.#records.edit(capability.id, { dependsOn: stored.filter((to) => !same.includes(to)) }, options);
        moved.capabilities.push(capability.id);
      }
      return moved;
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
      const stored = (await liveRecord(this.#records, id, ["story"])) as SchemaRecord<"story"> | null;
      if (stored === null) return null;
      await this.refusePluginEdit(stored, fields);
      return (await this.#records.edit(id, { audience: undefined, ...fields } as StoryEdit, options)) as SchemaRecord<"story"> | null;
    });
  }

  /**
   * Change only the named fields of a contract, as capability 3's edit does. A new capability is
   * checked as addContract checks it, and a title or capability that would leave its number carried
   * by another live contract of the capability is refused as addContract refuses it. A contract moved,
   * with no title given, to a numbered capability its number's leading part is not, takes that
   * capability's next free number as addContract gives it, past `testedNumbers`, so its number says
   * where it is; the rest of its title is kept. Returns null, and writes nothing, if `id` is not a live contract.
   */
  editContract(id: string, fields: ContractEdit, options?: ContractWriteOptions): Promise<SchemaRecord<"contract"> | null> {
    const { testedNumbers: tested = [], ...write } = options ?? {};
    return this.#serially(async () => {
      const own = (await liveRecord(this.#records, id, ["contract"])) as SchemaRecord<"contract"> | null;
      if (own === null) return null;
      await this.refusePluginEdit(own, fields);
      await checkReference(this.#records, "capability", fields.capability, "capability");
      await checkReference(this.#records, "edge", fields.edge, "edge");
      // A contract moved onto an edge leaves its capability, and one moved onto a capability its edge (ADR-1282 D1).
      const owner: ContractEdit = fields.edge !== undefined && !("capability" in fields) ? { capability: undefined } : fields.capability !== undefined && !("edge" in fields) ? { edge: undefined } : {};
      const renumbered = fields.title === undefined && fields.capability !== undefined && fields.capability !== own.fields.capability ? await this.#movedTitle(own.fields.title, fields.capability, tested) : undefined;
      if (renumbered !== undefined) fields = { ...fields, title: renumbered };
      const after = { ...own.fields, ...fields, ...owner };
      if (fields.title !== undefined || fields.capability !== undefined || fields.edge !== undefined) {
        const title = after.title;
        if (typeof title === "string" && after.edge !== undefined && after.capability === undefined) await this.#refuseTakenStoryNumber(title, after.edge, id);
        else if (typeof title === "string" && couldBeId(after.capability)) await this.#refuseTakenNumber(title, after.capability, id);
      }
      const edit = { ...fields, ...owner, ...(typeof fields.title === "string" ? { title: separated(fields.title) } : {}) };
      return (await this.#records.edit(id, edit, write)) as SchemaRecord<"contract"> | null;
    });
  }

  /**
   * `title`, a contract's, as it carries it moved onto `capability`: given the capability's next free number in place of
   * its own when its number's leading part is not the capability's; undefined, kept as it is, otherwise, or when either
   * has no number.
   */
  async #movedTitle(title: string, capability: string, tested: readonly string[]): Promise<string | undefined> {
    const number = contractNumber(title);
    const prefix = /^(\d+) · /.exec((await this.#titleOf(capability)) ?? "")?.[1];
    if (number === undefined || prefix === undefined || number.startsWith(`${prefix}.`)) return undefined;
    return this.#numbered(title.slice(number.length).replace(/^\s*·?\s*/, ""), capability, tested);
  }

  /**
   * The plan as it is now: every story holding its capabilities, each holding its contracts, and
   * every arc, all in creation order. A capability or contract whose parent is not a live record
   * has no place in it.
   */
  async projectTree(): Promise<ProjectTree> {
    const [stories, capabilities, contracts, edges, arcs, anchor] = await Promise.all([
      this.#records.list("story"),
      this.#records.list("capability"),
      this.#records.list("contract"),
      this.#records.list("edge"),
      this.#records.list("arc"),
      this.anchor(),
    ]);
    const capabilitiesOf = childrenByParent(capabilities, (capability) => capability.fields.story);
    const contractsOf = childrenByParent(contracts, (contract) => contract.fields.capability ?? contract.fields.edge ?? "");
    const inStory = storyEdges(capabilities, edges);
    const edgesOf = childrenByParent(inStory, (edge) => capabilities.find((capability) => capability.id === edge.fields.from)!.fields.story);
    const faces = facesOf(capabilities, inStory);
    const contractNode = (contract: SchemaRecord<"contract">): ContractNode => ({
      ...nodeOf(contract),
      ...(contract.fields.provedBy === undefined ? {} : { provedBy: [...contract.fields.provedBy] }),
      ...(contract.fields.proof === undefined ? {} : { proof: { ...contract.fields.proof } }),
    });
    return {
      ...(anchor === undefined ? {} : { anchor }),
      stories: stories.sort(byCreation).map((story) => ({
        ...nodeOf(story),
        ...(story.fields.mapped === undefined ? {} : { mapped: { ...story.fields.mapped, folders: [...story.fields.mapped.folders] } }),
        ...(story.fields.plugin === undefined ? {} : { plugin: story.fields.plugin }),
        ...(story.fields.risk === undefined ? {} : { risk: structuredClone(story.fields.risk) }),
        ...guardrailsOf(story),
        capabilities: (capabilitiesOf.get(story.id) ?? []).map((capability) => ({
          ...nodeOf(capability),
          dependsOn: faces.get(capability.id) ?? [],
          proposed: capability.fields.proposed,
          ...(capability.fields.covers === undefined ? {} : { covers: [...capability.fields.covers] }),
          ...guardrailsOf(capability),
          contracts: (contractsOf.get(capability.id) ?? []).map(contractNode),
        })),
        ...(edgesOf.has(story.id)
          ? {
              edges: edgesOf.get(story.id)!.map((edge) => ({
                id: edge.id,
                from: edge.fields.from,
                to: edge.fields.to,
                ...(edge.fields.description === undefined ? {} : { description: edge.fields.description }),
                contracts: (contractsOf.get(edge.id) ?? []).map(contractNode),
              })),
            }
          : {}),
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
    // An edge's contracts are its story's (ADR-1282 D1): a number one carries is never given again.
    const planned = own([...(await this.#contractsOf(capability)), ...(await this.#edgeContractsBeside(capability))].map((contract) => contractNumber(contract.fields.title)));
    return `${prefix}.${Math.max(0, ...planned, ...own(tested)) + 1} · ${title}`;
  }

  /** The live contracts on the edges of `capability`'s story. */
  async #edgeContractsBeside(capability: string): Promise<SchemaRecord<"contract">[]> {
    const capabilities = await this.#records.list("capability");
    const story = capabilities.find(({ id }) => id === capability)?.fields.story;
    const inStory = new Set(capabilities.filter((one) => one.fields.story === story).map(({ id }) => id));
    const edges = new Set((await this.#records.list("edge")).filter(({ fields }) => inStory.has(fields.from)).map(({ id }) => id));
    return (await this.#records.list("contract")).filter((contract) => contract.fields.edge !== undefined && edges.has(contract.fields.edge));
  }

  /**
   * `title` as a new capability of `story` carries it: refused if its number is taken there, and given the story's
   * next free number when it has none, the story read as `pending` would leave it.
   */
  async #capabilityNumbered(title: string, story: string, pending: readonly PendingPlanChange[]): Promise<string> {
    if (typeof title !== "string") return title; // the schema refuses it in the write
    if (capabilityNumber(title) !== undefined) {
      await this.#refuseTakenCapabilityNumber(title, story, undefined, pending);
      return title;
    }
    return `${nextFree(await this.#capabilitiesOf(story, pending))} · ${title}`;
  }

  /**
   * Refuse `title` on `story` when another live capability there (not `self`) carries its number, naming it and the
   * next free number, the story read as `pending` would leave it.
   */
  async #refuseTakenCapabilityNumber(title: unknown, story: unknown, self?: string, pending: readonly PendingPlanChange[] = []): Promise<void> {
    const number = capabilityNumber(title);
    if (number === undefined || typeof story !== "string") return;
    const theirs = await this.#capabilitiesOf(story, pending);
    const holder = theirs.find((capability) => capability.id !== self && capabilityNumber(capability.fields.title) === number);
    if (holder !== undefined) {
      throw new SchemaError("capability", [{ field: "title", problem: `capability number ${number} is taken: ${holder.id} (${holder.fields.title}) carries it in this story; the next free number is ${nextFree(theirs)}` }]);
    }
  }

  /**
   * Refuse `fields`, an edit to live story, capability or contract `record`, when it would change a plugin's plan
   * (ADR-1187): a SchemaError naming the plugin's plan file, as editStory, editCapability and editContract refuse it,
   * and as a pending change is refused before it is staged, so none is held that its landing could only refuse.
   */
  async refusePluginEdit(record: SchemaRecord<"story"> | SchemaRecord<"capability"> | SchemaRecord<"contract">, fields: Readonly<Record<string, unknown>>): Promise<void> {
    if (record.type === "story") {
      if (PLUGIN_STORY_FIELDS.some((field) => field in fields)) this.#refusePlugins("story", "title", (record as SchemaRecord<"story">).fields.plugin);
    } else if (record.type === "capability") {
      if (PLUGIN_CAPABILITY_FIELDS.some((field) => field in fields)) this.#refusePlugins("capability", "story", await this.#pluginOfStory((record as SchemaRecord<"capability">).fields.story));
      this.#refusePlugins("capability", "story", await this.#pluginOfStory(fields["story"]));
    } else {
      const contract = (record as SchemaRecord<"contract">).fields;
      this.#refusePlugins("contract", "capability", await this.#pluginOfCapability(contract.capability ?? (await this.#fromOf(contract.edge))));
      this.#refusePlugins("contract", "capability", await this.#pluginOfCapability(fields["capability"]));
      this.#refusePlugins("contract", "edge", await this.#pluginOfCapability(await this.#fromOf(fields["edge"])));
    }
  }

  /** Refuse a plan edit when `plugin` names whose plan it would change (ADR-1187). */
  #refusePlugins(type: "story" | "capability" | "contract" | "edge", field: string, plugin: string | undefined): void {
    if (plugin !== undefined) throw pluginsOwn(type, field, plugin);
  }

  /** The plugin whose plan `story` is, when it names a stored plugin's story. */
  async #pluginOfStory(story: unknown): Promise<string | undefined> {
    const record = couldBeId(story) ? await this.#records.get(story) : null;
    return record?.type === "story" ? (record as SchemaRecord<"story">).fields.plugin : undefined;
  }

  /** The plugin whose plan `capability` is part of, when it names a stored capability of a plugin's story. */
  async #pluginOfCapability(capability: unknown): Promise<string | undefined> {
    const record = couldBeId(capability) ? await this.#records.get(capability) : null;
    return record?.type === "capability" ? this.#pluginOfStory((record as SchemaRecord<"capability">).fields.story) : undefined;
  }

  /** The live capabilities of `story`, as `pending` would leave them: one it retires is gone, and one it edits carries its new title and story. */
  async #capabilitiesOf(story: string, pending: readonly PendingPlanChange[] = []): Promise<SchemaRecord<"capability">[]> {
    const retired = new Set(pending.flatMap((change) => ("retire" in change ? [change.record] : [])));
    const after = new Map(pending.flatMap((change) => ("after" in change ? [[change.record, change.after] as const] : [])));
    return (await this.#records.list("capability"))
      .filter((capability) => !retired.has(capability.id))
      .map((capability) => {
        const fields = after.get(capability.id);
        return fields === undefined ? capability : { ...capability, fields: { ...capability.fields, ...fields } as typeof capability.fields };
      })
      .filter((capability) => capability.fields.story === story);
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
    if (covers === undefined || covers.length === 0) refuse(`a capability of the imported story ${story} names the folders and files of its import it covers`);
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
   * that is, if the would-be graph (every live capability's dependencies as the tree gives them, with `id`'s
   * replaced by `dependsOn`) leads from `id` back round to `id`.
   */
  async #refuseLoop(id: string, dependsOn: readonly unknown[]): Promise<void> {
    const graph = new Map<string, readonly unknown[]>(await this.#faces());
    graph.set(id, dependsOn);
    const loop = loopThrough(id, graph);
    if (loop !== undefined) throw new DependencyLoopError(loop);
  }

  /** Every live capability's dependsOn as the tree gives it: its story's edges from it, then what it stores (ADR-1282 D1). */
  async #faces(): Promise<Map<string, string[]>> {
    const [capabilities, edges] = await Promise.all([this.#records.list("capability"), this.#records.list("edge")]);
    return facesOf(capabilities, storyEdges(capabilities, edges));
  }

  /** Capability `id`'s dependsOn as the tree gives it. */
  async #faceOf(id: string): Promise<string[]> {
    return (await this.#faces()).get(id) ?? [];
  }

  /** The capability an edge depends from, when `edge` names a stored edge. */
  async #fromOf(edge: unknown): Promise<string | undefined> {
    const record = couldBeId(edge) ? await this.#records.get(edge) : null;
    return record?.type === "edge" ? (record as SchemaRecord<"edge">).fields.from : undefined;
  }

  /** `dependsOn`, for a capability of `story`: the live capabilities of that story, which are edges, and the rest, stored. */
  async #split(story: string, dependsOn: readonly string[]): Promise<{ same: string[]; cross: string[] }> {
    const stories = new Map((await this.#records.list("capability")).map((capability) => [capability.id, capability.fields.story]));
    const unique = [...new Set(dependsOn)];
    return { same: unique.filter((to) => stories.get(to) === story), cross: unique.filter((to) => stories.get(to) !== story) };
  }

  /** The live capabilities whose dependsOn names `id`, each with its story and dependsOn as the tree gives them. */
  async #dependentsOf(id: string): Promise<Relinked[]> {
    const faces = await this.#faces();
    const capabilities = await this.#records.list("capability");
    return capabilities.filter((capability) => capability.id !== id && (faces.get(capability.id) ?? []).includes(id)).map((capability) => ({ id: capability.id, story: capability.fields.story, face: faces.get(capability.id) ?? [] }));
  }

  /**
   * What writing `capability`'s links as `face` takes, `moved` standing where its edit leaves it: the edges to add and
   * retire, and the ids it stores. An edge to retire that holds live contracts is refused (SchemaError), nothing written.
   */
  async #relink(capability: Relinked, moved: Relinked): Promise<RelinkPlan> {
    const stories = new Map((await this.#records.list("capability")).map((other) => [other.id, other.fields.story]));
    stories.set(moved.id, moved.story);
    const unique = [...new Set(capability.face)];
    const same = unique.filter((to) => stories.get(to) === capability.story);
    const edges = (await this.#records.list("edge")).filter((edge) => edge.fields.from === capability.id);
    const retire = edges.filter((edge) => !same.includes(edge.fields.to));
    const contracts = await this.#records.list("contract");
    for (const edge of retire) {
      const held = contracts.filter((contract) => contract.fields.edge === edge.id);
      if (held.length > 0) {
        throw new SchemaError("capability", [{ field: "dependsOn", problem: `the edge ${edge.id} from ${capability.id} to ${edge.fields.to} holds contracts (${held.map((contract) => contract.id).join(", ")}): move or retire them first` }]);
      }
    }
    const add = same.filter((to) => !edges.some((edge) => edge.fields.to === to));
    return { id: capability.id, add, retire: retire.map((edge) => edge.id), cross: unique.filter((to) => !same.includes(to)) };
  }

  /** Write `plan`: its edges added and retired, and, for a capability other than the one edited, its stored ids. */
  async #applyRelink(plan: RelinkPlan, options?: WriteOptions): Promise<void> {
    for (const edge of plan.retire) await this.#records.retire(edge, "its capability no longer depends on that one inside its story", options);
    for (const to of plan.add) await this.#records.create("edge", { from: plan.id, to }, options);
    const stored = (await this.#records.get(plan.id)) as SchemaRecord<"capability"> | null;
    if (stored !== null && !isDeepStrictEqual(stored.fields.dependsOn ?? [], plan.cross)) await this.#records.edit(plan.id, { dependsOn: plan.cross }, options);
  }

  /**
   * Add a contract to an edge (ADR-1282 D1), which must be a live edge (MissingReferenceError otherwise): a number given
   * is kept, and one another live contract of the edge's story carries is refused (SchemaError on `title`). A title given
   * none gets its dependent (`from`) capability's next free number, as addContract gives it there, `testedNumbers` being
   * that capability's tests' numbers, so a test titled with it can prove the edge's contract.
   */
  async #addEdgeContract(contract: NewContract, options?: ContractWriteOptions): Promise<SchemaRecord<"contract">> {
    await checkReference(this.#records, "edge", contract.edge, "edge");
    const from = await this.#fromOf(contract.edge);
    this.#refusePlugins("contract", "edge", await this.#pluginOfCapability(from));
    const { testedNumbers: tested = [], ...write } = options ?? {};
    if (typeof contract.title !== "string") return this.#records.create("contract", contract, write);
    if (contractNumber(contract.title) !== undefined) {
      await this.#refuseTakenStoryNumber(contract.title, contract.edge!);
      return this.#records.create("contract", { ...contract, title: separated(contract.title) }, write);
    }
    return this.#records.create("contract", { ...contract, title: await this.#numbered(contract.title, from!, tested) }, write);
  }

  /** Refuse `title` on edge `edge` when another live contract of the edge's story (not `self`) carries its number. */
  async #refuseTakenStoryNumber(title: string, edge: string, self?: string): Promise<void> {
    const number = contractNumber(title);
    const from = await this.#fromOf(edge);
    const story = from === undefined ? undefined : ((await this.#records.get(from)) as SchemaRecord<"capability"> | null)?.fields.story;
    if (number === undefined || story === undefined) return;
    const capabilities = (await this.#records.list("capability")).filter((capability) => capability.fields.story === story).map(({ id }) => id);
    const edges = (await this.#records.list("edge")).filter((other) => capabilities.includes(other.fields.from)).map(({ id }) => id);
    const owners = new Set([...capabilities, ...edges]);
    const holder = (await this.#records.list("contract")).find((contract) => contract.id !== self && owners.has(contract.fields.capability ?? contract.fields.edge ?? "") && contractNumber(contract.fields.title) === number);
    if (holder !== undefined) {
      throw new SchemaError("contract", [{ field: "title", problem: `contract number ${number} is taken: ${holder.id} carries it in this story` }]);
    }
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

/** A capability whose links are written again: its id, the story it stands in, and its dependsOn. */
interface Relinked {
  readonly id: string;
  readonly story: string;
  readonly face: readonly string[];
}
/** What writing one capability's links takes: the edges to add (their `to`) and retire (their ids), and the ids it stores. */
interface RelinkPlan {
  readonly id: string;
  readonly add: string[];
  readonly retire: string[];
  readonly cross: string[];
}

/** The live edges whose two capabilities are live and of one story: the ones the plan reads (ADR-1282 D1). */
function storyEdges(capabilities: readonly SchemaRecord<"capability">[], edges: readonly SchemaRecord<"edge">[]): SchemaRecord<"edge">[] {
  const stories = new Map(capabilities.map((capability) => [capability.id, capability.fields.story]));
  return edges.filter((edge) => edge.fields.from !== edge.fields.to && stories.has(edge.fields.from) && stories.get(edge.fields.from) === stories.get(edge.fields.to));
}

/** Each capability's dependsOn as the tree gives it: its `edges` (the story's) in creation order, then its stored ids, once each. */
function facesOf(capabilities: readonly SchemaRecord<"capability">[], edges: readonly SchemaRecord<"edge">[]): Map<string, string[]> {
  const from = childrenByParent(edges, (edge) => edge.fields.from);
  return new Map(capabilities.map((capability) => [capability.id, [...new Set([...(from.get(capability.id) ?? []).map((edge) => edge.fields.to), ...(capability.fields.dependsOn ?? [])])]]));
}

/** `record` with its dependsOn as the tree gives it, `face`, in place of the ids it stores. */
function withFace(record: SchemaRecord<"capability">, face: string[]): SchemaRecord<"capability"> {
  if (face.length === 0 && record.fields.dependsOn === undefined) return record;
  return { ...record, fields: { ...record.fields, dependsOn: face } };
}

/** Whether `inner` is `outer` or lies under it (both plain paths from an imported folder, "." its top). */
function within(inner: string, outer: string): boolean {
  return outer === "." || inner === outer || inner.startsWith(`${outer}/`);
}

/** Refuse a `mapped` or `plugin` field: only mapStories makes a story mapped (ADR-0993 D2), and only importPluginPlan a plugin's. */
function refuseMapped(fields: object): void {
  if ("mapped" in fields) throw new SchemaError("story", [{ field: "mapped", problem: "only importing a project makes an imported story" }]);
  if ("plugin" in fields) throw new SchemaError("story", [{ field: "plugin", problem: "a story is made a plugin's only by importing its plan (storytree plugin import-plan)" }]);
}

/** The fields of a plugin's story, capabilities and contracts its plan holds: only importPluginPlan writes them. */
const PLUGIN_STORY_FIELDS = ["title", "description", "text", "plugin"] as const;
const PLUGIN_CAPABILITY_FIELDS = ["title", "description", "text", "proposed", "dependsOn", "story"] as const;
const PLUGIN_CONTRACT_FIELDS = ["title", "description", "proof", "capability"] as const;
/** The text fields of a plugin's plan an import from a stale source must not write back over another lane's change. */
const GUARDED_PLAN_FIELDS = new Set(["title", "description", "text", "proposed", "proof"]);

/**
 * Every value a plugin plan's story, capabilities and contracts held their text fields at in any of `versions`, as an
 * import writes them (a capability proposed when not given, a contract's title separated), keyed `story:<field>`,
 * `capability <n>:<field>` and `contract <n.m>:<field>`. A version, capability or contract of another shape holds nothing.
 */
function heldValues(versions: readonly unknown[]): Map<string, unknown[]> {
  const values = new Map<string, unknown[]>();
  const hold = (key: string, fields: Record<string, unknown>): void => {
    for (const field of GUARDED_PLAN_FIELDS) values.set(`${key}:${field}`, [...(values.get(`${key}:${field}`) ?? []), fields[field]]);
  };
  const object = (value: unknown): Record<string, unknown> | undefined => (typeof value === "object" && value !== null ? (value as Record<string, unknown>) : undefined);
  for (const version of versions) {
    const story = object(object(version)?.story);
    if (story !== undefined) hold("story", story);
    const capabilities = object(version)?.capabilities;
    for (const capability of Array.isArray(capabilities) ? capabilities.map(object) : []) {
      const number = typeof capability?.title === "string" ? capabilityNumber(capability.title) : undefined;
      if (number === undefined) continue;
      hold(`capability ${number}`, { ...capability, proposed: capability!.proposed ?? true });
      for (const contract of Array.isArray(capability!.contracts) ? capability!.contracts.map(object) : []) {
        const own = typeof contract?.title === "string" ? contractNumber(contract.title) : undefined;
        if (own !== undefined) hold(`contract ${own}`, { ...contract, title: separated(contract!.title as string) });
      }
    }
  }
  return values;
}

/** Whether `one` and `other` hold the same ids, in any order. */
function sameMembers(one: readonly string[], other: readonly string[]): boolean {
  const mine = new Set(one);
  const theirs = new Set(other);
  return mine.size === theirs.size && [...mine].every((id) => theirs.has(id));
}

/** A plan's capability as its record's fields hold it: everything but its contracts. */
function withoutContracts({ contracts: _contracts, ...fields }: PluginPlanCapability): Omit<PluginPlanCapability, "contracts"> {
  return fields;
}

/** The refusal of a plan edit to plugin `plugin`'s story, naming where it is edited instead. */
function pluginsOwn(type: "story" | "capability" | "contract" | "edge", field: string, plugin: string): SchemaError {
  return new SchemaError(type, [{ field, problem: `this is ${plugin}'s plan: edit plugins/${plugin}'s plan file in the factory and import it (storytree plugin import-plan ${plugin})` }]);
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
function childrenByParent<R extends GroupedRecord>(children: readonly R[], parentOf: (child: R) => string): Map<string, R[]> {
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
  "Plan first. When the user asks you to build or change something, plan it in storytree before you build it, even when they never mention storytree and the work is small: a story for what they will be able to do, a capability for each part that makes it work, and a contract for each guarantee its tests will keep. The plan is how the user watches the work grow, so asking only for the work is no reason to skip it. Park the change's increment with `park_increment` and `claim` it before you build, never afterwards to record work already done. A small fix, one that adds or changes no contract, needs no more plan than that: one increment with a one-line objective on this project's standing small-fixes arc \"small-fixes\", and no new story, capability or contract (it may name an existing contract it restores); anything bigger goes on an arc of its own, planned as above. A story is one package of the product, never a task: on an existing codebase, `import_project` maps its packages as stories first (`plan_story` refuses until it has), and work items such as tasks or tickets become increments, with contracts on the capabilities they change.",
  "- `focus` shows what a file, capability, contract or story depends on (up) and what depends on it (down). Start with counts, then narrow.",
  "- `show_plan` shows the plan: every story, capability and contract with its health and who holds what. `health_worklist` lists the oldest capabilities that are not healthy, with why and who moves each: route each into an increment whose capabilities list names it, held on a question when only the owner can move it.",
  `- Plan a story (something a user can do, one package of its own) with \`plan_story\`, the parts that make it work with \`plan_capability\`, and each testable guarantee, a contract, with \`plan_contract\`. ${CONTRACT_DEFINITION} \`plan_edge\` links a story's capabilities. ${CONTRACT_PLACEMENT} A story or capability starts with its founding decision: what it is for, and the one choice that shapes it. Group stories under an initiative with \`plan_arc\`. Correct any of them with \`edit_plan\`, and \`retire_from_plan\` a capability or contract no longer wanted, with the reason.`,
  "- Break an arc's work into increments with `park_increment` (the breakdown goes in its body, its capabilities list left empty); claiming one starts it, and as you plan it you fill its capabilities list, the capabilities it changes and nothing else, with `edit_plan`, linking its stories and the contracts it makes true. `move_increment` re-homes one on another arc. `add_remedies` makes a parked one the fix for friction. `park_arc` parks or unparks an arc.",
  "- When one piece of work must wait for another, `set_wait` with the reason; when an increment waits for something outside the plan, an action only the owner can take that is not a decision, or an outside event, `set_wait` for the owner or the event, with a note (an event needs a day to check back). `clear_wait` when it no longer must, saying why.",
  "- When only the owner can decide (see Who decides what, below), land what is green first and push the rest to a branch named on the increment, then `raise_question` on the arc instead of only asking in chat, holding the increments that need the answer: it releases your claims on them. `correct_question` rewords an open one; `move_question` re-homes it. `present_question` before putting one to the owner (refused: another session is asking, so skip it), and with done when you move on unanswered. `settle_question` with the answer, in the owner's own words; `retire_question` one that was wrong to ask.",
  ].join("\n"),
];
