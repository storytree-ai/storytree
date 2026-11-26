// Capability 4 · Work model
import path from "node:path";
import { isDeepStrictEqual } from "node:util";

import {
  DependencyLoopError,
  findLoop,
  liveOf,
  referTo,
  SchemaError,
  type FieldsOf,
  type SchemaRecord,
  type SchemaRecords,
  type WriteOptions,
} from "../storage/rules/index.js";
import type { PendingPlanChange } from "./kinds.js";
import { capabilityNumber, contractNumber, separated, unnumbered } from "./numbers.js";
import { importPluginPlan, type ImportedPluginPlan, type PluginImportOptions, type PluginPlan } from "./plugin-plan.js";
import {
  contractsOfStory,
  dependsOnOf,
  edgesFrom,
  edgesTo,
  holdsContracts,
  listed,
  nextContract,
  prefixOf,
  readPlan,
  storyOfContract,
  withDependsOn,
  type Plan,
} from "./snapshot.js";
import { ANCHOR_ID, treeOf, type Anchor, type ProjectTree } from "./tree.js";

export type NewStory = Omit<FieldsOf<"story">, "mapped" | "plugin">;
export type StoryEdit = { [F in keyof NewStory]?: NewStory[F] | undefined };
export type NewCapability = Omit<FieldsOf<"capability">, "proposed"> & { proposed?: boolean };
export type CapabilityEdit = { [F in keyof FieldsOf<"capability">]?: FieldsOf<"capability">[F] | undefined };
export type NewContract = FieldsOf<"contract">;
export type ContractEdit = { [F in keyof FieldsOf<"contract">]?: FieldsOf<"contract">[F] | undefined };
export type NewEdge = FieldsOf<"edge">;
export type EdgeEdit = { description?: string | undefined };
export type AnchorEdit = { [F in keyof Anchor]?: Anchor[F] | undefined };

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

export interface MovedToEdges {
  readonly edges: string[];
  readonly capabilities: string[];
}

export interface ContractWriteOptions extends WriteOptions {
  readonly testedNumbers?: readonly string[];
}

export interface CapabilityWriteOptions extends WriteOptions {
  readonly pending?: readonly PendingPlanChange[];
  readonly levels?: readonly string[];
}

type Fields = Record<string, unknown>;
type PlanRecord = SchemaRecord<"story"> | SchemaRecord<"capability"> | SchemaRecord<"contract"> | SchemaRecord<"edge">;

const PLUGIN_FIELD = { story: "plugin", capability: "story", contract: "capability", edge: "from" } as const;

export class WorkModel {
  readonly #records: SchemaRecords;

  constructor(records: SchemaRecords) {
    this.#records = records;
  }

  async addStory(story: NewStory, options: WriteOptions = {}): Promise<SchemaRecord<"story">> {
    refuseImportFields(story);
    return await this.#records.create("story", story, writing(options));
  }

  async editStory(id: string, fields: StoryEdit, options: WriteOptions = {}): Promise<SchemaRecord<"story"> | null> {
    return await this.#write(options, async () => {
      const story = await liveOf(this.#records, "story", id);
      if (story === null) return null;
      refuseImportFields(fields);
      await this.refusePluginEdit(story, fields);
      return (await this.#records.edit(id, { audience: undefined, ...fields } as never, writing(options))) as SchemaRecord<"story">;
    });
  }

  async mapStories(from: string, packages: readonly MappedPackage[], options: WriteOptions = {}): Promise<MappedStories> {
    return await this.#write(options, async () => {
      const mapped = (await listed(this.#records, "story")).filter((story) => story.fields.mapped?.from === from);
      const known = new Set(mapped.map((story) => story.fields.mapped!.package));
      const added: SchemaRecord<"story">[] = [];
      for (const each of packages) {
        if (known.has(each.package)) continue;
        known.add(each.package);
        const fields = { title: each.title, ...(each.description === undefined ? {} : { description: each.description }), mapped: { from, package: each.package, folders: [...each.folders] } };
        added.push(await this.#records.create("story", fields, writing(options)));
      }
      const wanted = new Set(packages.map((each) => each.package));
      const retired: string[] = [];
      const kept: string[] = [];
      for (const story of mapped) {
        const name = story.fields.mapped!.package;
        if (wanted.has(name)) {
          kept.push(story.id);
          continue;
        }
        await this.#records.retire(story.id, `its package ${name} is gone from ${from}`, writing(options));
        retired.push(story.id);
      }
      return { added, retired, kept };
    });
  }

  async importPluginPlan(plugin: string, plan: PluginPlan, options: PluginImportOptions = {}): Promise<ImportedPluginPlan> {
    return await this.#write(options, () => importPluginPlan(this.#records, plugin, plan, options));
  }

  async addCapability(capability: NewCapability, options: CapabilityWriteOptions = {}): Promise<SchemaRecord<"capability">> {
    return await this.#write(options, async () => {
      const fields: Fields = { ...capability, proposed: capability.proposed ?? true };
      this.#records.check("capability", fields);
      const story = await referTo(this.#records, "story", capability.story, "story");
      await this.refusePluginEdit(story, {});
      const plan = await readPlan(this.#records);
      if (capability.parent !== undefined) checkParent(plan, undefined, story.id, capability.parent, options.levels);
      const { title, next } = numberCapability(plan, story.id, capability.title, undefined, options.pending);
      fields["title"] = capabilityNumber(title) === undefined ? `${next} · ${title}` : title;
      setOrDrop(fields, "covers", coveredPaths(plan, story, undefined, capability.covers));
      const dependsOn = capability.dependsOn;
      const same: string[] = [];
      if (dependsOn !== undefined) {
        for (const id of dependsOn) await referTo(this.#records, "dependsOn", id, "capability");
        same.push(...new Set(dependsOn.filter((id) => plan.capabilities.get(id)?.fields.story === story.id)));
        fields["dependsOn"] = dependsOn.filter((id) => !same.includes(id));
      }
      const created = await this.#records.create("capability", fields as FieldsOf<"capability">, writing(options));
      for (const to of same) await this.#records.create("edge", { from: created.id, to }, writing(options));
      return withDependsOn(await readPlan(this.#records), created);
    });
  }

  async editCapability(id: string, edit: CapabilityEdit, options: CapabilityWriteOptions = {}): Promise<SchemaRecord<"capability"> | null> {
    return await this.#write(options, async () => {
      const current = await liveOf(this.#records, "capability", id);
      if (current === null) return null;
      const { dependsOn: given, ...rest } = edit;
      const fields = present({ ...current.fields, ...rest });
      this.#records.check("capability", "dependsOn" in edit ? { ...fields, dependsOn: given } : fields);
      const plan = await readPlan(this.#records);
      const target = String(fields["story"]);
      const moving = target !== current.fields.story;
      const story = moving ? await referTo(this.#records, "story", target, "story") : plan.stories.get(target);
      await this.refusePluginEdit(current, edit);
      if (moving && (fields["parent"] !== undefined || [...plan.capabilities.values()].some((other) => other.fields.parent === id))) {
        refuseParent("a capability with a parent, or with capabilities inside it, stays in its story");
      }
      if (edit.parent !== undefined) checkParent(plan, id, target, edit.parent, options.levels);
      if ("title" in edit || moving) numberCapability(plan, target, String(fields["title"]), id, options.pending);
      if ("covers" in edit || moving) setOrDrop(fields, "covers", coveredPaths(plan, story, id, fields["covers"] as string[] | undefined));

      const wanted = "dependsOn" in edit ? (given ?? []) : dependsOnOf(plan, id);
      if ("dependsOn" in edit) {
        for (const dependency of wanted) await referTo(this.#records, "dependsOn", dependency, "capability");
        const loop = findLoop(id, wanted, (other) => dependsOnOf(plan, other));
        if (loop !== undefined) throw new DependencyLoopError(loop);
      }
      const writes: (() => Promise<unknown>)[] = [];
      if ("dependsOn" in edit || moving) {
        const same = [...new Set(wanted.filter((other) => plan.capabilities.get(other)?.fields.story === target))];
        const others = wanted.filter((other) => !same.includes(other));
        const own = edgesFrom(plan, id);
        const dropped = own.filter((edge) => !same.includes(edge.fields.to));
        const incoming = moving ? edgesTo(plan, id).filter((edge) => plan.capabilities.get(edge.fields.from)?.fields.story !== target) : [];
        for (const edge of [...dropped, ...incoming]) {
          if (holdsContracts(plan, edge.id)) refuse("capability", "dependsOn", `dropping the edge ${edge.id} would lose the contracts it holds: move them first`);
        }
        setOrDrop(fields, "dependsOn", others.length > 0 || fields["dependsOn"] !== undefined ? others : undefined);
        for (const edge of [...dropped, ...incoming]) writes.push(() => this.#records.retire(edge.id, `${id}'s dependsOn no longer names it as one story's`, writing(options)));
        for (const to of same) if (!own.some((edge) => edge.fields.to === to)) writes.push(() => this.#records.create("edge", { from: id, to }, writing(options)));
        for (const edge of incoming) {
          const from = plan.capabilities.get(edge.fields.from)!;
          writes.push(() => this.#records.edit(from.id, { dependsOn: [...(from.fields.dependsOn ?? []), id] }, writing(options)));
        }
      }
      if (!isDeepStrictEqual(fields, current.fields)) {
        const changes = Object.fromEntries([...new Set([...Object.keys(current.fields), ...Object.keys(fields)])].map((key) => [key, fields[key]]));
        await this.#records.edit(id, changes as never, writing(options));
      }
      for (const write of writes) await write();
      const after = await readPlan(this.#records);
      return withDependsOn(after, after.capabilities.get(id)!);
    });
  }

  async setProposed(id: string, proposed: boolean, options: WriteOptions = {}): Promise<SchemaRecord<"capability"> | null> {
    return await this.#write(options, async () => {
      const current = await liveOf(this.#records, "capability", id);
      if (current === null) return null;
      await this.refusePluginEdit(current, { proposed });
      const edited = (await this.#records.edit(id, { proposed }, writing(options))) as SchemaRecord<"capability">;
      return withDependsOn(await readPlan(this.#records), edited);
    });
  }

  async addContract(contract: NewContract, options: ContractWriteOptions = {}): Promise<SchemaRecord<"contract">> {
    return await this.#write(options, async () => {
      this.#records.check("contract", contract);
      const owner = await this.#contractOwner(contract);
      await this.refusePluginEdit(owner, {});
      const plan = await readPlan(this.#records);
      const story = storyOfContract(plan, contract);
      let title = separated(contract.title);
      const prefix = prefixOf(plan, contract);
      if (contractNumber(title) === undefined && prefix !== undefined) title = `${prefix}.${nextContract(plan, story, prefix, undefined, options.testedNumbers)} · ${title}`;
      else refuseTakenContract(plan, story, title, undefined);
      return await this.#records.create("contract", { ...contract, title }, writing(options));
    });
  }

  async editContract(id: string, edit: ContractEdit, options: ContractWriteOptions = {}): Promise<SchemaRecord<"contract"> | null> {
    return await this.#write(options, async () => {
      const current = await liveOf(this.#records, "contract", id);
      if (current === null) return null;
      const fields = present({
        ...current.fields,
        ...(edit.edge !== undefined && !("capability" in edit) ? { capability: undefined } : {}),
        ...(edit.capability !== undefined && !("edge" in edit) ? { edge: undefined } : {}),
        ...edit,
      }) as FieldsOf<"contract">;
      this.#records.check("contract", fields);
      await this.refusePluginEdit(current, edit);
      const moving = fields.capability !== current.fields.capability || fields.edge !== current.fields.edge;
      if (moving) await this.refusePluginEdit(await this.#contractOwner(fields), {});
      const plan = await readPlan(this.#records);
      const story = storyOfContract(plan, fields);
      const prefix = prefixOf(plan, fields);
      const given = edit.title === undefined ? undefined : separated(edit.title);
      let title = given ?? current.fields.title;
      if (given === undefined || contractNumber(given) === undefined) {
        const own = contractNumber(current.fields.title);
        const bare = unnumbered(given ?? current.fields.title);
        const renumber = moving && prefix !== undefined && (own === undefined || (given === undefined && fields.capability !== undefined && own.capability !== prefix));
        if (renumber) title = `${prefix}.${nextContract(plan, story, prefix, id, options.testedNumbers)} · ${bare}`;
        else title = own === undefined ? bare : `${own.capability}.${own.contract} · ${bare}`;
      }
      if (title !== current.fields.title || moving) refuseTakenContract(plan, story, title, id);
      const changes = Object.fromEntries([...new Set([...Object.keys(current.fields), ...Object.keys(fields)])].map((key) => [key, key === "title" ? title : (fields as Fields)[key]]));
      return (await this.#records.edit(id, changes as never, writing(options))) as SchemaRecord<"contract">;
    });
  }

  async addEdge(edge: NewEdge, options: WriteOptions = {}): Promise<SchemaRecord<"edge">> {
    return await this.#write(options, async () => {
      this.#records.check("edge", edge);
      const from = await referTo(this.#records, "from", edge.from, "capability");
      const to = await referTo(this.#records, "to", edge.to, "capability");
      await this.#refusePlugin("edge", "from", from.id, [from.fields.story]);
      if (from.fields.story !== to.fields.story) refuse("edge", "to", `${to.id} is another story's capability: an edge joins two capabilities of one story`);
      if (from.id === to.id) refuse("edge", "to", `an edge joins two capabilities, never one to itself`);
      const plan = await readPlan(this.#records);
      if (edgesFrom(plan, from.id).some((other) => other.fields.to === to.id)) refuse("edge", "to", `the story already has an edge from ${from.id} to ${to.id}`);
      const loop = findLoop(from.id, [to.id], (other) => dependsOnOf(plan, other));
      if (loop !== undefined) throw new DependencyLoopError(loop);
      return await this.#records.create("edge", edge, writing(options));
    });
  }

  async editEdge(id: string, fields: EdgeEdit, options: WriteOptions = {}): Promise<SchemaRecord<"edge"> | null> {
    return await this.#write(options, async () => {
      const current = await liveOf(this.#records, "edge", id);
      if (current === null) return null;
      this.refuseEdgeEnds(fields);
      await this.refusePluginEdit(current, fields);
      return (await this.#records.edit(id, fields, writing(options))) as SchemaRecord<"edge">;
    });
  }

  async dependsOn(id: string): Promise<string[] | null> {
    const plan = await readPlan(this.#records);
    return plan.capabilities.has(id) ? dependsOnOf(plan, id) : null;
  }

  async moveDependsOnToEdges(options: WriteOptions = {}): Promise<MovedToEdges> {
    return await this.#write(options, async () => {
      const plan = await readPlan(this.#records);
      const moved = { edges: [] as string[], capabilities: [] as string[] };
      for (const capability of plan.capabilities.values()) {
        const stored = capability.fields.dependsOn ?? [];
        const same = stored.filter((id) => plan.capabilities.get(id)?.fields.story === capability.fields.story);
        if (same.length === 0) continue;
        for (const to of new Set(same)) {
          if (edgesFrom(plan, capability.id).some((edge) => edge.fields.to === to)) continue;
          moved.edges.push((await this.#records.create("edge", { from: capability.id, to }, writing(options))).id);
        }
        await this.#records.edit(capability.id, { dependsOn: stored.filter((id) => !same.includes(id)) }, writing(options));
        moved.capabilities.push(capability.id);
      }
      return moved;
    });
  }

  async projectTree(): Promise<ProjectTree> {
    return treeOf(await readPlan(this.#records), await listed(this.#records, "arc"), await this.anchor());
  }

  async anchor(): Promise<Anchor | undefined> {
    return (await liveOf(this.#records, "anchor", ANCHOR_ID))?.fields;
  }

  async setAnchor(fields: AnchorEdit, options: WriteOptions = {}): Promise<SchemaRecord<"anchor">> {
    return await this.#write(options, async () => {
      if ((await liveOf(this.#records, "anchor", ANCHOR_ID)) === null) {
        return await this.#records.create("anchor", present(fields) as Anchor, { ...writing(options), id: ANCHOR_ID });
      }
      return (await this.#records.edit(ANCHOR_ID, fields, writing(options))) as SchemaRecord<"anchor">;
    });
  }

  async refusePluginEdit(record: PlanRecord, fields: Readonly<Record<string, unknown>>): Promise<void> {
    const stories: (string | undefined)[] = [typeof fields["story"] === "string" ? fields["story"] : undefined];
    if (record.type === "story") stories.push(record.id);
    else if (record.type === "capability") stories.push(record.fields.story);
    else {
      const plan = await readPlan(this.#records);
      stories.push(record.type === "edge" ? plan.capabilities.get(record.fields.from)?.fields.story : storyOfContract(plan, record.fields));
    }
    await this.#refusePlugin(record.type, PLUGIN_FIELD[record.type], record.id, stories);
  }

  refuseEdgeEnds(fields: Readonly<Record<string, unknown>>): void {
    for (const end of ["from", "to"]) {
      if (Object.hasOwn(fields, end)) refuse("edge", end, "an edge keeps its two capabilities: retire it and plan another");
    }
  }

  async #refusePlugin(type: string, field: string, id: string, stories: readonly (string | undefined)[]): Promise<void> {
    for (const story of stories) {
      if (story === undefined) continue;
      const plugin = (await liveOf(this.#records, "story", story))?.fields.plugin;
      if (plugin !== undefined) refuse(type, field, `${id} is ${plugin}'s plan's to write: change ${plugin}'s plan file and import it`);
    }
  }

  async #contractOwner(fields: { readonly capability?: string | undefined; readonly edge?: string | undefined }): Promise<SchemaRecord<"capability"> | SchemaRecord<"edge">> {
    if (fields.capability !== undefined) return await referTo(this.#records, "capability", fields.capability, "capability");
    return await referTo(this.#records, "edge", fields.edge ?? "", "edge");
  }

  async #write<T>(options: WriteOptions, work: () => Promise<T>): Promise<T> {
    return await this.#records.inOneWrite(work, options.signal);
  }
}

function writing(options: WriteOptions & { readonly reason?: string }): WriteOptions & { readonly reason?: string } {
  return { ...(options.actor === undefined ? {} : { actor: options.actor }), ...(options.reason === undefined ? {} : { reason: options.reason }) };
}

function present(fields: Fields): Fields {
  return Object.fromEntries(Object.entries(fields).filter(([, value]) => value !== undefined));
}

function setOrDrop(fields: Fields, field: string, value: unknown): void {
  if (value === undefined) delete fields[field];
  else fields[field] = value;
}

function refuse(type: string, field: string, problem: string): never {
  throw new SchemaError(type, [{ field, problem: `${JSON.stringify(field)}: ${problem}` }]);
}

function refuseParent(problem: string): never {
  refuse("capability", "parent", problem);
}

function refuseImportFields(fields: Readonly<Record<string, unknown>>): void {
  const given = ["mapped", "plugin"].filter((field) => fields[field] !== undefined);
  if (given.length === 0) return;
  throw new SchemaError("story", given.map((field) => ({
    field,
    problem: field === "mapped" ? `"mapped": only mapStories makes an imported story` : `"plugin": only importing a plugin's plan makes a plugin's story`,
  })));
}

function checkParent(plan: Plan, id: string | undefined, story: string, parent: string, levels: readonly string[] | undefined): void {
  const holder = plan.capabilities.get(parent);
  if (holder === undefined || holder.fields.story !== story) refuseParent(`${parent} is no live capability of the story`);
  const seen = new Set<string>();
  for (let at: string | undefined = parent; at !== undefined && !seen.has(at); at = plan.capabilities.get(at)?.fields.parent) {
    if (at === id) refuseParent(at === parent ? `${parent} is the capability itself` : `${parent} is inside the capability`);
    seen.add(at);
  }
  if (levels === undefined || levels.length === 0) {
    refuseParent(`no folder with its own entry file (index.ts, index.js or __init__.py) or nested package stands behind ${parent}, so nothing makes it a capability inside ${parent}`);
  }
}

function numberCapability(plan: Plan, story: string, title: string, id: string | undefined, pending: readonly PendingPlanChange[] = []): { title: string; next: number } {
  const read = new Map([...plan.capabilities].map(([key, capability]) => [key, capability.fields as Fields]));
  for (const change of pending) {
    if (change.type !== "capability" || !read.has(change.record)) continue;
    if ("retire" in change) read.delete(change.record);
    else read.set(change.record, { ...read.get(change.record), ...change.after });
  }
  const mine = [...read].filter(([, fields]) => fields["story"] === story).map(([key, fields]) => ({ id: key, number: capabilityNumber(String(fields["title"])) }));
  const next = Math.max(0, ...mine.flatMap(({ number }) => (number === undefined ? [] : [number]))) + 1;
  const number = capabilityNumber(title);
  const holder = number === undefined ? undefined : mine.find((other) => other.id !== id && other.number === number);
  if (holder !== undefined) refuse("capability", "title", `capability number ${number} is taken: ${holder.id}; the story's next free number is ${next}`);
  return { title, next };
}

function refuseTakenContract(plan: Plan, story: string | undefined, title: string, id: string | undefined): void {
  const number = contractNumber(title);
  if (number === undefined) return;
  const holder = contractsOfStory(plan, story, id).find((other) => isDeepStrictEqual(contractNumber(other.fields.title), number));
  if (holder !== undefined) refuse("contract", "title", `contract number ${number.capability}.${number.contract} is taken: ${holder.id}`);
}

function coveredPaths(plan: Plan, story: SchemaRecord<"story"> | undefined, id: string | undefined, covers: readonly string[] | undefined): string[] | undefined {
  const mapped = story?.fields.mapped;
  if (story === undefined || mapped === undefined) {
    if (covers !== undefined) refuse("capability", "covers", "a capability of a story storytree built is found by its tests, so it names no covers");
    return undefined;
  }
  if (covers === undefined || covers.length === 0) refuse("capability", "covers", `a capability of an imported story names the folders and files of ${mapped.from} it covers`);
  const folders = mapped.folders.map(plain);
  const paths = covers.map(plain);
  for (const each of paths) {
    if (each === ".." || each.startsWith("../") || path.posix.isAbsolute(each)) refuse("capability", "covers", `${each} is outside ${mapped.from}`);
    if (!folders.some((folder) => inside(each, folder))) refuse("capability", "covers", `${each} is outside the story's folders (${folders.join(", ")})`);
  }
  for (const other of plan.capabilities.values()) {
    if (other.id === id || other.fields.story !== story.id) continue;
    for (const each of paths) {
      const held = other.fields.covers?.find((covered) => inside(each, covered) || inside(covered, each));
      if (held !== undefined) refuse("capability", "covers", `${each} overlaps ${held}, which ${other.id} covers: edit that capability instead`);
    }
  }
  return paths;
}

function plain(file: string): string {
  const normal = path.posix.normalize(file.replaceAll("\\", "/")).replace(/\/$/, "");
  return normal === "" ? "." : normal;
}

function inside(file: string, folder: string): boolean {
  return folder === "." || file === folder || file.startsWith(`${folder}/`);
}
