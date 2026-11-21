// Capability 4 · Work model
import path from "node:path";
import { isDeepStrictEqual } from "node:util";

import { byCreation } from "../creation-order.js";
import { checkReference, checkReferences, couldBeId, DependencyLoopError, liveRecord } from "../references.js";
import { SchemaError, type SchemaRecord, type SchemaRecords, type WriteOptions } from "../schema/index.js";
import type { FieldsOf } from "../schema/index.js";

export type ContractProof = NonNullable<FieldsOf<"contract">["proof"]>;
import { historyOf, PR_CUTOVER_ID, type PrCutover } from "./pr-cutover.js";

export const CONTRACT_DEFINITION =
  "A contract is one behaviour seen from outside the code: what goes in (its inputs), what comes out (its outputs) and its errors. A guarantee that joins two such behaviours is two contracts, and one about how the code works inside is not a contract yet.";
export const CONTRACT_PLACEMENT =
  "A contract goes on the part whose behaviour it pins, and a guarantee about what passes between two parts goes on their edge, even when every test drives the whole service through one entry point: plan from where you found each fault, not from the list of tests, so each part or link at fault gets a contract of its own.";
export const LONG_CONTRACT_TITLE = 300;

export type NewStory = Omit<FieldsOf<"story">, "mapped" | "plugin">;
export interface MappedPackage {
  readonly package: string;
  readonly title: string;
  readonly description?: string;
  readonly folders: readonly string[];
}
export interface MappedStories {
  readonly added: SchemaRecord<"story">[];
  readonly retired: string[];
  readonly kept: string[];
}
export interface PluginPlan {
  readonly story: { readonly title: string; readonly description?: string; readonly text?: string };
  readonly capabilities: readonly PluginPlanCapability[];
}
export interface PluginPlanCapability {
  readonly title: string;
  readonly description?: string;
  readonly text?: string;
  readonly proposed?: boolean;
  readonly dependsOn?: string[];
  readonly contracts: readonly { readonly title: string; readonly description?: string; readonly proof?: Readonly<ContractProof> }[];
}
export interface ImportedPluginPlan {
  readonly story: string;
  readonly added: string[];
  readonly edited: string[];
  readonly retired: string[];
  readonly kept: string[];
  readonly left: string[];
  readonly stood: string[];
}
export interface PluginPlanHeld {
  readonly capabilities: readonly number[];
  readonly contracts: readonly string[];
  readonly versions?: readonly unknown[];
}
export type NewCapability = Omit<FieldsOf<"capability">, "proposed"> & { proposed?: boolean };
export type NewContract = FieldsOf<"contract">;
export type NewEdge = FieldsOf<"edge">;
export type EdgeEdit = { description?: string | undefined };
export interface MovedToEdges {
  readonly edges: string[];
  readonly capabilities: string[];
}
export type CapabilityEdit = { [F in keyof FieldsOf<"capability">]?: FieldsOf<"capability">[F] | undefined };
export type StoryEdit = { [F in keyof NewStory]?: NewStory[F] | undefined };
export type ContractEdit = { [F in keyof FieldsOf<"contract">]?: FieldsOf<"contract">[F] | undefined };
export interface ContractWriteOptions extends WriteOptions {
  readonly testedNumbers?: readonly string[];
}
type PendingPlanChange = NonNullable<FieldsOf<"increment">["pending"]>[number];
export interface CapabilityWriteOptions extends WriteOptions {
  readonly pending?: readonly PendingPlanChange[];
  readonly levels?: readonly string[];
}
export type Anchor = FieldsOf<"anchor">;
export type AnchorEdit = { [F in keyof Anchor]?: Anchor[F] | undefined };
export const ANCHOR_ID = "project-anchor";

export interface AnchorGaps {
  anchor: ("what" | "audience")[];
}

export function anchorGaps(tree: { anchor?: Anchor | undefined }): AnchorGaps {
  return { anchor: (["what", "audience"] as const).filter((half) => tree.anchor?.[half] === undefined) };
}

export interface ProjectTree {
  anchor?: Anchor;
  stories: StoryNode[];
  arcs: ArcNode[];
}

export type Guardrail = NonNullable<FieldsOf<"story">["guardrails"]>[number];
export type StoreLink = NonNullable<FieldsOf<"capability">["storeLinks"]>[number];

export interface StoryNode {
  id: string;
  title: string;
  description?: string;
  mapped?: { from: string; package: string; folders: string[] };
  plugin?: string;
  risk?: NonNullable<FieldsOf<"story">["risk"]>;
  guardrails?: Guardrail[];
  capabilities: CapabilityNode[];
  edges?: EdgeNode[];
}

export interface EdgeNode {
  id: string;
  from: string;
  to: string;
  description?: string;
  contracts: ContractNode[];
}

export interface CapabilityNode {
  id: string;
  title: string;
  description?: string;
  dependsOn: string[];
  proposed: boolean;
  parent?: string;
  covers?: string[];
  storeLinks?: StoreLink[];
  guardrails?: Guardrail[];
  contracts: ContractNode[];
}

export interface ContractNode {
  id: string;
  title: string;
  description?: string;
  provedBy?: string[];
  proof?: ContractProof;
}

export interface ArcNode {
  id: string;
  title: string;
  description?: string;
  stories: string[];
}

type PlanRecord = SchemaRecord<"story" | "capability" | "contract" | "arc">;
type GroupedRecord = PlanRecord | SchemaRecord<"edge">;

export class WorkModel {
  readonly #records: SchemaRecords;
  #lastWrite: Promise<unknown> = Promise.resolve();

  constructor(records: SchemaRecords) {
    this.#records = records;
  }

  addStory(story: NewStory, options?: WriteOptions): Promise<SchemaRecord<"story">> {
    return this.#serially(() => {
      refuseMapped(story);
      return this.#records.create("story", story, options);
    });
  }

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
      const heldRecord = (record: SchemaRecord<"capability" | "contract">, key: string): boolean => held === undefined || (held.get(`${key}:title`) ?? []).some((value) => isDeepStrictEqual(value, record.fields.title));
      if (story === undefined) {
        story = await this.#records.create("story", storyFields, options);
        done.added.push(story.id);
      } else await update(story, storyFields, PLUGIN_STORY_FIELDS, "story");
      const storyId = story.id;
      for (const capability of plan.capabilities) {
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
          if ((heldContracts !== undefined && !heldContracts.has(number)) || !heldRecord(gone, `contract ${number}`)) {
            done.left.push(gone.id);
            continue;
          }
          await this.#records.retire(gone.id, `${plugin}'s plan no longer holds it`, options);
          done.retired.push(gone.id);
        }
      }
      for (const [number, gone] of capabilities) {
        if (planned.has(number)) continue;
        if ((heldCapabilities !== undefined && !heldCapabilities.has(number)) || !heldRecord(gone, `capability ${number}`)) {
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

  addCapability(capability: NewCapability, options?: CapabilityWriteOptions): Promise<SchemaRecord<"capability">> {
    return this.#serially(async () => {
      this.#refusePlugins("capability", "story", await this.#pluginOfStory(capability.story));
      await checkReference(this.#records, "story", capability.story, "story");
      await checkReferences(this.#records, "dependsOn", capability.dependsOn, "capability");
      const covers = await this.#covered(capability.story, capability.covers);
      if (capability.parent !== undefined) await this.#refuseParent(capability.parent, capability.story, undefined, options?.levels);
      const { pending = [], levels: _levels, ...write } = options ?? {};
      const title = await this.#capabilityNumbered(capability.title, capability.story, pending);
      const links = !Array.isArray(capability.dependsOn) ? undefined : await this.#split(capability.story, capability.dependsOn);
      const fields = { ...capability, title, proposed: capability.proposed ?? true, ...(covers === undefined ? {} : { covers }), ...(links === undefined ? {} : { dependsOn: links.cross }) };
      const created = await this.#records.create("capability", fields, write);
      if (links === undefined) return created;
      for (const to of links.same) await this.#records.create("edge", { from: created.id, to }, write);
      return withFace(created, await this.#faceOf(created.id));
    });
  }

  editCapability(id: string, fields: CapabilityEdit, options?: CapabilityWriteOptions): Promise<SchemaRecord<"capability"> | null> {
    return this.#serially(async () => {
      const stored = (await liveRecord(this.#records, id, ["capability"])) as SchemaRecord<"capability"> | null;
      if (stored === null) return null;
      await this.refusePluginEdit(stored, fields);
      await checkReference(this.#records, "story", fields.story, "story");
      await checkReferences(this.#records, "dependsOn", fields.dependsOn, "capability");
      if (Array.isArray(fields.dependsOn)) await this.#refuseLoop(id, fields.dependsOn);
      if (fields.title !== undefined || fields.story !== undefined) await this.#refuseTakenCapabilityNumber(fields.title ?? stored.fields.title, fields.story ?? stored.fields.story, id);
      if (fields.parent !== undefined) await this.#refuseParent(fields.parent, fields.story ?? stored.fields.story, id, options?.levels);
      let edit: CapabilityEdit = fields;
      if ("story" in fields || "covers" in fields) {
        const covers = await this.#covered(fields.story ?? stored.fields.story, "covers" in fields ? fields.covers : stored.fields.covers, id);
        if ("covers" in fields) edit = { ...fields, covers };
      }
      const listed = !("dependsOn" in fields) || fields.dependsOn === undefined || Array.isArray(fields.dependsOn);
      const relinks = listed && ("dependsOn" in fields || ("story" in fields && fields.story !== stored.fields.story));
      if (!relinks) return (await this.#records.edit(id, edit, options)) as SchemaRecord<"capability"> | null;
      const story = fields.story ?? stored.fields.story;
      const own = { id, story, face: "dependsOn" in fields ? (fields.dependsOn ?? []) : await this.#faceOf(id) };
      const dependents = story === stored.fields.story ? [] : await this.#dependentsOf(id);
      const plans = [await this.#relink(own, own), ...(await Promise.all(dependents.map(async (dependent) => this.#relink(dependent, own))))];
      const { dependsOn: _given, ...rest } = edit;
      const change = { ...rest, ...(isDeepStrictEqual(stored.fields.dependsOn ?? [], plans[0]!.cross) ? {} : { dependsOn: plans[0]!.cross }) };
      const written = Object.keys(change).length === 0 ? stored : ((await this.#records.edit(id, change, options)) as SchemaRecord<"capability"> | null);
      for (const plan of plans) await this.#applyRelink(plan, options);
      return written === null ? null : withFace(written, await this.#faceOf(id));
    });
  }

  setProposed(id: string, proposed: boolean, options?: WriteOptions): Promise<SchemaRecord<"capability"> | null> {
    return this.editCapability(id, { proposed }, options);
  }

  addContract(contract: NewContract, options?: ContractWriteOptions): Promise<SchemaRecord<"contract">> {
    return this.#serially(async () => {
      if (contract.edge !== undefined && contract.capability === undefined) return this.#addEdgeContract(contract, options);
      this.#refusePlugins("contract", "capability", await this.#pluginOfCapability(contract.capability));
      await checkReference(this.#records, "capability", contract.capability, "capability");
      const title = await this.#numbered(contract.title, contract.capability!, options?.testedNumbers ?? []);
      return this.#records.create("contract", { ...contract, title }, options);
    });
  }

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

  editEdge(id: string, fields: EdgeEdit, options?: WriteOptions): Promise<SchemaRecord<"edge"> | null> {
    return this.#serially(async () => {
      const stored = (await liveRecord(this.#records, id, ["edge"])) as SchemaRecord<"edge"> | null;
      if (stored === null) return null;
      this.refuseEdgeEnds(fields);
      await this.refusePluginEdit(stored, fields);
      return (await this.#records.edit(id, fields, options)) as SchemaRecord<"edge"> | null;
    });
  }

  async dependsOn(id: string): Promise<string[] | null> {
    if ((await liveRecord(this.#records, id, ["capability"])) === null) return null;
    return this.#faceOf(id);
  }

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

  editStory(id: string, fields: StoryEdit, options?: WriteOptions): Promise<SchemaRecord<"story"> | null> {
    return this.#serially(async () => {
      refuseMapped(fields);
      const stored = (await liveRecord(this.#records, id, ["story"])) as SchemaRecord<"story"> | null;
      if (stored === null) return null;
      await this.refusePluginEdit(stored, fields);
      return (await this.#records.edit(id, { audience: undefined, ...fields } as StoryEdit, options)) as SchemaRecord<"story"> | null;
    });
  }

  editContract(id: string, fields: ContractEdit, options?: ContractWriteOptions): Promise<SchemaRecord<"contract"> | null> {
    const { testedNumbers: tested = [], ...write } = options ?? {};
    return this.#serially(async () => {
      const own = (await liveRecord(this.#records, id, ["contract"])) as SchemaRecord<"contract"> | null;
      if (own === null) return null;
      await this.refusePluginEdit(own, fields);
      await checkReference(this.#records, "capability", fields.capability, "capability");
      await checkReference(this.#records, "edge", fields.edge, "edge");
      const owner: ContractEdit = fields.edge !== undefined && !("capability" in fields) ? { capability: undefined } : fields.capability !== undefined && !("edge" in fields) ? { edge: undefined } : {};
      const renumbered = fields.title === undefined && fields.capability !== undefined && fields.capability !== own.fields.capability ? await this.#movedTitle(own.fields.title, fields.capability, tested) : undefined;
      if (renumbered !== undefined) fields = { ...fields, title: renumbered };
      const onEdge = { ...own.fields, ...fields, ...owner };
      if (onEdge.edge !== undefined && onEdge.capability === undefined && (fields.title !== undefined || fields.edge !== undefined) && typeof onEdge.title === "string" && contractNumber(onEdge.title) === undefined) {
        const number = contractNumber(own.fields.title);
        fields = { ...fields, title: number !== undefined ? `${number} · ${onEdge.title}` : await this.#numbered(onEdge.title, (await this.#fromOf(onEdge.edge))!, tested) };
      }
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

  async #movedTitle(title: string, capability: string, tested: readonly string[]): Promise<string | undefined> {
    const number = contractNumber(title);
    const prefix = /^(\d+) · /.exec((await this.#titleOf(capability)) ?? "")?.[1];
    if (number === undefined || prefix === undefined || number.startsWith(`${prefix}.`)) return undefined;
    return this.#numbered(title.slice(number.length).replace(/^\s*·?\s*/, ""), capability, tested);
  }

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
          ...(capability.fields.parent === undefined ? {} : { parent: capability.fields.parent }),
          ...(capability.fields.covers === undefined ? {} : { covers: [...capability.fields.covers] }),
          ...(capability.fields.storeLinks === undefined ? {} : { storeLinks: structuredClone(capability.fields.storeLinks) }),
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

  async anchor(): Promise<Anchor | undefined> {
    const record = (await liveRecord(this.#records, ANCHOR_ID, ["anchor"])) as SchemaRecord<"anchor"> | null;
    if (record === null || (record.fields.what === undefined && record.fields.audience === undefined)) return undefined;
    return { ...record.fields };
  }

  setAnchor(fields: AnchorEdit, options?: WriteOptions): Promise<SchemaRecord<"anchor">> {
    return this.#serially(async () => {
      if ((await liveRecord(this.#records, ANCHOR_ID, ["anchor"])) === null) {
        const given = Object.fromEntries(Object.entries(fields).filter(([, value]) => value !== undefined));
        return this.#records.create("anchor", given as Anchor, { ...options, id: ANCHOR_ID });
      }
      return (await this.#records.edit(ANCHOR_ID, fields, options)) as SchemaRecord<"anchor">;
    });
  }

  async prCutover(): Promise<PrCutover | undefined> {
    const record = (await liveRecord(this.#records, PR_CUTOVER_ID, ["prCutover"])) as SchemaRecord<"prCutover"> | null;
    return record === null ? undefined : { ...record.fields };
  }

  setPrCutover(fields: Partial<PrCutover>, options?: WriteOptions): Promise<SchemaRecord<"prCutover">> {
    return this.#serially(async () => {
      if ((await liveRecord(this.#records, PR_CUTOVER_ID, ["prCutover"])) === null) {
        const before = fields.before !== undefined ? fields.before : fields.repository === undefined ? undefined : historyOf(fields.repository);
        return this.#records.create("prCutover", { ...fields, before } as PrCutover, { ...options, id: PR_CUTOVER_ID });
      }
      return (await this.#records.edit(PR_CUTOVER_ID, fields, options)) as SchemaRecord<"prCutover">;
    });
  }

  async #numbered(title: string, capability: string, tested: readonly string[]): Promise<string> {
    if (typeof title !== "string" || !couldBeId(capability)) return title;
    if (contractNumber(title) !== undefined) {
      await this.#refuseTakenNumber(title, capability);
      return separated(title);
    }
    const prefix = /^(\d+) · /.exec((await this.#titleOf(capability)) ?? "")?.[1];
    if (prefix === undefined) return title;
    const own = (numbers: readonly (string | undefined)[]) => numbers.flatMap((number) => (number?.startsWith(`${prefix}.`) ? [Number(number.slice(prefix.length + 1))] : []));
    const planned = own([...(await this.#contractsOf(capability)), ...(await this.#edgeContractsBeside(capability))].map((contract) => contractNumber(contract.fields.title)));
    return `${prefix}.${Math.max(0, ...planned, ...own(tested)) + 1} · ${title}`;
  }

  async #edgeContractsBeside(capability: string): Promise<SchemaRecord<"contract">[]> {
    const capabilities = await this.#records.list("capability");
    const story = capabilities.find(({ id }) => id === capability)?.fields.story;
    const inStory = new Set(capabilities.filter((one) => one.fields.story === story).map(({ id }) => id));
    const edges = new Set((await this.#records.list("edge")).filter(({ fields }) => inStory.has(fields.from)).map(({ id }) => id));
    return (await this.#records.list("contract")).filter((contract) => contract.fields.edge !== undefined && edges.has(contract.fields.edge));
  }

  async #capabilityNumbered(title: string, story: string, pending: readonly PendingPlanChange[]): Promise<string> {
    if (typeof title !== "string") return title;
    if (capabilityNumber(title) !== undefined) {
      await this.#refuseTakenCapabilityNumber(title, story, undefined, pending);
      return title;
    }
    return `${nextFree(await this.#capabilitiesOf(story, pending))} · ${title}`;
  }

  async #refuseParent(parent: unknown, story: unknown, self: string | undefined, levels: readonly string[] | undefined): Promise<void> {
    const refuse = (problem: string): never => { throw new SchemaError("capability", [{ field: "parent", problem }]); };
    const named = (await liveRecord(this.#records, parent, ["capability"])) as SchemaRecord<"capability"> | null;
    if (named === null) refuse(`${String(parent)} is no live capability`);
    if (named!.fields.story !== story) refuse(`${named!.id} is a capability of another story: a capability sits inside one of its own story's`);
    const capabilities = new Map((await this.#records.list("capability")).map((capability) => [capability.id, capability]));
    for (let at: string | undefined = named!.id; at !== undefined; at = capabilities.get(at)?.fields.parent) {
      if (at === self) refuse(`${named!.id} is ${self} itself or a capability inside it: a capability cannot sit inside itself`);
    }
    if (levels === undefined || levels.length === 0) refuse(`${named!.id} has no folder with its own entry file (index.ts, index.js or __init__.py) or nested package behind it: a capability sits inside another only where its code has such a level`);
  }

  async #refuseTakenCapabilityNumber(title: unknown, story: unknown, self?: string, pending: readonly PendingPlanChange[] = []): Promise<void> {
    const number = capabilityNumber(title);
    if (number === undefined || typeof story !== "string") return;
    const theirs = await this.#capabilitiesOf(story, pending);
    const holder = theirs.find((capability) => capability.id !== self && capabilityNumber(capability.fields.title) === number);
    if (holder !== undefined) {
      throw new SchemaError("capability", [{ field: "title", problem: `capability number ${number} is taken: ${holder.id} (${holder.fields.title}) carries it in this story; the next free number is ${nextFree(theirs)}` }]);
    }
  }

  async refusePluginEdit(record: SchemaRecord<"story"> | SchemaRecord<"capability"> | SchemaRecord<"contract"> | SchemaRecord<"edge">, fields: Readonly<Record<string, unknown>>): Promise<void> {
    if (record.type === "edge") {
      this.#refusePlugins("edge", "from", await this.#pluginOfCapability((record as SchemaRecord<"edge">).fields.from));
    } else if (record.type === "story") {
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

  refuseEdgeEnds(fields: Readonly<Record<string, unknown>>): void {
    for (const field of ["from", "to"]) {
      if (field in fields) throw new SchemaError("edge", [{ field, problem: "an edge keeps its two capabilities: retire it and add another" }]);
    }
  }

  #refusePlugins(type: "story" | "capability" | "contract" | "edge", field: string, plugin: string | undefined): void {
    if (plugin !== undefined) throw pluginsOwn(type, field, plugin);
  }

  async #pluginOfStory(story: unknown): Promise<string | undefined> {
    const record = couldBeId(story) ? await this.#records.get(story) : null;
    return record?.type === "story" ? (record as SchemaRecord<"story">).fields.plugin : undefined;
  }

  async #pluginOfCapability(capability: unknown): Promise<string | undefined> {
    const record = couldBeId(capability) ? await this.#records.get(capability) : null;
    return record?.type === "capability" ? this.#pluginOfStory((record as SchemaRecord<"capability">).fields.story) : undefined;
  }

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

  async #covered(story: string, covers: readonly unknown[] | undefined, self?: string): Promise<string[] | undefined> {
    const given = covers as string[] | undefined;
    const record = couldBeId(story) ? await this.#records.get(story) : null;
    if (record?.type !== "story") return given;
    const mapped = (record as SchemaRecord<"story">).fields.mapped;
    const refuse = (problem: string): never => { throw new SchemaError("capability", [{ field: "covers", problem }]); };
    if (mapped === undefined) {
      if (covers !== undefined) refuse("a capability of a story storytree built covers no folders: its numbered tests find its files");
      return undefined;
    }
    if (covers !== undefined && !Array.isArray(covers)) return given;
    if (covers === undefined || covers.length === 0) refuse(`a capability of the imported story ${story} names the folders and files of its import it covers`);
    if (!covers!.every((cover) => typeof cover === "string" && cover !== "")) return given;
    const paths = given!.map((cover) => {
      const plain = path.posix.normalize(cover.replaceAll("\\", "/")).replace(/(?<!\/)\/+$/, "") || ".";
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

  async #titleOf(capability: string): Promise<string | undefined> {
    const record = await this.#records.get(capability);
    return record?.type === "capability" ? (record as SchemaRecord<"capability">).fields.title : undefined;
  }

  async #refuseLoop(id: string, dependsOn: readonly unknown[]): Promise<void> {
    const graph = new Map<string, readonly unknown[]>(await this.#faces());
    graph.set(id, dependsOn);
    const loop = loopThrough(id, graph);
    if (loop !== undefined) throw new DependencyLoopError(loop);
  }

  async #faces(): Promise<Map<string, string[]>> {
    const [capabilities, edges] = await Promise.all([this.#records.list("capability"), this.#records.list("edge")]);
    return facesOf(capabilities, storyEdges(capabilities, edges));
  }

  async #faceOf(id: string): Promise<string[]> {
    return (await this.#faces()).get(id) ?? [];
  }

  async #fromOf(edge: unknown): Promise<string | undefined> {
    const record = couldBeId(edge) ? await this.#records.get(edge) : null;
    return record?.type === "edge" ? (record as SchemaRecord<"edge">).fields.from : undefined;
  }

  async #split(story: string, dependsOn: readonly string[]): Promise<{ same: string[]; cross: string[] }> {
    const stories = new Map((await this.#records.list("capability")).map((capability) => [capability.id, capability.fields.story]));
    const unique = [...new Set(dependsOn)];
    return { same: unique.filter((to) => stories.get(to) === story), cross: unique.filter((to) => stories.get(to) !== story) };
  }

  async #dependentsOf(id: string): Promise<Relinked[]> {
    const faces = await this.#faces();
    const capabilities = await this.#records.list("capability");
    return capabilities.filter((capability) => capability.id !== id && (faces.get(capability.id) ?? []).includes(id)).map((capability) => ({ id: capability.id, story: capability.fields.story, face: faces.get(capability.id) ?? [] }));
  }

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

  async #applyRelink(plan: RelinkPlan, options?: WriteOptions): Promise<void> {
    for (const edge of plan.retire) await this.#records.retire(edge, "its capability no longer depends on that one inside its story", options);
    for (const to of plan.add) await this.#records.create("edge", { from: plan.id, to }, options);
    const stored = (await this.#records.get(plan.id)) as SchemaRecord<"capability"> | null;
    if (stored !== null && !isDeepStrictEqual(stored.fields.dependsOn ?? [], plan.cross)) await this.#records.edit(plan.id, { dependsOn: plan.cross }, options);
  }

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

  #serially<T>(write: () => Promise<T>): Promise<T> {
    const result = this.#lastWrite.then(() => write());
    this.#lastWrite = result.catch(() => undefined);
    return result;
  }
}

interface Relinked {
  readonly id: string;
  readonly story: string;
  readonly face: readonly string[];
}
interface RelinkPlan {
  readonly id: string;
  readonly add: string[];
  readonly retire: string[];
  readonly cross: string[];
}

function storyEdges(capabilities: readonly SchemaRecord<"capability">[], edges: readonly SchemaRecord<"edge">[]): SchemaRecord<"edge">[] {
  const stories = new Map(capabilities.map((capability) => [capability.id, capability.fields.story]));
  return edges.filter((edge) => edge.fields.from !== edge.fields.to && stories.has(edge.fields.from) && stories.get(edge.fields.from) === stories.get(edge.fields.to));
}

function facesOf(capabilities: readonly SchemaRecord<"capability">[], edges: readonly SchemaRecord<"edge">[]): Map<string, string[]> {
  const from = childrenByParent(edges, (edge) => edge.fields.from);
  return new Map(capabilities.map((capability) => [capability.id, [...new Set([...(from.get(capability.id) ?? []).map((edge) => edge.fields.to), ...(capability.fields.dependsOn ?? [])])]]));
}

function withFace(record: SchemaRecord<"capability">, face: string[]): SchemaRecord<"capability"> {
  if (face.length === 0 && record.fields.dependsOn === undefined) return record;
  return { ...record, fields: { ...record.fields, dependsOn: face } };
}

function within(inner: string, outer: string): boolean {
  return outer === "." || inner === outer || inner.startsWith(`${outer}/`);
}

function refuseMapped(fields: object): void {
  if ("mapped" in fields) throw new SchemaError("story", [{ field: "mapped", problem: "only importing a project makes an imported story" }]);
  if ("plugin" in fields) throw new SchemaError("story", [{ field: "plugin", problem: "a story is made a plugin's only by importing its plan (storytree plugin import-plan)" }]);
}

const PLUGIN_STORY_FIELDS = ["title", "description", "text", "plugin"] as const;
const PLUGIN_CAPABILITY_FIELDS = ["title", "description", "text", "proposed", "dependsOn", "story"] as const;
const PLUGIN_CONTRACT_FIELDS = ["title", "description", "proof", "capability"] as const;
const GUARDED_PLAN_FIELDS = new Set(["title", "description", "text", "proposed", "proof"]);

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

function sameMembers(one: readonly string[], other: readonly string[]): boolean {
  const mine = new Set(one);
  const theirs = new Set(other);
  return mine.size === theirs.size && [...mine].every((id) => theirs.has(id));
}

function withoutContracts({ contracts: _contracts, ...fields }: PluginPlanCapability): Omit<PluginPlanCapability, "contracts"> {
  return fields;
}

function pluginsOwn(type: "story" | "capability" | "contract" | "edge", field: string, plugin: string): SchemaError {
  return new SchemaError(type, [{ field, problem: `this is ${plugin}'s plan: edit plugins/${plugin}'s plan file in the factory and import it (storytree plugin import-plan ${plugin})` }]);
}

type NodeHead = Pick<StoryNode, "id" | "title" | "description">;

function nodeOf(record: PlanRecord): NodeHead {
  const { title, description } = record.fields;
  return { id: record.id, title, ...(description === undefined ? {} : { description }) };
}

function guardrailsOf(record: SchemaRecord<"story"> | SchemaRecord<"capability">): { guardrails?: Guardrail[] } {
  const { guardrails } = record.fields;
  return guardrails === undefined ? {} : { guardrails: guardrails.map((guardrail) => ({ ...guardrail })) };
}

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

function loopThrough(start: string, graph: ReadonlyMap<string, readonly unknown[]>): string[] | undefined {
  const dependenciesOf = (id: string): Iterator<unknown> => (graph.get(id) ?? []).values();
  const path = [{ id: start, next: dependenciesOf(start) }];
  const reached = new Set([start]);
  for (let step = path.at(-1); step !== undefined; step = path.at(-1)) {
    const next = step.next.next();
    if (next.done === true) {
      path.pop();
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

function capabilityNumber(title: unknown): number | undefined {
  const number = typeof title === "string" ? /^(\d+) · /.exec(title)?.[1] : undefined;
  return number === undefined ? undefined : Number(number);
}

function nextFree(capabilities: readonly SchemaRecord<"capability">[]): number {
  return Math.max(0, ...capabilities.flatMap((capability) => capabilityNumber(capability.fields.title) ?? [])) + 1;
}

function separated(title: string): string {
  return title.replace(/^(\d+\.\d+)\s+(?!·)(?=\S)/, "$1 · ");
}

function contractNumber(title: string): string | undefined {
  return /^(\d+\.\d+)(?![\d.])/.exec(title)?.[1];
}

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
